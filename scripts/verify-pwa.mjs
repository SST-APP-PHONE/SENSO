// Verificación estática del build PWA (dist/senso): manifest, service worker, precache y rutas bajo /senso.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const dir = path.resolve("dist/senso");
const errors = [];
const ok = (cond, msg) => (cond ? console.log(`  ✓ ${msg}`) : errors.push(msg));

console.log("Verificando PWA en", dir);
ok(existsSync(dir), "existe dist/senso");
const html = readFileSync(path.join(dir, "index.html"), "utf8");
const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.webmanifest"), "utf8"));
const sw = readFileSync(path.join(dir, "sw.js"), "utf8");

ok(manifest.display === "standalone", "manifest display: standalone");
ok(manifest.scope === "/senso/" && manifest.start_url.startsWith("/senso/"), "scope y start_url bajo /senso/");
ok(manifest.icons.some((i) => i.sizes === "192x192") && manifest.icons.some((i) => i.sizes === "512x512"), "iconos 192 y 512");
ok(manifest.icons.some((i) => i.purpose === "maskable"), "icono maskable");
for (const i of manifest.icons) ok(existsSync(path.join(dir, i.src)), `icono existe: ${i.src}`);
ok(/<link rel="manifest" href="\/senso\/manifest\.webmanifest"/.test(html), "index.html enlaza el manifest bajo /senso");
ok(!/(src|href)="\/(?!senso\/)/.test(html), "index.html sin rutas absolutas fuera de /senso");
ok(/<link rel="canonical"/.test(html) && /og:title/.test(html) && /name="description"/.test(html), "SEO: canonical, description y Open Graph");
ok(sw.includes('"index.html"') || sw.includes("index.html"), "service worker precachea index.html");
ok(sw.includes("/senso/index.html"), "navigateFallback a /senso/index.html");
const assets = readdirSync(path.join(dir, "assets")).filter((f) => f.endsWith(".js") || f.endsWith(".css"));
for (const a of assets) ok(sw.includes(`assets/${a}`), `precache incluye assets/${a}`);
ok(/api/.test(sw) && sw.includes("denylist"), "la API está excluida del fallback de navegación");
ok(existsSync(path.join(dir, "robots.txt")) && existsSync(path.join(dir, "sitemap.xml")), "robots.txt y sitemap.xml");

if (errors.length) {
  console.error("\n✗ Fallos de verificación PWA:\n - " + errors.join("\n - "));
  process.exit(1);
}
console.log("PWA verificada correctamente.");
