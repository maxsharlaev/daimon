export type LocalFileEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
  isSymlink?: boolean;
  linkTarget?: string;
};

export function parentLocal(p: string) {
  if (!p) return "";
  const norm = p.replace(/[\\/]+$/, "");
  if (/^[a-zA-Z]:$/.test(norm)) return norm + "\\";
  if (/^[a-zA-Z]:\\$/.test(norm)) return norm.slice(0, 2) + "\\";
  if (norm === "/") return "/";
  const i = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
  if (i <= 0) {
    if (norm.startsWith("/")) return "/";
    return norm;
  }
  if (i === 2 && /^[a-zA-Z]:/.test(norm)) return norm.slice(0, 2) + "\\";
  return norm.slice(0, i) || "/";
}

export function joinLocal(dir: string, name: string) {
  if (!dir) return name;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  const base = dir.replace(/[\\/]+$/, "");
  if (sep === "/") return `${base}/${name}`;
  return `${base}\\${name}`;
}

export function driveFromLocalPath(p: string): string | null {
  if (!p) return null;
  const m = p.match(/^([a-zA-Z]:)(\\|\/)?/);
  if (!m) return null;
  return m[1] + "\\";
}

export function volumeForPath(p: string, volumes: string[]): string | null {
  const drive = driveFromLocalPath(p);
  if (drive) return drive;
  if (!p || volumes.length === 0) return volumes[0] ?? null;
  let best = volumes[0];
  for (const v of volumes) {
    if (p === v || p.startsWith(v.endsWith("/") ? v : v + "/") || p.startsWith(v.endsWith("\\") ? v : v + "\\")) {
      if (v.length > best.length) best = v;
    }
  }
  return best;
}

/** Separator after crumb at index (empty after Unix root so we do not render "/" twice). */
export function crumbSeparatorAfter(
  idx: number,
  crumb: { path: string },
  total: number
): string {
  if (idx >= total - 1) return "";
  if (idx === 0 && crumb.path === "/") return "";
  return "/";
}

export function breadcrumbsLocal(p: string): Array<{ label: string; path: string }> {
  if (!p) return [];
  const win = p.match(/^([a-zA-Z]:)(\\|\/)?/);
  if (win) {
    const norm = p.replace(/\//g, "\\");
    const drive = win[1] + "\\";
    const rest = norm.slice(drive.length).split("\\").filter(Boolean);
    const out: Array<{ label: string; path: string }> = [{ label: drive.replace(/\\$/, ""), path: drive }];
    let cur = drive;
    for (const part of rest) {
      cur = joinLocal(cur, part);
      out.push({ label: part, path: cur });
    }
    return out;
  }
  if (p.startsWith("/")) {
    const parts = p.split("/").filter(Boolean);
    const out: Array<{ label: string; path: string }> = [{ label: "/", path: "/" }];
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : `/${part}`;
      out.push({ label: part, path: cur });
    }
    return out;
  }
  const parts = p.split(/[\\/]/).filter(Boolean);
  const out: Array<{ label: string; path: string }> = [];
  let cur = "";
  for (const part of parts) {
    cur = cur ? joinLocal(cur, part) : part;
    out.push({ label: part, path: cur });
  }
  return out;
}

export function moveSelection(entries: LocalFileEntry[], current: string | null, delta: number): string | null {
  if (!entries || entries.length === 0) return null;
  const idx = current ? entries.findIndex((e) => e.path === current) : -1;
  const nextIdx = Math.max(0, Math.min(entries.length - 1, (idx >= 0 ? idx : 0) + delta));
  return entries[nextIdx]?.path ?? null;
}

export function displayEntries(path: string, entries: LocalFileEntry[]): LocalFileEntry[] {
  const out: LocalFileEntry[] = [];
  const up = parentLocal(path);
  if (path && up && up !== path) {
    out.push({ name: "..", path: up, isDir: true, size: 0, mtimeMs: 0 });
  }
  out.push(...entries);
  return out;
}

export function fmtSize(n: number) {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function fmtDate(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}
