import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  preview: { strictPort: true },
  // Relative API URLs work through the proxy in dev and preview.
  // A deployment should serve the site and /api under the same origin.
  server: {
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});
