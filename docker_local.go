package main

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/api/types/mount"
	"github.com/docker/docker/pkg/stdcopy"
)

func (a *App) DockerLocalStatus() (DockerStatusDTO, error) {
	cli, err := dockerClient()
	if err != nil {
		return DockerStatusDTO{Available: false, Message: err.Error()}, nil
	}
	defer cli.Close()
	ctx := context.Background()
	info, err := cli.Info(ctx)
	if err != nil {
		return DockerStatusDTO{Available: false, Message: err.Error()}, nil
	}
	ver, _ := cli.ServerVersion(ctx)
	return DockerStatusDTO{
		Available:  true,
		Version:    ver.Version,
		APIVersion: ver.APIVersion,
		OS:         info.OperatingSystem,
		Arch:       info.Architecture,
	}, nil
}

func (a *App) DockerLocalListContainers() ([]DockerContainerDTO, error) {
	cli, err := dockerClient()
	if err != nil {
		return nil, err
	}
	defer cli.Close()
	ctx := context.Background()
	list, err := cli.ContainerList(ctx, container.ListOptions{All: true})
	if err != nil {
		return nil, err
	}
	out := make([]DockerContainerDTO, 0, len(list))
	for _, c := range list {
		name := ""
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}
		out = append(out, DockerContainerDTO{
			ID:          c.ID,
			Name:        name,
			Image:       c.Image,
			ImageID:     c.ImageID,
			State:       c.State,
			Status:      c.Status,
			CreatedUnix: c.Created,
			Ports:       formatPorts(c.Ports),
		})
	}
	return out, nil
}

func (a *App) DockerLocalListImages() ([]DockerImageDTO, error) {
	cli, err := dockerClient()
	if err != nil {
		return nil, err
	}
	defer cli.Close()
	ctx := context.Background()
	list, err := cli.ImageList(ctx, image.ListOptions{All: true})
	if err != nil {
		return nil, err
	}
	out := make([]DockerImageDTO, 0, len(list))
	for _, img := range list {
		repo := "<none>"
		tag := "<none>"
		if len(img.RepoTags) > 0 {
			parts := strings.SplitN(img.RepoTags[0], ":", 2)
			if len(parts) == 2 {
				repo = parts[0]
				tag = parts[1]
			} else if len(parts) == 1 {
				repo = parts[0]
			}
		}
		out = append(out, DockerImageDTO{
			ID:           img.ID,
			Repository:   repo,
			Tag:          tag,
			CreatedSince: time.Unix(img.Created, 0).Format(time.RFC3339),
			Size:         byteSize(img.Size),
			SizeBytes:    img.Size,
		})
	}
	return out, nil
}

func (a *App) DockerLocalImageInspect(id string) (string, error) {
	cli, err := dockerClient()
	if err != nil {
		return "", err
	}
	defer cli.Close()
	ctx := context.Background()
	info, _, err := cli.ImageInspectWithRaw(ctx, id)
	if err != nil {
		return "", err
	}
	b, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func (a *App) DockerLocalCreateTempContainer(imageRef string) (string, error) {
	cli, err := dockerClient()
	if err != nil {
		return "", err
	}
	defer cli.Close()
	ctx := context.Background()
	_ = cleanupLocalTempContainersByLabels(ctx, cli, []string{
		"daimon.temp=true",
		fmt.Sprintf("daimon.temp.image=%s", imageRef),
	})
	name := tempContainerName(imageRef)
	resp, err := cli.ContainerCreate(ctx, &container.Config{
		Image: imageRef,
		Cmd:   []string{"sh", "-lc", "sleep 3600"},
		Tty:   false,
		Labels: map[string]string{
			"daimon.temp":       "true",
			"daimon.temp.kind":  "image",
			"daimon.temp.image": imageRef,
		},
	}, nil, nil, nil, name)
	if err != nil {
		return "", err
	}
	if err := cli.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
		_ = cli.ContainerRemove(ctx, resp.ID, container.RemoveOptions{Force: true})
		return "", err
	}
	return resp.ID, nil
}

