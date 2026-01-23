package sshkeys

import (
	"bytes"
	"errors"
	"fmt"

	"github.com/kayrus/putty"
	"golang.org/x/crypto/ssh"
)

// SanitizeKeyBytes trims whitespace and removes UTF-8 BOM if present.
func SanitizeKeyBytes(b []byte) []byte {
	if len(b) >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF {
		b = b[3:]
	}
	return bytes.TrimSpace(b)
}

func isPuttyPPK(b []byte) bool {
	b = SanitizeKeyBytes(b)
	return bytes.HasPrefix(b, []byte("PuTTY-User-Key-File-"))
}

// ParseSigner parses a private key and returns an ssh.Signer.
// Supports OpenSSH/PEM keys and PuTTY .ppk keys.
func ParseSigner(keyBytes []byte, passphrase string) (ssh.Signer, error) {
	keyBytes = SanitizeKeyBytes(keyBytes)
	if len(keyBytes) == 0 {
		return nil, errors.New("private key is empty")
	}

	// PuTTY .ppk
	if isPuttyPPK(keyBytes) {
		k, err := putty.New(keyBytes)
		if err != nil {
			return nil, fmt.Errorf("parse putty key: %w", err)
		}
		raw, err := k.ParseRawPrivateKey([]byte(passphrase))
		if err != nil {
			// Provide a clearer error than the downstream "no key found".
			return nil, fmt.Errorf("parse putty private key: %w", err)
		}
		signer, err := ssh.NewSignerFromKey(raw)
		if err != nil {
			return nil, fmt.Errorf("create signer from putty key: %w", err)
		}
		return signer, nil
	}

	// OpenSSH / PEM
	var (
		signer ssh.Signer
		err    error
	)
	if passphrase != "" {
		signer, err = ssh.ParsePrivateKeyWithPassphrase(keyBytes, []byte(passphrase))
	} else {
		signer, err = ssh.ParsePrivateKey(keyBytes)
	}
	if err != nil {
		return nil, err
	}
	return signer, nil
}

