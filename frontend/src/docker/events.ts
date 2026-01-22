import { EventsOn } from "../../wailsjs/runtime/runtime";
import type { DockerOutputEvent, DockerStateEvent } from "../types/docker";

type Unsub = () => void;

let started = false;

const outputSubs = new Set<(ev: DockerOutputEvent) => void>();
const stateSubs = new Set<(ev: DockerStateEvent) => void>();

export function startDockerEventBridge() {
  if (started) return;
  started = true;

  EventsOn("docker:output", (...args: any[]) => {
    const ev = normalizeEvent<DockerOutputEvent>(args);
    if (!ev) return;
    outputSubs.forEach((fn) => fn(ev));
  });

  EventsOn("docker:state", (...args: any[]) => {
    const ev = normalizeEvent<DockerStateEvent>(args);
    if (!ev) return;
    stateSubs.forEach((fn) => fn(ev));
  });
}

export function onDockerOutput(fn: (ev: DockerOutputEvent) => void): Unsub {
  startDockerEventBridge();
  outputSubs.add(fn);
  return () => outputSubs.delete(fn);
}

export function onDockerState(fn: (ev: DockerStateEvent) => void): Unsub {
  startDockerEventBridge();
  stateSubs.add(fn);
  return () => stateSubs.delete(fn);
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
