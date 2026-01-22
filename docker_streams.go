package main

import (
	"context"
	"errors"
	"io"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type dockerStream struct {
	id     string
	stdin  io.WriteCloser
	close  func() error
	resize func(cols int, rows int) error
}

type DockerStreamManager struct {
	mu      sync.Mutex
	streams map[string]*dockerStream
}

func NewDockerStreamManager() *DockerStreamManager {
	return &DockerStreamManager{
		streams: map[string]*dockerStream{},
	}
}

func (m *DockerStreamManager) Start(ctx context.Context, stdin io.WriteCloser, stdout io.Reader, stderr io.Reader, resize func(cols int, rows int) error, closeFn func() error, waitFn func() error) string {
	id := randomID()
	m.mu.Lock()
	m.streams[id] = &dockerStream{id: id, stdin: stdin, close: closeFn, resize: resize}
	m.mu.Unlock()

	runtime.EventsEmit(ctx, "docker:state", DockerStateEvent{ID: id, State: "connected"})

	if stdout != nil {
		go m.pump(ctx, id, stdout, false)
	}
	if stderr != nil {
		go m.pump(ctx, id, stderr, true)
	}

	if waitFn != nil {
		go func() {
			err := waitFn()
			ev := DockerStateEvent{ID: id, State: "disconnected"}
			if err != nil {
				ev.Error = err.Error()
			}
			_ = m.stop(ctx, id, &ev)
		}()
	}

	return id
}

func (m *DockerStreamManager) Send(id string, data string) error {
	m.mu.Lock()
	s := m.streams[id]
	m.mu.Unlock()
	if s == nil || s.stdin == nil {
		return errors.New("stream not found or not writable")
	}
	_, err := s.stdin.Write([]byte(data))
	return err
}

func (m *DockerStreamManager) Resize(id string, cols int, rows int) error {
	m.mu.Lock()
	s := m.streams[id]
	m.mu.Unlock()
	if s == nil || s.resize == nil {
		return errors.New("stream not found or not resizable")
	}
	if cols <= 0 || rows <= 0 {
		return nil
	}
	return s.resize(cols, rows)
}

func (m *DockerStreamManager) Stop(ctx context.Context, id string) error {
	return m.stop(ctx, id, nil)
}

func (m *DockerStreamManager) stop(ctx context.Context, id string, ev *DockerStateEvent) error {
	m.mu.Lock()
	s := m.streams[id]
	if s != nil {
		delete(m.streams, id)
	}
	m.mu.Unlock()
	if s == nil {
		return nil
	}
	if s.close != nil {
		_ = s.close()
	}
	if ev != nil {
		runtime.EventsEmit(ctx, "docker:state", *ev)
	} else {
		runtime.EventsEmit(ctx, "docker:state", DockerStateEvent{ID: id, State: "disconnected"})
	}
	return nil
}

func (m *DockerStreamManager) pump(ctx context.Context, id string, r io.Reader, isErr bool) {
	buf := make([]byte, 32*1024)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			runtime.EventsEmit(ctx, "docker:output", DockerOutputEvent{
				ID:    id,
				Data:  string(buf[:n]),
				IsErr: isErr,
			})
		}
		if err != nil {
			return
		}
	}
}
