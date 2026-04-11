package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"daimon/internal/ai"
)

// AgentContextDTO describes the active UI session for AI tool execution.
type AgentContextDTO struct {
	Mode string `json:"mode"` // connections | docker | logs | settings

	SessionID string `json:"sessionId"`
	ProfileID string `json:"profileId"`

	DockerScope string `json:"dockerScope"` // local | remote | ""
	ContainerID string `json:"containerId"`
}

func (a *App) aiExecFile(ctx AgentContextDTO, meta map[string]any) (string, error) {
	path, _ := meta["path"].(string)
	path = strings.TrimSpace(path)
	if path == "" {
		return "", errors.New("file path missing")
	}
	maxBytes := int64(ai.MaxFileReadBytes)
	if v, ok := meta["maxBytes"].(float64); ok && v > 0 {
		maxBytes = int64(v)
	}
	if v, ok := meta["maxBytes"].(json.Number); ok {
		if n, e := v.Int64(); e == nil && n > 0 {
			maxBytes = n
		}
	}
	if maxBytes > ai.MaxFileReadBytes {
		maxBytes = ai.MaxFileReadBytes
	}

	switch ctx.Mode {
	case "connections":
		if strings.TrimSpace(ctx.SessionID) == "" {
			return "", errors.New("no active SSH session for file read")
		}
		q := shellQuote(path)
		cmd := fmt.Sprintf(`if [ ! -f %s ]; then echo '[ai] missing file'; exit 0; fi; tail -c %d %s`, q, maxBytes, q)
		return a.ssh.Exec(ctx.SessionID, cmd)
	case "docker":
		cid := strings.TrimSpace(ctx.ContainerID)
		if cid == "" {
			return "", errors.New("container id required for docker file read")
		}
		switch ctx.DockerScope {
		case "local":
			return a.DockerLocalReadFileTail(cid, path, maxBytes)
		case "remote":
			if strings.TrimSpace(ctx.SessionID) == "" {
				return "", errors.New("SSH session required for remote docker file read")
			}
			return a.DockerRemoteReadFileTail(ctx.SessionID, cid, path, maxBytes)
		default:
			return "", errors.New("docker scope missing (local vs remote)")
		}
	default:
		return "", fmt.Errorf("file read not available in mode %q (connect with an active terminal)", ctx.Mode)
	}
}

func (a *App) aiExecLogs(ctx AgentContextDTO, meta map[string]any) (string, error) {
	origin, _ := meta["origin"].(string)
	origin = strings.TrimSpace(origin)
	switch origin {
	case "app_synced":
		req := LogsQueryRequest{}
		b, err := json.Marshal(meta)
		if err != nil {
			return "", err
		}
		if err := json.Unmarshal(b, &req); err != nil {
			return "", err
		}
		res, err := a.LogsQuery(req)
		if err != nil {
			return "", err
		}
		out, err := json.MarshalIndent(res, "", "  ")
		if err != nil {
			return "", err
		}
		if len(out) > 200000 {
			return string(out[:200000]) + "\n...[truncated]", nil
		}
		return string(out), nil
	case "docker_daemon":
		tail := "500"
		if v, ok := meta["tail"].(string); ok && strings.TrimSpace(v) != "" {
			tail = strings.TrimSpace(v)
		}
		since := ""
		if v, ok := meta["since"].(string); ok {
			since = strings.TrimSpace(v)
		}
		maxBytes := int64(65536)
		if v, ok := meta["maxBytes"].(float64); ok && v > 0 {
			maxBytes = int64(v)
		}
		cid := strings.TrimSpace(ctx.ContainerID)
		if cid == "" {
			if v, ok := meta["containerId"].(string); ok {
				cid = strings.TrimSpace(v)
			}
		}
		if cid == "" {
			return "", errors.New("container id required for docker logs")
		}
		if ctx.Mode == "docker" && ctx.DockerScope == "local" {
			return a.DockerLocalLogsSnapshot(cid, tail, since, maxBytes)
		}
		if ctx.Mode == "docker" && ctx.DockerScope == "remote" {
			if ctx.SessionID == "" {
				return "", errors.New("SSH session required for remote docker logs")
			}
			return a.DockerRemoteLogsSnapshot(ctx.SessionID, cid, tail, since, maxBytes)
		}
		return "", errors.New("docker_daemon logs require Docker mode with active container")
	default:
		return "", fmt.Errorf("unknown logs origin %q", origin)
	}
}

func (a *App) aiExecCommand(ctx AgentContextDTO, command string) (string, error) {
	command = strings.TrimSpace(command)
	if command == "" {
		return "", errors.New("empty command")
	}
	if ctx.Mode != "connections" && ctx.Mode != "docker" {
		return "", errors.New("commands require Connections or Docker with an active session")
	}
	if ctx.Mode == "connections" {
		if ctx.SessionID == "" {
			return "", errors.New("no active SSH session")
		}
		return a.ssh.Exec(ctx.SessionID, command)
	}
	// docker: run inside container via docker exec
	if ctx.ContainerID == "" {
		return "", errors.New("container id required")
	}
	if ctx.DockerScope == "local" {
		return a.dockerLocalExecOutput(ctx.ContainerID, command)
	}
	if ctx.DockerScope == "remote" {
		if ctx.SessionID == "" {
			return "", errors.New("SSH session required")
		}
		return a.dockerRemoteExecInContainer(ctx.SessionID, ctx.ContainerID, command)
	}
	return "", errors.New("unsupported docker scope")
}
