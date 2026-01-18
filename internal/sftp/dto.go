package sftp

type FileEntryDTO struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	IsDir   bool   `json:"isDir"`
	Size    int64  `json:"size"`
	MTimeMs int64  `json:"mtimeMs"`
}

type TransferEvent struct {
	TransferID string `json:"transferId"`
	Direction  string `json:"direction"` // "upload" | "download"
	DoneBytes  int64  `json:"doneBytes"`
	TotalBytes int64  `json:"totalBytes"`
	State      string `json:"state"` // "running" | "success" | "failed"
	Error      string `json:"error,omitempty"`
}

