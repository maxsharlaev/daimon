package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

// DataScopeJSON describes where a DataSource is used (non-secret).
type DataScopeJSON struct {
	Mode          string `json:"mode"` // ssh | docker_local | docker_remote
	SSHProfileID  string `json:"sshProfileId,omitempty"`
	ContainerID   string `json:"containerId,omitempty"`
	ContainerName string `json:"containerName,omitempty"`
}

func parseDataScopeJSON(s string) (DataScopeJSON, error) {
	var sc DataScopeJSON
	if strings.TrimSpace(s) == "" || strings.TrimSpace(s) == "{}" {
		return sc, fmt.Errorf("empty scope")
	}
	if err := json.Unmarshal([]byte(s), &sc); err != nil {
		return sc, err
	}
	sc.Mode = strings.TrimSpace(strings.ToLower(sc.Mode))
	return sc, nil
}

func (sc DataScopeJSON) matchesFilter(mode string, sshProfileID, containerID string) bool {
	if sc.Mode != mode {
		return false
	}
	switch mode {
	case "ssh":
		if sshProfileID == "" {
			return true
		}
		return sc.SSHProfileID == sshProfileID
	case "docker_local":
		if containerID == "" {
			return true
		}
		return sc.ContainerID == containerID || sc.ContainerName == containerID
	case "docker_remote":
		if sshProfileID == "" {
			return false
		}
		if containerID == "" {
			return sc.SSHProfileID == sshProfileID
		}
		return sc.SSHProfileID == sshProfileID && (sc.ContainerID == containerID || sc.ContainerName == containerID)
	default:
		return false
	}
}
