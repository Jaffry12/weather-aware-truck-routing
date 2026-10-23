import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // Forward API calls to the Django dev server.
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  build: {
    // MapLibre is most of the bundle; a separate chunk keeps it cached across app deploys.
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/maplibre-gl")) return "maplibre";
          if (id.includes("node_modules")) return "vendor";
        },
      },
    },
  },
});
