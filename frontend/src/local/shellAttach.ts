import type { Terminal } from "@xterm/xterm";
import { LocalShellReplay, LocalShellReplayB64, LocalShellResize, LocalShellSend } from "../../wailsjs/go/main/App";
import { writeBase64 } from "./terminalBytes";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function terminalHasVisibleText(term: Terminal): boolean {
  const buffer = term.buffer.active;
  const start = buffer.viewportY;
  const end = Math.min(buffer.length, start + term.rows);
  for (let row = start; row < end; row++) {
    const line = buffer.getLine(row);
    if (line?.translateToString(true).trim()) {
      return true;
    }
  }
  return false;
}

export async function requestPromptIfEmpty(term: Terminal, shellId: string, isWindows?: boolean): Promise<void> {
  await sleep(80);
  if (terminalHasVisibleText(term)) return;
  try {
    await LocalShellSend(shellId, isWindows ? "\r" : "\n");
  } catch {
    // ignore
  }
}

export function ptyColsForTerminal(term: Terminal, isWindows?: boolean): number {
  const cols = term.cols;
  return Math.max(2, cols);
}

export function ptyRowsForTerminal(term: Terminal): number {
  return Math.max(1, term.rows);
}

export async function replayLocalShell(term: Terminal, decoder: TextDecoder, shellId: string): Promise<boolean> {
  try {
    const dataB64 = await LocalShellReplayB64(shellId);
    if (dataB64) {
      writeBase64(term, decoder, dataB64);
      return true;
    }
  } catch {
    try {
      const data = await LocalShellReplay(shellId);
      if (data) {
        term.write(data);
        return true;
      }
    } catch {
      // shell gone or not ready
    }
  }
  return false;
}

export async function replayLocalShellWithRetry(
  term: Terminal,
  decoder: TextDecoder,
  shellId: string,
  attempts = 32
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await replayLocalShell(term, decoder, shellId)) return true;
    await sleep(30);
  }
  return false;
}

export async function resizeLocalShell(
  shellId: string,
  term: Terminal,
  isWindows?: boolean
): Promise<void> {
  const cols = ptyColsForTerminal(term, isWindows);
  const rows = ptyRowsForTerminal(term);
  if (cols < 1 || rows < 1) return;
  try {
    await LocalShellResize(shellId, cols, rows);
  } catch {
    // ignore
  }
}

export async function syncLocalShellGeometry(
  term: Terminal,
  decoder: TextDecoder,
  shellId: string,
  opts?: { syncCwd?: string; isWindows?: boolean }
): Promise<boolean> {
  if (term.cols < 1 || term.rows < 1) return false;
  await resizeLocalShell(shellId, term, opts?.isWindows);
  await sleep(48);
  const replayed = await replayLocalShellWithRetry(term, decoder, shellId);
  if (opts?.syncCwd) {
    const dir = opts.syncCwd;
    const cmd = opts.isWindows
      ? `cd /d "${dir.replace(/"/g, '""')}"\r\n`
      : `cd ${JSON.stringify(dir)}\n`;
    try {
      await LocalShellSend(shellId, cmd);
    } catch {
      // ignore
    }
  }
  return replayed;
}
