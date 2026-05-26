package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/docker/docker/client"
)

// dockerClient returns a Docker Engine API client. When DOCKER_HOST is unset,
// GUI apps (e.g. Wails) do not inherit shell profile exports, so we resolve
// the daemon address the same way the Docker CLI does: current context in
// ~/.docker/config.json plus ~/.docker/contexts/meta/.../meta.json, then a
// small list of common local socket paths (Docker Desktop user socket, Colima,
// OrbStack, /var/run).
func dockerClient() (*client.Client, error) {
	opts := []client.Opt{client.FromEnv, client.WithAPIVersionNegotiation()}
	if host := resolveDockerDaemonHost(); host != "" {
		opts = append(opts, client.WithHost(host))
	}
	return client.NewClientWithOpts(opts...)
}

func resolveDockerDaemonHost() string {
	if strings.TrimSpace(os.Getenv("DOCKER_HOST")) != "" {
		return ""
	}
	if h := dockerHostFromCurrentContext(); h != "" {
		return h
	}
	if runtime.GOOS == "windows" {
		return ""
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	for _, p := range []string{
		filepath.Join(home, ".docker", "run", "docker.sock"),
		filepath.Join(home, ".colima", "default", "docker.sock"),
		filepath.Join(home, ".colima", "docker.sock"),
		filepath.Join(home, ".orbstack", "run", "docker.sock"),
		"/var/run/docker.sock",
	} {
		if isUnixDockerSocket(p) {
			return "unix://" + p
		}
	}
	return ""
}

func dockerHostFromCurrentContext() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	current := "default"
	if data, err := os.ReadFile(filepath.Join(home, ".docker", "config.json")); err == nil {
		var cfg struct {
			CurrentContext string `json:"currentContext"`
		}
		if json.Unmarshal(data, &cfg) == nil && strings.TrimSpace(cfg.CurrentContext) != "" {
			current = strings.TrimSpace(cfg.CurrentContext)
		}
	}
	metaRoot := filepath.Join(home, ".docker", "contexts", "meta")
	ents, err := os.ReadDir(metaRoot)
	if err != nil {
		return ""
	}
	for _, ent := range ents {
		if !ent.IsDir() {
			continue
		}
		p := filepath.Join(metaRoot, ent.Name(), "meta.json")
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		var m struct {
			Name      string            `json:"Name"`
			Endpoints map[string]struct {
				Host string `json:"Host"`
			} `json:"Endpoints"`
		}
		if json.Unmarshal(data, &m) != nil || m.Name != current {
			continue
		}
		ep, ok := m.Endpoints["docker"]
		if !ok {
			continue
		}
		host := strings.TrimSpace(ep.Host)
		if host == "" {
			continue
		}
		if strings.HasPrefix(host, "unix://") {
			path := strings.TrimPrefix(host, "unix://")
			if !isUnixDockerSocket(path) {
				continue
			}
		}
		return host
	}
	return ""
}

func isUnixDockerSocket(path string) bool {
	fi, err := os.Stat(path)
	if err != nil {
		return false
	}
	if fi.IsDir() {
		return false
	}
	return fi.Mode()&os.ModeSocket != 0
}
