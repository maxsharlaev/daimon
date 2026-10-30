package hostkeys

import (
	"bytes"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// ErrUnknownHost is returned when the server key is not in the app known_hosts file.
type ErrUnknownHost struct {
	Host        string `json:"host"`
	Port        int    `json:"port"`
	KeyType     string `json:"keyType"`
	Fingerprint string `json:"fingerprint"`
	PublicKey   string `json:"publicKey"`
}

func (e *ErrUnknownHost) Error() string {
	return "HOSTKEY_UNKNOWN " + mustJSON(e)
}

// ErrHostKeyChanged is returned when a stored key does not match the key the server offered.
type ErrHostKeyChanged struct {
	Host           string `json:"host"`
	Port           int    `json:"port"`
	KeyType        string `json:"keyType"`
	Fingerprint    string `json:"fingerprint"`
	OldKeyType     string `json:"oldKeyType"`
	OldFingerprint string `json:"oldFingerprint"`
}

func (e *ErrHostKeyChanged) Error() string {
	return "HOSTKEY_CHANGED " + mustJSON(e)
}

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(b)
}

// OpenOptions selects the known_hosts file and whether the first create copies ~/.ssh/known_hosts.
type OpenOptions struct {
	Path                 string
	ImportUserKnownHosts bool
}

// Store is the app known_hosts file. Writes are serialized by mu.
type Store struct {
	mu                   sync.Mutex
	path                 string
	importUserKnownHosts bool
	maintained           bool
}

// DefaultPath is the known_hosts file next to the app database.
func DefaultPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil || strings.TrimSpace(dir) == "" {
		return "", errors.New("user config dir not found")
	}
	return filepath.Join(dir, "daimon", "known_hosts"), nil
}

// Open opens or creates the known_hosts store. An empty Path uses DefaultPath.
func Open(opts OpenOptions) (*Store, error) {
	path := strings.TrimSpace(opts.Path)
	if path == "" {
		p, err := DefaultPath()
		if err != nil {
			return nil, err
		}
		path = p
	}
	s := &Store{path: path, importUserKnownHosts: opts.ImportUserKnownHosts}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLocked(); err != nil {
		return nil, err
	}
	return s, nil
}

// Path returns the known_hosts file path.
func (s *Store) Path() string {
	if s == nil {
		return ""
	}
	return s.path
}

// Callback verifies the server key against the app known_hosts file.
func (s *Store) Callback(host string, port int) ssh.HostKeyCallback {
	host = normalizeHost(host)
	port = portOr22(port)
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		if s == nil {
			return errors.New("host key store is required")
		}
		if key == nil {
			return errors.New("host key is required")
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		if err := s.ensureLocked(); err != nil {
			return err
		}
		err := s.verifyLocked(host, port, hostname, remote, key)
		if err == nil {
			return nil
		}
		var ke *knownhosts.KeyError
		if !errors.As(err, &ke) {
			if !isNoHostAuthority(err) {
				return err
			}
			return &ErrUnknownHost{
				Host:        host,
				Port:        port,
				KeyType:     key.Type(),
				Fingerprint: ssh.FingerprintSHA256(key),
				PublicKey:   authorizedKey(key),
			}
		}
		fp := ssh.FingerprintSHA256(key)
		if len(ke.Want) == 0 {
			return &ErrUnknownHost{
				Host:        host,
				Port:        port,
				KeyType:     key.Type(),
				Fingerprint: fp,
				PublicKey:   authorizedKey(key),
			}
		}
		old := ke.Want[0]
		for _, w := range ke.Want {
			if w.Key != nil && w.Key.Type() == key.Type() {
				old = w
				break
			}
		}
		oldType := ""
		oldFP := ""
		if old.Key != nil {
			oldType = old.Key.Type()
			oldFP = ssh.FingerprintSHA256(old.Key)
		}
		return &ErrHostKeyChanged{
			Host:           host,
			Port:           port,
			KeyType:        key.Type(),
			Fingerprint:    fp,
			OldKeyType:     oldType,
			OldFingerprint: oldFP,
		}
	}
}

// HostKeyAlgorithms returns host key algorithms for the client to offer.
// Stored types for this host come first, then the other non-certificate defaults.
// Certificate algorithms are omitted so an unknown host is not answered with
// "no authorities for hostname" instead of an unknown-key prompt.
func (s *Store) HostKeyAlgorithms(host string, port int) []string {
	if s == nil {
		return nil
	}
	host = normalizeHost(host)
	port = portOr22(port)
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLocked(); err != nil {
		return plainHostKeyAlgos()
	}
	return mergeAlgorithms(s.storedAlgorithmsLocked(host, port), plainHostKeyAlgos())
}

