import { createApp } from "../server/app.js";
import { getDb } from "../server/db/client.js";
import { loadConfig } from "../server/lib/config.js";

/**
 * Función serverless de Vercel. vercel.json reescribe /senso/api/* y /api/* hacia aquí;
 * los archivos estáticos los sirve la CDN de Vercel desde dist/.
 */
export default createApp({ db: getDb(), config: loadConfig() });
