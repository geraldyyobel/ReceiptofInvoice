import { defineConfig } from "vite";
import { parse } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const env = existsSync(".env") ? parse(readFileSync(".env")) : {};
  const apiOrigin = `http://127.0.0.1:${process.env.API_PORT || env.API_PORT || 3000}`;
  return {
    root: "client",
    plugins: [react()],
    build: {
      outDir: "../dist",
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom", "react-dom/client", "scheduler"],
            editor: ["@tinymce/tinymce-react"],
          },
        },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": apiOrigin,
        "/uploads": apiOrigin,
        "/vendor": apiOrigin,
      },
    },
  };
});
