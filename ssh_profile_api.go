package main

import (
	"errors"
	"fmt"
	"strings"

	"daimon/internal/secrets"
	"daimon/internal/storage"
)

// SSHConnectProfile builds SSHConfig from stored Profile + secrets and opens an interactive shell session.
func (a *App) SSHConnectProfile(profileId string) (string, error) {
	if a.db == nil || a.db.DB == nil || a.secrets == nil {
		return "", errors.New("app not ready")
	}
	if a.ctx == nil {
		return "", errors.New("app context not ready")
	}
	if profileId == "" {
		return "", errors.New("profileId required")
	}

	var p storage.Profile
	if err := a.db.DB.First(&p, "id = ?", profileId).Error; err != nil {
		return "", err
	}

	cfg := SSHConfig{
		Host:                  p.Host,
		Port:                  p.Port,
		Username:              p.Username,
		InsecureIgnoreHostKey: true,
		TimeoutMs:             10000,
	}

	// Prefer private key if present/configured
	if sr, err := a.secrets.GetSecretRef(profileId, secrets.KindPrivateKey); err == nil {
		switch secrets.Storage(sr.Storage) {
		case secrets.StorageExternal:
			if strings.TrimSpace(sr.Ref) != "" {
				cfg.AuthType = "privateKey"
				cfg.PrivateKeyPath = sr.Ref
				if val, _, err := a.secrets.GetSecretValue(profileId, secrets.KindPrivateKey); err == nil {
					cfg.Passphrase = val.Passphrase
				}
				return a.ssh.Connect(a.ctx, cfg)
			}
		case secrets.StorageKeyring, secrets.StorageInternal:
			val, _, err := a.secrets.GetSecretValue(profileId, secrets.KindPrivateKey)
			if err != nil {
				return "", fmt.Errorf("private key: %w", err)
			}
			if strings.TrimSpace(val.PrivateKeyPEM) != "" {
				cfg.AuthType = "privateKey"
				cfg.PrivateKeyPEM = val.PrivateKeyPEM
				cfg.Passphrase = val.Passphrase
				return a.ssh.Connect(a.ctx, cfg)
			}
		}
	}

	// fallback to password
	val, mode, err := a.secrets.GetSecretValue(profileId, secrets.KindPassword)
	if err != nil {
		return "", err
	}
	if mode == secrets.StorageNone || strings.TrimSpace(val.Password) == "" {
		return "", fmt.Errorf("password required")
	}
	cfg.AuthType = "password"
	cfg.Password = val.Password
	return a.ssh.Connect(a.ctx, cfg)
}

// SSHDashboardConnectProfile builds SSHConfig from stored Profile + secrets and opens an exec-only SSH connection,
// intended for dashboard polling via SSHExec().
func (a *App) SSHDashboardConnectProfile(profileId string) (string, error) {
	if a.db == nil || a.db.DB == nil || a.secrets == nil {
		return "", errors.New("app not ready")
	}
	if a.ctx == nil {
		return "", errors.New("app context not ready")
	}
	if profileId == "" {
		return "", errors.New("profileId required")
	}

	var p storage.Profile
	if err := a.db.DB.First(&p, "id = ?", profileId).Error; err != nil {
		return "", err
	}

	cfg := SSHConfig{
		Host:                  p.Host,
		Port:                  p.Port,
		Username:              p.Username,
		InsecureIgnoreHostKey: true,
		TimeoutMs:             10000,
	}

	// Prefer private key if present/configured
	if sr, err := a.secrets.GetSecretRef(profileId, secrets.KindPrivateKey); err == nil {
		switch secrets.Storage(sr.Storage) {
		case secrets.StorageExternal:
			if strings.TrimSpace(sr.Ref) != "" {
				cfg.AuthType = "privateKey"
				cfg.PrivateKeyPath = sr.Ref
				if val, _, err := a.secrets.GetSecretValue(profileId, secrets.KindPrivateKey); err == nil {
					cfg.Passphrase = val.Passphrase
				}
				return a.ssh.ConnectExecOnly(a.ctx, cfg)
			}
		case secrets.StorageKeyring, secrets.StorageInternal:
			val, _, err := a.secrets.GetSecretValue(profileId, secrets.KindPrivateKey)
			if err != nil {
				return "", fmt.Errorf("private key: %w", err)
			}
			if strings.TrimSpace(val.PrivateKeyPEM) != "" {
				cfg.AuthType = "privateKey"
				cfg.PrivateKeyPEM = val.PrivateKeyPEM
				cfg.Passphrase = val.Passphrase
				return a.ssh.ConnectExecOnly(a.ctx, cfg)
			}
		}
	}

	// fallback to password
	val, mode, err := a.secrets.GetSecretValue(profileId, secrets.KindPassword)
	if err != nil {
		return "", err
	}
	if mode == secrets.StorageNone || strings.TrimSpace(val.Password) == "" {
		return "", fmt.Errorf("password required")
	}
	cfg.AuthType = "password"
	cfg.Password = val.Password
	return a.ssh.ConnectExecOnly(a.ctx, cfg)
}

