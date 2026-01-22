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
};