// Trust appends a known_hosts line for host:port.
func (s *Store) Trust(host string, port int, key ssh.PublicKey) error {
	if s == nil {
		return errors.New("host key store is required")
	}
	if key == nil {
		return errors.New("host key is required")
	}
	host = normalizeHost(host)
	if host == "" {
		return errors.New("host is required")
	}
	port = portOr22(port)
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLocked(); err != nil {
		return err
	}
	if s.alreadyTrustedLocked(host, port, key) {
		return nil
	}
	if err := s.sameTypeConflictLocked(host, port, key); err != nil {
		return err
	}
	line := knownhosts.Line([]string{net.JoinHostPort(host, strconv.Itoa(port))}, key)
	f, err := os.OpenFile(s.path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := io.WriteString(f, line+"\n"); err != nil {
		return err
	}
	return f.Chmod(0o600)
}

// Forget removes known_hosts lines for host:port.
func (s *Store) Forget(host string, port int) error {
	if s == nil {
		return errors.New("host key store is required")
	}
	host = normalizeHost(host)
	if host == "" {
		return errors.New("host is required")
	}
	port = portOr22(port)
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLocked(); err != nil {
		return err
	}
	b, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	lines := strings.Split(string(b), "\n")
	kept := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "#") {
			kept = append(kept, trimmed)
			continue
		}
		if lineMatchesHost(trimmed, host, port) {
			continue
		}
		kept = append(kept, trimmed)
	}
	data := strings.Join(kept, "\n")
	if data != "" {
		data += "\n"
	}
	return writeFileAtomic(s.path, []byte(data))
}

func (s *Store) ensureLocked() error {
	if s.maintained {
		return nil
	}
	if st, err := os.Stat(s.path); err == nil {
		if st.IsDir() {
			return fmt.Errorf("known_hosts path is a directory")
		}
		if err := s.maintainLocked(); err != nil {
			return err
		}
		s.maintained = true
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return fmt.Errorf("create known_hosts dir: %w", err)
	}
	var body []byte
	if s.importUserKnownHosts {
		if home, err := os.UserHomeDir(); err == nil && strings.TrimSpace(home) != "" {
			userFile := filepath.Join(home, ".ssh", "known_hosts")
			if b, err := os.ReadFile(userFile); err == nil {
				body = sanitizeKnownHosts(b)
			}
		}
	}
	if err := writeFileAtomic(s.path, body); err != nil {
		return err
	}
	s.maintained = true
	return nil
}

func (s *Store) maintainLocked() error {
	b, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	next := foldKnownHosts(b)
	if _, err := knownhosts.New(s.path); err != nil {
		next = sanitizeKnownHosts(b)
	}
	if string(next) == string(b) {
		return nil
	}
	return writeFileAtomic(s.path, next)
}

func algorithmsForKeyType(keyType string) []string {
	// rsa-sha2-* sign the same ssh-rsa key. Asking only for ssh-rsa makes
	// current OpenSSH servers decline the key.
	if keyType == ssh.KeyAlgoRSA {
		return []string{ssh.KeyAlgoRSASHA256, ssh.KeyAlgoRSASHA512, ssh.KeyAlgoRSA}
	}
	if isCertAlgorithm(keyType) {
		return nil
	}
	return []string{keyType}
}

// plainHostKeyAlgos is the client default host key list without certificate types.
func plainHostKeyAlgos() []string {
	return []string{
		ssh.KeyAlgoED25519,
		ssh.KeyAlgoECDSA256,
		ssh.KeyAlgoECDSA384,
		ssh.KeyAlgoECDSA521,
		ssh.KeyAlgoRSASHA256,
		ssh.KeyAlgoRSASHA512,
		ssh.KeyAlgoRSA,
	}
}

func isCertAlgorithm(alg string) bool {
	return strings.Contains(alg, "-cert-")
}

func mergeAlgorithms(preferred, rest []string) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, list := range [][]string{preferred, rest} {
		for _, alg := range list {
			if alg == "" || isCertAlgorithm(alg) {
				continue
			}
			if _, ok := seen[alg]; ok {
				continue
			}
			seen[alg] = struct{}{}
			out = append(out, alg)
		}
	}
	return out
}

