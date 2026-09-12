import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import ecosystem from "./ecosystem.config.cjs";

export default defineConfig({
  plugins: [react()],
  server: {
    port: ecosystem.PORTS.devUi,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${ecosystem.PORTS.api}`,
        changeOrigin: true,
      },
    },
  },
  build: { outDir: "dist" },
});
