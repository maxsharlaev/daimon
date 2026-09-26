package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"al.essio.dev/pkg/shellescape"
	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/volume"
	"github.com/docker/docker/client"
	"github.com/docker/go-units"
)

type volumeUsage struct {
	refCount  int
	sizeBytes int64
}

const volumeUsageCacheTTL = 5 * time.Second

var volumeUsageCache = struct {
	mu       sync.Mutex
	local    map[string]volumeUsage
	localAt  time.Time
	remote   map[string]map[string]volumeUsage
	remoteAt map[string]time.Time
}{
	remote:   map[string]map[string]volumeUsage{},
	remoteAt: map[string]time.Time{},
}

func getLocalVolumeUsageMap(cli *client.Client) (map[string]volumeUsage, error) {
	volumeUsageCache.mu.Lock()
	if volumeUsageCache.local != nil && time.Since(volumeUsageCache.localAt) < volumeUsageCacheTTL {
		out := volumeUsageCache.local
		volumeUsageCache.mu.Unlock()
		return out, nil
	}
	volumeUsageCache.mu.Unlock()

	du, err := cli.DiskUsage(context.Background(), types.DiskUsageOptions{
		Types: []types.DiskUsageObject{types.VolumeObject},
	})
	if err != nil {
		return nil, err
	}
	out := map[string]volumeUsage{}
	for _, v := range du.Volumes {
		if v.UsageData == nil {
			continue
		}
		out[v.Name] = volumeUsage{
			refCount:  int(v.UsageData.RefCount),
			sizeBytes: int64(v.UsageData.Size),
		}
	}
	volumeUsageCache.mu.Lock()
	volumeUsageCache.local = out
	volumeUsageCache.localAt = time.Now()
	volumeUsageCache.mu.Unlock()
	return out, nil
}

func getRemoteVolumeUsageMap(sessionId string, exec func(sessionId string, cmd string) (string, error)) (map[string]volumeUsage, error) {
	volumeUsageCache.mu.Lock()
	if cached, ok := volumeUsageCache.remote[sessionId]; ok && time.Since(volumeUsageCache.remoteAt[sessionId]) < volumeUsageCacheTTL {
		volumeUsageCache.mu.Unlock()
		return cached, nil
	}
	volumeUsageCache.mu.Unlock()

	raw, err := exec(sessionId, "docker system df -v")
	if err != nil {
		return nil, err
	}
	out := parseDockerSystemDFVolumes(raw)
	volumeUsageCache.mu.Lock()
	volumeUsageCache.remote[sessionId] = out
	volumeUsageCache.remoteAt[sessionId] = time.Now()
	volumeUsageCache.mu.Unlock()
	return out, nil
}

func parseDockerSystemDFVolumes(raw string) map[string]volumeUsage {
	out := map[string]volumeUsage{}
	scanner := bufio.NewScanner(strings.NewReader(raw))
	inVolumes := false
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "Local Volumes space usage:") {
			inVolumes = true
			continue
		}
		if !inVolumes {
			continue
		}
		if line == "" {
			break
		}
		if strings.HasPrefix(line, "VOLUME NAME") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		name := fields[0]
		refCount, err := strconv.Atoi(fields[1])
		if err != nil {
			refCount = -1
		}
		sizeBytes, err := units.FromHumanSize(fields[2])
		if err != nil {
			sizeBytes = -1
		}
		out[name] = volumeUsage{refCount: refCount, sizeBytes: sizeBytes}
	}
	return out
}

func getLocalVolumeUsedBy(ctx context.Context, cli *client.Client, volumeName string) []string {
	list, err := cli.ContainerList(ctx, container.ListOptions{All: true})
	if err != nil {
		return nil
	}
	out := []string{}
	for _, c := range list {
		inspect, err := cli.ContainerInspect(ctx, c.ID)
		if err != nil {
			continue
		}
		name := strings.TrimPrefix(inspect.Name, "/")
		for _, m := range inspect.Mounts {
			if m.Type == "volume" && m.Name == volumeName {
				entry := name
				if m.Destination != "" {
					entry = fmt.Sprintf("%s:%s", name, m.Destination)
				}
				out = append(out, entry)
			}
		}
	}
	return out
}

