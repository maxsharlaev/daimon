package secrets

import (
	"fmt"

	"github.com/zalando/go-keyring"
)

// KeyringStore stores secrets in OS keychain.
// On Windows it uses Credential Manager.
type KeyringStore struct {
	Service string
}

func NewKeyringStore(service string) *KeyringStore {
	if service == "" {
		service = "daimon"
	}
	return &KeyringStore{Service: service}
}

func (k *KeyringStore) Key(profileID string, kind Kind) string {
	return fmt.Sprintf("profile/%s/%s", profileID, string(kind))
}

func (k *KeyringStore) Set(profileID string, kind Kind, secret string) error {
	return keyring.Set(k.Service, k.Key(profileID, kind), secret)
}

func (k *KeyringStore) Get(profileID string, kind Kind) (string, error) {
	return keyring.Get(k.Service, k.Key(profileID, kind))
}

func (k *KeyringStore) Delete(profileID string, kind Kind) error {
	return keyring.Delete(k.Service, k.Key(profileID, kind))
}
