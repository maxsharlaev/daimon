package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"time"

	"daimon/internal/secrets"
	"daimon/internal/sftp"
	"daimon/internal/storage"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// SFTPEndpoint: methods bound to frontend.

type SFTPFileEntryDTO = sftp.FileEntryDTO

type SFTPTransferEvent = sftp.TransferEvent

func (a *App) ensureSFTP() (*sftp.Manager, error) {
	if a.sftp == nil {
		return nil, errors.New("sftp not ready")
	}
	return a.sftp, nil
}

func (a *App) SFTPConnectProfile(profileId string) (string, error) {
	if a.db == nil || a.db.DB == nil || a.secrets == nil {
		return "", errors.New("app not ready")
	}
	m, err := a.ensureSFTP()
	if err != nil {
		return "", err
	}

	var p storage.Profile
	if err := a.db.DB.First(&p, "id = ?", profileId).Error; err != nil {
		return "", err
	}

	cfg := sftp.SSHConfig{
		Host:                  p.Host,
		Port:                  p.Port,
		Username:              p.Username,
		InsecureIgnoreHostKey: true,
		TimeoutMs:             10000,
	}

	// Prefer key if configured
	if sr, err := a.secrets.GetSecretRef(profileId, secrets.KindPrivateKey); err == nil {
		switch secrets.Storage(sr.Storage) {
		case secrets.StorageKeyring, secrets.StorageInternal:
			val, _, err := a.secrets.GetSecretValue(profileId, secrets.KindPrivateKey)
			if err == nil && val.PrivateKeyPEM != "" {
				cfg.AuthType = "privateKey"
				cfg.PrivateKeyPEM = val.PrivateKeyPEM
				cfg.Passphrase = val.Passphrase
				return m.Connect(context.Background(), cfg)
			}
		case secrets.StorageExternal:
			// In SFTP manager we require PEM; read file here and provide PEM.
			if sr.Ref != "" {
				b, err := os.ReadFile(sr.Ref)
				if err == nil {
					cfg.AuthType = "privateKey"
					cfg.PrivateKeyPEM = string(b)
					return m.Connect(context.Background(), cfg)
				}
			}
		}
	}

	// fallback to password
	val, mode, err := a.secrets.GetSecretValue(profileId, secrets.KindPassword)
	if err != nil {
		return "", err
	}
	if mode == secrets.StorageNone || val.Password == "" {
		return "", errors.New("password required")
	}
	cfg.AuthType = "password"
	cfg.Password = val.Password
	return m.Connect(context.Background(), cfg)
}

func (a *App) SFTPDisconnect(sessionId string) error {
	m, err := a.ensureSFTP()
	if err != nil {
		return err
	}
	return m.Disconnect(sessionId)
}

func (a *App) SFTPListDir(sessionId string, dir string) ([]SFTPFileEntryDTO, error) {
	m, err := a.ensureSFTP()
	if err != nil {
		return nil, err
	}
	return m.ListDir(sessionId, dir)
}

func (a *App) SFTPGetwd(sessionId string) (string, error) {
	m, err := a.ensureSFTP()
	if err != nil {
		return "", err
	}
	return m.Getwd(sessionId)
}

func (a *App) SFTPStat(sessionId string, p string) (SFTPFileEntryDTO, error) {
	m, err := a.ensureSFTP()
	if err != nil {
		return SFTPFileEntryDTO{}, err
	}
	return m.Stat(sessionId, p)
}

func (a *App) SFTPMkdir(sessionId string, dir string) error {
	m, err := a.ensureSFTP()
	if err != nil {
		return err
	}
	return m.Mkdir(sessionId, dir)
}

func (a *App) SFTPRename(sessionId string, oldPath string, newPath string) error {
	m, err := a.ensureSFTP()
	if err != nil {
		return err
	}
	return m.Rename(sessionId, oldPath, newPath)
}

func (a *App) SFTPDelete(sessionId string, p string) error {
	m, err := a.ensureSFTP()
	if err != nil {
		return err
	}
	return m.Remove(sessionId, p)
}

func (a *App) LocalHomeDir() (string, error) {
	return sftp.UserHomeDir()
}

