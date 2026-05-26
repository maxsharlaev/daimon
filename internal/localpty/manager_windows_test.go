//go:build windows

package localpty

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestStartWindowsShell(t *testing.T) {
	m := NewManager(nil)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	id, err := m.Start(ctx, 80, 24, `C:\`)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer m.Stop(id)

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		out, _ := m.Replay(id)
		if strings.Contains(out, ">") || strings.Contains(strings.ToLower(out), "microsoft") {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	out, _ := m.Replay(id)
	t.Fatalf("expected cmd banner/prompt in output, got %q", out)
}
