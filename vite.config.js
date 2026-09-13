import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import ecosystem from "./ecosystem.config.cjs";

// Mirrors the server ALLOWED_HOSTS contract: exact comma-separated hostnames,
// without scheme or port. Loopback stays allowed and no wildcard is granted.
const allowedHosts = (process.env.ALLOWED_HOSTS ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts,
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
