package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/docker/docker/api/types"
	"al.essio.dev/pkg/shellescape"
)

func (a *App) DockerLocalListNetworks() ([]DockerNetworkDTO, error) {
	cli, err := dockerClient()
	if err != nil {
		return nil, err
	}
	defer cli.Close()
	ctx := context.Background()
	list, err := cli.NetworkList(ctx, types.NetworkListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]DockerNetworkDTO, 0, len(list))
	for _, n := range list {
		out = append(out, DockerNetworkDTO{
			ID:     n.ID,
			Name:   n.Name,
			Driver: n.Driver,
			Scope:  n.Scope,
		})
	}
	return out, nil
}

func (a *App) DockerLocalNetworkInspect(id string) (DockerNetworkDetailsDTO, error) {
	cli, err := dockerClient()
	if err != nil {
		return DockerNetworkDetailsDTO{}, err
	}
	defer cli.Close()
	ctx := context.Background()
	nw, err := cli.NetworkInspect(ctx, id, types.NetworkInspectOptions{})
	if err != nil {
		return DockerNetworkDetailsDTO{}, err
	}
	var containers []string
	for _, c := range nw.Containers {
		if c.Name != "" {
			containers = append(containers, c.Name)
		}
	}
	return DockerNetworkDetailsDTO{
		ID:         nw.ID,
		Name:       nw.Name,
		Driver:     nw.Driver,
		Scope:      nw.Scope,
		Internal:   nw.Internal,
		Attachable: nw.Attachable,
		Ingress:    nw.Ingress,
		Containers: containers,
	}, nil
}

func (a *App) DockerLocalNetworkRemove(id string) error {
	cli, err := dockerClient()
	if err != nil {
		return err
	}
	defer cli.Close()
	return cli.NetworkRemove(context.Background(), id)
}

func (a *App) DockerRemoteListNetworks(sessionId string) ([]DockerNetworkDTO, error) {
	raw, err := a.ssh.Exec(sessionId, "docker network ls --format '{{json .}}'")
	if err != nil {
		return nil, err
	}
	lines := splitLines(raw)
	out := make([]DockerNetworkDTO, 0, len(lines))
	for _, line := range lines {
		var v struct {
			ID     string `json:"ID"`
			Name   string `json:"Name"`
			Driver string `json:"Driver"`
			Scope  string `json:"Scope"`
		}
		if err := jsonUnmarshal(line, &v); err != nil {
			continue
		}
		out = append(out, DockerNetworkDTO{ID: v.ID, Name: v.Name, Driver: v.Driver, Scope: v.Scope})
	}
	return out, nil
}

func (a *App) DockerRemoteNetworkInspect(sessionId string, id string) (DockerNetworkDetailsDTO, error) {
	raw, err := a.ssh.Exec(sessionId, fmt.Sprintf("docker network inspect %s", shellescape.Quote(id)))
	if err != nil {
		return DockerNetworkDetailsDTO{}, err
	}
	var arr []types.NetworkResource
	if err := json.Unmarshal([]byte(raw), &arr); err != nil {
		return DockerNetworkDetailsDTO{}, err
	}
	if len(arr) == 0 {
		return DockerNetworkDetailsDTO{}, errors.New("network not found")
	}
	nw := arr[0]
	var containers []string
	for _, c := range nw.Containers {
		if c.Name != "" {
			containers = append(containers, c.Name)
		}
	}
	return DockerNetworkDetailsDTO{
		ID:         nw.ID,
		Name:       nw.Name,
		Driver:     nw.Driver,
		Scope:      nw.Scope,
		Internal:   nw.Internal,
		Attachable: nw.Attachable,
		Ingress:    nw.Ingress,
		Containers: containers,
	}, nil
}

func (a *App) DockerRemoteNetworkRemove(sessionId string, id string) error {
	_, err := a.ssh.Exec(sessionId, fmt.Sprintf("docker network rm %s", shellescape.Quote(id)))
	return err
}
