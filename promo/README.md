# Daimon Promo (React component)

Web-only demo UI that mirrors the full daimon desktop app for embedding in a landing page.

## Dev preview

```bash
cd promo
npm install
npm run dev
```

## Build (library)

```bash
cd promo
npm install
npm run build
```

Output: `dist/daimon-promo.js` + `dist/style.css`.

## Embed

```tsx
import { DaimonPromo } from "../promo/src";

export function LandingDemo() {
  return (
    <div style={{ height: "80vh" }}>
      <DaimonPromo />
    </div>
  );
}
```

## What is demo-only

All modes (Local, Connections, Docker, Logs, Data, Settings, Agent) look and feel like the real app:

- tabs, panels, toolbars, dropdowns, splits, terminal chrome
- clickable navigation and mock content (terminals, logs table, SQL grid, agent chat)

There is **no** Wails/SSH/Docker/database backend. Destructive and create actions are disabled or only update local UI state.

Styles in `src/styles/from-app/` are hand-copied from `frontend/src`. They are not generated. After a CSS change in the app, copy the matching file here or the demo will drift.

## Smoke-test checklist

- Topbar: logo, Local / Connections / Docker / Logs / Data, Agent (Connections/Docker), Settings, window controls
- Local: layout toggles, file panes, interactive mock cmd terminal
- Connections: groups/profiles, Connect/Files/Dashboard, Places/Macros, terminal input
- Docker: Local/Remote, resource views, Logs/Shell/Files session tabs
- Logs: owner segments, filters, table, Sources
- Data: source cards, Table / SQL / Explain, canned results
- Settings: sidebar sections (AI, Macros, Places, Privacy, …)
- Agent: chat, context strip, canned replies / command approval
