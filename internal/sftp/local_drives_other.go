//go:build !windows

package sftp

// ListLocalDrives returns local roots (alias for ListLocalVolumes on non-Windows).
func ListLocalDrives() ([]string, error) {
	return ListLocalVolumes()
}
