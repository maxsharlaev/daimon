package localpty

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
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

	"github.com/charmbracelet/x/xpty"
)

type OutputEvent struct {
	ID      string `json:"id"`
	Data    string `json:"data,omitempty"` // legacy fallback
	DataB64 string `json:"dataB64,omitempty"`
	IsErr   bool   `json:"isErr"`
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

type DebugInfo struct {
	ID        string `json:"id"`
	Cwd       string `json:"cwd"`
	Cols      int    `json:"cols"`
	Rows      int    `json:"rows"`
	BufferLen int    `json:"bufferLen"`
	TailHex   string `json:"tailHex"`
	TailText  string `json:"tailText"`
}

type EmitFunc func(event string, payload any)

type Manager struct {
	mu     sync.Mutex
	shells map[string]*session
	emit   EmitFunc
}

const maxShellOutputBuf = 512 * 1024

type session struct {
	id        string
	pty       xpty.Pty
	cmd       *exec.Cmd
	closed    chan struct{}
	cwd       string
	inputBuf  strings.Builder
	outputBuf bytes.Buffer
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

	pt, err := xpty.NewPty(cols, rows)
	if err != nil {
		return "", fmt.Errorf("create pty: %w", err)
	}

	cmd := exec.Command(shell, shellArgs...)
	cmd.Dir = cwd
	cmd.Env = os.Environ()

	if err := pt.Start(cmd); err != nil {
		_ = pt.Close()
		return "", fmt.Errorf("start shell: %w", err)
	}

	id := randomID()
	s := &session{id: id, pty: pt, cmd: cmd, closed: make(chan struct{}), cwd: cwd}
	m.mu.Lock()
	m.shells[id] = s
	m.mu.Unlock()

	if m.emit != nil {
		m.emit("local:state", StateEvent{ID: id, State: "connected"})
		m.emit("local:cwd", CwdEvent{ID: id, Path: cwd})
	}

	go m.pump(ctx, id, pt, false)
	go func() {
		err := xpty.WaitProcess(ctx, cmd)
		ev := StateEvent{ID: id, State: "disconnected"}
		if err != nil {
			ev.Error = err.Error()
		}
		_ = m.stop(id, &ev)
	}()

	return id, nil
}

func (m *Manager) Replay(id string) (string, error) {
	b64, err := m.ReplayB64(id)
	if err != nil {
		return "", err
	}
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func (m *Manager) ReplayB64(id string) (string, error) {
	m.mu.Lock()
	s := m.shells[id]
	var out string
	if s != nil {
		out = base64.StdEncoding.EncodeToString(s.outputBuf.Bytes())
	}
	m.mu.Unlock()
	if s == nil {
		return "", errors.New("local shell not found")
	}
	return out, nil
}

func (m *Manager) Debug(id string) (DebugInfo, error) {
	m.mu.Lock()
	s := m.shells[id]
	if s == nil {
		m.mu.Unlock()
		return DebugInfo{}, errors.New("local shell not found")
	}
	info := DebugInfo{
		ID:        id,
		Cwd:       s.cwd,
		BufferLen: s.outputBuf.Len(),
	}
	tail := append([]byte(nil), s.outputBuf.Bytes()...)
	m.mu.Unlock()

	if s.pty != nil {
		cols, rows, err := s.pty.Size()
		if err == nil {
			info.Cols = cols
			info.Rows = rows
		}
	}
	if len(tail) > 96 {
		tail = tail[len(tail)-96:]
	}
	info.TailHex = hex.EncodeToString(tail)
	info.TailText = strings.ReplaceAll(string(tail), "\x1b", "\\x1b")
	return info, nil
}

func (m *Manager) appendOutput(id string, chunk []byte) {
	if len(chunk) == 0 {
		return
	}
	m.mu.Lock()
	s := m.shells[id]
	if s != nil {
		_, _ = s.outputBuf.Write(chunk)
		if s.outputBuf.Len() > maxShellOutputBuf {
			trim := append([]byte(nil), s.outputBuf.Bytes()...)
			s.outputBuf.Reset()
			_, _ = s.outputBuf.Write(trim[len(trim)-maxShellOutputBuf:])
		}
	}
	m.mu.Unlock()
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
	if s == nil || s.pty == nil {
		return errors.New("local shell not found")
	}
	_, err := s.pty.Write([]byte(data))
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
	if s == nil || s.pty == nil {
		return errors.New("local shell not found")
	}
	if cols <= 0 || rows <= 0 {
		return nil
	}
	return s.pty.Resize(cols, rows)
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
	if s.pty != nil {
		_ = s.pty.Close()
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

func (m *Manager) emitOutputChunk(id string, chunk []byte, isErr bool) {
	if len(chunk) == 0 {
		return
	}
	m.appendOutput(id, chunk)
	m.noteCwdFromOutput(id, string(chunk))
	if m.emit != nil {
		m.emit("local:output", OutputEvent{ID: id, DataB64: base64.StdEncoding.EncodeToString(chunk), IsErr: isErr})
	}
}

func (m *Manager) pump(ctx context.Context, id string, r io.Reader, isErr bool) {
	readBuf := make([]byte, 32*1024)
	var pending []byte
	flushPending := func() {
		for len(pending) > 0 {
			emit, rest := emitPrefix(pending)
			if len(emit) == 0 {
				break
			}
			pending = rest
			m.emitOutputChunk(id, emit, isErr)
		}
	}
	for {
		select {
		case <-ctx.Done():
			if len(pending) > 0 {
				m.emitOutputChunk(id, pending, isErr)
			}
			return
		default:
		}
		n, err := r.Read(readBuf)
		if n > 0 {
			pending = append(pending, readBuf[:n]...)
			flushPending()
		}
		if err != nil {
			if len(pending) > 0 {
				m.emitOutputChunk(id, pending, isErr)
			}
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
