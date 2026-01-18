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
	"time"

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

func (m *SSHManager) TestConnection(cfg SSHConfig) (string, error) {
	client, err := dialSSH(cfg)
	if err != nil {
		return "", err
	}
	defer client.Close()

	sess, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer sess.Close()

	out, err := sess.CombinedOutput("echo daimon-ok")
	if err != nil {
		return "", fmt.Errorf("ssh test failed: %w", err)
	}
	return strings.TrimSpace(string(out)), nil
}

func (m *SSHManager) Connect(ctx context.Context, cfg SSHConfig) (string, error) {
	client, err := dialSSH(cfg)
	if err != nil {
		return "", err
	}

	sess, err := client.NewSession()
	if err != nil {
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
		sess.Close()
		client.Close()
		return "", fmt.Errorf("request pty: %w", err)
	}

	if err := sess.Shell(); err != nil {
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

	timeout := 10 * time.Second
	if cfg.TimeoutMs > 0 {
		timeout = time.Duration(cfg.TimeoutMs) * time.Millisecond
	}

	hostKeyCallback, err := buildHostKeyCallback(cfg)
	if err != nil {
		return nil, err
	}

	clientConfig := &ssh.ClientConfig{
		User:            cfg.Username,
		Auth:            authMethods,
		HostKeyCallback: hostKeyCallback,
		Timeout:         timeout,
	}

	addr := net.JoinHostPort(cfg.Host, fmt.Sprintf("%d", cfg.Port))
	return ssh.Dial("tcp", addr, clientConfig)
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
		var signer ssh.Signer
		if cfg.Passphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase(pemBytes, []byte(cfg.Passphrase))
		} else {
			signer, err = ssh.ParsePrivateKey(pemBytes)
		}
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
		return b, nil
	}
	if strings.TrimSpace(cfg.PrivateKeyPEM) != "" {
		return []byte(cfg.PrivateKeyPEM), nil
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

