# Daimon Promo (React component)

This folder contains a web-only demo UI that can be embedded into a Vite + React landing page.

## Dev preview (optional)

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

The build output is an ES module you can import from your landing bundle.

## Embed in Vite + React landing

Example usage (same repo / monorepo):

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

If you prefer using the built artifact, import from `promo/dist/daimon-promo.js` and include the emitted CSS asset in your landing.

## Smoke-test checklist
- Left panel shows demo connection groups and profiles
- Connect opens a terminal tab with live demo output
- Files opens file tabs with navigable local/remote trees
- Dashboard opens tabs with live metrics and lists
- No edit/create/delete actions are enabled
