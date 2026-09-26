package sftp

type FileEntryDTO struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	IsDir      bool   `json:"isDir"`
	Size       int64  `json:"size"`
	MTimeMs    int64  `json:"mtimeMs"`
	IsSymlink  bool   `json:"isSymlink"`
	LinkTarget string `json:"linkTarget,omitempty"`
}

type TransferEvent struct {
	TransferID string `json:"transferId"`
	Direction  string `json:"direction"` // "upload" | "download"
	DoneBytes  int64  `json:"doneBytes"`
	TotalBytes int64  `json:"totalBytes"`
	State      string `json:"state"` // "running" | "success" | "failed" | "cancelled"
	Error      string `json:"error,omitempty"`
}