// SSHDashboardConnectProfileWithPassword connects using provided password and optionally remembers it.
// rememberStorage: "none" | "keyring" | "internal"
func (a *App) SSHDashboardConnectProfileWithPassword(profileId string, password string, rememberStorage string) (string, error) {
	if a.db == nil || a.db.DB == nil || a.secrets == nil {
		return "", errors.New("app not ready")
	}
	if a.ctx == nil {
		return "", errors.New("app context not ready")
	}
	if profileId == "" {
		return "", errors.New("profileId required")
	}
	if strings.TrimSpace(password) == "" {
		return "", errors.New("password required")
	}

	var p storage.Profile
	if err := a.db.DB.First(&p, "id = ?", profileId).Error; err != nil {
		return "", err
	}

	cfg := SSHConfig{
		Host:                  p.Host,
		Port:                  p.Port,
		Username:              p.Username,
		AuthType:              "password",
		Password:              password,
		InsecureIgnoreHostKey: true,
		TimeoutMs:             10000,
	}

	id, err := a.ssh.ConnectExecOnly(a.ctx, cfg)
	if err != nil {
		return "", err
	}

	mode := secrets.Storage(rememberStorage)
	if mode == "" {
		mode = secrets.StorageNone
	}
	// remember after successful connect
	_ = a.secrets.PutSecretValue(profileId, secrets.KindPassword, mode, "", secrets.SecretValue{Password: password}, "{}")
	return id, nil
}

// SSHConnectProfileWithPassword connects using provided password and optionally remembers it.
// rememberStorage: "none" | "keyring" | "internal"
func (a *App) SSHConnectProfileWithPassword(profileId string, password string, rememberStorage string) (string, error) {
	if a.db == nil || a.db.DB == nil || a.secrets == nil {
		return "", errors.New("app not ready")
	}
	if a.ctx == nil {
		return "", errors.New("app context not ready")
	}
	if profileId == "" {
		return "", errors.New("profileId required")
	}
	if strings.TrimSpace(password) == "" {
		return "", errors.New("password required")
	}

	var p storage.Profile
	if err := a.db.DB.First(&p, "id = ?", profileId).Error; err != nil {
		return "", err
	}

	cfg := SSHConfig{
		Host:                  p.Host,
		Port:                  p.Port,
		Username:              p.Username,
		AuthType:              "password",
		Password:              password,
		InsecureIgnoreHostKey: true,
		TimeoutMs:             10000,
	}

	id, err := a.ssh.Connect(a.ctx, cfg)
	if err != nil {
		return "", err
	}

	mode := secrets.Storage(rememberStorage)
	if mode == "" {
		mode = secrets.StorageNone
	}
	// remember after successful connect
	_ = a.secrets.PutSecretValue(profileId, secrets.KindPassword, mode, "", secrets.SecretValue{Password: password}, "{}")
	return id, nil
}

