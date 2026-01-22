package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/system"
)

func (a *App) DockerLocalSystemInfo() (DockerSystemDTO, error) {
	status, _ := a.DockerLocalStatus()
	cli, err := dockerClient()
	if err != nil {
		return DockerSystemDTO{Status: status}, nil
	}
	defer cli.Close()
	ctx := context.Background()
	info, err := cli.Info(ctx)
	if err != nil {
		return DockerSystemDTO{Status: status, InfoText: err.Error()}, nil
	}
	du, err := cli.DiskUsage(ctx, types.DiskUsageOptions{})
	if err != nil {
		return DockerSystemDTO{Status: status, InfoText: formatDockerInfo(info)}, nil
	}
	return DockerSystemDTO{
		Status:        status,
		InfoText:      formatDockerInfo(info),
		DiskUsageText: formatDiskUsage(du),
	}, nil
}

func (a *App) DockerRemoteSystemInfo(sessionId string) (DockerSystemDTO, error) {
	status, _ := a.DockerRemoteStatus(sessionId)
	info, _ := a.ssh.Exec(sessionId, "docker info")
	df, _ := a.ssh.Exec(sessionId, "docker system df")
	return DockerSystemDTO{
		Status:        status,
		InfoText:      strings.TrimSpace(info),
		DiskUsageText: strings.TrimSpace(df),
	}, nil
}

func formatDockerInfo(info system.Info) string {
	return fmt.Sprintf(
		"Name: %s\nID: %s\nServerVersion: %s\nKernelVersion: %s\nOS: %s\nArch: %s\nCPUs: %d\nTotalMemory: %s\nContainers: %d\nImages: %d\n",
		info.Name,
		info.ID,
		info.ServerVersion,
		info.KernelVersion,
		info.OperatingSystem,
		info.Architecture,
		info.NCPU,
		byteSize(info.MemTotal),
		info.Containers,
		info.Images,
	)
}

func formatDiskUsage(du types.DiskUsage) string {
	return fmt.Sprintf(
		"Images: %d\nContainers: %d\nVolumes: %d\nBuildCache: %d\n",
		len(du.Images),
		len(du.Containers),
		len(du.Volumes),
		len(du.BuildCache),
	)
}
