import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/",
  server: {
    proxy: {
      // only proxy API/auth paths (not SPA routes)
      "/api": "http://localhost:8002",
      "/auth": "http://localhost:8002",
    },
  },
});
