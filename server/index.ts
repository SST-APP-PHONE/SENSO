import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./db/client.js";
import { createApp } from "./app.js";
import { loadConfig } from "./lib/config.js";

/** Servidor local / autoalojado. En Vercel se usa api/index.ts. */
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = loadConfig();
const app = createApp({ db: getDb(), config, staticDir: path.join(root, "dist", "senso") });
const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`SENSO API escuchando en http://localhost:${port}/senso/`));
