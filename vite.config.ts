import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tsconfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tanstackStart({
      srcDirectory: "app",
      spa: {
        enabled: true,
        maskPath: "/mono",
        prerender: {
          outputPath: "/_shell",
          crawlLinks: false,
        },
      },
      prerender: {
        enabled: true,
        autoStaticPathsDiscovery: false,
        crawlLinks: false,
        concurrency: 1,
      },
      pages: [
        { path: "/" },
        { path: "/compare/frameio" },
        { path: "/compare/wipster" },
        { path: "/compare/lucidlink" },
        { path: "/for/video-editors" },
        { path: "/for/agencies" },
        { path: "/pricing" },
      ],
    }),
    viteReact(),
  ],
});
