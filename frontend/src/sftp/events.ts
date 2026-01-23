import { EventsOn, EventsOff } from "../../wailsjs/runtime/runtime";

type TransferEvent = {
  transferId: string;
  direction: string;
  doneBytes: number;
  totalBytes: number;
  state: string;
  error?: string;
};

type StateEvent = {
  id: string;
  state: string; // "connected" | "disconnected"
  error?: string;
};

let started = false;
const subs = new Set<(ev: TransferEvent) => void>();
const stateSubs = new Set<(ev: StateEvent) => void>();

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

export function startSFTPEventBridge() {
  if (started) return;
  started = true;

  EventsOn("sftp:transfer", (...args: any[]) => {
    const ev = normalizeEvent<TransferEvent>(args);
    if (!ev) return;
    subs.forEach((cb) => cb(ev));
  });

  EventsOn("sftp:state", (...args: any[]) => {
    const ev = normalizeEvent<StateEvent>(args);
    if (!ev) return;
    stateSubs.forEach((cb) => cb(ev));
  });
}

export function onSFTPTransfer(cb: (ev: TransferEvent) => void) {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

export function onSFTPState(cb: (ev: StateEvent) => void) {
  stateSubs.add(cb);
  return () => {
    stateSubs.delete(cb);
  };
}

export function stopSFTPEventBridge() {
  // not strictly needed in app lifetime, but keeps API symmetrical
  try {
    EventsOff("sftp:transfer");
    EventsOff("sftp:state");
  } catch {
    // ignore
  }
  subs.clear();
  stateSubs.clear();
  started = false;
}

