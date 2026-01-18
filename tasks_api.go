package main

import (
	"fmt"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// TaskStateEvent is a lightweight event to drive "yellow marker" UI.
// state: running | success | failed
type TaskStateEvent struct {
	SessionID string `json:"sessionId"`
	State     string `json:"state"`
	Error     string `json:"error,omitempty"`
}

// DemoRunTask emits task events for a given SSH session (UI marker demo).
// This is a temporary MVP helper until real tasks are implemented.
func (a *App) DemoRunTask(sessionId string, durationMs int) error {
	if a.ctx == nil {
		return fmt.Errorf("app context not ready")
	}
	if sessionId == "" {
		return fmt.Errorf("sessionId is required")
	}
	if durationMs <= 0 {
		durationMs = 1500
	}

	runtime.EventsEmit(a.ctx, "task:state", TaskStateEvent{SessionID: sessionId, State: "running"})
	go func() {
		time.Sleep(time.Duration(durationMs) * time.Millisecond)
		runtime.EventsEmit(a.ctx, "task:state", TaskStateEvent{SessionID: sessionId, State: "success"})
	}()
	return nil
}

