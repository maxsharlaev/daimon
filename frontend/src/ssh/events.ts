import { EventsOn } from "../../wailsjs/runtime/runtime";
import type { SSHOutputEvent, SSHStateEvent } from "../types/ssh";

type Unsub = () => void;

let started = false;

const outputSubs = new Set<(ev: SSHOutputEvent) => void>();
const stateSubs = new Set<(ev: SSHStateEvent) => void>();
const taskSubs = new Set<(ev: TaskStateEvent) => void>();

export type TaskStateEvent = {
  sessionId: string;
  state: "running" | "success" | "failed";
  error?: string;
};

export function startSSHEventBridge() {
  if (started) return;
  started = true;

  EventsOn("ssh:output", (...args: any[]) => {
    const ev = normalizeEvent<SSHOutputEvent>(args);
    if (!ev) return;
    outputSubs.forEach((fn) => fn(ev));
  });

  EventsOn("ssh:state", (...args: any[]) => {
    const ev = normalizeEvent<SSHStateEvent>(args);
    if (!ev) return;
    stateSubs.forEach((fn) => fn(ev));
  });

  EventsOn("task:state", (...args: any[]) => {
    const ev = normalizeEvent<TaskStateEvent>(args);
    if (!ev) return;
    taskSubs.forEach((fn) => fn(ev));
  });
}

export function onSSHOutput(fn: (ev: SSHOutputEvent) => void): Unsub {
  startSSHEventBridge();
  outputSubs.add(fn);
  return () => outputSubs.delete(fn);
}

export function onSSHState(fn: (ev: SSHStateEvent) => void): Unsub {
  startSSHEventBridge();
  stateSubs.add(fn);
  return () => stateSubs.delete(fn);
}

export function onTaskState(fn: (ev: TaskStateEvent) => void): Unsub {
  startSSHEventBridge();
  taskSubs.add(fn);
  return () => taskSubs.delete(fn);
}

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

