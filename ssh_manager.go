package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"daimon/internal/sshkeys"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

type SSHConfig struct {
	Host string `json:"host"`
	Port int    `json:"port"`

	Username string `json:"username"`

	// AuthType: "password" | "privateKey"
	AuthType string `json:"authType"`

	Password string `json:"password,omitempty"`

	PrivateKeyPath string `json:"privateKeyPath,omitempty"`
	PrivateKeyPEM  string `json:"privateKeyPem,omitempty"`
	Passphrase     string `json:"passphrase,omitempty"`

	// MVP: allow insecure host key verification (recommended false in production)
	InsecureIgnoreHostKey bool `json:"insecureIgnoreHostKey"`

	Cols int `json:"cols,omitempty"`
	Rows int `json:"rows,omitempty"`

	TimeoutMs int `json:"timeoutMs,omitempty"`
}

type SSHManager struct {
	mu    sync.Mutex
	conns map[string]*sshConn
}

type sshConn struct {
	id string

	client  *ssh.Client
	session *ssh.Session
	stdin   io.WriteCloser

	closed chan struct{}
	once   sync.Once
}

type SSHCmdSession struct {
	session *ssh.Session
	stdin   io.WriteCloser
	stdout  io.Reader
	stderr  io.Reader
}

func (s *SSHCmdSession) Stdin() io.WriteCloser { return s.stdin }
func (s *SSHCmdSession) Stdout() io.Reader     { return s.stdout }
func (s *SSHCmdSession) Stderr() io.Reader     { return s.stderr }
func (s *SSHCmdSession) Wait() error           { return s.session.Wait() }
func (s *SSHCmdSession) Close() error          { return s.session.Close() }
func (s *SSHCmdSession) Resize(cols int, rows int) error {
	if rows <= 0 || cols <= 0 {
		return nil
	}
	return s.session.WindowChange(rows, cols)
}

type SSHOutputEvent struct {
	ID    string `json:"id"`
	Data  string `json:"data"`
	IsErr bool   `json:"isErr"`
}

type SSHStateEvent struct {
	ID    string `json:"id"`
	State string `json:"state"` // "connected" | "disconnected"
	Error string `json:"error,omitempty"`
}

func NewSSHManager() *SSHManager {
	return &SSHManager{
		conns: map[string]*sshConn{},
	}
}

func sshTimeout(cfg SSHConfig) time.Duration {
	timeout := 10 * time.Second
	if cfg.TimeoutMs > 0 {
		timeout = time.Duration(cfg.TimeoutMs) * time.Millisecond
	}
	// Guard against accidental 0/negative or extremely small timeouts.
	if timeout < 250*time.Millisecond {
		timeout = 250 * time.Millisecond
	}
	return timeout
}

func (m *SSHManager) TestConnection(cfg SSHConfig) (string, error) {
	timeout := sshTimeout(cfg)
	client, err := dialSSH(cfg)
	if err != nil {
		return "", err
	}
	defer client.Close()

	// Ensure we never hang forever on NewSession/CombinedOutput.
	// If the timeout is hit, close the client to abort any in-flight SSH operations.
	var timedOut int32
	timer := time.AfterFunc(timeout, func() {
		atomic.StoreInt32(&timedOut, 1)
		_ = client.Close()
	})
	defer timer.Stop()

	sess, err := client.NewSession()
	if err != nil {
		if atomic.LoadInt32(&timedOut) == 1 {
			return "", fmt.Errorf("ssh test timed out after %s", timeout)
		}
		return "", err
	}
	defer sess.Close()

	out, err := sess.CombinedOutput("echo daimon-ok")
	if err != nil {
		if atomic.LoadInt32(&timedOut) == 1 {
			return "", fmt.Errorf("ssh test timed out after %s", timeout)
		}
		return "", fmt.Errorf("ssh test failed: %w", err)
	}
	return strings.TrimSpace(string(out)), nil
}

