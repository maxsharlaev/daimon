export type DashboardSnapshot = {
  tsUnixMs: number;
  cpu: { busyPct: number };
  mem: { totalBytes: number; availableBytes: number };
  load: { load1: number; cores: number };
  disks: Array<{ mount: string; sizeBytes: number; usedBytes: number; usedPct?: number }>;
  topCpu: Array<{ pid: number; comm: string; cpu: number }>;
  topMem: Array<{ pid: number; comm: string; mem: number; rssBytes: number }>;
  netDevices: Array<{ iface: string; rxBytes: number; txBytes: number }>;
  alerts: Array<{ id: string; severity: "warning" | "critical"; title: string; message: string }>;
};

const state = new Map<string, { seed: number; tick: number }>();

export function getDashboardSnapshot(sessionId: string): DashboardSnapshot {
  const now = Date.now();
  const st = state.get(sessionId) ?? { seed: Math.floor(Math.random() * 1000), tick: 0 };
  st.tick += 1;
  state.set(sessionId, st);

  const jitter = (base: number, spread: number) => base + Math.sin((st.tick + st.seed) / 3) * spread;
  const cpu = clamp(jitter(42, 18), 8, 92);
  const memAvail = clamp(jitter(38, 12), 10, 70);
  const load1 = clamp(jitter(1.4, 0.7), 0.2, 3.2);
  const diskUsedPct = clamp(jitter(46, 10), 20, 85);
  const diskSize = 96 * 1024 * 1024 * 1024;

  return {
    tsUnixMs: now,
    cpu: { busyPct: cpu },
    mem: { totalBytes: 16 * 1024 * 1024 * 1024, availableBytes: (memAvail / 100) * 16 * 1024 * 1024 * 1024 },
    load: { load1, cores: 4 },
    disks: [
      {
        mount: "/",
        sizeBytes: diskSize,
        usedBytes: (diskUsedPct / 100) * diskSize,
        usedPct: diskUsedPct,
      },
    ],
    topCpu: [
      { pid: 1824, comm: "myapp", cpu: clamp(jitter(18, 6), 5, 34) },
      { pid: 2031, comm: "nginx", cpu: clamp(jitter(7, 3), 1, 15) },
      { pid: 2270, comm: "postgres", cpu: clamp(jitter(4, 2), 1, 10) },
    ],
    topMem: [
      { pid: 1824, comm: "myapp", mem: clamp(jitter(6, 2), 2, 12), rssBytes: 148 * 1024 * 1024 },
      { pid: 2270, comm: "postgres", mem: clamp(jitter(4, 1.5), 2, 8), rssBytes: 108 * 1024 * 1024 },
      { pid: 2031, comm: "nginx", mem: clamp(jitter(1.6, 0.6), 0.8, 3.2), rssBytes: 38 * 1024 * 1024 },
    ],
    netDevices: [
      { iface: "eth0", rxBytes: 4_231_142_040 + st.tick * 120_000, txBytes: 1_821_345_700 + st.tick * 60_000 },
      { iface: "lo", rxBytes: 88_140_000 + st.tick * 1_000, txBytes: 88_140_000 + st.tick * 1_000 },
    ],
    alerts: diskUsedPct > 80
      ? [
          {
            id: "a-1",
            severity: "warning",
            title: "Disk usage is high",
            message: "Root filesystem usage exceeded 80%",
          },
        ]
      : [],
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