func getRemoteVolumeUsedBy(sessionId string, volumeName string, exec func(sessionId string, cmd string) (string, error)) []string {
	rawIDs, err := exec(sessionId, "docker ps -aq")
	if err != nil {
		return nil
	}
	ids := splitLines(rawIDs)
	if len(ids) == 0 {
		return nil
	}
	quoted := make([]string, 0, len(ids))
	for _, id := range ids {
		if id == "" {
			continue
		}
		quoted = append(quoted, shellescape.Quote(id))
	}
	if len(quoted) == 0 {
		return nil
	}
	cmd := fmt.Sprintf("docker inspect %s", strings.Join(quoted, " "))
	rawInspect, err := exec(sessionId, cmd)
	if err != nil {
		return nil
	}
	var arr []struct {
		ID     string `json:"Id"`
		Name   string `json:"Name"`
		Mounts []struct {
			Type        string `json:"Type"`
			Name        string `json:"Name"`
			Destination string `json:"Destination"`
		} `json:"Mounts"`
	}
	if err := json.Unmarshal([]byte(rawInspect), &arr); err != nil {
		return nil
	}
	out := []string{}
	for _, c := range arr {
		name := strings.TrimPrefix(c.Name, "/")
		for _, m := range c.Mounts {
			if m.Type == "volume" && m.Name == volumeName {
				entry := name
				if m.Destination != "" {
					entry = fmt.Sprintf("%s:%s", name, m.Destination)
				}
				out = append(out, entry)
			}
		}
	}
	return out
}

func cleanupLocalTempContainersByLabels(ctx context.Context, cli *client.Client, labels []string) error {
	args := filters.NewArgs()
	for _, label := range labels {
		if strings.TrimSpace(label) == "" {
			continue
		}
		args.Add("label", label)
	}
	list, err := cli.ContainerList(ctx, container.ListOptions{All: true, Filters: args})
	if err != nil {
		return err
	}
	for _, c := range list {
		_ = cli.ContainerRemove(ctx, c.ID, container.RemoveOptions{Force: true})
	}
	return nil
}

func cleanupLocalTempContainers(ctx context.Context, cli *client.Client, volumeName string) error {
	labels := []string{"daimon.temp=true"}
	if volumeName != "" {
		labels = append(labels, fmt.Sprintf("daimon.temp.volume=%s", volumeName))
	}
	return cleanupLocalTempContainersByLabels(ctx, cli, labels)
}

func (a *App) DockerLocalCleanupTempContainers(volumeName string) error {
	cli, err := dockerClient()
	if err != nil {
		return err
	}
	defer cli.Close()
	return cleanupLocalTempContainers(context.Background(), cli, volumeName)
}

func (a *App) DockerRemoteCleanupTempContainers(sessionId string, volumeName string) error {
	if sessionId == "" {
		return errors.New("sessionId required")
	}
	labels := []string{"daimon.temp=true"}
	if volumeName != "" {
		labels = append(labels, fmt.Sprintf("daimon.temp.volume=%s", volumeName))
	}
	return cleanupRemoteTempContainersByLabels(sessionId, labels, a.ssh.Exec)
}

func cleanupRemoteTempContainersByLabels(sessionId string, labels []string, exec func(sessionId string, cmd string) (string, error)) error {
	var parts []string
	for _, label := range labels {
		if strings.TrimSpace(label) == "" {
			continue
		}
		parts = append(parts, fmt.Sprintf("--filter %s", shellescape.Quote("label="+label)))
	}
	cmd := fmt.Sprintf("docker ps -aq %s", strings.Join(parts, " "))
	raw, err := exec(sessionId, cmd)
	if err != nil {
		return err
	}
	ids := splitLines(raw)
	if len(ids) == 0 {
		return nil
	}
	quoted := make([]string, 0, len(ids))
	for _, id := range ids {
		if id == "" {
			continue
		}
		quoted = append(quoted, shellescape.Quote(id))
	}
	if len(quoted) == 0 {
		return nil
	}
	_, err = exec(sessionId, fmt.Sprintf("docker rm -f %s", strings.Join(quoted, " ")))
	return err
}

func (a *App) DockerLocalListVolumes() ([]DockerVolumeDTO, error) {
	cli, err := dockerClient()
	if err != nil {
		return nil, err
	}
	defer cli.Close()
	ctx := context.Background()
	resp, err := cli.VolumeList(ctx, volume.ListOptions{Filters: filters.NewArgs()})
	if err != nil {
		return nil, err
	}
	out := make([]DockerVolumeDTO, 0, len(resp.Volumes))
	for _, v := range resp.Volumes {
		out = append(out, DockerVolumeDTO{
			Name:   v.Name,
			Driver: v.Driver,
			Scope:  v.Scope,
		})
	}
	return out, nil
}

