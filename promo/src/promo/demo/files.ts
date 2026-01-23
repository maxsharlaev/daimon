export type FileEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
};

type Node = {
  name: string;
  isDir: boolean;
  size?: number;
  children?: Node[];
};

const localRoot: Node = {
  name: "C:\\",
  isDir: true,
  children: [
    {
      name: "Users",
      isDir: true,
      children: [
        {
          name: "demo",
          isDir: true,
          children: [
            { name: "Desktop", isDir: true, children: [{ name: "notes.txt", isDir: false, size: 8420 }] },
            { name: "Downloads", isDir: true, children: [{ name: "build.zip", isDir: false, size: 5242880 }] },
            { name: "project", isDir: true, children: [{ name: "README.md", isDir: false, size: 1420 }] },
          ],
        },
      ],
    },
    {
      name: "Program Files",
      isDir: true,
      children: [{ name: "Daimon", isDir: true, children: [{ name: "daimon.exe", isDir: false, size: 22118400 }] }],
    },
    { name: "Temp", isDir: true, children: [{ name: "cache.tmp", isDir: false, size: 12000 }] },
  ],
};

const remoteRoot: Node = {
  name: "/",
  isDir: true,
  children: [
    { name: "etc", isDir: true, children: [{ name: "nginx", isDir: true, children: [{ name: "nginx.conf", isDir: false, size: 1800 }] }] },
    { name: "var", isDir: true, children: [{ name: "www", isDir: true, children: [{ name: "app", isDir: true, children: [{ name: "index.html", isDir: false, size: 1024 }] }] }] },
    { name: "home", isDir: true, children: [{ name: "deploy", isDir: true, children: [{ name: "releases", isDir: true, children: [{ name: "2026-01-22", isDir: true, children: [{ name: "app.tar.gz", isDir: false, size: 12400000 }] }] }] }] },
    { name: "srv", isDir: true, children: [{ name: "cache", isDir: true, children: [{ name: "state.json", isDir: false, size: 4096 }] }] },
  ],
};

export const DEFAULT_LOCAL = "C:\\Users\\demo";
export const DEFAULT_REMOTE = "/var/www/app";

export function listLocal(path: string): FileEntry[] {
  const node = findLocalNode(path) ?? localRoot;
  const children = Array.isArray(node.children) ? node.children : [];
  const entries = children.map((n) => ({
    name: n.name,
    path: joinLocal(path === "C:\\" ? "C:\\" : path, n.name),
    isDir: n.isDir,
    size: n.isDir ? 0 : n.size ?? 0,
  }));
  return entries.sort(sortEntries);
}

export function listRemote(path: string): FileEntry[] {
  const node = findRemoteNode(path) ?? remoteRoot;
  const children = Array.isArray(node.children) ? node.children : [];
  const entries = children.map((n) => ({
    name: n.name,
    path: joinRemote(path, n.name),
    isDir: n.isDir,
    size: n.isDir ? 0 : n.size ?? 0,
  }));
  return entries.sort(sortEntries);
}

export function parentLocalPath(p: string) {
  if (!p) return "";
  const norm = p.replace(/[\\\/]+$/, "");
  if (/^[a-zA-Z]:$/.test(norm)) return norm + "\\";
  if (/^[a-zA-Z]:\\$/.test(norm)) return norm.slice(0, 2) + "\\";
  const i = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
  if (i <= 0) return norm;
  if (i === 2 && /^[a-zA-Z]:/.test(norm)) return norm.slice(0, 2) + "\\";
  return norm.slice(0, i);
}

export function parentRemotePath(p: string) {
  if (!p || p === ".") return ".";
  const s = p.replace(/\/+$/, "") || "/";
  if (s === "/") return "/";
  const i = s.lastIndexOf("/");
  if (i <= 0) return "/";
  return s.slice(0, i) || "/";
}

export function breadcrumbsLocal(p: string): Array<{ label: string; path: string }> {
  if (!p) return [];
  const norm = p.replace(/\//g, "\\");
  const m = norm.match(/^([a-zA-Z]:)\\?/);
  if (!m) {
    const parts = norm.split("\\").filter(Boolean);
    const out: Array<{ label: string; path: string }> = [];
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}\\${part}` : part;
      out.push({ label: part, path: cur });
    }
    return out;
  }
  const drive = m[1] + "\\";
  const rest = norm.slice(drive.length).split("\\").filter(Boolean);
  const out: Array<{ label: string; path: string }> = [{ label: drive.replace(/\\$/, ""), path: drive }];
  let cur = drive.replace(/[\\\/]+$/, "") + "\\";
  for (const part of rest) {
    cur = cur.replace(/[\\\/]+$/, "") + "\\" + part;
    out.push({ label: part, path: cur });
  }
  return out;
}

export function breadcrumbsRemote(p: string): Array<{ label: string; path: string }> {
  if (!p) return [];
  if (p === ".") return [{ label: ".", path: "." }];
  const clean = p.replace(/\/+$/, "") || "/";
  if (clean === "/") return [{ label: "/", path: "/" }];
  const parts = clean.split("/").filter(Boolean);
  const out: Array<{ label: string; path: string }> = [{ label: "/", path: "/" }];
  let cur = "";
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : `/${part}`;
    out.push({ label: part, path: cur });
  }
  return out;
}

export function joinRemote(dir: string, name: string) {
  if (!dir || dir === ".") return name;
  if (dir === "/") return `/${name}`;
  const base = dir.replace(/\/+$/, "");
  return `${base}/${name}`;
}

export function joinLocal(dir: string, name: string) {
  return dir.replace(/[\\\/]+$/, "") + "\\" + name;
}

function findLocalNode(path: string): Node | null {
  const norm = path.replace(/\//g, "\\");
  const parts = norm.split("\\").filter(Boolean);
  let cur: Node | null = localRoot;
  if (parts.length > 0 && /^[a-zA-Z]:$/.test(parts[0])) {
    parts.shift();
  }
  for (const part of parts) {
    if (!cur?.children) return null;
    cur = cur.children.find((c) => c.name.toLowerCase() === part.toLowerCase()) ?? null;
  }
  return cur;
}

function findRemoteNode(path: string): Node | null {
  const clean = path.replace(/\/+$/, "") || "/";
  const parts = clean.split("/").filter(Boolean);
  let cur: Node | null = remoteRoot;
  for (const part of parts) {
    if (!cur?.children) return null;
    cur = cur.children.find((c) => c.name === part) ?? null;
  }
  return cur;
}

function sortEntries(a: FileEntry, b: FileEntry) {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  return a.name.localeCompare(b.name);
}
