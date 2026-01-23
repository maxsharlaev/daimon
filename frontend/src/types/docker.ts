export type DockerStatusDTO = {
  available: boolean;
  version?: string;
  apiVersion?: string;
  os?: string;
  arch?: string;
  message?: string;
};

export type DockerContainerDTO = {
  id: string;
  name: string;
  image: string;
  imageId?: string;
  state: string;
  status: string;
  createdUnix: number;
  ports?: string;
};

export type DockerImageDTO = {
  id: string;
  repository: string;
  tag: string;
  createdAt?: string;
  createdSince?: string;
  size?: string;
  sizeBytes?: number;
};

export type DockerSystemDTO = {
  status: DockerStatusDTO;
  infoText?: string;
  diskUsageText?: string;
};

export type DockerDanglingPreviewDTO = {
  count: number;
  sizeBytes: number;
};

export type DockerVolumeDTO = {
  name: string;
  driver?: string;
  scope?: string;
};

export type DockerVolumeDetailsDTO = {
  name: string;
  driver?: string;
  mountpoint?: string;
  scope?: string;
  createdAt?: string;
  labels?: Record<string, string>;
  options?: Record<string, string>;
  refCount?: number;
  sizeBytes?: number;
  usedBy?: string[];
};

export type DockerNetworkDTO = {
  id: string;
  name: string;
  driver?: string;
  scope?: string;
};

export type DockerNetworkDetailsDTO = {
  id: string;
  name: string;
  driver?: string;
  scope?: string;
  internal?: boolean;
  attachable?: boolean;
  ingress?: boolean;
  containers?: string[];
};

export type DockerOutputEvent = {
  id: string;
  data: string;
  isErr: boolean;
};

export type DockerStateEvent = {
  id: string;
  state: "connected" | "disconnected";
  error?: string;
};

export type DockerFileEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
  isSymlink?: boolean;
  linkTarget?: string;
};