func (m *SSHManager) Connect(ctx context.Context, cfg SSHConfig) (string, error) {
	timeout := sshTimeout(cfg)
	client, err := dialSSH(cfg)
	if err != nil {
		return "", err
	}

	// Safety guard: don't leave the UI "busy" forever if session startup stalls.
	var timedOut int32
	timer := time.AfterFunc(timeout, func() {
		atomic.StoreInt32(&timedOut, 1)
		_ = client.Close()
	})
	defer timer.Stop()

	sess, err := client.NewSession()
	if err != nil {
		if atomic.LoadInt32(&timedOut) == 1 {
			client.Close()
			return "", fmt.Errorf("ssh connect timed out after %s", timeout)
		}
		client.Close()
		return "", err
	}

	stdin, err := sess.StdinPipe()
	if err != nil {
		sess.Close()
		client.Close()
		return "", err
	}

	stdout, err := sess.StdoutPipe()
	if err != nil {
		sess.Close()
		client.Close()
		return "", err
	}

	stderr, err := sess.StderrPipe()
	if err != nil {
		sess.Close()
		client.Close()
		return "", err
	}

	rows := cfg.Rows
	cols := cfg.Cols
	if rows <= 0 {
		rows = 24
	}
	if cols <= 0 {
		cols = 80
	}

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := sess.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		if atomic.LoadInt32(&timedOut) == 1 {
			sess.Close()
			client.Close()
			return "", fmt.Errorf("ssh connect timed out after %s", timeout)
		}
		sess.Close()
		client.Close()
		return "", fmt.Errorf("request pty: %w", err)
	}

	if err := sess.Shell(); err != nil {
		if atomic.LoadInt32(&timedOut) == 1 {
			sess.Close()
			client.Close()
			return "", fmt.Errorf("ssh connect timed out after %s", timeout)
		}
		sess.Close()
		client.Close()
		return "", fmt.Errorf("start shell: %w", err)
	}

	id := randomID()
	c := &sshConn{
		id:      id,
		client:  client,
		session: sess,
		stdin:   stdin,
		closed:  make(chan struct{}),
	}

	m.mu.Lock()
	m.conns[id] = c
	m.mu.Unlock()

	runtime.EventsEmit(ctx, "ssh:state", SSHStateEvent{ID: id, State: "connected"})

	go m.pump(ctx, id, stdout, false)
	go m.pump(ctx, id, stderr, true)
	go func() {
		err := sess.Wait()
		ev := &SSHStateEvent{ID: id, State: "disconnected"}
		if err != nil {
			ev.Error = err.Error()
		}
		_ = m.disconnect(ctx, id, ev)
	}()

	return id, nil
}

// ConnectExecOnly connects to SSH and keeps only the ssh.Client for non-interactive Exec() calls.
// It does NOT create a PTY / shell session and does not emit ssh:output events.
func (m *SSHManager) ConnectExecOnly(ctx context.Context, cfg SSHConfig) (string, error) {
	client, err := dialSSH(cfg)
	if err != nil {
		return "", err
	}

	id := randomID()
	c := &sshConn{
		id:     id,
		client: client,
		closed: make(chan struct{}),
	}

	m.mu.Lock()
	m.conns[id] = c
	m.mu.Unlock()

	runtime.EventsEmit(ctx, "ssh:state", SSHStateEvent{ID: id, State: "connected"})
	return id, nil
}

func (m *SSHManager) Disconnect(ctx context.Context, id string) error {
	return m.disconnect(ctx, id, nil)
}

// Exec runs a non-interactive command on the existing SSH client for the given session id.
// It uses a separate ssh.Session (does not reuse the interactive PTY session).
func (m *SSHManager) Exec(id string, cmd string) (string, error) {
	m.mu.Lock()
	c := m.conns[id]
	m.mu.Unlock()
	if c == nil || c.client == nil {
		return "", errors.New("ssh session not found")
	}
	if strings.TrimSpace(cmd) == "" {
		return "", errors.New("cmd required")
	}

	sess, err := c.client.NewSession()
	if err != nil {
		return "", err
	}
	defer sess.Close()

	out, err := sess.CombinedOutput(cmd)
	if err != nil {
		return "", fmt.Errorf("ssh exec failed: %w", err)
	}
	return strings.TrimSpace(string(out)), nil
}

