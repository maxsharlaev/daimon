export type WidgetMetric =
  | "cpu_busy"
  | "mem_available"
  | "load1"
  | "disk_root"
  | "top_cpu"
  | "top_mem"
  | "net_ifaces"
  | "alerts";

export type WidgetView = "progress" | "kpi" | "list";

export type WidgetConfig = {
  id: string;
  metric: WidgetMetric;
  view: WidgetView;
};

export type DashboardRow = {
  id: string;
  cols: 1 | 2 | 3;
  slots: Array<WidgetConfig | null>;
};

export type DashboardTab = {
  id: string;
  name: string;
  icon: string;
  rows: DashboardRow[];
};

export type DashboardLayout = {
  tabs: DashboardTab[];
  activeTabId: string;
};

export const demoLayout: DashboardLayout = {
  activeTabId: "tab-general",
  tabs: [
    {
      id: "tab-general",
      name: "General",
      icon: "📊",
      rows: [
        {
          id: "row-1",
          cols: 3,
          slots: [
            { id: "w-cpu", metric: "cpu_busy", view: "progress" },
            { id: "w-mem", metric: "mem_available", view: "progress" },
            { id: "w-disk", metric: "disk_root", view: "progress" },
          ],
        },
        {
          id: "row-2",
          cols: 2,
          slots: [
            { id: "w-load", metric: "load1", view: "kpi" },
            { id: "w-alerts", metric: "alerts", view: "list" },
          ],
        },
        {
          id: "row-3",
          cols: 2,
          slots: [
            { id: "w-topcpu", metric: "top_cpu", view: "list" },
            { id: "w-topmem", metric: "top_mem", view: "list" },
          ],
        },
      ],
    },
    {
      id: "tab-network",
      name: "Network",
      icon: "📡",
      rows: [
        {
          id: "row-4",
          cols: 1,
          slots: [{ id: "w-net", metric: "net_ifaces", view: "list" }],
        },
      ],
    },
  ],
};
