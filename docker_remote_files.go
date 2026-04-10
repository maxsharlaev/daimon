package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"al.essio.dev/pkg/shellescape"
	"github.com/pkg/sftp"
)

func (a *App) DockerRemoteListDir(sessionId string, containerId string, path string) ([]DockerFileEntryDTO, error) {
	out, err := a.dockerRemoteExecInContainer(sessionId, containerId, fmt.Sprintf("cd %s && ls -la --time-style=+%%s", shellQuote(path)))
	if err != nil {
		if strings.Contains(err.Error(), "unrecognized option") || strings.Contains(err.Error(), "Usage: ls") {
			out, err = a.dockerRemoteExecInContainer(sessionId, containerId, fmt.Sprintf("cd %s && ls -la", shellQuote(path)))
		}
	}
	if err != nil {
		return nil, err
	}
	entries := parseLsOutput(out, path)
	entries = resolveSymlinkDirs(entries, func(cmd string) (string, error) {
		return a.dockerRemoteExecInContainer(sessionId, containerId, cmd)
	})
	return entries, nil
}

// DockerRemoteReadFileTail reads the last maxBytes of a file in the remote container using the existing SSH session.
func (a *App) DockerRemoteReadFileTail(sessionId string, containerId string, path string, maxBytes int64) (string, error) {
	if maxBytes <= 0 {
		maxBytes = 256 * 1024
	}
	q := shellQuote(path)
	n := strconv.FormatInt(maxBytes, 10)
	return a.dockerRemoteExecInContainer(sessionId, containerId, fmt.Sprintf(`if [ ! -f %s ]; then exit 1; fi; tail -c %s %s`, q, n, q))
}

func (a *App) DockerRemoteFileDelete(sessionId string, containerId string, path string) error {
	_, err := a.dockerRemoteExecInContainer(sessionId, containerId, fmt.Sprintf("rm -rf %s", shellQuote(path)))
	return err
}

func (a *App) DockerRemoteMkdir(sessionId string, containerId string, path string) error {
	_, err := a.dockerRemoteExecInContainer(sessionId, containerId, fmt.Sprintf("mkdir -p %s", shellQuote(path)))
	return err
}

func (a *App) DockerRemoteRename(sessionId string, containerId string, oldPath string, newPath string) error {
	_, err := a.dockerRemoteExecInContainer(sessionId, containerId, fmt.Sprintf("mv %s %s", shellQuote(oldPath), shellQuote(newPath)))
	return err
}

func (a *App) DockerRemoteDownload(sessionId string, containerId string, containerPath string, localPath string) error {
	if a.ssh == nil {
		return errors.New("ssh manager not ready")
	}
	if isDir, _ := a.dockerRemoteIsDir(sessionId, containerId, containerPath); isDir {
		return errors.New("directory download not supported in MVP")
	}
	tmp := fmt.Sprintf("/tmp/daimon-docker-%s", randomID())
	_, err := a.ssh.Exec(sessionId, fmt.Sprintf("docker cp %s:%s %s", shellescape.Quote(containerId), shellescape.Quote(containerPath), shellescape.Quote(tmp)))
	if err != nil {
		return err
	}
	defer func() {
		_, _ = a.ssh.Exec(sessionId, fmt.Sprintf("rm -rf %s", shellescape.Quote(tmp)))
	}()
	client, err := a.ssh.Client(sessionId)
	if err != nil {
		return err
	}
	sftpClient, err := sftp.NewClient(client)
	if err != nil {
		return err
	}
	defer sftpClient.Close()
	r, err := sftpClient.Open(tmp)
	if err != nil {
		return err
	}
	defer r.Close()
	if err := os.MkdirAll(filepath.Dir(localPath), 0755); err != nil {
		return err
	}
	f, err := os.Create(localPath)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, r)
	return err
}

func (a *App) DockerRemoteUpload(sessionId string, containerId string, localPath string, containerDir string) error {
	if a.ssh == nil {
		return errors.New("ssh manager not ready")
	}
	tmp := fmt.Sprintf("/tmp/daimon-docker-%s", randomID())
	client, err := a.ssh.Client(sessionId)
	if err != nil {
		return err
	}
	sftpClient, err := sftp.NewClient(client)
	if err != nil {
		return err
	}
	defer sftpClient.Close()
	src, err := os.Open(localPath)
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := sftpClient.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dst, src); err != nil {
		_ = dst.Close()
		return err
	}
	_ = dst.Close()
	defer func() {
		_, _ = a.ssh.Exec(sessionId, fmt.Sprintf("rm -rf %s", shellescape.Quote(tmp)))
	}()
	_, err = a.ssh.Exec(sessionId, fmt.Sprintf("docker cp %s %s:%s", shellescape.Quote(tmp), shellescape.Quote(containerId), shellescape.Quote(containerDir)))
	return err
}

func (a *App) dockerRemoteExecInContainer(sessionId string, containerId string, cmd string) (string, error) {
	full := fmt.Sprintf("docker exec %s sh -lc %s", shellescape.Quote(containerId), shellescape.Quote(cmd))
	return a.ssh.Exec(sessionId, full)
}

func (a *App) dockerRemoteIsDir(sessionId string, containerId string, path string) (bool, error) {
	out, err := a.dockerRemoteExecInContainer(sessionId, containerId, fmt.Sprintf("if [ -d %s ]; then echo DIR; else echo FILE; fi", shellQuote(path)))
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(out) == "DIR", nil
}
