package hostkeys

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(OpenOptions{Path: filepath.Join(t.TempDir(), "known_hosts")})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	return s
}

func ed25519Pub(t *testing.T) ssh.PublicKey {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatal(err)
	}
	return signer.PublicKey()
}

func rsaPub(t *testing.T) ssh.PublicKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return signer.PublicKey()
}

func check(t *testing.T, s *Store, host string, port int, key ssh.PublicKey) error {
	t.Helper()
	if port == 0 {
		port = 22
	}
	addr := net.JoinHostPort(host, strconv.Itoa(port))
	return s.Callback(host, port)(addr, &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: port}, key)
}

func TestUnknownMatchChanged(t *testing.T) {
	s := testStore(t)
	key := ed25519Pub(t)
	other := ed25519Pub(t)

	err := check(t, s, "db.example", 22, key)
	var unknown *ErrUnknownHost
	if !errors.As(err, &unknown) {
		t.Fatalf("want unknown, got %v", err)
	}
	if unknown.Host != "db.example" || unknown.Port != 22 || unknown.KeyType != key.Type() {
		t.Fatalf("unknown payload: %+v", unknown)
	}
	if unknown.Fingerprint != ssh.FingerprintSHA256(key) || unknown.PublicKey == "" {
		t.Fatalf("fingerprint/key: %+v", unknown)
	}

	if err := s.Trust("db.example", 22, key); err != nil {
		t.Fatal(err)
	}
	if err := check(t, s, "db.example", 22, key); err != nil {
		t.Fatalf("trusted key: %v", err)
	}

	err = check(t, s, "db.example", 22, other)
	var changed *ErrHostKeyChanged
	if !errors.As(err, &changed) {
		t.Fatalf("want changed, got %v", err)
	}
	if changed.OldFingerprint != ssh.FingerprintSHA256(key) || changed.Fingerprint != ssh.FingerprintSHA256(other) {
		t.Fatalf("fingerprints: %+v", changed)
	}
}

func TestNonstandardPort(t *testing.T) {
	s := testStore(t)
	key := ed25519Pub(t)
	if err := s.Trust("edge.example", 2222, key); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(s.Path())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "[edge.example]:2222") {
		t.Fatalf("line: %s", body)
	}
	if err := check(t, s, "edge.example", 2222, key); err != nil {
		t.Fatalf("port 2222: %v", err)
	}
	err = check(t, s, "edge.example", 22, key)
	var unknown *ErrUnknownHost
	if !errors.As(err, &unknown) {
		t.Fatalf("port 22 should be unknown, got %v", err)
	}
}

func TestForget(t *testing.T) {
	s := testStore(t)
	key := ed25519Pub(t)
	if err := s.Trust("gone.example", 22, key); err != nil {
		t.Fatal(err)
	}
	if err := s.Forget("gone.example", 22); err != nil {
		t.Fatal(err)
	}
	err := check(t, s, "gone.example", 22, key)
	var unknown *ErrUnknownHost
	if !errors.As(err, &unknown) {
		t.Fatalf("after forget: %v", err)
	}
}

func TestHostKeyAlgorithms(t *testing.T) {
	s := testStore(t)
	algs := s.HostKeyAlgorithms("rsa.example", 22)
	if len(algs) == 0 {
		t.Fatal("expected default algorithms")
	}
	for _, alg := range algs {
		if strings.Contains(alg, "-cert-") {
			t.Fatalf("certificate algorithm %s in %#v", alg, algs)
		}
	}
	key := rsaPub(t)
	if err := s.Trust("rsa.example", 22, key); err != nil {
		t.Fatal(err)
	}
	algs = s.HostKeyAlgorithms("rsa.example", 22)
	rsaAt := indexOf(algs, ssh.KeyAlgoRSA)
	edAt := indexOf(algs, ssh.KeyAlgoED25519)
	if rsaAt < 0 || edAt < 0 || rsaAt > edAt {
		t.Fatalf("stored RSA should come before other defaults: %#v", algs)
	}
	other := s.HostKeyAlgorithms("other.example", 22)
	if len(other) == 0 || other[0] != ssh.KeyAlgoED25519 {
		t.Fatalf("ed25519 should be first for an unknown host: %#v", other)
	}
	for _, alg := range other {
		if strings.Contains(alg, "-cert-") {
			t.Fatalf("certificate algorithm %s in %#v", alg, other)
		}
	}
}

