package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"al.essio.dev/pkg/shellescape"

	"daimon/internal/secrets"
	"daimon/internal/storage"
)

func (a *App) DockerRemoteConnectProfile(profileId string) (string, error) {
	if a.db == nil || a.db.DB == nil || a.secrets == nil {
		return "", errors.New("app not ready")
	}
	if a.ctx == nil {
		return "", errors.New("app context not ready")
	}
	if profileId == "" {
		return "", errors.New("profileId required")
	}
	var p storage.Profile
	if err := a.db.DB.First(&p, "id = ?", profileId).Error; err != nil {
		return "", err
	}
	cfg := SSHConfig{
		Host:                  p.Host,
		Port:                  p.Port,
		Username:              p.Username,
		InsecureIgnoreHostKey: true,
		TimeoutMs:             10000,
	}
	if sr, err := a.secrets.GetSecretRef(profileId, secrets.KindPrivateKey); err == nil {
		switch secrets.Storage(sr.Storage) {
		case secrets.StorageExternal:
			if strings.TrimSpace(sr.Ref) != "" {
				cfg.AuthType = "privateKey"
				cfg.PrivateKeyPath = sr.Ref
				return a.ssh.ConnectExecOnly(a.ctx, cfg)
			}
		case secrets.StorageKeyring, secrets.StorageInternal:
			val, _, err := a.secrets.GetSecretValue(profileId, secrets.KindPrivateKey)
			if err == nil && strings.TrimSpace(val.PrivateKeyPEM) != "" {
				cfg.AuthType = "privateKey"
				cfg.PrivateKeyPEM = val.PrivateKeyPEM
				cfg.Passphrase = val.Passphrase
				return a.ssh.ConnectExecOnly(a.ctx, cfg)
			}
		}
	}
	val, mode, err := a.secrets.GetSecretValue(profileId, secrets.KindPassword)
	if err != nil {
		return "", err
	}
	if mode == secrets.StorageNone || strings.TrimSpace(val.Password) == "" {
		return "", fmt.Errorf("password required")
	}
	cfg.AuthType = "password"
	cfg.Password = val.Password
	return a.ssh.ConnectExecOnly(a.ctx, cfg)
}

func (a *App) DockerRemoteDisconnect(sessionId string) error {
	if a.ctx == nil {
		return fmt.Errorf("app context not ready")
	}
	return a.ssh.Disconnect(a.ctx, sessionId)
}

func (a *App) DockerRemoteStatus(sessionId string) (DockerStatusDTO, error) {
	raw, err := a.ssh.Exec(sessionId, "docker version --format '{{json .Server}}'")
	if err != nil {
		return DockerStatusDTO{Available: false, Message: formatDockerRemoteError(err)}, nil
	}
	type server struct {
		Version    string `json:"Version"`
		APIVersion string `json:"ApiVersion"`
		Os         string `json:"Os"`
		Arch       string `json:"Arch"`
	}
	var s server
	if err := jsonUnmarshal(raw, &s); err != nil {
		return DockerStatusDTO{Available: true, Message: raw}, nil
	}
	return DockerStatusDTO{
		Available:  true,
		Version:    s.Version,
		APIVersion: s.APIVersion,
		OS:         s.Os,
		Arch:       s.Arch,
	}, nil
}

func formatDockerRemoteError(err error) string {
	raw := strings.ToLower(err.Error())
	if strings.Contains(raw, "status 127") || strings.Contains(raw, "exit status 127") || strings.Contains(raw, "command not found") || strings.Contains(raw, "not found") {
		return "Docker CLI not found on remote host"
	}
	return err.Error()
}

func (a *App) DockerRemoteListContainers(sessionId string) ([]DockerContainerDTO, error) {
	raw, err := a.ssh.Exec(sessionId, "docker ps --all --format '{{json .}}'")
	if err != nil {
		return nil, err
	}
	lines := splitLines(raw)
	out := make([]DockerContainerDTO, 0, len(lines))
	for _, line := range lines {
		var v struct {
			ID        string `json:"ID"`
			Image     string `json:"Image"`
			ImageID   string `json:"ImageID"`
			Names     string `json:"Names"`
			Status    string `json:"Status"`
			State     string `json:"State"`
			CreatedAt string `json:"CreatedAt"`
			Ports     string `json:"Ports"`
		}
		if err := jsonUnmarshal(line, &v); err != nil {
			continue
		}
		out = append(out, DockerContainerDTO{
			ID:     v.ID,
			Name:   v.Names,
			Image:  v.Image,
			ImageID: v.ImageID,
			State:  v.State,
			Status: v.Status,
			Ports:  v.Ports,
		})
	}
	return out, nil
}