func (a *App) DockerLocalCreateVolumeTempContainer(volumeName string) (string, error) {
	cli, err := dockerClient()
	if err != nil {
		return "", err
	}
	defer cli.Close()
	ctx := context.Background()
	_ = cleanupLocalTempContainers(ctx, cli, volumeName)
	imageRef := "alpine"
	if _, _, err := cli.ImageInspectWithRaw(ctx, imageRef); err != nil {
		rc, err := cli.ImagePull(ctx, imageRef, image.PullOptions{})
		if err != nil {
			return "", err
		}
		_, _ = io.Copy(io.Discard, rc)
		_ = rc.Close()
	}
	name := tempContainerName(volumeName)
	resp, err := cli.ContainerCreate(ctx, &container.Config{
		Image:  imageRef,
		Cmd:    []string{"sh", "-lc", "sleep 3600"},
		Tty:    false,
		Labels: tempContainerLabels(volumeName),
	}, &container.HostConfig{
		Mounts: []mount.Mount{
			{Type: mount.TypeVolume, Source: volumeName, Target: "/mnt"},
		},
	}, nil, nil, name)
	if err != nil {
		return "", err
	}
	if err := cli.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
		_ = cli.ContainerRemove(ctx, resp.ID, container.RemoveOptions{Force: true})
		return "", err
	}
	return resp.ID, nil
}

func (a *App) DockerLocalListDanglingImages() ([]DockerImageDTO, error) {
	cli, err := dockerClient()
	if err != nil {
		return nil, err
	}
	defer cli.Close()
	ctx := context.Background()
	args := filters.NewArgs()
	args.Add("dangling", "true")
	list, err := cli.ImageList(ctx, image.ListOptions{All: true, Filters: args})
	if err != nil {
		return nil, err
	}
	out := make([]DockerImageDTO, 0, len(list))
	for _, img := range list {
		out = append(out, DockerImageDTO{
			ID:           img.ID,
			Repository:   "<none>",
			Tag:          "<none>",
			CreatedSince: time.Unix(img.Created, 0).Format(time.RFC3339),
			Size:         byteSize(img.Size),
			SizeBytes:    img.Size,
		})
	}
	return out, nil
}

func (a *App) DockerLocalDanglingPreview() (DockerDanglingPreviewDTO, error) {
	cli, err := dockerClient()
	if err != nil {
		return DockerDanglingPreviewDTO{}, err
	}
	defer cli.Close()
	ctx := context.Background()
	args := filters.NewArgs()
	args.Add("dangling", "true")
	list, err := cli.ImageList(ctx, image.ListOptions{All: true, Filters: args})
	if err != nil {
		return DockerDanglingPreviewDTO{}, err
	}
	var total int64
	for _, img := range list {
		total += img.Size
	}
	return DockerDanglingPreviewDTO{Count: len(list), SizeBytes: total}, nil
}

func (a *App) DockerLocalPruneDangling() (DockerDanglingPreviewDTO, error) {
	cli, err := dockerClient()
	if err != nil {
		return DockerDanglingPreviewDTO{}, err
	}
	defer cli.Close()
	ctx := context.Background()
	args := filters.NewArgs()
	args.Add("dangling", "true")
	report, err := cli.ImagesPrune(ctx, args)
	if err != nil {
		return DockerDanglingPreviewDTO{}, err
	}
	return DockerDanglingPreviewDTO{Count: len(report.ImagesDeleted), SizeBytes: int64(report.SpaceReclaimed)}, nil
}

func (a *App) DockerLocalRemoveImages(ids []string) error {
	for _, id := range ids {
		if strings.TrimSpace(id) == "" {
			continue
		}
		_ = a.DockerLocalImageRemove(id, true)
	}
	return nil
}

func (a *App) DockerLocalContainerStart(id string) error {
	cli, err := dockerClient()
	if err != nil {
		return err
	}
	defer cli.Close()
	return cli.ContainerStart(context.Background(), id, container.StartOptions{})
}

func (a *App) DockerLocalContainerStop(id string) error {
	cli, err := dockerClient()
	if err != nil {
		return err
	}
	defer cli.Close()
	return cli.ContainerStop(context.Background(), id, container.StopOptions{})
}

func (a *App) DockerLocalContainerRestart(id string) error {
	cli, err := dockerClient()
	if err != nil {
		return err
	}
	defer cli.Close()
	return cli.ContainerRestart(context.Background(), id, container.StopOptions{})
}

func (a *App) DockerLocalContainerRemove(id string) error {
	cli, err := dockerClient()
	if err != nil {
		return err
	}
	defer cli.Close()
	return cli.ContainerRemove(context.Background(), id, container.RemoveOptions{Force: true})
}

