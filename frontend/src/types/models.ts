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

export type MacroDataItemDTO = {
  id: string;
  key: string;
  value: string;
  order: number;
};

export type MacroParamDTO = {
  id: string;
  name: string;
  prompt: string;
  order: number;
};

export type MacroDTO = {
  id: string;
  name: string;
  tags: string[];
  script: string;
  dataItems: MacroDataItemDTO[];
  params: MacroParamDTO[];
  createdAt: string;
  updatedAt: string;
};

export type UpsertMacroRequest = {
  id?: string;
  name: string;
  tags: string[];
  script: string;
  dataItems: MacroDataItemDTO[];
  params: MacroParamDTO[];
};

export type MacroBindingDTO = {
  id: string;
  profileId: string;
  macroId: string;
  isFavorite: boolean;
  enabled: boolean;
  updatedAt: string;
};

