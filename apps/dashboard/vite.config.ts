import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    middlewareMode: true,
  },
  appType: "spa",
  build: {
    outDir: "dist",
  },
});
