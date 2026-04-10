package sftp

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path"
	"sort"
	"strings"
	"sync"
	"time"

	"daimon/internal/sshkeys"
	pkgsftp "github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

type SSHConfig struct {
	Host     string
	Port     int
	Username string

	AuthType string // "password" | "privateKey"

	Password string

	PrivateKeyPath string
	PrivateKeyPEM  string
	Passphrase     string

	InsecureIgnoreHostKey bool
	TimeoutMs             int
}

type Session struct {
	ID string

	Client *ssh.Client
	SFTP   *pkgsftp.Client
}

type Manager struct {
	mu       sync.Mutex
	sessions map[string]*Session
}

func NewManager() *Manager {
	return &Manager{
		sessions: map[string]*Session{},
	}
}

func (m *Manager) Connect(ctx context.Context, cfg SSHConfig) (string, error) {
	client, err := dialSSH(cfg)
	if err != nil {
		return "", err
	}
	sftpClient, err := pkgsftp.NewClient(client)
	if err != nil {
		_ = client.Close()
		return "", err
	}

	id := randomID()
	s := &Session{ID: id, Client: client, SFTP: sftpClient}
	m.mu.Lock()
	m.sessions[id] = s
	m.mu.Unlock()
	return id, nil
}

func (m *Manager) Disconnect(id string) error {
	m.mu.Lock()
	s := m.sessions[id]
	if s != nil {
		delete(m.sessions, id)
	}
	m.mu.Unlock()
	if s == nil {
		return nil
	}
	if s.SFTP != nil {
		_ = s.SFTP.Close()
	}
	if s.Client != nil {
		_ = s.Client.Close()
	}
	return nil
}

func (m *Manager) session(id string) (*Session, error) {
	m.mu.Lock()
	s := m.sessions[id]
	m.mu.Unlock()
	if s == nil {
		return nil, errors.New("sftp session not found")
	}
	return s, nil
}

// SessionForTransfer returns a session pointer for long-running transfer operations.
// Callers must not close the session; use Disconnect().
func (m *Manager) SessionForTransfer(id string) (*Session, error) {
	return m.session(id)
}

func Clean(p string) string {
	if p == "" {
		return "."
	}
	return path.Clean(p)
}

func (m *Manager) Getwd(sessionId string) (string, error) {
	s, err := m.session(sessionId)
	if err != nil {
		return "", err
	}
	// Prefer Getwd() if supported; fall back to resolving ".".
	if s.SFTP != nil {
		if wd, err := s.SFTP.Getwd(); err == nil && strings.TrimSpace(wd) != "" {
			return Clean(wd), nil
		}
		if rp, err := s.SFTP.RealPath("."); err == nil && strings.TrimSpace(rp) != "" {
			return Clean(rp), nil
		}
	}
	return ".", nil
}

