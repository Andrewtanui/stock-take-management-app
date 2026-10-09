import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { powerApps } from "@microsoft/power-apps-vite/plugin";
import { viteSingleFile } from "vite-plugin-singlefile";

// `npm run dev` serves on :3001 so the Power Apps browser can load the local app.
// `npm run build:preview` inlines everything into one HTML file for sharing the demo.
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [react(), powerApps(), ...(mode === "preview" ? [viteSingleFile()] : [])],
  server: {
    host: "localhost",
    port: 3001,
    strictPort: true,
  },
  build: { outDir: mode === "preview" ? "preview" : "dist" },
}));
