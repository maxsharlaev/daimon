export type ProfileGroup = {
  id: string;
  name: string;
  order: number;
};

export type Profile = {
  id: string;
  groupId: string;
  name: string;
  host: string;
  port: number;
  username: string;
};

export type TerminalSession = {
  sessionId: string;
  profileId: string;
  icon: string;
  ordinal: number;
  marker: "green" | "red" | "yellow" | "none";
  lastError?: string | null;
};

export type FilesSession = {
  sessionId: string;
  profileId: string;
  icon: string;
  ordinal: number;
  remotePath: string;
  marker: "files" | "red";
  lastError?: string | null;
};

export type DashboardSession = {
  sessionId: string;
  profileId: string;
  icon: string;
  ordinal: number;
  marker: "purple" | "red";
  lastError?: string | null;
};