func (m *Manager) ListDir(sessionId string, dir string) ([]FileEntryDTO, error) {
	s, err := m.session(sessionId)
	if err != nil {
		return nil, err
	}
	reqDir := Clean(dir)
	entries, err := s.SFTP.ReadDir(reqDir)
	if err != nil {
		return nil, err
	}

	// Resolve directory to absolute when possible, to avoid returning relative entry paths.
	base := reqDir
	if base == "" || base == "." || !strings.HasPrefix(base, "/") {
		if rp, rerr := s.SFTP.RealPath(reqDir); rerr == nil && strings.TrimSpace(rp) != "" {
			base = Clean(rp)
		}
	}

	out := make([]FileEntryDTO, 0, len(entries))
	for _, fi := range entries {
		name := fi.Name()
		full := path.Join(base, name)
		isDir := fi.IsDir()
		isSymlink := fi.Mode()&os.ModeSymlink != 0
		linkTarget := ""
		if isSymlink {
			if target, err := s.SFTP.ReadLink(full); err == nil {
				linkTarget = target
			}
		}
		// Treat symlink-to-dir as a directory so UI can enter it.
		if isSymlink {
			if st, err := s.SFTP.Stat(full); err == nil {
				isDir = st.IsDir()
			}
		}
		out = append(out, FileEntryDTO{
			Name:       name,
			Path:       full,
			IsDir:      isDir,
			Size:       fi.Size(),
			MTimeMs:    fi.ModTime().UnixMilli(),
			IsSymlink:  isSymlink,
			LinkTarget: linkTarget,
		})
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].IsDir != out[j].IsDir {
			return out[i].IsDir
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

func (m *Manager) Stat(sessionId string, p string) (FileEntryDTO, error) {
	s, err := m.session(sessionId)
	if err != nil {
		return FileEntryDTO{}, err
	}
	p = Clean(p)
	fi, err := s.SFTP.Stat(p)
	if err != nil {
		return FileEntryDTO{}, err
	}
	name := path.Base(p)
	isDir := fi.IsDir()
	return FileEntryDTO{
		Name:       name,
		Path:       p,
		IsDir:      isDir,
		Size:       fi.Size(),
		MTimeMs:    fi.ModTime().UnixMilli(),
		IsSymlink:  false,
		LinkTarget: "",
	}, nil
}

func (m *Manager) Mkdir(sessionId string, dir string) error {
	s, err := m.session(sessionId)
	if err != nil {
		return err
	}
	return s.SFTP.Mkdir(Clean(dir))
}

func (m *Manager) Rename(sessionId string, oldPath string, newPath string) error {
	s, err := m.session(sessionId)
	if err != nil {
		return err
	}
	return s.SFTP.Rename(Clean(oldPath), Clean(newPath))
}

func (m *Manager) Remove(sessionId string, p string) error {
	s, err := m.session(sessionId)
	if err != nil {
		return err
	}
	p = Clean(p)
	// Try file removal, then dir removal
	if err := s.SFTP.Remove(p); err == nil {
		return nil
	}
	return s.SFTP.RemoveDirectory(p)
}

// ReadFileTail returns up to maxBytes from the end of a regular file (follows symlinks via Stat/Open).
// If maxBytes <= 0, defaults to 256 KiB.
func (m *Manager) ReadFileTail(sessionId string, p string, maxBytes int64) ([]byte, error) {
	if maxBytes <= 0 {
		maxBytes = 256 * 1024
	}
	s, err := m.session(sessionId)
	if err != nil {
		return nil, err
	}
	p = Clean(p)
	fi, err := s.SFTP.Stat(p)
	if err != nil {
		return nil, err
	}
	if fi.IsDir() {
		return nil, errors.New("path is a directory")
	}
	size := fi.Size()
	f, err := s.SFTP.Open(p)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	toRead := size
	if toRead > maxBytes {
		toRead = maxBytes
	}
	start := int64(0)
	if size > maxBytes {
		start = size - maxBytes
	}
	if _, err := f.Seek(start, io.SeekStart); err != nil {
		return nil, err
	}
	return io.ReadAll(io.LimitReader(f, toRead))
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
	timeout := 10 * time.Second
	if cfg.TimeoutMs > 0 {
		timeout = time.Duration(cfg.TimeoutMs) * time.Millisecond
	}

	auth, err := buildAuth(cfg)
	if err != nil {
		return nil, err
	}

	hostKeyCb := ssh.InsecureIgnoreHostKey()
	if !cfg.InsecureIgnoreHostKey {
		// MVP: keep insecure unless you add known_hosts verification here (same as ssh_manager.go).
		hostKeyCb = ssh.InsecureIgnoreHostKey()
	}

	clientCfg := &ssh.ClientConfig{
		User:            cfg.Username,
		Auth:            auth,
		HostKeyCallback: hostKeyCb,
		Timeout:         timeout,
	}
	addr := net.JoinHostPort(cfg.Host, fmt.Sprintf("%d", cfg.Port))
	return ssh.Dial("tcp", addr, clientCfg)
}

func buildAuth(cfg SSHConfig) ([]ssh.AuthMethod, error) {
	switch strings.ToLower(strings.TrimSpace(cfg.AuthType)) {
	case "password":
		if cfg.Password == "" {
			return nil, errors.New("password is required")
		}
		return []ssh.AuthMethod{ssh.Password(cfg.Password)}, nil
	case "privatekey", "private_key", "key":
		var pem []byte
		if strings.TrimSpace(cfg.PrivateKeyPEM) != "" {
			pem = []byte(cfg.PrivateKeyPEM)
		} else if strings.TrimSpace(cfg.PrivateKeyPath) != "" {
			// read handled by caller in main package if desired; keep minimal here
			return nil, errors.New("private key path not supported in sftp manager (use PEM)")
		} else {
			return nil, errors.New("private key PEM is required")
		}
		signer, err := sshkeys.ParseSigner(pem, cfg.Passphrase)
		if err != nil {
			return nil, fmt.Errorf("parse private key: %w", err)
		}
		return []ssh.AuthMethod{ssh.PublicKeys(signer)}, nil
	default:
		return nil, errors.New(`authType must be "password" or "privateKey"`)
	}
}

func randomID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("sftp-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

