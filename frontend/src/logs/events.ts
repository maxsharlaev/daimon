import { EventsOff, EventsOn } from "../../wailsjs/runtime/runtime";

export type LogsSyncEvent = {
  sourceId: string;
  state: "running" | "success" | "failed" | "warning";
  message?: string;
  importedCount?: number;
  skippedCount?: number;
  bytesRead?: number;
};

let started = false;
const subs = new Set<(ev: LogsSyncEvent) => void>();

function normalizeEvent<T>(args: any[]): T | null {
  if (!args || args.length === 0) return null;
  let v = args[0];
  if (Array.isArray(v) && v.length === 1) v = v[0];
  if (!v) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  if (typeof v === "object") return v as T;
  return null;
}

export function startLogsEventBridge() {
  if (started) return;
  started = true;
  EventsOn("logs:sync", (...args: any[]) => {
    const ev = normalizeEvent<LogsSyncEvent>(args);
    if (!ev) return;
    subs.forEach((cb) => cb(ev));
  });
}

export function onLogsSync(cb: (ev: LogsSyncEvent) => void) {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function stopLogsEventBridge() {
  try {
    EventsOff("logs:sync");
  } catch {
    // ignore
  }
  subs.clear();
  started = false;
}
