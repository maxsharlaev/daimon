package main

type DockerStatusDTO struct {
	Available  bool   `json:"available"`
	Version    string `json:"version,omitempty"`
	APIVersion string `json:"apiVersion,omitempty"`
	OS         string `json:"os,omitempty"`
	Arch       string `json:"arch,omitempty"`
	Message    string `json:"message,omitempty"`
}

type DockerContainerDTO struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Image       string `json:"image"`
	ImageID     string `json:"imageId,omitempty"`
	State       string `json:"state"`
	Status      string `json:"status"`
	CreatedUnix int64  `json:"createdUnix"`
	Ports       string `json:"ports,omitempty"`
}

type DockerImageDTO struct {
	ID           string `json:"id"`
	Repository   string `json:"repository"`
	Tag          string `json:"tag"`
	CreatedAt    string `json:"createdAt,omitempty"`
	CreatedSince string `json:"createdSince,omitempty"`
	Size         string `json:"size,omitempty"`
	SizeBytes    int64  `json:"sizeBytes,omitempty"`
}

type DockerDanglingPreviewDTO struct {
	Count     int   `json:"count"`
	SizeBytes int64 `json:"sizeBytes"`
}

type DockerVolumeDTO struct {
	Name   string `json:"name"`
	Driver string `json:"driver,omitempty"`
	Scope  string `json:"scope,omitempty"`
}

type DockerVolumeDetailsDTO struct {
	Name       string            `json:"name"`
	Driver     string            `json:"driver,omitempty"`
	Mountpoint string            `json:"mountpoint,omitempty"`
	Scope      string            `json:"scope,omitempty"`
	CreatedAt  string            `json:"createdAt,omitempty"`
	Labels     map[string]string `json:"labels,omitempty"`
	Options    map[string]string `json:"options,omitempty"`
	RefCount   int               `json:"refCount,omitempty"`
	SizeBytes  int64             `json:"sizeBytes,omitempty"`
	UsedBy     []string          `json:"usedBy,omitempty"`
}

type DockerNetworkDTO struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Driver string `json:"driver,omitempty"`
	Scope  string `json:"scope,omitempty"`
}

type DockerNetworkDetailsDTO struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Driver     string   `json:"driver,omitempty"`
	Scope      string   `json:"scope,omitempty"`
	Internal   bool     `json:"internal,omitempty"`
	Attachable bool     `json:"attachable,omitempty"`
	Ingress    bool     `json:"ingress,omitempty"`
	Containers []string `json:"containers,omitempty"`
}

type DockerSystemDTO struct {
	Status        DockerStatusDTO `json:"status"`
	InfoText      string          `json:"infoText,omitempty"`
	DiskUsageText string          `json:"diskUsageText,omitempty"`
}

type DockerFileEntryDTO struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	IsDir      bool   `json:"isDir"`
	Size       int64  `json:"size"`
	MtimeMs    int64  `json:"mtimeMs"`
	IsSymlink  bool   `json:"isSymlink"`
	LinkTarget string `json:"linkTarget,omitempty"`
}

type DockerOutputEvent struct {
	ID    string `json:"id"`
	Data  string `json:"data"`
	IsErr bool   `json:"isErr"`
}

type DockerStateEvent struct {
	ID    string `json:"id"`
	State string `json:"state"` // "connected" | "disconnected"
	Error string `json:"error,omitempty"`
}
