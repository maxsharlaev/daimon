import { spawnSync } from "node:child_process";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: "wails-sync-appicon",
      configureServer(server) {
        const marker = "src/images/daimon-icon.png";
        server.watcher.on("change", (file) => {
          const norm = file.split(path.sep).join("/");
          if (norm.endsWith(marker)) {
            const script = path.join(__dirname, "scripts", "sync-appicon.cjs");
            spawnSync(process.execPath, [script], {
              cwd: __dirname,
              stdio: "inherit",
            });
          }
        });
      },
    },
  ],
});