// Client returns the underlying ssh.Client for a connection id.
func (m *SSHManager) Client(id string) (*ssh.Client, error) {
	m.mu.Lock()
	c := m.conns[id]
	m.mu.Unlock()
	if c == nil || c.client == nil {
		return nil, errors.New("ssh session not found")
	}
	return c.client, nil
}

// OpenCommandSession starts a non-interactive command session with streaming stdout/stderr.
func (m *SSHManager) OpenCommandSession(id string, cmd string) (*SSHCmdSession, error) {
	m.mu.Lock()
	c := m.conns[id]
	m.mu.Unlock()
	if c == nil || c.client == nil {
		return nil, errors.New("ssh session not found")
	}
	if strings.TrimSpace(cmd) == "" {
		return nil, errors.New("cmd required")
	}
	sess, err := c.client.NewSession()
	if err != nil {
		return nil, err
	}
	stdin, err := sess.StdinPipe()
	if err != nil {
		sess.Close()
		return nil, err
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		sess.Close()
		return nil, err
	}
	stderr, err := sess.StderrPipe()
	if err != nil {
		sess.Close()
		return nil, err
	}
	if err := sess.Start(cmd); err != nil {
		sess.Close()
		return nil, err
	}
	return &SSHCmdSession{session: sess, stdin: stdin, stdout: stdout, stderr: stderr}, nil
}

// OpenCommandPTY starts an interactive command session with PTY and streaming IO.
func (m *SSHManager) OpenCommandPTY(id string, cmd string, cols int, rows int) (*SSHCmdSession, error) {
	m.mu.Lock()
	c := m.conns[id]
	m.mu.Unlock()
	if c == nil || c.client == nil {
		return nil, errors.New("ssh session not found")
	}
	if strings.TrimSpace(cmd) == "" {
		return nil, errors.New("cmd required")
	}
	sess, err := c.client.NewSession()
	if err != nil {
		return nil, err
	}
	stdin, err := sess.StdinPipe()
	if err != nil {
		sess.Close()
		return nil, err
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		sess.Close()
		return nil, err
	}
	stderr, err := sess.StderrPipe()
	if err != nil {
		sess.Close()
		return nil, err
	}
	if rows <= 0 {
		rows = 24
	}
	if cols <= 0 {
		cols = 80
	}
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := sess.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		sess.Close()
		return nil, fmt.Errorf("request pty: %w", err)
	}
	if err := sess.Start(cmd); err != nil {
		sess.Close()
		return nil, err
	}
	return &SSHCmdSession{session: sess, stdin: stdin, stdout: stdout, stderr: stderr}, nil
}

func (m *SSHManager) disconnect(ctx context.Context, id string, stateEvent *SSHStateEvent) error {
	m.mu.Lock()
	c, ok := m.conns[id]
	if ok {
		delete(m.conns, id)
	}
	m.mu.Unlock()
	if !ok {
		return nil
	}

	c.once.Do(func() {
		close(c.closed)
	})

	// Best-effort shutdown order
	if c.session != nil {
		_ = c.session.Close()
	}
	if c.client != nil {
		_ = c.client.Close()
	}

	if stateEvent != nil {
		runtime.EventsEmit(ctx, "ssh:state", *stateEvent)
	} else {
		runtime.EventsEmit(ctx, "ssh:state", SSHStateEvent{ID: id, State: "disconnected"})
	}
	return nil
}

func (m *SSHManager) Send(id string, data string) error {
	m.mu.Lock()
	c := m.conns[id]
	m.mu.Unlock()
	if c == nil {
		return errors.New("ssh connection not found")
	}
	_, err := c.stdin.Write([]byte(data))
	return err
}

func (m *SSHManager) Resize(id string, cols int, rows int) error {
	m.mu.Lock()
	c := m.conns[id]
	m.mu.Unlock()
	if c == nil {
		return errors.New("ssh connection not found")
	}
	if rows <= 0 || cols <= 0 {
		return nil
	}
	return c.session.WindowChange(rows, cols)
}