func (a *App) LocalListDrives() ([]string, error) {
	return sftp.ListLocalDrives()
}

func (a *App) LocalListDir(dir string) ([]SFTPFileEntryDTO, error) {
	return sftp.ListLocalDir(dir)
}

func (a *App) LocalStat(p string) (SFTPFileEntryDTO, error) {
	return sftp.StatLocal(p)
}

func (a *App) LocalMkdir(dir string) error {
	return sftp.MkdirLocal(dir)
}

func (a *App) LocalRename(oldPath string, newPath string) error {
	return sftp.RenameLocal(oldPath, newPath)
}

func (a *App) LocalDelete(p string) error {
	return sftp.RemoveLocal(p)
}

func (a *App) PickLocalFile() (string, error) {
	if a.ctx == nil {
		return "", errors.New("app context not ready")
	}
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "Select file"})
}

func (a *App) PickLocalFolder() (string, error) {
	if a.ctx == nil {
		return "", errors.New("app context not ready")
	}
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "Select folder"})
}

func (a *App) PickSaveFile(defaultName string) (string, error) {
	if a.ctx == nil {
		return "", errors.New("app context not ready")
	}
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save file",
		DefaultFilename: defaultName,
	})
}

// Chunked transfer APIs (plan-compatible). These run step-by-step on backend, emitting progress events.

type SFTPTransferStartResult struct {
	TransferID string `json:"transferId"`
	TotalBytes int64  `json:"totalBytes"`
}

func (a *App) SFTPDownloadStart(sessionId string, remotePath string, localPath string) (SFTPTransferStartResult, error) {
	m, err := a.ensureSFTP()
	if err != nil {
		return SFTPTransferStartResult{}, err
	}
	if a.sftpTransfers == nil {
		a.sftpTransfers = sftp.NewTransferManager()
	}
	sess, err := m.SessionForTransfer(sessionId)
	if err != nil {
		return SFTPTransferStartResult{}, err
	}
	t, err := a.sftpTransfers.StartDownload(sess, remotePath, localPath)
	if err != nil {
		return SFTPTransferStartResult{}, err
	}
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "sftp:transfer", sftp.TransferEvent{TransferID: t.ID, Direction: "download", DoneBytes: 0, TotalBytes: t.Total, State: "running"})
	}
	return SFTPTransferStartResult{TransferID: t.ID, TotalBytes: t.Total}, nil
}

func (a *App) SFTPUploadStart(sessionId string, localPath string, remotePath string) (SFTPTransferStartResult, error) {
	m, err := a.ensureSFTP()
	if err != nil {
		return SFTPTransferStartResult{}, err
	}
	if a.sftpTransfers == nil {
		a.sftpTransfers = sftp.NewTransferManager()
	}
	sess, err := m.SessionForTransfer(sessionId)
	if err != nil {
		return SFTPTransferStartResult{}, err
	}
	t, err := a.sftpTransfers.StartUpload(sess, localPath, remotePath)
	if err != nil {
		return SFTPTransferStartResult{}, err
	}
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "sftp:transfer", sftp.TransferEvent{TransferID: t.ID, Direction: "upload", DoneBytes: 0, TotalBytes: t.Total, State: "running"})
	}
	return SFTPTransferStartResult{TransferID: t.ID, TotalBytes: t.Total}, nil
}

// SFTPTransferChunk advances transfer by up to limit bytes.
func (a *App) SFTPTransferChunk(transferId string, limit int) (SFTPTransferEvent, error) {
	if a.sftpTransfers == nil {
		return SFTPTransferEvent{}, errors.New("transfer manager not ready")
	}
	ev, err := a.sftpTransfers.Step(transferId, limit)
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "sftp:transfer", ev)
	}
	return ev, err
}

func (a *App) SFTPTransferCancel(transferId string) error {
	if a.sftpTransfers == nil {
		return nil
	}
	ev, _ := a.sftpTransfers.Cancel(transferId, true)
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "sftp:transfer", ev)
	}
	return nil
}