func (a *App) DockerRemoteListImages(sessionId string) ([]DockerImageDTO, error) {
	raw, err := a.ssh.Exec(sessionId, "docker images --format '{{json .}}'")
	if err != nil {
		return nil, err
	}
	lines := splitLines(raw)
	out := make([]DockerImageDTO, 0, len(lines))
	for _, line := range lines {
		var v struct {
			ID           string `json:"ID"`
			Repository   string `json:"Repository"`
			Tag          string `json:"Tag"`
			CreatedAt    string `json:"CreatedAt"`
			CreatedSince string `json:"CreatedSince"`
			Size         string `json:"Size"`
		}
		if err := jsonUnmarshal(line, &v); err != nil {
			continue
		}
		out = append(out, DockerImageDTO{
			ID:           v.ID,
			Repository:   v.Repository,
			Tag:          v.Tag,
			CreatedAt:    v.CreatedAt,
			CreatedSince: v.CreatedSince,
			Size:         v.Size,
			SizeBytes:    parseSizeString(v.Size),
		})
	}
	return out, nil
}

func (a *App) DockerRemoteListDanglingImages(sessionId string) ([]DockerImageDTO, error) {
	raw, err := a.ssh.Exec(sessionId, "docker images --filter dangling=true --format '{{json .}}'")
	if err != nil {
		return nil, err
	}
	lines := splitLines(raw)
	out := make([]DockerImageDTO, 0, len(lines))
	for _, line := range lines {
		var v struct {
			ID           string `json:"ID"`
			Repository   string `json:"Repository"`
			Tag          string `json:"Tag"`
			CreatedAt    string `json:"CreatedAt"`
			CreatedSince string `json:"CreatedSince"`
			Size         string `json:"Size"`
		}
		if err := jsonUnmarshal(line, &v); err != nil {
			continue
		}
		out = append(out, DockerImageDTO{
			ID:           v.ID,
			Repository:   v.Repository,
			Tag:          v.Tag,
			CreatedAt:    v.CreatedAt,
			CreatedSince: v.CreatedSince,
			Size:         v.Size,
			SizeBytes:    parseSizeString(v.Size),
		})
	}
	return out, nil
}

func (a *App) DockerRemoteImageInspect(sessionId string, id string) (string, error) {
	out, err := a.ssh.Exec(sessionId, fmt.Sprintf("docker image inspect %s", shellescape.Quote(id)))
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(out), nil
}

func (a *App) DockerRemoteCreateTempContainer(sessionId string, imageRef string) (string, error) {
	_ = cleanupRemoteTempContainersByLabels(sessionId, []string{
		"daimon.temp=true",
		fmt.Sprintf("daimon.temp.image=%s", imageRef),
	}, a.ssh.Exec)
	name := tempContainerName(imageRef)
	id, err := a.ssh.Exec(sessionId, fmt.Sprintf(
		"docker create --name %s --label %s --label %s --label %s %s sh -lc %s",
		shellescape.Quote(name),
		shellescape.Quote("daimon.temp=true"),
		shellescape.Quote("daimon.temp.kind=image"),
		shellescape.Quote(fmt.Sprintf("daimon.temp.image=%s", imageRef)),
		shellescape.Quote(imageRef),
		shellescape.Quote("sleep 3600"),
	))
	if err != nil {
		return "", err
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return "", errors.New("failed to create temp container")
	}
	_, err = a.ssh.Exec(sessionId, fmt.Sprintf("docker start %s", shellescape.Quote(id)))
	if err != nil {
		_, _ = a.ssh.Exec(sessionId, fmt.Sprintf("docker rm -f %s", shellescape.Quote(id)))
		return "", err
	}
	return id, nil
}

func (a *App) DockerRemoteCreateVolumeTempContainer(sessionId string, volumeName string) (string, error) {
	imageRef := "alpine"
	_ = a.DockerRemoteCleanupTempContainers(sessionId, volumeName)
	if _, err := a.ssh.Exec(sessionId, fmt.Sprintf("docker image inspect %s", shellescape.Quote(imageRef))); err != nil {
		if _, pullErr := a.ssh.Exec(sessionId, fmt.Sprintf("docker pull %s", shellescape.Quote(imageRef))); pullErr != nil {
			return "", pullErr
		}
	}
	name := tempContainerName(volumeName)
	id, err := a.ssh.Exec(sessionId, fmt.Sprintf(
		"docker create --name %s --label %s --label %s --label %s -v %s:/mnt %s sh -lc %s",
		shellescape.Quote(name),
		shellescape.Quote("daimon.temp=true"),
		shellescape.Quote("daimon.temp.kind=volume"),
		shellescape.Quote(fmt.Sprintf("daimon.temp.volume=%s", volumeName)),
		shellescape.Quote(volumeName),
		shellescape.Quote(imageRef),
		shellescape.Quote("sleep 3600"),
	))
	if err != nil {
		return "", err
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return "", errors.New("failed to create temp container")
	}
	if _, err = a.ssh.Exec(sessionId, fmt.Sprintf("docker start %s", shellescape.Quote(id))); err != nil {
		_, _ = a.ssh.Exec(sessionId, fmt.Sprintf("docker rm -f %s", shellescape.Quote(id)))
		return "", err
	}
	return id, nil
}