func (m *SSHManager) pump(ctx context.Context, id string, r io.Reader, isErr bool) {
	buf := make([]byte, 32*1024)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			runtime.EventsEmit(ctx, "ssh:output", SSHOutputEvent{
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

func dialSSH(cfg SSHConfig) (*ssh.Client, error) {
	if strings.TrimSpace(cfg.Host) == "" {
		return nil, errors.New("host is required")
	}
	if cfg.Port == 0 {
		cfg.Port = 22
	}
	if strings.TrimSpace(cfg.Username) == "" {
		return nil, errors.New("username is required")
	}

	authMethods, err := buildAuth(cfg)
	if err != nil {
		return nil, err
	}
	if len(authMethods) == 0 {
		return nil, errors.New("no auth methods")
	}

	timeout := sshTimeout(cfg)

	hostKeyCallback, err := buildHostKeyCallback(cfg)
	if err != nil {
		return nil, err
	}

	clientConfig := &ssh.ClientConfig{
		User:            cfg.Username,
		Auth:            authMethods,
		HostKeyCallback: hostKeyCallback,
		// Keep this for ssh internals that still consult it.
		Timeout: timeout,
	}

	addr := net.JoinHostPort(cfg.Host, fmt.Sprintf("%d", cfg.Port))

	// NOTE: We avoid ssh.Dial() here to have deterministic timeout behavior.
	// The goal is: never hang forever on unreachable hosts or half-open handshakes.
	d := &net.Dialer{Timeout: timeout}
	conn, err := d.Dial("tcp", addr)
	if err != nil {
		return nil, err
	}

	// Bound the SSH handshake with a deadline, then clear it for long-lived sessions.
	_ = conn.SetDeadline(time.Now().Add(timeout))
	cconn, chans, reqs, err := ssh.NewClientConn(conn, addr, clientConfig)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	_ = conn.SetDeadline(time.Time{})
	return ssh.NewClient(cconn, chans, reqs), nil
}

func buildHostKeyCallback(cfg SSHConfig) (ssh.HostKeyCallback, error) {
	if cfg.InsecureIgnoreHostKey {
		return ssh.InsecureIgnoreHostKey(), nil
	}

	home, err := os.UserHomeDir()
	if err == nil && strings.TrimSpace(home) != "" {
		kh := filepath.Join(home, ".ssh", "known_hosts")
		if _, statErr := os.Stat(kh); statErr == nil {
			return knownhosts.New(kh)
		}
	}

	return nil, errors.New("host key verification enabled, but ~/.ssh/known_hosts not found; either create known_hosts or enable InsecureIgnoreHostKey")
}

func buildAuth(cfg SSHConfig) ([]ssh.AuthMethod, error) {
	switch strings.ToLower(strings.TrimSpace(cfg.AuthType)) {
	case "password":
		if cfg.Password == "" {
			return nil, errors.New("password is required")
		}
		return []ssh.AuthMethod{ssh.Password(cfg.Password)}, nil
	case "privatekey", "private_key", "key":
		pemBytes, err := resolvePrivateKey(cfg)
		if err != nil {
			return nil, err
		}
		signer, err := sshkeys.ParseSigner(pemBytes, cfg.Passphrase)
		if err != nil {
			return nil, fmt.Errorf("parse private key: %w", err)
		}
		return []ssh.AuthMethod{ssh.PublicKeys(signer)}, nil
	default:
		return nil, errors.New(`authType must be "password" or "privateKey"`)
	}
}

func resolvePrivateKey(cfg SSHConfig) ([]byte, error) {
	if strings.TrimSpace(cfg.PrivateKeyPath) != "" {
		b, err := os.ReadFile(cfg.PrivateKeyPath)
		if err != nil {
			return nil, fmt.Errorf("read private key file: %w", err)
		}
		return sshkeys.SanitizeKeyBytes(b), nil
	}
	if strings.TrimSpace(cfg.PrivateKeyPEM) != "" {
		return sshkeys.SanitizeKeyBytes([]byte(cfg.PrivateKeyPEM)), nil
	}
	return nil, errors.New("private key path or PEM is required")
}

func randomID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// fall back to time-based
		return fmt.Sprintf("c-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