func (s *Store) verifyLocked(host string, port int, hostname string, remote net.Addr, key ssh.PublicKey) error {
	cb, err := knownhosts.New(s.path)
	if err != nil {
		return err
	}
	if remote == nil {
		remote = &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: port}
	}
	var unknown error
	for _, name := range dialHosts(host, hostname) {
		addr := net.JoinHostPort(name, strconv.Itoa(port))
		err = cb(addr, remote, key)
		if err == nil {
			return nil
		}
		if isNoHostAuthority(err) {
			return err
		}
		var ke *knownhosts.KeyError
		if errors.As(err, &ke) && len(ke.Want) > 0 {
			return err
		}
		unknown = err
	}
	if unknown == nil {
		return &knownhosts.KeyError{}
	}
	return unknown
}

func (s *Store) alreadyTrustedLocked(host string, port int, key ssh.PublicKey) bool {
	return s.verifyLocked(host, port, "", nil, key) == nil
}

func (s *Store) storedAlgorithmsLocked(host string, port int) []string {
	pk := probePublicKey()
	if pk == nil {
		return nil
	}
	err := s.verifyLocked(host, port, "", nil, pk)
	if err == nil {
		return algorithmsForKeyType(pk.Type())
	}
	var ke *knownhosts.KeyError
	if !errors.As(err, &ke) || len(ke.Want) == 0 {
		return nil
	}
	var out []string
	seen := map[string]struct{}{}
	for _, w := range ke.Want {
		if w.Key == nil {
			continue
		}
		for _, alg := range algorithmsForKeyType(w.Key.Type()) {
			if _, ok := seen[alg]; ok {
				continue
			}
			seen[alg] = struct{}{}
			out = append(out, alg)
		}
	}
	return out
}

func dialHosts(host, hostname string) []string {
	var out []string
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" {
			return
		}
		if h, _, err := net.SplitHostPort(s); err == nil {
			s = h
		}
		s = strings.Trim(s, "[]")
		if s == "" {
			return
		}
		for _, e := range out {
			if e == s {
				return
			}
		}
		out = append(out, s)
	}
	add(strings.ToLower(host))
	add(host)
	if h, _, err := net.SplitHostPort(hostname); err == nil {
		add(h)
		add(strings.ToLower(h))
	} else {
		add(hostname)
		add(strings.ToLower(hostname))
	}
	return out
}

func isNoHostAuthority(err error) bool {
	return err != nil && strings.Contains(err.Error(), "no authorities for hostname")
}

func lineMatchesHost(line, host string, port int) bool {
	fields := strings.Fields(strings.TrimSpace(line))
	if len(fields) == 0 || strings.HasPrefix(fields[0], "#") {
		return false
	}
	hostIdx := 0
	if strings.HasPrefix(fields[0], "@") {
		if len(fields) < 2 {
			return false
		}
		hostIdx = 1
	}
	for _, token := range strings.Split(fields[hostIdx], ",") {
		token = strings.TrimSpace(token)
		token = strings.TrimPrefix(token, "!")
		if token == "" {
			continue
		}
		if hashedTokenMatches(token, hashCandidates(host, port)) || plainTokenMatches(token, addressForms(host, port)) {
			return true
		}
	}
	return false
}

func addressForms(host string, port int) []string {
	host = strings.TrimSpace(host)
	port = portOr22(port)
	var out []string
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" {
			return
		}
		for _, e := range out {
			if strings.EqualFold(e, s) {
				return
			}
		}
		out = append(out, s)
	}
	add(knownhosts.Normalize(net.JoinHostPort(strings.ToLower(host), strconv.Itoa(port))))
	add(knownhosts.Normalize(net.JoinHostPort(host, strconv.Itoa(port))))
	return out
}

func plainTokenMatches(token string, forms []string) bool {
	if strings.HasPrefix(token, "|") {
		return false
	}
	got := knownhosts.Normalize(token)
	for _, form := range forms {
		if strings.EqualFold(got, form) || strings.EqualFold(token, form) {
			return true
		}
	}
	return false
}

func hashedTokenMatches(token string, candidates []string) bool {
	if !strings.HasPrefix(token, "|") {
		return false
	}
	parts := strings.Split(token, "|")
	if len(parts) != 4 || parts[1] != "1" {
		return false
	}
	salt, err := base64.StdEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}
	sum, err := base64.StdEncoding.DecodeString(parts[3])
	if err != nil {
		return false
	}
	for _, c := range candidates {
		mac := hmac.New(sha1.New, salt) // OpenSSH known_hosts hashes are HMAC-SHA1.
		_, _ = mac.Write([]byte(c))
		if hmac.Equal(mac.Sum(nil), sum) {
			return true
		}
	}
	return false
}

