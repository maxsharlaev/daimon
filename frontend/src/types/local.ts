export type LocalPanelKind = "files";

export type LocalPanelConfig = {
  kind: LocalPanelKind;
  path: string;
  volume: string;
};

export type LocalLayoutFlags = {
  leftPanel: boolean;
  rightPanel: boolean;
  terminal: boolean;
};

export type LocalWorkspacePersist = {
  layout: LocalLayoutFlags;
  left: LocalPanelConfig;
  right: LocalPanelConfig;
  activePane: "left" | "right";
};

export type LocalOutputEvent = {
  id: string;
  data: string;
  isErr?: boolean;
};

export type LocalStateEvent = {
  id: string;
  state: string;
  error?: string;
};

export type LocalSystemInfo = {
  os: string;
  arch: string;
  hostname: string;
  homeDir: string;
  defaultShell: string;
  volumeLabel: string;
  osDisplayName: string;
};

export const defaultLocalLayout = (): LocalLayoutFlags => ({
  leftPanel: true,
  rightPanel: true,
  terminal: true,
});

export const defaultLocalPanel = (home = ""): LocalPanelConfig => ({
  kind: "files",
  path: home,
  volume: home || "/",
});
