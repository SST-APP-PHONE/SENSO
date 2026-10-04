import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * SENSO se publica bajo /senso (https://www.leysillapro.com/senso).
 * Todas las rutas y recursos son relativos a BASE; para otra ruta usar SENSO_BASE=/otra/.
 */
const BASE = process.env.SENSO_BASE ?? "/senso/";

export default defineConfig({
  base: BASE,
  build: {
    outDir: `dist${BASE.replace(/\/$/, "")}`,
    emptyOutDir: true,
    sourcemap: false,
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      manifestFilename: "manifest.webmanifest",
      includeAssets: ["icons/*.svg", "icons/*.png", "robots.txt"],
      manifest: {
        id: BASE,
        name: "SENSO — Reporte y Monitoreo de Emergencias",
        short_name: "SENSO",
        description: "Reporta afectaciones durante emergencias, aun sin conexión.",
        lang: "es-MX",
        dir: "ltr",
        start_url: `${BASE}app`,
        scope: BASE,
        display: "standalone",
        orientation: "portrait",
        background_color: "#06132a",
        theme_color: "#06132a",
        categories: ["utilities", "navigation"],
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [{ name: "Nuevo reporte", short_name: "Reportar", url: `${BASE}app/nuevo`, icons: [{ src: "icons/icon-192.png", sizes: "192x192" }] }],
      },
      workbox: {
        // Toda la app queda precacheada: abre, captura y consulta sin red.
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        globIgnores: ["og-image.png"],
        navigateFallback: `${BASE}index.html`,
        // La API nunca se sirve desde caché: la cola offline vive en IndexedDB.
        navigateFallbackDenylist: [/\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    proxy: { [`${BASE}api`]: { target: "http://localhost:8787", changeOrigin: false } },
  },
});
