import { EventsOn } from "../../wailsjs/runtime/runtime";
import type { LocalOutputEvent, LocalStateEvent } from "../types/local";

let started = false;

function normalize<T>(args: unknown[]): T | null {
  if (!args || args.length === 0) return null;
  let v: unknown = args[0];
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

export function startLocalEventBridge() {
  if (started) return;
  started = true;
}

export function onLocalOutput(cb: (ev: LocalOutputEvent) => void) {
  return EventsOn("local:output", (...args: unknown[]) => {
    const ev = normalize<LocalOutputEvent>(args);
    if (ev) cb(ev);
  });
}

export function onLocalState(cb: (ev: LocalStateEvent) => void) {
  return EventsOn("local:state", (...args: unknown[]) => {
    const ev = normalize<LocalStateEvent>(args);
    if (ev) cb(ev);
  });
}
