import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDb } from "./db/client.js";
import { createApp } from "./app.js";
import { loadConfig } from "./lib/config.js";

/** Servidor local / autoalojado. En Vercel se usa api/index.ts. */
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = loadConfig();
const dbState = resolveDb();
if (!dbState.configured) console.warn(`[senso] ${dbState.reason}: la API arranca sin base de datos`);
if (!config.adminConfigured) console.warn("[senso] ADMIN_SECRET no configurado: centro de monitoreo deshabilitado");
const app = createApp({ db: dbState.db, config, staticDir: path.join(root, "dist", "senso") });
const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`SENSO API escuchando en http://localhost:${port}/senso/`));