func indexOf(list []string, want string) int {
	for i, v := range list {
		if v == want {
			return i
		}
	}
	return -1
}

func TestFileMode(t *testing.T) {
	s := testStore(t)
	info, err := os.Stat(s.Path())
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0o077 != 0 && !isWindows() {
		t.Fatalf("mode: %o", info.Mode().Perm())
	}
}

func isWindows() bool {
	return os.PathSeparator == '\\'
}

func TestTrustCaseAndNoDuplicate(t *testing.T) {
	s := testStore(t)
	key := ed25519Pub(t)
	if err := s.Trust("Example.COM", 22, key); err != nil {
		t.Fatal(err)
	}
	if err := s.Trust("example.com", 22, key); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(s.Path())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "Example.COM") {
		t.Fatalf("expected lowercase host: %s", body)
	}
	lines := 0
	for _, line := range strings.Split(string(body), "\n") {
		if strings.TrimSpace(line) != "" {
			lines++
		}
	}
	if lines != 1 {
		t.Fatalf("duplicate lines: %d\n%s", lines, body)
	}
	if err := check(t, s, "EXAMPLE.com", 22, key); err != nil {
		t.Fatal(err)
	}
}

func TestIPv6(t *testing.T) {
	s := testStore(t)
	key := ed25519Pub(t)
	if err := s.Trust("2001:db8::1", 22, key); err != nil {
		t.Fatal(err)
	}
	if err := check(t, s, "2001:db8::1", 22, key); err != nil {
		t.Fatalf("ipv6 port 22: %v", err)
	}
	if err := s.Trust("2001:db8::2", 2222, key); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(s.Path())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.ToLower(string(body)), "[2001:db8::2]:2222") {
		t.Fatalf("line: %s", body)
	}
	if err := check(t, s, "2001:db8::2", 2222, key); err != nil {
		t.Fatalf("ipv6 port 2222: %v", err)
	}
}

