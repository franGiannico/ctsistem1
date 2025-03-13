import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    historyApiFallback: true, // Permite redirecciones en una SPA
  },
  build: {
    outDir: "dist", // Asegura que el build se guarde en "dist"
  },
});
