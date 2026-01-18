package secrets

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/chacha20poly1305"
)

type KDFParams struct {
	Name      string `json:"name"` // "argon2id"
	Time      uint32 `json:"time"`
	MemoryKiB uint32 `json:"memoryKiB"`
	Threads   uint8  `json:"threads"`
	KeyLen    uint32 `json:"keyLen"`
}

func DefaultKDFParams() KDFParams {
	return KDFParams{
		Name:      "argon2id",
		Time:      2,
		MemoryKiB: 64 * 1024,
		Threads:   2,
		KeyLen:    32,
	}
}

func RandomBytes(n int) ([]byte, error) {
	b := make([]byte, n)
	_, err := rand.Read(b)
	return b, err
}

func DeriveKey(password string, salt []byte, p KDFParams) ([]byte, error) {
	if p.Name == "" {
		p = DefaultKDFParams()
	}
	if p.Name != "argon2id" {
		return nil, fmt.Errorf("unsupported kdf: %s", p.Name)
	}
	if len(salt) < 8 {
		return nil, errors.New("salt too short")
	}
	if password == "" {
		return nil, errors.New("password required")
	}
	key := argon2.IDKey([]byte(password), salt, p.Time, p.MemoryKiB, p.Threads, p.KeyLen)
	return key, nil
}

func EncryptJSON(key []byte, payload any) (cipherB64 string, nonceB64 string, err error) {
	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return "", "", err
	}
	nonce, err := RandomBytes(chacha20poly1305.NonceSizeX)
	if err != nil {
		return "", "", err
	}
	plain, err := json.Marshal(payload)
	if err != nil {
		return "", "", err
	}
	cipher := aead.Seal(nil, nonce, plain, nil)
	return base64.StdEncoding.EncodeToString(cipher), base64.StdEncoding.EncodeToString(nonce), nil
}

func DecryptJSON(key []byte, cipherB64 string, nonceB64 string, out any) error {
	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return err
	}
	nonce, err := base64.StdEncoding.DecodeString(nonceB64)
	if err != nil {
		return err
	}
	cipher, err := base64.StdEncoding.DecodeString(cipherB64)
	if err != nil {
		return err
	}
	plain, err := aead.Open(nil, nonce, cipher, nil)
	if err != nil {
		return err
	}
	return json.Unmarshal(plain, out)
}

