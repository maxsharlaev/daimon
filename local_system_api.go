package main

import (
	"os"
	"os/exec"
	"runtime"
	"strings"

	"daimon/internal/sftp"
)

type LocalSystemInfoDTO struct {
	OS            string `json:"os"`
	Arch          string `json:"arch"`
	Hostname      string `json:"hostname"`
	HomeDir       string `json:"homeDir"`
	DefaultShell  string `json:"defaultShell"`
	VolumeLabel   string `json:"volumeLabel"`
	OSDisplayName string `json:"osDisplayName"`
}

func (a *App) LocalSystemInfo() (LocalSystemInfoDTO, error) {
	home, _ := os.UserHomeDir()
	host, _ := os.Hostname()
	shell := resolveDefaultShell()
	volLabel := "Location"
	osName := "Linux"
	switch runtime.GOOS {
	case "windows":
		volLabel = "Drive"
		osName = "Windows"
	case "darwin":
		osName = "macOS"
	}
	return LocalSystemInfoDTO{
		OS:            runtime.GOOS,
		Arch:          runtime.GOARCH,
		Hostname:      host,
		HomeDir:       home,
		DefaultShell:  shell,
		VolumeLabel:   volLabel,
		OSDisplayName: osName,
	}, nil
}

func (a *App) LocalListVolumes() ([]string, error) {
	return sftp.ListLocalVolumes()
}

func resolveDefaultShell() string {
	if runtime.GOOS == "windows" {
		if v := strings.TrimSpace(os.Getenv("ComSpec")); v != "" {
			return v
		}
		return `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`
	}
	if v := strings.TrimSpace(os.Getenv("SHELL")); v != "" {
		return v
	}
	for _, sh := range []string{"/bin/zsh", "/bin/bash", "/bin/sh"} {
		if _, err := exec.LookPath(sh); err == nil {
			return sh
		}
	}
	return "/bin/sh"
}
