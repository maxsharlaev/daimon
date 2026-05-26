package sftp

import (
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// ListLocalVolumes returns browse roots for the local file manager (drives on Windows, locations on Unix).
func ListLocalVolumes() ([]string, error) {
	switch runtime.GOOS {
	case "windows":
		return listWindowsVolumes()
	default:
		return listUnixVolumes()
	}
}

func listWindowsVolumes() ([]string, error) {
	out := make([]string, 0, 8)
	for c := byte('A'); c <= byte('Z'); c++ {
		drive := string([]byte{c, ':'}) + `\`
		if _, err := os.Stat(drive); err == nil {
			out = append(out, drive)
		}
	}
	return out, nil
}

func listUnixVolumes() ([]string, error) {
	seen := map[string]struct{}{}
	add := func(p string) {
		p = strings.TrimSpace(p)
		if p == "" {
			return
		}
		p = filepath.Clean(p)
		if _, err := os.Stat(p); err != nil {
			return
		}
		if _, ok := seen[p]; ok {
			return
		}
		seen[p] = struct{}{}
	}

	add("/")
	if home, err := os.UserHomeDir(); err == nil {
		add(home)
	}

	switch runtime.GOOS {
	case "darwin":
		entries, _ := os.ReadDir("/Volumes")
		for _, e := range entries {
			if e.IsDir() {
				add(filepath.Join("/Volumes", e.Name()))
			}
		}
	case "linux":
		for _, root := range []string{"/mnt", "/media"} {
			entries, err := os.ReadDir(root)
			if err != nil {
				continue
			}
			for _, e := range entries {
				if !e.IsDir() {
					continue
				}
				p := filepath.Join(root, e.Name())
				add(p)
				if root == "/media" {
					sub, err := os.ReadDir(p)
					if err != nil {
						continue
					}
					for _, se := range sub {
						if se.IsDir() {
							add(filepath.Join(p, se.Name()))
						}
					}
				}
			}
		}
	}

	out := make([]string, 0, len(seen))
	for p := range seen {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i] == "/" {
			return true
		}
		if out[j] == "/" {
			return false
		}
		return strings.ToLower(out[i]) < strings.ToLower(out[j])
	})
	return out, nil
}
