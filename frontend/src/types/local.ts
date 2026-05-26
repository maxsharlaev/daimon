export type LocalPanelKind = "files" | "terminal";

export type LocalPanelConfig = {
  kind: LocalPanelKind;
  path: string;
  volume: string;
  /** Secondary shell in this panel (not the main workspace terminal). */
  shellId?: string;
};

export type LocalLayoutFlags = {
  leftPanel: boolean;
  rightPanel: boolean;
  terminal: boolean;
};

export type LocalWorkspaceSplit = {
  panelsPct?: number;
  verticalPct?: number;
  /** @deprecated use sidePanelsPct — was first-pane % and depended on terminal side */
  sidePct?: number;
  /** Horizontal layout: width % of the panels block (stable when terminal is left or right). */
  sidePanelsPct?: number;
};

export type LocalWorkspacePersist = {
  layout: LocalLayoutFlags;
  left: LocalPanelConfig;
  right: LocalPanelConfig;
  activePane: "left" | "right";
  split?: LocalWorkspaceSplit;
};

export const defaultLocalSplit = (): LocalWorkspaceSplit => ({
  panelsPct: 50,
  verticalPct: 62,
  sidePanelsPct: 58,
});

/** Panels width % for horizontal terminal+panels layout (migrates legacy sidePct). */
export function sidePanelsPctFromSplit(
  split: LocalWorkspaceSplit | undefined,
  terminalOnLeft: boolean
): number {
  if (split?.sidePanelsPct != null) return split.sidePanelsPct;
  if (split?.sidePct != null) return terminalOnLeft ? 100 - split.sidePct : split.sidePct;
  return 58;
}

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

export type LocalCwdEvent = {
  id: string;
  path: string;
};

export const PANEL_KIND_OPTIONS = [
  { value: "files" as const, label: "Files" },
  { value: "terminal" as const, label: "Panel terminal" },
];

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