func hashCandidates(host string, port int) []string {
	host = strings.TrimSpace(host)
	port = portOr22(port)
	var out []string
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" {
			return
		}
		for _, e := range out {
			if e == s {
				return
			}
		}
		out = append(out, s)
	}
	add(knownhosts.Normalize(net.JoinHostPort(strings.ToLower(host), strconv.Itoa(port))))
	add(knownhosts.Normalize(net.JoinHostPort(host, strconv.Itoa(port))))
	if ip := net.ParseIP(strings.Trim(host, "[]")); ip != nil && ip.To4() == nil && port == 22 {
		add("[" + strings.ToLower(ip.String()) + "]")
	}
	return out
}

func foldKnownHosts(raw []byte) []byte {
	return joinKnownHostLines(splitKnownHostLines(raw), false)
}

func sanitizeKnownHosts(raw []byte) []byte {
	return joinKnownHostLines(splitKnownHostLines(raw), true)
}

func splitKnownHostLines(raw []byte) []string {
	text := strings.ReplaceAll(string(raw), "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	return strings.Split(text, "\n")
}

func joinKnownHostLines(lines []string, dropInvalid bool) []byte {
	kept := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "#") {
			kept = append(kept, trimmed)
			continue
		}
		folded := foldPlainHostLine(trimmed)
		if dropInvalid && !knownHostLineOK(folded) {
			continue
		}
		kept = append(kept, folded)
	}
	if len(kept) == 0 {
		return nil
	}
	return []byte(strings.Join(kept, "\n") + "\n")
}

func foldPlainHostLine(line string) string {
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return strings.TrimSpace(line)
	}
	hostIdx := 0
	if strings.HasPrefix(fields[0], "@") {
		if len(fields) < 3 {
			return strings.TrimSpace(line)
		}
		hostIdx = 1
	}
	parts := strings.Split(fields[hostIdx], ",")
	for i, part := range parts {
		part = strings.TrimSpace(part)
		neg := strings.HasPrefix(part, "!")
		if neg {
			part = strings.TrimPrefix(part, "!")
		}
		if !strings.HasPrefix(part, "|") {
			part = strings.ToLower(part)
		}
		if neg {
			part = "!" + part
		}
		parts[i] = part
	}
	fields[hostIdx] = strings.Join(parts, ",")
	return strings.Join(fields, " ")
}

func knownHostLineOK(line string) bool {
	_, hosts, pub, _, _, err := ssh.ParseKnownHosts([]byte(line))
	return err == nil && pub != nil && len(hosts) > 0
}

func normalizeHost(host string) string {
	host = strings.TrimSpace(host)
	if strings.HasPrefix(host, "[") && strings.HasSuffix(host, "]") {
		inner := strings.TrimSpace(host[1 : len(host)-1])
		if ip := net.ParseIP(inner); ip != nil {
			host = ip.String()
		}
	}
	return strings.ToLower(host)
}

func writeFileAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	f, err := os.CreateTemp(dir, ".known_hosts-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	done := false
	defer func() {
		if !done {
			_ = os.Remove(tmp)
		}
	}()
	if err := f.Chmod(0o600); err != nil {
		_ = f.Close()
		return err
	}
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	done = true
	return nil
}

func (s *Store) sameTypeConflictLocked(host string, port int, key ssh.PublicKey) error {
	err := s.verifyLocked(host, port, "", nil, key)
	var ke *knownhosts.KeyError
	if !errors.As(err, &ke) || len(ke.Want) == 0 {
		return nil
	}
	for _, w := range ke.Want {
		if w.Key == nil || w.Key.Type() != key.Type() {
			continue
		}
		if bytes.Equal(w.Key.Marshal(), key.Marshal()) {
			return nil
		}
		return &ErrHostKeyChanged{
			Host:           host,
			Port:           port,
			KeyType:        key.Type(),
			Fingerprint:    ssh.FingerprintSHA256(key),
			OldKeyType:     w.Key.Type(),
			OldFingerprint: ssh.FingerprintSHA256(w.Key),
		}
	}
	return nil
}

func portOr22(port int) int {
	if port == 0 {
		return 22
	}
	return port
}

func authorizedKey(key ssh.PublicKey) string {
	return strings.TrimSpace(string(ssh.MarshalAuthorizedKey(key)))
}

var (
	probeOnce sync.Once
	probeKey  ssh.PublicKey
)

func probePublicKey() ssh.PublicKey {
	probeOnce.Do(func() {
		_, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return
		}
		signer, err := ssh.NewSignerFromKey(priv)
		if err != nil {
			return
		}
		probeKey = signer.PublicKey()
	})
	return probeKey
}
