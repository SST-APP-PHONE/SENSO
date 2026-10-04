import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { closeDb, getDb } from "../server/db/client.js";
import { getOrCreateDefaultEvent } from "../server/services/events.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const db = getDb();
await migrate(db, { migrationsFolder: path.join(root, "drizzle") });
const id = await getOrCreateDefaultEvent(db);
console.log(`Migraciones aplicadas. Evento por defecto: #${id}`);
await closeDb();
