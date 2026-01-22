package main

import "errors"

func (a *App) DockerStreamSend(id string, data string) error {
	if a.dockerStreams == nil {
		return errors.New("docker streams not ready")
	}
	return a.dockerStreams.Send(id, data)
}

func (a *App) DockerStreamResize(id string, cols int, rows int) error {
	if a.dockerStreams == nil {
		return errors.New("docker streams not ready")
	}
	return a.dockerStreams.Resize(id, cols, rows)
}

func (a *App) DockerStreamStop(id string) error {
	if a.dockerStreams == nil || a.ctx == nil {
		return errors.New("docker streams not ready")
	}
	return a.dockerStreams.Stop(a.ctx, id)
}
