package sftp

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func UserHomeDir() (string, error) {
	return os.UserHomeDir()
}

func ListLocalDir(dir string) ([]FileEntryDTO, error) {
	if dir == "" {
		return nil, errors.New("dir required")
	}
	dir = filepath.Clean(dir)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := make([]FileEntryDTO, 0, len(entries))
	for _, de := range entries {
		name := de.Name()
		full := filepath.Join(dir, name)
		info, err := de.Info()
		if err != nil {
			continue
		}
		isDir := info.IsDir()
		// Treat symlink-to-dir as a directory (so it can be navigated like in FAR/MC).
		if info.Mode()&os.ModeSymlink != 0 {
			if st, err := os.Stat(full); err == nil {
				isDir = st.IsDir()
			}
		}
		out = append(out, FileEntryDTO{
			Name:    name,
			Path:    full,
			IsDir:   isDir,
			Size:    info.Size(),
			MTimeMs: info.ModTime().UnixMilli(),
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].IsDir != out[j].IsDir {
			return out[i].IsDir
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

func MkdirLocal(dir string) error {
	if dir == "" {
		return errors.New("dir required")
	}
	return os.MkdirAll(filepath.Clean(dir), 0o755)
}

func RenameLocal(oldPath string, newPath string) error {
	if oldPath == "" || newPath == "" {
		return errors.New("paths required")
	}
	return os.Rename(filepath.Clean(oldPath), filepath.Clean(newPath))
}

func RemoveLocal(p string) error {
	if p == "" {
		return errors.New("path required")
	}
	return os.RemoveAll(filepath.Clean(p))
}

