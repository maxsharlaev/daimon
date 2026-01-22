export type ProfileGroup = {
  id: string;
  name: string;
  order: number;
};

export type Profile = {
  id: string;
  groupId: string;
  name: string;
  host: string;
  port: number;
  username: string;
};

export type Place = {
  id: string;
  profileId: string;
  name: string;
  remotePath: string;
};

export type Macro = {
  id: string;
  name: string;
  tags: string[];
  preview: string;
};

export const demoGroups: ProfileGroup[] = [
  { id: "g-prod", name: "Production", order: 0 },
  { id: "g-stage", name: "Staging", order: 1 },
  { id: "g-lab", name: "Lab", order: 2 },
];

export const demoProfiles: Profile[] = [
  { id: "p-web-01", groupId: "g-prod", name: "web-01", host: "10.0.1.10", port: 22, username: "deploy" },
  { id: "p-web-02", groupId: "g-prod", name: "web-02", host: "10.0.1.11", port: 22, username: "deploy" },
  { id: "p-db-01", groupId: "g-prod", name: "db-01", host: "10.0.2.20", port: 22, username: "postgres" },
  { id: "p-edge-01", groupId: "g-stage", name: "edge-01", host: "10.1.1.5", port: 22, username: "ops" },
  { id: "p-api-01", groupId: "g-stage", name: "api-01", host: "10.1.2.7", port: 22, username: "svc" },
  { id: "p-dev-01", groupId: "g-lab", name: "dev-01", host: "192.168.56.12", port: 22, username: "dev" },
  { id: "p-dev-02", groupId: "g-lab", name: "dev-02", host: "192.168.56.13", port: 22, username: "dev" },
];

export const demoPlaces: Place[] = [
  { id: "pl-1", profileId: "p-web-01", name: "nginx", remotePath: "/etc/nginx" },
  { id: "pl-2", profileId: "p-web-01", name: "app", remotePath: "/var/www/app" },
  { id: "pl-3", profileId: "p-db-01", name: "postgres data", remotePath: "/var/lib/postgresql/15/main" },
  { id: "pl-4", profileId: "p-api-01", name: "logs", remotePath: "/var/log/api" },
];

export const demoMacros: Macro[] = [
  { id: "m-1", name: "Restart service", tags: ["systemd", "prod"], preview: "sudo systemctl restart myapp" },
  { id: "m-2", name: "Tail logs", tags: ["logs"], preview: "tail -n 200 /var/log/app/app.log" },
  { id: "m-3", name: "Disk usage", tags: ["diagnostics"], preview: "df -h && du -sh /var/*" },
];