func (a *App) DockerRemoteDanglingPreview(sessionId string) (DockerDanglingPreviewDTO, error) {
	list, err := a.DockerRemoteListDanglingImages(sessionId)
	if err != nil {
		return DockerDanglingPreviewDTO{}, err
	}
	var total int64
	for _, img := range list {
		total += parseSizeString(img.Size)
	}
	return DockerDanglingPreviewDTO{Count: len(list), SizeBytes: total}, nil
}

func (a *App) DockerRemotePruneDangling(sessionId string) (DockerDanglingPreviewDTO, error) {
	out, err := a.ssh.Exec(sessionId, "docker image prune -f")
	if err != nil {
		return DockerDanglingPreviewDTO{}, err
	}
	// Parse "Total reclaimed space: 12.3MB"
	var reclaimed int64
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "Total reclaimed space:") {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				reclaimed = parseSizeString(parts[1])
			}
		}
	}
	return DockerDanglingPreviewDTO{Count: 0, SizeBytes: reclaimed}, nil
}

func (a *App) DockerRemoteRemoveImages(sessionId string, ids []string) error {
	for _, id := range ids {
		if strings.TrimSpace(id) == "" {
			continue
		}
		_ = a.DockerRemoteImageRemove(sessionId, id, true)
	}
	return nil
}

func (a *App) DockerRemoteContainerStart(sessionId string, id string) error {
	_, err := a.ssh.Exec(sessionId, fmt.Sprintf("docker start %s", shellescape.Quote(id)))
	return err
}

func (a *App) DockerRemoteContainerStop(sessionId string, id string) error {
	_, err := a.ssh.Exec(sessionId, fmt.Sprintf("docker stop %s", shellescape.Quote(id)))
	return err
}

func (a *App) DockerRemoteContainerRestart(sessionId string, id string) error {
	_, err := a.ssh.Exec(sessionId, fmt.Sprintf("docker restart %s", shellescape.Quote(id)))
	return err
}

func (a *App) DockerRemoteContainerRemove(sessionId string, id string) error {
	_, err := a.ssh.Exec(sessionId, fmt.Sprintf("docker rm -f %s", shellescape.Quote(id)))
	return err
}

func (a *App) DockerRemoteImagePull(sessionId string, ref string) (string, error) {
	out, err := a.ssh.Exec(sessionId, fmt.Sprintf("docker pull %s", shellescape.Quote(ref)))
	return out, err
}

func (a *App) DockerRemoteImageRemove(sessionId string, id string, force bool) error {
	forceFlag := ""
	if force {
		forceFlag = " -f"
	}
	_, err := a.ssh.Exec(sessionId, fmt.Sprintf("docker rmi%s %s", forceFlag, shellescape.Quote(id)))
	return err
}

func (a *App) DockerRemoteLogsStart(sessionId string, containerId string, tail string, since string) (string, error) {
	if a.ctx == nil || a.dockerStreams == nil {
		return "", errors.New("app not ready")
	}
	if strings.TrimSpace(tail) == "" {
		tail = "200"
	}
	cmd := fmt.Sprintf("docker logs -f --tail %s %s", shellescape.Quote(tail), shellescape.Quote(containerId))
	sess, err := a.ssh.OpenCommandSession(sessionId, cmd)
	if err != nil {
		return "", err
	}
	id := a.dockerStreams.Start(a.ctx, nil, sess.Stdout(), sess.Stderr(), nil, func() error {
		return sess.Close()
	}, func() error {
		return sess.Wait()
	})
	return id, nil
}

func (a *App) DockerRemoteExecStart(sessionId string, containerId string, cols int, rows int) (string, error) {
	if a.ctx == nil || a.dockerStreams == nil {
		return "", errors.New("app not ready")
	}
	shellCmd := "if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi"
	cmd := fmt.Sprintf("docker exec -it %s sh -lc %s", shellescape.Quote(containerId), shellescape.Quote(shellCmd))
	sess, err := a.ssh.OpenCommandPTY(sessionId, cmd, cols, rows)
	if err != nil {
		return "", err
	}
	id := a.dockerStreams.Start(a.ctx, sess.Stdin(), sess.Stdout(), sess.Stderr(), func(c int, r int) error {
		return sess.Resize(c, r)
	}, func() error {
		return sess.Close()
	}, func() error {
		return sess.Wait()
	})
	return id, nil
}

func splitLines(raw string) []string {
	lines := strings.Split(strings.TrimSpace(raw), "\n")
	out := make([]string, 0, len(lines))
	for _, l := range lines {
		if strings.TrimSpace(l) == "" {
			continue
		}
		out = append(out, strings.TrimSpace(l))
	}
	return out
}

func jsonUnmarshal(raw string, v any) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return errors.New("empty json")
	}
	return json.Unmarshal([]byte(raw), v)
}