func (a *App) DockerLocalImagePull(ref string) (string, error) {
	cli, err := dockerClient()
	if err != nil {
		return "", err
	}
	defer cli.Close()
	rc, err := cli.ImagePull(context.Background(), ref, image.PullOptions{})
	if err != nil {
		return "", err
	}
	defer rc.Close()
	b, _ := io.ReadAll(rc)
	return strings.TrimSpace(string(b)), nil
}

func (a *App) DockerLocalImageRemove(id string, force bool) error {
	cli, err := dockerClient()
	if err != nil {
		return err
	}
	defer cli.Close()
	_, err = cli.ImageRemove(context.Background(), id, image.RemoveOptions{Force: force})
	return err
}

func (a *App) DockerLocalLogsStart(containerId string, tail string, since string) (string, error) {
	if a.ctx == nil || a.dockerStreams == nil {
		return "", errors.New("app not ready")
	}
	cli, err := dockerClient()
	if err != nil {
		return "", err
	}
	ctx := context.Background()
	rc, err := cli.ContainerLogs(ctx, containerId, container.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Follow:     true,
		Tail:       tail,
		Since:      since,
	})
	if err != nil {
		cli.Close()
		return "", err
	}

	stdoutR, stdoutW := io.Pipe()
	stderrR, stderrW := io.Pipe()
	done := make(chan error, 1)
	go func() {
		_, err := stdcopy.StdCopy(stdoutW, stderrW, rc)
		_ = stdoutW.CloseWithError(err)
		_ = stderrW.CloseWithError(err)
		done <- err
	}()

	id := a.dockerStreams.Start(a.ctx, nil, stdoutR, stderrR, nil, func() error {
		_ = rc.Close()
		return cli.Close()
	}, func() error {
		return <-done
	})
	return id, nil
}

// DockerLocalLogsSnapshot reads a bounded amount of non-streaming container logs (stdout+stderr demux).
func (a *App) DockerLocalLogsSnapshot(containerId string, tail string, since string, maxBytes int64) (string, error) {
	if maxBytes <= 0 {
		maxBytes = 65536
	}
	if tail == "" {
		tail = "500"
	}
	cli, err := dockerClient()
	if err != nil {
		return "", err
	}
	defer cli.Close()
	ctx := context.Background()
	rc, err := cli.ContainerLogs(ctx, containerId, container.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Follow:     false,
		Tail:       tail,
		Since:      since,
	})
	if err != nil {
		return "", err
	}
	defer rc.Close()
	var stdoutB, stderrB bytes.Buffer
	_, err = stdcopy.StdCopy(&stdoutB, &stderrB, io.LimitReader(rc, maxBytes))
	if err != nil && err != io.EOF {
		return "", err
	}
	return stdoutB.String() + stderrB.String(), nil
}

func (a *App) DockerLocalExecStart(containerId string, cols int, rows int) (string, error) {
	if a.ctx == nil || a.dockerStreams == nil {
		return "", errors.New("app not ready")
	}
	cli, err := dockerClient()
	if err != nil {
		return "", err
	}
	ctx := context.Background()
	cmd := []string{"sh", "-lc", "if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi"}
	create, err := cli.ContainerExecCreate(ctx, containerId, types.ExecConfig{
		Tty:          true,
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: true,
		Cmd:          cmd,
	})
	if err != nil {
		cli.Close()
		return "", err
	}
	resp, err := cli.ContainerExecAttach(ctx, create.ID, types.ExecStartCheck{Tty: true})
	if err != nil {
		cli.Close()
		return "", err
	}
	waitFn := func() error {
		for {
			ins, err := cli.ContainerExecInspect(ctx, create.ID)
			if err != nil {
				return err
			}
			if !ins.Running {
				return nil
			}
			time.Sleep(300 * time.Millisecond)
		}
	}
	id := a.dockerStreams.Start(a.ctx, resp.Conn, resp.Reader, nil, func(c int, r int) error {
		return cli.ContainerExecResize(ctx, create.ID, container.ResizeOptions{Width: uint(c), Height: uint(r)})
	}, func() error {
		resp.Close()
		return cli.Close()
	}, waitFn)
	return id, nil
}

func (a *App) DockerLocalListDir(containerId string, path string) ([]DockerFileEntryDTO, error) {
	out, err := a.dockerLocalExecOutput(containerId, fmt.Sprintf("cd %s && ls -la --time-style=+%%s", shellQuote(path)))
	if err != nil {
		if strings.Contains(err.Error(), "unrecognized option") || strings.Contains(err.Error(), "Usage: ls") {
			out, err = a.dockerLocalExecOutput(containerId, fmt.Sprintf("cd %s && ls -la", shellQuote(path)))
		}
	}
	if err != nil {
		return nil, err
	}
	entries := parseLsOutput(out, path)
	entries = resolveSymlinkDirs(entries, func(cmd string) (string, error) {
		return a.dockerLocalExecOutput(containerId, cmd)
	})
	return entries, nil
}

