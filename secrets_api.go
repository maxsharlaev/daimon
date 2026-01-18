package main

import (
	"errors"
	"fmt"

	"daimon/internal/secrets"
)

type VaultStatusDTO struct {
	Setup    bool `json:"setup"`
	Unlocked bool `json:"unlocked"`
}

type SecretRefDTO struct {
	ProfileID string `json:"profileId"`
	Kind      string `json:"kind"`    // password | private_key
	Storage   string `json:"storage"` // none | keyring | external | internal
	Ref       string `json:"ref"`
	MetaJSON  string `json:"metaJson"`
}

type SetSecretRequest struct {
	ProfileID string `json:"profileId"`
	Kind      string `json:"kind"`
	Storage   string `json:"storage"`
	Ref       string `json:"ref,omitempty"`
	MetaJSON  string `json:"metaJson,omitempty"`

	// For password
	Password string `json:"password,omitempty"`

	// For private key
	PrivateKeyPEM string `json:"privateKeyPem,omitempty"`
	Passphrase    string `json:"passphrase,omitempty"`
}

func (a *App) VaultStatus() (VaultStatusDTO, error) {
	if a.secrets == nil {
		return VaultStatusDTO{}, errors.New("secrets not ready")
	}
	st, err := a.secrets.Vault().Status()
	if err != nil {
		return VaultStatusDTO{}, err
	}
	return VaultStatusDTO{Setup: st.Setup, Unlocked: st.Unlocked}, nil
}

func (a *App) VaultSetup(masterPassword string) error {
	if a.secrets == nil {
		return errors.New("secrets not ready")
	}
	return a.secrets.Vault().Setup(masterPassword)
}

func (a *App) VaultUnlock(masterPassword string) error {
	if a.secrets == nil {
		return errors.New("secrets not ready")
	}
	return a.secrets.Vault().Unlock(masterPassword)
}

func (a *App) VaultLock() error {
	if a.secrets == nil {
		return errors.New("secrets not ready")
	}
	a.secrets.Vault().Lock()
	return nil
}

func (a *App) GetSecretRef(profileId string, kind string) (SecretRefDTO, error) {
	if a.secrets == nil {
		return SecretRefDTO{}, errors.New("secrets not ready")
	}
	if profileId == "" {
		return SecretRefDTO{}, errors.New("profileId required")
	}
	k := secrets.Kind(kind)
	sr, err := a.secrets.GetSecretRef(profileId, k)
	if err != nil {
		return SecretRefDTO{}, err
	}
	return SecretRefDTO{
		ProfileID: sr.ProfileID,
		Kind:      sr.Kind,
		Storage:   sr.Storage,
		Ref:       sr.Ref,
		MetaJSON:  sr.MetaJSON,
	}, nil
}

func (a *App) SetSecret(req SetSecretRequest) error {
	if a.secrets == nil {
		return errors.New("secrets not ready")
	}
	if req.ProfileID == "" {
		return errors.New("profileId required")
	}
	if req.Kind == "" {
		return errors.New("kind required")
	}
	mode := secrets.Storage(req.Storage)
	k := secrets.Kind(req.Kind)

	val := secrets.SecretValue{
		Password:      req.Password,
		PrivateKeyPEM: req.PrivateKeyPEM,
		Passphrase:    req.Passphrase,
	}

	switch k {
	case secrets.KindPassword:
		if mode != secrets.StorageNone && mode != secrets.StorageKeyring && mode != secrets.StorageInternal {
			return fmt.Errorf("unsupported storage for password: %s", req.Storage)
		}
	case secrets.KindPrivateKey:
		// allow external for key path, plus internal/keyring/none
		if mode != secrets.StorageNone && mode != secrets.StorageKeyring && mode != secrets.StorageInternal && mode != secrets.StorageExternal {
			return fmt.Errorf("unsupported storage for private_key: %s", req.Storage)
		}
	default:
		return fmt.Errorf("unknown kind: %s", req.Kind)
	}

	return a.secrets.PutSecretValue(req.ProfileID, k, mode, req.Ref, val, req.MetaJSON)
}

