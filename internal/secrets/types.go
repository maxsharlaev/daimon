package secrets

type Kind string

const (
	KindPassword   Kind = "password"
	KindPrivateKey Kind = "private_key"
)

type Storage string

const (
	StorageNone    Storage = "none"
	StorageKeyring Storage = "keyring"
	StorageExternal Storage = "external"
	StorageInternal Storage = "internal"
)

type SecretValue struct {
	// For password kind: Password
	Password string `json:"password,omitempty"`

	// For private key kind: PEM and optional Passphrase
	PrivateKeyPEM string `json:"privateKeyPem,omitempty"`
	Passphrase    string `json:"passphrase,omitempty"`
}

