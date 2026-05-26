//go:build windows

package sftp

// ListLocalDrives returns available drive roots like "C:\" on Windows.
func ListLocalDrives() ([]string, error) {
	return listWindowsVolumes()
}
