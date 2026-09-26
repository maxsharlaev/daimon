package main

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
)

const (
	postgresSidecarImage = "postgres:16-alpine"
	mysqlSidecarImage    = "mysql:8"
)

func dockerSidecarRun(ctx context.Context, cli *client.Client, targetContainerID string, image string, env []string, cmd []string, stdin io.Reader) (stdout string, stderr string, err error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()

	netMode := container.NetworkMode("container:" + targetContainerID)
	resp, err := cli.ContainerCreate(ctx, &container.Config{
		Image:        image,
		Cmd:          cmd,
		Env:          env,
		AttachStdout: true,
		AttachStderr: true,
		AttachStdin:  stdin != nil,
		OpenStdin:    stdin != nil,
		Tty:          false,
	}, &container.HostConfig{
		AutoRemove:    true,
		NetworkMode:   netMode,
		RestartPolicy: container.RestartPolicy{Name: "no"},
	}, &network.NetworkingConfig{}, nil, "")
	if err != nil {
		return "", "", err
	}
	cid := resp.ID
	attachResp, err := cli.ContainerAttach(ctx, cid, container.AttachOptions{
		Stream: true,
		Stdin:  stdin != nil,
		Stdout: true,
		Stderr: true,
	})
	if err != nil {
		return "", "", err
	}
	defer attachResp.Close()

	if stdin != nil {
		go func() {
			_, _ = io.Copy(attachResp.Conn, stdin)
			_ = attachResp.CloseWrite()
		}()
	}

	if err := cli.ContainerStart(ctx, cid, container.StartOptions{}); err != nil {
		return "", "", err
	}

	var outBuf, errBuf bytes.Buffer
	_, err = stdcopy.StdCopy(&outBuf, &errBuf, attachResp.Reader)
	waitCh, errC := cli.ContainerWait(ctx, cid, container.WaitConditionNotRunning)
	select {
	case w := <-waitCh:
		if w.Error != nil {
			err = errors.New(w.Error.Message)
		}
	case err = <-errC:
	case <-ctx.Done():
		err = ctx.Err()
	}

	stdout = strings.TrimSpace(outBuf.String())
	stderr = strings.TrimSpace(errBuf.String())
	if err != nil && stdout == "" && stderr != "" {
		err = errors.New(stderr)
	}
	return stdout, stderr, err
}

func dockerPostgresQuery(containerID, host string, port int, user, password, database, sqlText string) (cols []string, rows [][]string, err error) {
	if database == "" {
		database = "postgres"
	}
	cli, err := dockerClient()
	if err != nil {
		return nil, nil, err
	}
	defer cli.Close()
	ctx := context.Background()
	env := []string{"PGPASSWORD=" + password}
	if host == "" {
		host = "127.0.0.1"
	}
	cmd := []string{
		"psql", "-h", host, "-p", strconv.Itoa(port), "-U", user, "-d", database,
		"-At", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-f", "-",
	}
	stdin := strings.NewReader(sqlText + "\n")
	out, stderr, err := dockerSidecarRun(ctx, cli, containerID, postgresSidecarImage, env, cmd, stdin)
	if err != nil && out == "" {
		if stderr != "" {
			return nil, nil, fmt.Errorf("%w: %s", err, stderr)
		}
		return nil, nil, err
	}
	return parseTSV(out)
}

func dockerMySQLQuery(containerID, host string, port int, user, password, database, sqlText string) (cols []string, rows [][]string, err error) {
	cli, err := dockerClient()
	if err != nil {
		return nil, nil, err
	}
	defer cli.Close()
	ctx := context.Background()
	env := []string{fmt.Sprintf("MYSQL_PWD=%s", password)}
	if host == "" {
		host = "127.0.0.1"
	}
	args := []string{
		"mysql", "-h", host, "-P", strconv.Itoa(port), "-u", user,
		"--default-character-set=utf8mb4",
		"-B", "-e", sqlText,
	}
	if database != "" {
		args = append(args, database)
	}
	out, stderr, err := dockerSidecarRun(ctx, cli, containerID, mysqlSidecarImage, env, args, nil)
	if err != nil && out == "" {
		if stderr != "" {
			return nil, nil, fmt.Errorf("%w: %s", err, stderr)
		}
		return nil, nil, err
	}
	// mysql -B emits tab-separated output and includes the header row (unless -N is set).
	// We keep headers so UI gets real column names.
	return parseMySQLTSV(out)
}

func parseTSV(s string) (cols []string, rows [][]string, err error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, nil, nil
	}
	lines := strings.Split(s, "\n")
	r := csv.NewReader(strings.NewReader(strings.Join(lines, "\n")))
	r.Comma = '\t'
	r.LazyQuotes = true
	records, err := r.ReadAll()
	if err != nil {
		return nil, nil, err
	}
	if len(records) == 0 {
		return nil, nil, nil
	}
	// psql -At returns one column per line for single column output; for SELECT * it's tab-separated per line
	if len(records[0]) == 1 && len(records) > 1 {
		// Could be single-column result
		cols = []string{"?"}
		rows = append(rows, records...)
		return cols, rows, nil
	}
	// Assume first line is header if we emitted with headers - we use -At without headers
	cols = make([]string, len(records[0]))
	for i := range cols {
		cols[i] = fmt.Sprintf("col%d", i+1)
	}
	rows = append(rows, records...)
	return cols, rows, nil
}

func parseMySQLTSV(s string) (cols []string, rows [][]string, err error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, nil, nil
	}
	r := csv.NewReader(strings.NewReader(s))
	r.Comma = '\t'
	r.LazyQuotes = true
	records, err := r.ReadAll()
	if err != nil {
		return nil, nil, err
	}
	if len(records) == 0 {
		return nil, nil, nil
	}
	cols = records[0]
	if len(records) > 1 {
		rows = records[1:]
	}
	return cols, rows, nil
}
