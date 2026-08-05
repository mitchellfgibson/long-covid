import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: the app is served from https://<user>.github.io/long-covid/
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? "/long-covid/",
  build: { outDir: "dist", assetsInlineLimit: 0 },
  // Stats tests run in node; UI tests opt into jsdom with a per-file docblock.
  test: { environment: "node" },
});
