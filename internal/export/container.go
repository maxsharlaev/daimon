package export

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"

	"daimon/internal/secrets"
)

type ContainerV1 struct {
	Format  string `json:"format"`  // "daimon-profile-export"
	Version int    `json:"version"` // 1

	KDF secrets.KDFParams `json:"kdf"`

	SaltB64   string `json:"saltB64"`
	NonceB64  string `json:"nonceB64"`
	CipherB64 string `json:"cipherB64"`
}

func EncryptPayload(password string, payload any) (ContainerV1, error) {
	kdf := secrets.DefaultKDFParams()
	salt, err := secrets.RandomBytes(16)
	if err != nil {
		return ContainerV1{}, err
	}
	key, err := secrets.DeriveKey(password, salt, kdf)
	if err != nil {
		return ContainerV1{}, err
	}
	cipherB64, nonceB64, err := secrets.EncryptJSON(key, payload)
	if err != nil {
		return ContainerV1{}, err
	}
	return ContainerV1{
		Format:    "daimon-profile-export",
		Version:   1,
		KDF:       kdf,
		SaltB64:   base64.StdEncoding.EncodeToString(salt),
		NonceB64:  nonceB64,
		CipherB64: cipherB64,
	}, nil
}

func DecryptPayload(password string, c ContainerV1, out any) error {
	if c.Format != "daimon-profile-export" || c.Version != 1 {
		return fmt.Errorf("unsupported container format/version")
	}
	salt, err := base64.StdEncoding.DecodeString(c.SaltB64)
	if err != nil {
		return err
	}
	key, err := secrets.DeriveKey(password, salt, c.KDF)
	if err != nil {
		return err
	}
	return secrets.DecryptJSON(key, c.CipherB64, c.NonceB64, out)
}

func MarshalContainer(c ContainerV1) (string, error) {
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func UnmarshalContainer(s string) (ContainerV1, error) {
	if s == "" {
		return ContainerV1{}, errors.New("empty container")
	}
	var c ContainerV1
	if err := json.Unmarshal([]byte(s), &c); err != nil {
		return ContainerV1{}, err
	}
	return c, nil
}
