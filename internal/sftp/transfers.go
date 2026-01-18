package sftp

import (
	"errors"
	"fmt"
	pkgsftp "github.com/pkg/sftp"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type TransferDirection string

const (
	TransferDownload TransferDirection = "download"
	TransferUpload   TransferDirection = "upload"
)

type Transfer struct {
	ID        string
	Direction TransferDirection

	Session *Session

	RemotePath string
	LocalPath  string

	Total int64
	Done  int64

	remoteFile *pkgsftp.File
	localFile  *os.File
}

type TransferManager struct {
	mu        sync.Mutex
	transfers map[string]*Transfer
}

func NewTransferManager() *TransferManager {
	return &TransferManager{transfers: map[string]*Transfer{}}
}

func (tm *TransferManager) StartDownload(sess *Session, remotePath string, localPath string) (*Transfer, error) {
	if sess == nil || sess.SFTP == nil {
		return nil, errors.New("session not ready")
	}
	id := fmt.Sprintf("dl-%d", time.Now().UnixNano())

	rp := Clean(remotePath)
	remoteFile, err := sess.SFTP.Open(rp)
	if err != nil {
		return nil, err
	}
	fi, _ := remoteFile.Stat()
	total := int64(0)
	if fi != nil {
		total = fi.Size()
	}

	_ = os.MkdirAll(filepath.Dir(localPath), 0o755)
	localFile, err := os.Create(localPath)
	if err != nil {
		_ = remoteFile.Close()
		return nil, err
	}

	t := &Transfer{
		ID:         id,
		Direction:  TransferDownload,
		Session:    sess,
		RemotePath: rp,
		LocalPath:  localPath,
		Total:      total,
		Done:       0,
		remoteFile: remoteFile,
		localFile:  localFile,
	}

	tm.mu.Lock()
	tm.transfers[id] = t
	tm.mu.Unlock()
	return t, nil
}

func (tm *TransferManager) StartUpload(sess *Session, localPath string, remotePath string) (*Transfer, error) {
	if sess == nil || sess.SFTP == nil {
		return nil, errors.New("session not ready")
	}
	id := fmt.Sprintf("ul-%d", time.Now().UnixNano())

	localFile, err := os.Open(localPath)
	if err != nil {
		return nil, err
	}
	fi, _ := localFile.Stat()
	total := int64(0)
	if fi != nil {
		total = fi.Size()
	}

	rp := Clean(remotePath)
	remoteFile, err := sess.SFTP.Create(rp)
	if err != nil {
		_ = localFile.Close()
		return nil, err
	}

	t := &Transfer{
		ID:         id,
		Direction:  TransferUpload,
		Session:    sess,
		RemotePath: rp,
		LocalPath:  localPath,
		Total:      total,
		Done:       0,
		remoteFile: remoteFile,
		localFile:  localFile,
	}

	tm.mu.Lock()
	tm.transfers[id] = t
	tm.mu.Unlock()
	return t, nil
}

func (tm *TransferManager) Get(id string) (*Transfer, error) {
	tm.mu.Lock()
	t := tm.transfers[id]
	tm.mu.Unlock()
	if t == nil {
		return nil, errors.New("transfer not found")
	}
	return t, nil
}

func (tm *TransferManager) Delete(id string) {
	tm.mu.Lock()
	delete(tm.transfers, id)
	tm.mu.Unlock()
}

func (tm *TransferManager) Close(id string) error {
	t, err := tm.Get(id)
	if err != nil {
		return err
	}
	if t.remoteFile != nil {
		_ = t.remoteFile.Close()
	}
	if t.localFile != nil {
		_ = t.localFile.Close()
	}
	tm.Delete(id)
	return nil
}

// Cancel stops a transfer and (optionally) removes any partially written target file.
// Best-effort: cleanup errors are ignored.
func (tm *TransferManager) Cancel(id string, cleanup bool) (TransferEvent, error) {
	t, err := tm.Get(id)
	if err != nil {
		// idempotent cancel
		return TransferEvent{TransferID: id, State: "cancelled"}, nil
	}
	ev := TransferEvent{
		TransferID: t.ID,
		Direction:  string(t.Direction),
		DoneBytes:  t.Done,
		TotalBytes: t.Total,
		State:      "cancelled",
	}
	localPath := t.LocalPath
	remotePath := t.RemotePath
	dir := t.Direction
	sess := t.Session

	_ = tm.Close(id)

	if cleanup {
		switch dir {
		case TransferDownload:
			if localPath != "" {
				_ = os.Remove(localPath)
			}
		case TransferUpload:
			if sess != nil && sess.SFTP != nil && remotePath != "" {
				_ = sess.SFTP.Remove(Clean(remotePath))
			}
		}
	}
	return ev, nil
}

// Step advances the transfer by up to limit bytes and returns an event snapshot.
// If the transfer completes, it is closed and removed.
func (tm *TransferManager) Step(id string, limit int) (TransferEvent, error) {
	if limit <= 0 {
		limit = 64 * 1024
	}
	t, err := tm.Get(id)
	if err != nil {
		return TransferEvent{}, err
	}

	buf := make([]byte, limit)
	switch t.Direction {
	case TransferDownload:
		n, rerr := t.remoteFile.Read(buf)
		if n > 0 {
			if _, werr := t.localFile.Write(buf[:n]); werr != nil {
				_ = tm.Close(t.ID)
				return TransferEvent{TransferID: t.ID, Direction: "download", DoneBytes: t.Done, TotalBytes: t.Total, State: "failed", Error: werr.Error()}, werr
			}
			t.Done += int64(n)
		}
		if rerr != nil {
			_ = tm.Close(t.ID)
			return TransferEvent{TransferID: t.ID, Direction: "download", DoneBytes: t.Done, TotalBytes: t.Total, State: "success"}, nil
		}
		return TransferEvent{TransferID: t.ID, Direction: "download", DoneBytes: t.Done, TotalBytes: t.Total, State: "running"}, nil

	case TransferUpload:
		n, rerr := t.localFile.Read(buf)
		if n > 0 {
			if _, werr := t.remoteFile.Write(buf[:n]); werr != nil {
				_ = tm.Close(t.ID)
				return TransferEvent{TransferID: t.ID, Direction: "upload", DoneBytes: t.Done, TotalBytes: t.Total, State: "failed", Error: werr.Error()}, werr
			}
			t.Done += int64(n)
		}
		if rerr != nil {
			_ = tm.Close(t.ID)
			return TransferEvent{TransferID: t.ID, Direction: "upload", DoneBytes: t.Done, TotalBytes: t.Total, State: "success"}, nil
		}
		return TransferEvent{TransferID: t.ID, Direction: "upload", DoneBytes: t.Done, TotalBytes: t.Total, State: "running"}, nil
	default:
		return TransferEvent{}, errors.New("unknown transfer direction")
	}
}

