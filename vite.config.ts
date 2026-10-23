import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { powerApps } from "@microsoft/power-apps-vite/plugin";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath } from "node:url";

// The Excel libraries' fflate goes through src/vendor/fflate-sync.ts (no Web Workers, which
// the Power Apps player won't run); that file reaches the real fflate as "fflate-real".
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// `npm run dev` serves on :3001 so the Power Apps browser can load the local app.
// `npm run build:preview` inlines everything into one HTML file for sharing the demo.
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [react(), powerApps(), ...(mode === "preview" ? [viteSingleFile()] : [])],
  resolve: {
    alias: [
      { find: /^fflate$/, replacement: here("./src/vendor/fflate-sync.ts") },
      { find: /^fflate-real$/, replacement: here("./node_modules/fflate/esm/browser.js") },
    ],
  },
  server: {
    host: "localhost",
    port: 3001,
    strictPort: true,
  },
  build: { outDir: mode === "preview" ? "preview" : "dist" },
}));