// DockerLocalReadFileTail reads the last maxBytes of a file inside the container via docker exec (no extra connection).
func (a *App) DockerLocalReadFileTail(containerId string, path string, maxBytes int64) (string, error) {
	if maxBytes <= 0 {
		maxBytes = 256 * 1024
	}
	q := shellQuote(path)
	n := strconv.FormatInt(maxBytes, 10)
	return a.dockerLocalExecOutput(containerId, fmt.Sprintf(`if [ ! -f %s ]; then exit 1; fi; tail -c %s %s`, q, n, q))
}

func (a *App) DockerLocalFileDelete(containerId string, path string) error {
	_, err := a.dockerLocalExecOutput(containerId, fmt.Sprintf("rm -rf %s", shellQuote(path)))
	return err
}

func (a *App) DockerLocalMkdir(containerId string, path string) error {
	_, err := a.dockerLocalExecOutput(containerId, fmt.Sprintf("mkdir -p %s", shellQuote(path)))
	return err
}

func (a *App) DockerLocalRename(containerId string, oldPath string, newPath string) error {
	_, err := a.dockerLocalExecOutput(containerId, fmt.Sprintf("mv %s %s", shellQuote(oldPath), shellQuote(newPath)))
	return err
}

func (a *App) DockerLocalDownload(containerId string, containerPath string, localPath string) error {
	cli, err := dockerClient()
	if err != nil {
		return err
	}
	defer cli.Close()
	ctx := context.Background()
	stat, err := cli.ContainerStatPath(ctx, containerId, containerPath)
	if err != nil {
		return err
	}
	if stat.Mode&040000 != 0 {
		return errors.New("directory download not supported in MVP")
	}
	reader, _, err := cli.CopyFromContainer(ctx, containerId, containerPath)
	if err != nil {
		return err
	}
	defer reader.Close()
	tr := tar.NewReader(reader)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if h.FileInfo().IsDir() {
			continue
		}
		if err := os.MkdirAll(filepath.Dir(localPath), 0755); err != nil {
			return err
		}
		f, err := os.Create(localPath)
		if err != nil {
			return err
		}
		if _, err := io.Copy(f, tr); err != nil {
			_ = f.Close()
			return err
		}
		_ = f.Close()
		break
	}
	return nil
}

func (a *App) DockerLocalUpload(containerId string, localPath string, containerDir string) error {
	cli, err := dockerClient()
	if err != nil {
		return err
	}
	defer cli.Close()
	f, err := os.Open(localPath)
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	pr, pw := io.Pipe()
	tw := tar.NewWriter(pw)
	go func() {
		defer pw.Close()
		defer tw.Close()
		hdr := &tar.Header{
			Name: filepath.Base(localPath),
			Mode: 0644,
			Size: info.Size(),
		}
		_ = tw.WriteHeader(hdr)
		_, _ = io.Copy(tw, f)
	}()
	return cli.CopyToContainer(context.Background(), containerId, containerDir, pr, container.CopyToContainerOptions{AllowOverwriteDirWithFile: true})
}

func (a *App) dockerLocalExecOutput(containerId string, cmd string) (string, error) {
	cli, err := dockerClient()
	if err != nil {
		return "", err
	}
	defer cli.Close()
	ctx := context.Background()
	create, err := cli.ContainerExecCreate(ctx, containerId, types.ExecConfig{
		Tty:          false,
		AttachStdout: true,
		AttachStderr: true,
		Cmd:          []string{"sh", "-lc", cmd},
	})
	if err != nil {
		return "", err
	}
	resp, err := cli.ContainerExecAttach(ctx, create.ID, types.ExecStartCheck{})
	if err != nil {
		return "", err
	}
	defer resp.Close()
	var out strings.Builder
	var errOut strings.Builder
	_, err = stdcopy.StdCopy(&out, &errOut, resp.Reader)
	if err != nil {
		return "", err
	}
	if errOut.Len() > 0 {
		return out.String(), errors.New(strings.TrimSpace(errOut.String()))
	}
	return out.String(), nil
}