func (a *App) DockerLocalVolumeInspect(name string) (DockerVolumeDetailsDTO, error) {
	cli, err := dockerClient()
	if err != nil {
		return DockerVolumeDetailsDTO{}, err
	}
	defer cli.Close()
	ctx := context.Background()
	v, err := cli.VolumeInspect(ctx, name)
	if err != nil {
		return DockerVolumeDetailsDTO{}, err
	}
	refCount := -1
	sizeBytes := int64(-1)
	if v.UsageData != nil {
		refCount = int(v.UsageData.RefCount)
		sizeBytes = int64(v.UsageData.Size)
	}
	if usageMap, err := getLocalVolumeUsageMap(cli); err == nil {
		if usage, ok := usageMap[v.Name]; ok {
			refCount = usage.refCount
			sizeBytes = usage.sizeBytes
		}
	}
	usedBy := getLocalVolumeUsedBy(ctx, cli, v.Name)
	return DockerVolumeDetailsDTO{
		Name:       v.Name,
		Driver:     v.Driver,
		Mountpoint: v.Mountpoint,
		Scope:      v.Scope,
		CreatedAt:  v.CreatedAt,
		Labels:     v.Labels,
		Options:    v.Options,
		RefCount:   refCount,
		SizeBytes:  sizeBytes,
		UsedBy:     usedBy,
	}, nil
}

func (a *App) DockerLocalVolumeRemove(name string) error {
	cli, err := dockerClient()
	if err != nil {
		return err
	}
	defer cli.Close()
	return cli.VolumeRemove(context.Background(), name, false)
}

func (a *App) DockerRemoteListVolumes(sessionId string) ([]DockerVolumeDTO, error) {
	raw, err := a.ssh.Exec(sessionId, "docker volume ls --format '{{json .}}'")
	if err != nil {
		return nil, err
	}
	lines := splitLines(raw)
	out := make([]DockerVolumeDTO, 0, len(lines))
	for _, line := range lines {
		var v struct {
			Driver string `json:"Driver"`
			Name   string `json:"Name"`
			Scope  string `json:"Scope"`
		}
		if err := jsonUnmarshal(line, &v); err != nil {
			continue
		}
		out = append(out, DockerVolumeDTO{Name: v.Name, Driver: v.Driver, Scope: v.Scope})
	}
	return out, nil
}

func (a *App) DockerRemoteVolumeInspect(sessionId string, name string) (DockerVolumeDetailsDTO, error) {
	raw, err := a.ssh.Exec(sessionId, fmt.Sprintf("docker volume inspect %s", shellescape.Quote(name)))
	if err != nil {
		return DockerVolumeDetailsDTO{}, err
	}
	var arr []volume.Volume
	if err := json.Unmarshal([]byte(raw), &arr); err != nil {
		return DockerVolumeDetailsDTO{}, err
	}
	if len(arr) == 0 {
		return DockerVolumeDetailsDTO{}, errors.New("volume not found")
	}
	v := arr[0]
	refCount := -1
	sizeBytes := int64(-1)
	if v.UsageData != nil {
		refCount = int(v.UsageData.RefCount)
		sizeBytes = int64(v.UsageData.Size)
	}
	if usageMap, err := getRemoteVolumeUsageMap(sessionId, a.ssh.Exec); err == nil {
		if usage, ok := usageMap[v.Name]; ok {
			refCount = usage.refCount
			sizeBytes = usage.sizeBytes
		}
	}
	usedBy := getRemoteVolumeUsedBy(sessionId, v.Name, a.ssh.Exec)
	return DockerVolumeDetailsDTO{
		Name:       v.Name,
		Driver:     v.Driver,
		Mountpoint: v.Mountpoint,
		Scope:      v.Scope,
		CreatedAt:  v.CreatedAt,
		Labels:     v.Labels,
		Options:    v.Options,
		RefCount:   refCount,
		SizeBytes:  sizeBytes,
		UsedBy:     usedBy,
	}, nil
}

func (a *App) DockerRemoteVolumeRemove(sessionId string, name string) error {
	_, err := a.ssh.Exec(sessionId, fmt.Sprintf("docker volume rm %s", shellescape.Quote(name)))
	return err
}
