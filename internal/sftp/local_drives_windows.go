//go:build windows

package sftp

import (
	"os"
)

// ListLocalDrives returns available drive roots like "C:\" on Windows.
func ListLocalDrives() ([]string, error) {
	out := make([]string, 0, 8)
	for c := byte('A'); c <= byte('Z'); c++ {
		drive := string([]byte{c, ':'}) + `\`
		if _, err := os.Stat(drive); err == nil {
			out = append(out, drive)
		}
	}
	return out, nil
}

