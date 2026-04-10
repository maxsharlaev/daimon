export type WidgetMetric =
  | "cpu_busy"
  | "mem_available"
  | "load1"
  | "disk_root"
  | "top_cpu"
  | "top_mem"
  | "net_ifaces"
  | "alerts"
  | "log_tail";

export type WidgetView = "kpi" | "progress" | "list";

export type WidgetConfig = {
  id: string;
  metric: WidgetMetric;
  view: WidgetView;
  logSourceId?: string;
  maxLines?: number;
  levelFilter?: string;
};

export type DashboardRow = {
  id: string;
  cols: 1 | 2 | 3;
  slots: Array<WidgetConfig | null>; // length = cols
};

export type DashboardTab = {
  id: string;
  name: string;
  icon: string;
  locked?: boolean; // General
  rows: DashboardRow[];
};

export type StoredLayoutV2 = {
  version: 2;
  activeTabId?: string;
  tabs: DashboardTab[];
};

export function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export function defaultLayoutV2(): StoredLayoutV2 {
  return {
    version: 2,
    activeTabId: "tab-general",
    tabs: [
      {
        id: "tab-general",
        name: "General",
        icon: "📊",
        locked: true,
        rows: [
          {
            id: "row-general-1",
            cols: 3,
            slots: [
              { id: "w-cpu", metric: "cpu_busy", view: "progress" },
              { id: "w-mem", metric: "mem_available", view: "progress" },
              { id: "w-disk", metric: "disk_root", view: "progress" },
            ],
          },
          {
            id: "row-general-2",
            cols: 2,
            slots: [
              { id: "w-load", metric: "load1", view: "kpi" },
              { id: "w-net", metric: "net_ifaces", view: "list" },
            ],
          },
          {
            id: "row-general-3",
            cols: 1,
            slots: [{ id: "w-alerts", metric: "alerts", view: "list" }],
          },
        ],
      },
    ],
  };
}

