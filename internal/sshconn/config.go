package sshconn

import (
	"errors"
	"strings"
	"time"

	"daimon/internal/hostkeys"
	"golang.org/x/crypto/ssh"
)

// Node is one SSH hop. InsecureIgnoreHostKey applies only to this hop,
// so a later jump-host chain can verify every other node.
type Node struct {
	Host     string
	Port     int
	Username string
	Auth     []ssh.AuthMethod
	Timeout  time.Duration

	InsecureIgnoreHostKey bool
}

// BuildClientConfig sets host key verification from keys, or skips it when the node opts out.
func BuildClientConfig(node Node, keys *hostkeys.Store) (*ssh.ClientConfig, error) {
	if strings.TrimSpace(node.Username) == "" {
		return nil, errors.New("username is required")
	}
	cfg := &ssh.ClientConfig{
		User:    node.Username,
		Auth:    node.Auth,
		Timeout: node.Timeout,
	}
	if node.InsecureIgnoreHostKey {
		cfg.HostKeyCallback = ssh.InsecureIgnoreHostKey()
		return cfg, nil
	}
	if keys == nil {
		return nil, errors.New("host key store is required")
	}
	cfg.HostKeyCallback = keys.Callback(node.Host, node.Port)
	cfg.HostKeyAlgorithms = keys.HostKeyAlgorithms(node.Host, node.Port)
	return cfg, nil
}
