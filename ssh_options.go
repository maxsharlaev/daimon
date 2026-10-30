package main

import (
	"encoding/json"

	"daimon/internal/sftp"
	"daimon/internal/storage"
)

type sshOptions struct {
	InsecureIgnoreHostKey bool `json:"insecureIgnoreHostKey"`
	TimeoutMs             int  `json:"timeoutMs"`
}

func parseSSHOptions(raw string) sshOptions {
	var o sshOptions
	_ = json.Unmarshal([]byte(raw), &o)
	if o.TimeoutMs <= 0 {
		o.TimeoutMs = 10000
	}
	return o
}

func sshConfigFromProfile(p storage.Profile) SSHConfig {
	o := parseSSHOptions(p.SSHOptionsJSON)
	return SSHConfig{
		Host:                  p.Host,
		Port:                  p.Port,
		Username:              p.Username,
		InsecureIgnoreHostKey: o.InsecureIgnoreHostKey,
		TimeoutMs:             o.TimeoutMs,
	}
}

func sftpConfigFromProfile(p storage.Profile) sftp.SSHConfig {
	o := parseSSHOptions(p.SSHOptionsJSON)
	return sftp.SSHConfig{
		Host:                  p.Host,
		Port:                  p.Port,
		Username:              p.Username,
		InsecureIgnoreHostKey: o.InsecureIgnoreHostKey,
		TimeoutMs:             o.TimeoutMs,
	}
}
