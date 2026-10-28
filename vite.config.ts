import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { deepSeekApiPlugin } from "./server/deepSeekApiPlugin";
import { roguelikePlugin } from "./server/roguelikePlugin";

export default defineConfig({
  plugins: [react(), deepSeekApiPlugin(), roguelikePlugin()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2022",
  },
});
