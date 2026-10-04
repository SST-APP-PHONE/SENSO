// Genera los PNG de iconos y la imagen Open Graph a partir de los SVG (usa Chromium de Playwright).
import { chromium } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const icons = path.join(root, "public", "icons");
const mark = readFileSync(path.join(icons, "senso-mark.svg"), "utf8");
const maskable = readFileSync(path.join(icons, "senso-maskable.svg"), "utf8");
const exe = process.env.CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();

async function render(svg, size, file, bg = "transparent") {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:${bg}">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: path.join(icons, file), omitBackground: bg === "transparent" });
}
await render(mark, 32, "favicon-32.png");
await render(mark, 192, "icon-192.png");
await render(mark, 512, "icon-512.png");
await render(maskable, 512, "icon-maskable-512.png");
await render(maskable, 180, "apple-touch-icon.png", "#0a1f3d");

await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<html><body style="margin:0;width:1200px;height:630px;background:#06132a;color:#fff;font-family:system-ui,sans-serif;display:flex;align-items:center;gap:56px;padding:0 90px;box-sizing:border-box">
  ${mark.replace("<svg ", '<svg width="260" height="260" ')}
  <div><div style="font-size:30px;letter-spacing:.3em;color:#4b9bff;font-weight:800">SENSO</div>
  <div style="font-size:72px;font-weight:900;line-height:1.05;margin-top:12px">Reporta.<br><span style="color:#4b9bff">Aún sin conexión.</span></div>
  <div style="font-size:28px;margin-top:22px;opacity:.85">Sistema de Reporte y Monitoreo de Emergencias</div></div></body></html>`);
await page.screenshot({ path: path.join(root, "public", "og-image.png") });
await browser.close();
console.log("Iconos generados en public/icons y public/og-image.png");
