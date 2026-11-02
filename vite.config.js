import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" makes the build work from any folder, including GitHub Pages project sites.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { chunkSizeWarningLimit: 2000 },
});
