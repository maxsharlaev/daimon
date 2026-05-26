import type { ITerminalOptions } from "@xterm/xterm";

export const localTerminalOptions: ITerminalOptions = {
  cursorBlink: true,
  convertEol: false,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  // ConPTY performs wrapping on the Windows side. Tell xterm to apply the
  // Windows PTY heuristics so wrapped rows don't render as broken hard lines.
  windowsPty: {
    backend: "conpty",
    buildNumber: 26200,
  },
  theme: {
    background: "#0b1220",
    foreground: "#c8d5e6",
    cursor: "#6ee7ff",
    selectionBackground: "rgba(110, 231, 255, 0.25)",
  },
  allowProposedApi: false,
};
