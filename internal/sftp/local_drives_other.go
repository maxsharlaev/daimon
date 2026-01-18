//go:build !windows

package sftp

// ListLocalDrives returns local "roots" for non-Windows systems.
func ListLocalDrives() ([]string, error) {
	return []string{"/"}, nil
}

