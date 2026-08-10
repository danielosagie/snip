import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  plugins: [react()],
  // The desktop renderer uses plain CSS, no Tailwind. Left to search, Vite
  // walks up out of desktop/ and finds the web app's postcss.config.mjs, which
  // requires @tailwindcss/postcss from the ROOT node_modules that this build
  // never installs. That surfaced only on the Windows runner. An explicit empty
  // config stops the search here on every platform.
  css: { postcss: {} },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        history: resolve(__dirname, "version-history.html"),
        pairing: resolve(__dirname, "pairing.html"),
      },
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/convex/")) return "convex";
        },
      },
    },
  },
  server: {
    port: 5300,
    strictPort: true,
  },
});