// Simple streaming transfers with progress events (legacy convenience).
func (a *App) SFTPDownloadToLocal(sessionId string, remotePath string, localPath string) (string, error) {
	m, err := a.ensureSFTP()
	if err != nil {
		return "", err
	}
	if a.ctx == nil {
		return "", errors.New("app context not ready")
	}
	sess, err := m.SessionForTransfer(sessionId)
	if err != nil {
		return "", err
	}
	return runDownload(a.ctx, sess, remotePath, localPath)
}

func (a *App) SFTPUploadFromLocal(sessionId string, localPath string, remotePath string) (string, error) {
	m, err := a.ensureSFTP()
	if err != nil {
		return "", err
	}
	if a.ctx == nil {
		return "", errors.New("app context not ready")
	}
	sess, err := m.SessionForTransfer(sessionId)
	if err != nil {
		return "", err
	}
	return runUpload(a.ctx, sess, localPath, remotePath)
}

func runDownload(ctx context.Context, sess *sftp.Session, remotePath string, localPath string) (string, error) {
	transferID := "dl-" + time.Now().Format("150405.000")

	// ensure dir
	_ = os.MkdirAll(filepath.Dir(localPath), 0o755)

	rf, err := sess.SFTP.Open(sftp.Clean(remotePath))
	if err != nil {
		return "", err
	}
	defer rf.Close()
	fi, _ := rf.Stat()
	total := int64(0)
	if fi != nil {
		total = fi.Size()
	}

	lf, err := os.Create(localPath)
	if err != nil {
		return "", err
	}
	defer lf.Close()

	buf := make([]byte, 64*1024)
	var done int64
	runtime.EventsEmit(ctx, "sftp:transfer", sftp.TransferEvent{TransferID: transferID, Direction: "download", DoneBytes: 0, TotalBytes: total, State: "running"})
	for {
		n, rerr := rf.Read(buf)
		if n > 0 {
			if _, werr := lf.Write(buf[:n]); werr != nil {
				runtime.EventsEmit(ctx, "sftp:transfer", sftp.TransferEvent{TransferID: transferID, Direction: "download", DoneBytes: done, TotalBytes: total, State: "failed", Error: werr.Error()})
				return "", werr
			}
			done += int64(n)
			runtime.EventsEmit(ctx, "sftp:transfer", sftp.TransferEvent{TransferID: transferID, Direction: "download", DoneBytes: done, TotalBytes: total, State: "running"})
		}
		if rerr != nil {
			break
		}
	}
	runtime.EventsEmit(ctx, "sftp:transfer", sftp.TransferEvent{TransferID: transferID, Direction: "download", DoneBytes: done, TotalBytes: total, State: "success"})
	return transferID, nil
}

func runUpload(ctx context.Context, sess *sftp.Session, localPath string, remotePath string) (string, error) {
	transferID := "ul-" + time.Now().Format("150405.000")

	lf, err := os.Open(localPath)
	if err != nil {
		return "", err
	}
	defer lf.Close()
	fi, _ := lf.Stat()
	total := int64(0)
	if fi != nil {
		total = fi.Size()
	}

	rf, err := sess.SFTP.Create(sftp.Clean(remotePath))
	if err != nil {
		return "", err
	}
	defer rf.Close()

	buf := make([]byte, 64*1024)
	var done int64
	runtime.EventsEmit(ctx, "sftp:transfer", sftp.TransferEvent{TransferID: transferID, Direction: "upload", DoneBytes: 0, TotalBytes: total, State: "running"})
	for {
		n, rerr := lf.Read(buf)
		if n > 0 {
			if _, werr := rf.Write(buf[:n]); werr != nil {
				runtime.EventsEmit(ctx, "sftp:transfer", sftp.TransferEvent{TransferID: transferID, Direction: "upload", DoneBytes: done, TotalBytes: total, State: "failed", Error: werr.Error()})
				return "", werr
			}
			done += int64(n)
			runtime.EventsEmit(ctx, "sftp:transfer", sftp.TransferEvent{TransferID: transferID, Direction: "upload", DoneBytes: done, TotalBytes: total, State: "running"})
		}
		if rerr != nil {
			break
		}
	}
	runtime.EventsEmit(ctx, "sftp:transfer", sftp.TransferEvent{TransferID: transferID, Direction: "upload", DoneBytes: done, TotalBytes: total, State: "success"})
	return transferID, nil
}

