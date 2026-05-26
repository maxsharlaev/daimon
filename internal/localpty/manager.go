package localpty

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
)

type OutputEvent struct {
	ID    string `json:"id"`
	Data  string `json:"data"`
	IsErr bool   `json:"isErr"`
}

type StateEvent struct {
	ID    string `json:"id"`
	State string `json:"state"`
	Error string `json:"error,omitempty"`
}

type CwdEvent struct {
	ID   string `json:"id"`
	Path string `json:"path"`
}

type EmitFunc func(event string, payload any)

type Manager struct {
	mu     sync.Mutex
	shells map[string]*session
	emit   EmitFunc
}

type session struct {
	id       string
	ptmx     *os.File
	cmd      *exec.Cmd
	closed   chan struct{}
	cwd      string
	inputBuf strings.Builder
}

func NewManager(emit EmitFunc) *Manager {
	return &Manager{
		shells: map[string]*session{},
		emit:   emit,
	}
}

func (m *Manager) Start(ctx context.Context, cols, rows int, cwd string) (string, error) {
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}
	shell, shellArgs := defaultShellCommand()
	if strings.TrimSpace(cwd) == "" {
		if home, err := os.UserHomeDir(); err == nil {
			cwd = home
		} else {
			cwd = "."
		}
	}
	cwd = filepath.Clean(cwd)
	if st, err := os.Stat(cwd); err != nil || !st.IsDir() {
		if home, err := os.UserHomeDir(); err == nil {
			cwd = home
		}
	}

	cmd := exec.Command(shell, shellArgs...)
	cmd.Dir = cwd
	cmd.Env = os.Environ()

	ptmx, err := pty.Start(cmd)
	if err != nil {
		return "", fmt.Errorf("start pty: %w", err)
	}
	if err := pty.Setsize(ptmx, &pty.Winsize{Rows: uint16(rows), Cols: uint16(cols)}); err != nil {
		_ = ptmx.Close()
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		return "", fmt.Errorf("resize pty: %w", err)
	}

	id := randomID()
	s := &session{id: id, ptmx: ptmx, cmd: cmd, closed: make(chan struct{}), cwd: cwd}
	m.mu.Lock()
	m.shells[id] = s
	m.mu.Unlock()

	if m.emit != nil {
		m.emit("local:state", StateEvent{ID: id, State: "connected"})
		m.emit("local:cwd", CwdEvent{ID: id, Path: cwd})
	}

	go m.pump(ctx, id, ptmx, false)
	go func() {
		err := cmd.Wait()
		ev := StateEvent{ID: id, State: "disconnected"}
		if err != nil {
			ev.Error = err.Error()
		}
		_ = m.stop(id, &ev)
	}()

	return id, nil
}

func (m *Manager) Cwd(id string) (string, error) {
	m.mu.Lock()
	s := m.shells[id]
	cwd := ""
	if s != nil {
		cwd = s.cwd
	}
	m.mu.Unlock()
	if s == nil {
		return "", errors.New("local shell not found")
	}
	return cwd, nil
}

func (m *Manager) Send(id string, data string) error {
	m.mu.Lock()
	s := m.shells[id]
	m.mu.Unlock()
	if s == nil || s.ptmx == nil {
		return errors.New("local shell not found")
	}
	_, err := s.ptmx.Write([]byte(data))
	if err != nil {
		return err
	}
	m.feedInput(id, data)
	return nil
}

func (m *Manager) feedInput(id string, data string) {
	var cwdUpdate string
	m.mu.Lock()
	s := m.shells[id]
	if s == nil {
		m.mu.Unlock()
		return
	}
	for _, ch := range data {
		if ch == '\r' || ch == '\n' {
			line := s.inputBuf.String()
			s.inputBuf.Reset()
			next := ApplyCdLine(s.cwd, line)
			if next != "" && next != s.cwd {
				s.cwd = next
				cwdUpdate = next
			}
		} else {
			s.inputBuf.WriteRune(ch)
		}
	}
	m.mu.Unlock()
	if cwdUpdate != "" {
		m.emitCwd(id, cwdUpdate)
	}
}

func (m *Manager) emitCwd(id string, path string) {
	if m.emit == nil {
		return
	}
	m.emit("local:cwd", CwdEvent{ID: id, Path: path})
}

func (m *Manager) noteCwdFromOutput(id string, chunk string) {
	if p := ParseOSC7Cwd(chunk); p != "" {
		m.setCwd(id, p)
	}
}

func (m *Manager) setCwd(id string, path string) {
	path = filepath.Clean(path)
	m.mu.Lock()
	s := m.shells[id]
	if s == nil || s.cwd == path {
		m.mu.Unlock()
		return
	}
	s.cwd = path
	m.mu.Unlock()
	m.emitCwd(id, path)
}

func (m *Manager) Resize(id string, cols, rows int) error {
	m.mu.Lock()
	s := m.shells[id]
	m.mu.Unlock()
	if s == nil || s.ptmx == nil {
		return errors.New("local shell not found")
	}
	if cols <= 0 || rows <= 0 {
		return nil
	}
	return pty.Setsize(s.ptmx, &pty.Winsize{Rows: uint16(rows), Cols: uint16(cols)})
}

func (m *Manager) Stop(id string) error {
	return m.stop(id, nil)
}

func (m *Manager) StopAll() {
	m.mu.Lock()
	ids := make([]string, 0, len(m.shells))
	for id := range m.shells {
		ids = append(ids, id)
	}
	m.mu.Unlock()
	for _, id := range ids {
		_ = m.stop(id, nil)
	}
}

func (m *Manager) stop(id string, ev *StateEvent) error {
	m.mu.Lock()
	s := m.shells[id]
	if s != nil {
		delete(m.shells, id)
	}
	m.mu.Unlock()
	if s == nil {
		return nil
	}
	select {
	case <-s.closed:
	default:
		close(s.closed)
	}
	if s.ptmx != nil {
		_ = s.ptmx.Close()
	}
	if s.cmd != nil && s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
	}
	if m.emit != nil {
		if ev != nil {
			m.emit("local:state", *ev)
		} else {
			m.emit("local:state", StateEvent{ID: id, State: "disconnected"})
		}
	}
	return nil
}

func (m *Manager) pump(ctx context.Context, id string, r io.Reader, isErr bool) {
	buf := make([]byte, 32*1024)
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		n, err := r.Read(buf)
		if n > 0 {
			chunk := string(buf[:n])
			m.noteCwdFromOutput(id, chunk)
			if m.emit != nil {
				m.emit("local:output", OutputEvent{ID: id, Data: chunk, IsErr: isErr})
			}
		}
		if err != nil {
			return
		}
	}
}

func defaultShellCommand() (string, []string) {
	if runtime.GOOS == "windows" {
		comspec := strings.TrimSpace(os.Getenv("ComSpec"))
		if comspec == "" {
			comspec = `C:\Windows\System32\cmd.exe`
		}
		if strings.HasSuffix(strings.ToLower(comspec), "cmd.exe") {
			return comspec, []string{"/k"}
		}
		return comspec, nil
	}
	if sh := strings.TrimSpace(os.Getenv("SHELL")); sh != "" {
		return sh, []string{"-l"}
	}
	return "/bin/bash", []string{"-l"}
}

func randomID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("local-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}
