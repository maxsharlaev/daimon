package main

import (
	"errors"
	"strings"

	"golang.org/x/crypto/ssh"
)

var errHostKeysNotReady = errors.New("host key store is not ready")

// TrustHostKey stores the offered server key and lets the next connection attempt succeed.
func (a *App) TrustHostKey(host string, port int, authorizedKey string) error {
	if a.hostKeys == nil {
		return errHostKeysNotReady
	}
	pub, _, _, _, err := ssh.ParseAuthorizedKey([]byte(strings.TrimSpace(authorizedKey)))
	if err != nil {
		return err
	}
	return a.hostKeys.Trust(host, port, pub)
}

// ForgetHostKey removes stored keys for host:port.
func (a *App) ForgetHostKey(host string, port int) error {
	if a.hostKeys == nil {
		return errHostKeysNotReady
	}
	return a.hostKeys.Forget(host, port)
}
