/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves the app from /<repo>/, so the base path is configurable
// via env (set to "/queryforge/" in CI). Defaults to "/" for local dev.
const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
  base,
  plugins: [react()],
  test: {
    // Logic tests (schema/prompt/validator) run in node; no real network calls.
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
