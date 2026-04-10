/** Unix-style path helpers for remote log file browser */

export function dirnameUnix(p: string): string {
  const t = p.trim();
  if (!t || t === "/") return "/";
  const x = t.endsWith("/") ? t.slice(0, -1) : t;
  const i = x.lastIndexOf("/");
  if (i < 0) return ".";
  if (i === 0) return "/";
  return x.slice(0, i);
}

export function basenameUnix(p: string): string {
  const t = p.trim();
  if (!t || t === "/") return "";
  const x = t.endsWith("/") ? t.slice(0, -1) : t;
  const i = x.lastIndexOf("/");
  return i < 0 ? x : x.slice(i + 1);
}

export function joinUnix(base: string, name: string): string {
  if (!base || base === "/") return `/${name}`.replace("//", "/");
  const clean = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${clean}/${name}`;
}

export function parentUnix(p: string): string {
  if (!p || p === "/" || p === ".") return "/";
  const clean = p.endsWith("/") ? p.slice(0, -1) : p;
  const i = clean.lastIndexOf("/");
  if (i <= 0) return "/";
  return clean.slice(0, i);
}

/**
 * Directory to list + optional filename prefix filter (while user types a path).
 * `fallbackRoot` is used when path is empty (e.g. SFTP getwd or "/").
 */
export function pathToListSpec(raw: string, fallbackRoot: string): { listDir: string; filterPrefix: string } {
  const t = raw.trim();
  const root = fallbackRoot || "/";
  if (!t) {
    return { listDir: root, filterPrefix: "" };
  }
  if (t.endsWith("/")) {
    const d = t.slice(0, -1) || "/";
    return { listDir: d === "" ? "/" : d, filterPrefix: "" };
  }
  const dir = dirnameUnix(t);
  const base = basenameUnix(t);
  const listDir = dir === "." ? root : dir;
  return { listDir, filterPrefix: base };
}
