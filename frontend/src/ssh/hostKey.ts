import { TrustHostKey } from "../../wailsjs/go/main/App";

export type UnknownHostPrompt = {
  kind: "unknown";
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  publicKey: string;
};

export type ChangedHostPrompt = {
  kind: "changed";
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  oldKeyType: string;
  oldFingerprint: string;
};

export type HostKeyPrompt = UnknownHostPrompt | ChangedHostPrompt;

type Decision = "trust" | "cancel";
type Handler = (prompt: HostKeyPrompt) => Promise<Decision>;

let handler: Handler | null = null;
let promptChain: Promise<void> = Promise.resolve();
const decisions = new Map<string, Promise<Decision>>();

const trustDecisionTTLMs = 60_000;

export function registerHostKeyHandler(next: Handler | null) {
  handler = next;
}

function messageOf(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message?: unknown }).message ?? err);
  }
  return String(err ?? "");
}

function jsonAfter(msg: string, marker: string): Record<string, unknown> | null {
  const at = msg.indexOf(marker);
  if (at < 0) return null;
  const start = msg.indexOf("{", at);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < msg.length; i++) {
    const ch = msg[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(msg.slice(start, i + 1));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
          }
        } catch {
          return null;
        }
        return null;
      }
    }
  }
  return null;
}

export function parseHostKeyError(err: unknown): HostKeyPrompt | null {
  const msg = messageOf(err);
  const unknown = jsonAfter(msg, "HOSTKEY_UNKNOWN ");
  if (unknown) {
    return {
      kind: "unknown",
      host: String(unknown.host ?? ""),
      port: Number(unknown.port) || 22,
      keyType: String(unknown.keyType ?? ""),
      fingerprint: String(unknown.fingerprint ?? ""),
      publicKey: String(unknown.publicKey ?? ""),
    };
  }
  const changed = jsonAfter(msg, "HOSTKEY_CHANGED ");
  if (changed) {
    return {
      kind: "changed",
      host: String(changed.host ?? ""),
      port: Number(changed.port) || 22,
      keyType: String(changed.keyType ?? ""),
      fingerprint: String(changed.fingerprint ?? ""),
      oldKeyType: String(changed.oldKeyType ?? ""),
      oldFingerprint: String(changed.oldFingerprint ?? ""),
    };
  }
  return null;
}

export function profileSkipsHostKey(sshOptionsJson: string | undefined | null): boolean {
  try {
    const parsed = JSON.parse(sshOptionsJson || "{}");
    return parsed?.insecureIgnoreHostKey === true;
  } catch {
    return false;
  }
}

export function sshOptionsJSON(current: string | undefined | null, insecureIgnoreHostKey: boolean, timeoutMs: number): string {
  let o: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(current || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      o = { ...parsed };
    }
  } catch {
    o = {};
  }
  o.insecureIgnoreHostKey = insecureIgnoreHostKey;
  o.timeoutMs = timeoutMs;
  return JSON.stringify(o);
}

export function readSSHOptions(raw: string | undefined | null): { insecureIgnoreHostKey: boolean; timeoutMs: number } {
  try {
    const parsed = JSON.parse(raw || "{}");
    return {
      insecureIgnoreHostKey: parsed?.insecureIgnoreHostKey === true,
      timeoutMs: Number(parsed?.timeoutMs) || 0,
    };
  } catch {
    return { insecureIgnoreHostKey: false, timeoutMs: 0 };
  }
}

export function clearHostKeyPrompt(host: string, port: number) {
  const marker = `|${normalizeHost(host)}:${port}|`;
  for (const key of decisions.keys()) {
    if (key.includes(marker)) decisions.delete(key);
  }
}

export async function withHostKey<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const prompt = parseHostKeyError(err);
    if (!prompt) throw err;
    const decision = await enqueuePrompt(prompt);
    if (prompt.kind === "unknown" && decision === "trust") {
      try {
        await TrustHostKey(prompt.host, prompt.port, prompt.publicKey);
      } catch (trustErr) {
        const changed = parseHostKeyError(trustErr);
        if (changed?.kind === "changed") {
          await enqueuePrompt(changed);
          throw new Error(`Host key changed for ${changed.host}:${changed.port}`);
        }
        throw trustErr;
      }
      try {
        return await fn();
      } catch (retryErr) {
        const again = parseHostKeyError(retryErr);
        if (again) {
          throw new Error(hostKeyMessage(again));
        }
        throw retryErr;
      }
    }
    if (prompt.kind === "changed") {
      throw new Error(`Host key changed for ${prompt.host}:${prompt.port}`);
    }
    throw new Error("Connection cancelled");
  }
}

function enqueuePrompt(prompt: HostKeyPrompt): Promise<Decision> {
  const key = `${prompt.kind}|${prompt.host}:${prompt.port}|${prompt.fingerprint}`;
  const existing = decisions.get(key);
  if (existing) return existing;
  if (!handler) {
    return Promise.reject(new Error(hostKeyMessage(prompt)));
  }
  const ask = promptChain.then(() => handler!(prompt));
  promptChain = ask.then(
    () => undefined,
    () => undefined
  );
  const stored = ask.then(
    (decision) => {
      if (decision === "trust") {
        window.setTimeout(() => {
          if (decisions.get(key) === stored) decisions.delete(key);
        }, trustDecisionTTLMs);
      } else {
        queueMicrotask(() => {
          if (decisions.get(key) === stored) decisions.delete(key);
        });
      }
      return decision;
    },
    (err) => {
      decisions.delete(key);
      throw err;
    }
  );
  decisions.set(key, stored);
  return stored;
}

function normalizeHost(host: string): string {
  let value = host.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    const ip = canonicalIP(value.slice(1, -1).trim());
    if (ip) value = ip;
  }
  return value.toLowerCase();
}

function canonicalIP(value: string): string | null {
  const v4 = canonicalIPv4(value);
  if (v4) return v4;
  if (!value.includes(":")) return null;
  let hostname: string;
  try {
    hostname = new URL(`http://[${value}]`).hostname;
  } catch {
    return null;
  }
  if (!hostname.startsWith("[") || !hostname.endsWith("]")) return null;
  const inner = hostname.slice(1, -1);
  const mapped = inner.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (mapped) {
    const hi = Number.parseInt(mapped[1], 16);
    const lo = Number.parseInt(mapped[2], 16);
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  return inner;
}

function canonicalIPv4(value: string): string | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    nums.push(n);
  }
  return nums.join(".");
}

function hostKeyMessage(prompt: HostKeyPrompt): string {
  if (prompt.kind === "changed") {
    return `Host key changed for ${prompt.host}:${prompt.port}`;
  }
  return `Host key is not trusted for ${prompt.host}:${prompt.port}`;
}
