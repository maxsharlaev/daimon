package main

import (
	"context"
	"fmt"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"daimon/internal/secrets"
	"daimon/internal/sftp"
	"daimon/internal/storage"
)

// App struct
type App struct {
	ctx           context.Context
	ssh           *SSHManager
	db            *storage.Store
	secrets       *secrets.Router
	sftp          *sftp.Manager
	sftpTransfers *sftp.TransferManager
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		ssh: NewSSHManager(),
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	store, err := storage.Open(storage.OpenOptions{})
	if err != nil {
		// Can't return error from startup; crash early to avoid running without persistence.
		panic(err)
	}
	a.db = store
	a.secrets = secrets.NewRouter(store.DB)
	a.sftp = sftp.NewManager()

	_, _ = a.EnsureDefaultGroup()
}

func (a *App) shutdown(ctx context.Context) {
	if a.db != nil {
		_ = a.db.Close()
	}
}

// Greet returns a greeting for the given name
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}

// PickPrivateKeyFile opens a native file dialog and returns the selected key file path (or empty string).
func (a *App) PickPrivateKeyFile() (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("app context not ready")
	}
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select SSH private key",
		Filters: []runtime.FileFilter{
			{DisplayName: "Private Key", Pattern: "*"},
		},
	})
}

// SSHTestConnection connects via SSH and runs a trivial command to validate auth/transport.
func (a *App) SSHTestConnection(cfg SSHConfig) (string, error) {
	return a.ssh.TestConnection(cfg)
}

// SSHConnect starts an interactive SSH shell with PTY and returns a connection ID.
func (a *App) SSHConnect(cfg SSHConfig) (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("app context not ready")
	}
	return a.ssh.Connect(a.ctx, cfg)
}

// SSHDisconnect closes an active SSH connection.
func (a *App) SSHDisconnect(id string) error {
	if a.ctx == nil {
		return fmt.Errorf("app context not ready")
	}
	return a.ssh.Disconnect(a.ctx, id)
}

// SSHSend writes user input bytes into the remote shell.
func (a *App) SSHSend(id string, data string) error {
	return a.ssh.Send(id, data)
}

// SSHExec runs a non-interactive command on an existing SSH session.
func (a *App) SSHExec(id string, cmd string) (string, error) {
	return a.ssh.Exec(id, cmd)
}

// SSHResize updates the PTY size for the remote session.
func (a *App) SSHResize(id string, cols int, rows int) error {
	return a.ssh.Resize(id, cols, rows)
}
