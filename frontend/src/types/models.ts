export type ProfileGroupDTO = {
  id: string;
  parentId?: string | null;
  name: string;
  order: number;
};

export type ProfileDTO = {
  id: string;
  groupId: string;
  name: string;
  host: string;
  port: number;
  username: string;
  sshOptionsJson: string;
  createdAt: string;
  updatedAt: string;
};

export type UpsertProfileGroupRequest = {
  id?: string;
  parentId?: string | null;
  name: string;
  order: number;
};

export type UpsertProfileRequest = {
  id?: string;
  groupId: string;
  name: string;
  host: string;
  port: number;
  username: string;
  sshOptionsJson: string;
};

