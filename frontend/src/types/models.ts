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

export type PlaceDTO = {
  id: string;
  profileId: string;
  name: string;
  remotePath: string;
  order: number;
  createdAt: string;
  updatedAt: string;
};

export type UpsertPlaceRequest = {
  id?: string;
  profileId: string;
  name: string;
  remotePath: string;
  order: number;
};

