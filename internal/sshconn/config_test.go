package sshconn

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"errors"
	"fmt"
	"net"
	"path/filepath"
	"strings"
	"testing"

	"daimon/internal/hostkeys"
	"golang.org/x/crypto/ssh"
)

func TestBuildClientConfigInsecureOptOut(t *testing.T) {
	dir := t.TempDir()
	keys, err := hostkeys.Open(hostkeys.OpenOptions{Path: filepath.Join(dir, "known_hosts")})
	if err != nil {
		t.Fatal(err)
	}
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatal(err)
	}
	key := signer.PublicKey()

	cfg, err := BuildClientConfig(Node{
		Host:                  "optout.example",
		Port:                  22,
		Username:              "root",
		InsecureIgnoreHostKey: true,
	}, keys)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.HostKeyAlgorithms != nil {
		t.Fatalf("algorithms: %#v", cfg.HostKeyAlgorithms)
	}
	if err := cfg.HostKeyCallback("optout.example:22", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 22}, key); err != nil {
		t.Fatalf("opt-out callback: %v", err)
	}

	verified, err := BuildClientConfig(Node{
		Host:     "optout.example",
		Port:     22,
		Username: "root",
	}, keys)
	if err != nil {
		t.Fatal(err)
	}
	err = verified.HostKeyCallback("optout.example:22", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 22}, key)
	var unknown *hostkeys.ErrUnknownHost
	if !errors.As(err, &unknown) {
		t.Fatalf("want unknown, got %v", err)
	}
}

func TestBuildClientConfigUsesStoredAlgorithms(t *testing.T) {
	keys, err := hostkeys.Open(hostkeys.OpenOptions{Path: filepath.Join(t.TempDir(), "known_hosts")})
	if err != nil {
		t.Fatal(err)
	}
	rsaKey := rsaPub(t)
	if err := keys.Trust("algo.example", 22, rsaKey); err != nil {
		t.Fatal(err)
	}
	cfg, err := BuildClientConfig(Node{Host: "algo.example", Port: 22, Username: "root"}, keys)
	if err != nil {
		t.Fatal(err)
	}
	rsaAt := -1
	edAt := -1
	for i, alg := range cfg.HostKeyAlgorithms {
		if strings.Contains(alg, "-cert-") {
			t.Fatalf("certificate algorithm %s", alg)
		}
		if alg == ssh.KeyAlgoRSASHA256 {
			rsaAt = i
		}
		if alg == ssh.KeyAlgoED25519 {
			edAt = i
		}
	}
	if rsaAt < 0 || edAt < 0 || rsaAt > edAt {
		t.Fatalf("algorithms: %#v", cfg.HostKeyAlgorithms)
	}
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

func TestHandshakePromptsForPlainKeyWhenHostOffersCertificate(t *testing.T) {
	keys, err := hostkeys.Open(hostkeys.OpenOptions{Path: filepath.Join(t.TempDir(), "known_hosts")})
	if err != nil {
		t.Fatal(err)
	}
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatal(err)
	}
	_, caPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	ca, err := ssh.NewSignerFromKey(caPriv)
	if err != nil {
		t.Fatal(err)
	}
	cert := &ssh.Certificate{
		Key:             signer.PublicKey(),
		Serial:          1,
		CertType:        ssh.HostCert,
		KeyId:           "lab",
		ValidPrincipals: []string{"127.0.0.1"},
		ValidBefore:     ssh.CertTimeInfinity,
		SignatureKey:    ca.PublicKey(),
	}
	if err := cert.SignCert(rand.Reader, ca); err != nil {
		t.Fatal(err)
	}
	certSigner, err := ssh.NewCertSigner(cert, signer)
	if err != nil {
		t.Fatal(err)
	}
	serverCfg := &ssh.ServerConfig{NoClientAuth: true}
	serverCfg.AddHostKey(certSigner)
	serverCfg.AddHostKey(signer)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		_, _, _, _ = ssh.NewServerConn(conn, serverCfg)
	}()

	_, portText, err := net.SplitHostPort(ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	var port int
	if _, err := fmt.Sscan(portText, &port); err != nil {
		t.Fatal(err)
	}
	clientCfg, err := BuildClientConfig(Node{
		Host:     "127.0.0.1",
		Port:     port,
		Username: "root",
		Auth:     []ssh.AuthMethod{ssh.Password("unused")},
	}, keys)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := net.Dial("tcp", ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	_, _, _, err = ssh.NewClientConn(raw, ln.Addr().String(), clientCfg)
	var unknown *hostkeys.ErrUnknownHost
	if !errors.As(err, &unknown) {
		t.Fatalf("want plain-key prompt, got %v", err)
	}
	if unknown.KeyType != ssh.KeyAlgoED25519 {
		t.Fatalf("key type %s", unknown.KeyType)
	}
	if strings.Contains(err.Error(), "no authorities") {
		t.Fatal(err)
	}
}