func TestForgetHashed(t *testing.T) {
	s := testStore(t)
	key := ed25519Pub(t)
	keepKey := ed25519Pub(t)
	hashed := knownhosts.HashHostname("hashed.example")
	keep := knownhosts.HashHostname("keep.example")
	body := hashed + " " + strings.TrimSpace(string(ssh.MarshalAuthorizedKey(key))) + "\n" +
		keep + " " + strings.TrimSpace(string(ssh.MarshalAuthorizedKey(keepKey))) + "\n"
	if err := os.WriteFile(s.Path(), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := check(t, s, "hashed.example", 22, key); err != nil {
		t.Fatalf("hashed match: %v", err)
	}
	if err := s.Forget("hashed.example", 22); err != nil {
		t.Fatal(err)
	}
	left, err := os.ReadFile(s.Path())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(left), hashed) {
		t.Fatalf("hashed line remains: %s", left)
	}
	if !strings.Contains(string(left), keep) {
		t.Fatalf("other host removed: %s", left)
	}
	err = check(t, s, "hashed.example", 22, key)
	var unknown *ErrUnknownHost
	if !errors.As(err, &unknown) {
		t.Fatalf("after forget: %v", err)
	}

	ported := knownhosts.HashHostname("[port.example]:2222")
	if err := os.WriteFile(s.Path(), []byte(ported+" "+strings.TrimSpace(string(ssh.MarshalAuthorizedKey(key)))+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := s.Forget("port.example", 2222); err != nil {
		t.Fatal(err)
	}
	left, err = os.ReadFile(s.Path())
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(left)) != "" {
		t.Fatalf("ported hash remains: %s", left)
	}
}

func TestHostCertificatePrompts(t *testing.T) {
	s := testStore(t)
	algs := s.HostKeyAlgorithms("cert.example", 22)
	for _, alg := range algs {
		if strings.Contains(alg, "-cert-") {
			t.Fatalf("certificate algorithm %s", alg)
		}
	}
	err := check(t, s, "cert.example", 22, hostCert(t))
	var unknown *ErrUnknownHost
	if !errors.As(err, &unknown) {
		t.Fatalf("want unknown host, got %v", err)
	}
	if unknown.Host != "cert.example" || unknown.Fingerprint == "" {
		t.Fatalf("prompt: %+v", unknown)
	}
}

func TestSanitizeKnownHostsSkipsBadLines(t *testing.T) {
	key := ed25519Pub(t)
	good := knownhosts.Line([]string{"ok.example:22"}, key)
	raw := []byte(good + "\nnot a valid known_hosts line\n" + good + "\n")
	out := sanitizeKnownHosts(raw)
	if strings.Contains(string(out), "not a valid") {
		t.Fatalf("bad line kept: %s", out)
	}
	path := filepath.Join(t.TempDir(), "kh")
	if err := os.WriteFile(path, out, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := knownhosts.New(path); err != nil {
		t.Fatal(err)
	}
}

func hostCert(t *testing.T) ssh.PublicKey {
	t.Helper()
	_, hostPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	hostSigner, err := ssh.NewSignerFromKey(hostPriv)
	if err != nil {
		t.Fatal(err)
	}
	_, caPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	caSigner, err := ssh.NewSignerFromKey(caPriv)
	if err != nil {
		t.Fatal(err)
	}
	cert := &ssh.Certificate{
		Key:             hostSigner.PublicKey(),
		Serial:          1,
		CertType:        ssh.HostCert,
		KeyId:           "test-host",
		ValidPrincipals: []string{"cert.example"},
		ValidAfter:      0,
		ValidBefore:     ssh.CertTimeInfinity,
		SignatureKey:    caSigner.PublicKey(),
	}
	if err := cert.SignCert(rand.Reader, caSigner); err != nil {
		t.Fatal(err)
	}
	return cert
}

func TestIPv6LoopbackLiteralAndHashedForget(t *testing.T) {
	s := testStore(t)
	key := ed25519Pub(t)
	pub := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(key)))
	body := "[::1]:22 " + pub + "\n" + knownhosts.HashHostname("[::1]") + " " + pub + "\n"
	if err := os.WriteFile(s.Path(), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := check(t, s, "::1", 22, key); err != nil {
		t.Fatal(err)
	}
	if err := s.Forget("[::1]", 22); err != nil {
		t.Fatal(err)
	}
	left, err := os.ReadFile(s.Path())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(left), "::1") || strings.Contains(string(left), "|1|") {
		t.Fatalf("entries left: %q", left)
	}
	err = check(t, s, "::1", 22, key)
	var unknown *ErrUnknownHost
	if !errors.As(err, &unknown) {
		t.Fatalf("after forget: %v", err)
	}
}

func TestBracketIPv6DoesNotDoubleWrap(t *testing.T) {
	s := testStore(t)
	key := ed25519Pub(t)
	if err := s.Trust("[::1]", 22, key); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(s.Path())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "[[") {
		t.Fatalf("double-wrapped host: %s", raw)
	}
	if err := check(t, s, "::1", 22, key); err != nil {
		t.Fatal(err)
	}
}

func TestTrustRejectsSameAlgorithmChange(t *testing.T) {
	s := testStore(t)
	first := ed25519Pub(t)
	second := ed25519Pub(t)
	if err := s.Trust("swap.example", 22, first); err != nil {
		t.Fatal(err)
	}
	err := s.Trust("swap.example", 22, second)
	var changed *ErrHostKeyChanged
	if !errors.As(err, &changed) {
		t.Fatalf("want changed, got %v", err)
	}
	raw, err := os.ReadFile(s.Path())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(raw), "ssh-ed25519") != 1 {
		t.Fatalf("key was written: %s", raw)
	}
	if err := check(t, s, "swap.example", 22, first); err != nil {
		t.Fatal(err)
	}
	err = check(t, s, "swap.example", 22, second)
	if !errors.As(err, &changed) {
		t.Fatalf("connection with the new key: %v", err)
	}
	if err := s.Trust("swap.example", 22, rsaPub(t)); err != nil {
		t.Fatal(err)
	}
}
