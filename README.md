# SENSO

**Sistema de Reporte y Monitoreo de Emergencias** — *Reporta. Aún sin conexión.*

SENSO es una aplicación web progresiva (PWA) **offline-first** para que ciudadanos, trabajadores,
brigadistas y personal de apoyo reporten afectaciones durante huracanes, sismos, inundaciones,
incendios, derrumbes, daños estructurales y fallas de servicios (luz, agua, telefonía, internet, gas…).

La característica principal: **se pueden crear, consultar y actualizar reportes sin internet ni red
telefónica**. Los reportes se guardan en el dispositivo (IndexedDB) y se sincronizan automáticamente,
sin duplicados, cuando vuelve la conexión. Un centro de monitoreo con mapa de calor muestra dónde se
concentran las afectaciones y su evolución hasta el restablecimiento.

Publicación prevista: `https://www.leysillapro.com/senso` · Desarrollado por LeySillaPro.

---

## Contenido

1. [Arquitectura](#arquitectura)
2. [Estructura del proyecto](#estructura-del-proyecto)
3. [Funcionamiento offline](#funcionamiento-offline)
4. [Sincronización](#sincronización)
5. [GPS](#gps)
6. [Base de datos](#base-de-datos)
7. [Variables de entorno](#variables-de-entorno)
8. [Desarrollo local](#desarrollo-local)
9. [Administración](#administración)
10. [Pruebas](#pruebas)
11. [Deploy](#deploy)
12. [Seguridad y privacidad](#seguridad-y-privacidad)
13. [Pendiente / fuera del MVP](#pendiente--fuera-del-mvp)

---

## Arquitectura

| Capa | Tecnología |
|---|---|
| Frontend | React 19 · Vite · TypeScript · Tailwind CSS 4 · React Router |
| PWA | `vite-plugin-pwa` (Workbox, `generateSW`), Web App Manifest, iconos maskable |
| Almacenamiento local | IndexedDB (`idb`) — reportes, historial, **cola de operaciones**, catálogos, configuración |
| Backend | Node.js · Express 5 · TypeScript |
| Validación | Zod (contrato compartido cliente/servidor en `shared/`) |
| Base de datos | MySQL 8 (compatible MariaDB 10.11) · Drizzle ORM · migraciones SQL versionadas |
| Mapas | Leaflet + leaflet.heat · teselas OpenStreetMap (solo centro de monitoreo) |
| Hosting | Vercel (estáticos en CDN + función serverless Express) |

```
 Dispositivo (PWA)                                   Servidor
┌───────────────────────────────┐                 ┌──────────────────────────┐
│ UI React  ──►  storage/        │                 │ Express  /senso/api      │
│                (IndexedDB)     │  POST /sync     │  ├─ validación (Zod)     │
│  reports · updates · outbox ───┼───────────────► │  ├─ idempotencia         │
│                ▲               │  lotes ≤ 50     │  │  (clientOperationId)  │
│  sync/engine ──┘ reintentos,   │ ◄───────────────┤  └─ MySQL (Drizzle)      │
│  backoff, bloqueo entre tabs   │  APPLIED /      │ Centro de monitoreo      │
│ Service worker: app en caché   │  DUPLICATE /    │  (auth, KPIs, mapa, CSV) │
└───────────────────────────────┘  ERROR          └──────────────────────────┘
```

## Estructura del proyecto

```
senso/
├─ shared/            Catálogos (categorías, estados, eventos) y esquemas Zod — usados por cliente y servidor
├─ src/               Frontend
│  ├─ components/     UI reutilizable (ConnectionStatus, InstallPrompt, botones, consentimiento)
│  ├─ pages/          Landing, Inicio, Nuevo reporte, Mis reportes, Detalle/historial, Cómo funciona, Privacidad
│  ├─ admin/          Centro de monitoreo (se carga aparte: lazy chunk)
│  ├─ offline/        Apertura/esquema de IndexedDB, almacenamiento persistente
│  ├─ storage/        Repositorio local: crear reporte/actualización (transacción atómica con la cola)
│  ├─ sync/           Motor de sincronización (cola FIFO, backoff, idempotencia, alcance del servidor)
│  ├─ gps/            Geolocalización (mejor lectura, baja precisión, errores, reintento)
│  ├─ maps/           Mapa de calor y puntos (Leaflet)
│  ├─ api/            Cliente HTTP (rutas relativas a la base /senso)
│  ├─ types/          Modelos locales
│  └─ utils/          UUID, folio provisional, formatos
├─ server/            Backend Express
│  ├─ db/             Esquema Drizzle y conexión MySQL
│  ├─ routes/         Rutas públicas (/sync, /catalog, /health) y admin
│  ├─ services/       Sincronización idempotente, eventos, consultas de monitoreo/CSV
│  ├─ middleware/     Autenticación, CSRF, errores
│  └─ lib/            Configuración, contraseñas (scrypt), sesiones firmadas, privacidad, zona horaria
├─ api/index.ts       Entrada serverless para Vercel
├─ drizzle/           Migraciones SQL generadas
├─ scripts/           migrate, create-admin, generate-icons, verify-pwa
├─ public/            Iconos, robots.txt, sitemap.xml, imagen Open Graph
└─ tests/             unit (IndexedDB/sync/GPS) · server (MySQL real) · e2e (Playwright)
```

## Funcionamiento offline

Es la parte central del proyecto. No se trata de ocultar errores de red: existe almacenamiento
local, cola de operaciones, reintentos, sincronización idempotente y recuperación tras cerrar la app.

1. **La app abre sin red.** El service worker precachea HTML, JS, CSS, iconos y manifest. Todas las
   rutas (`/senso/app/*`) se sirven desde caché sin conexión. *Requisito:* abrir SENSO **una vez con
   internet** (o instalarla) para que el service worker quede instalado.
2. **Captura local primero.** Al guardar, el reporte y su operación de sincronización se escriben en
   **una sola transacción de IndexedDB** (`storage/reports.ts`): o se guardan ambos o ninguno. No hay
   ninguna llamada de red en la captura.
3. **Persistencia.** IndexedDB sobrevive a cerrar la pestaña, cerrar el navegador y reiniciar el
   teléfono. Se solicita `navigator.storage.persist()` para que el navegador no la borre bajo presión
   de espacio.
4. **Detección real de conectividad.** `navigator.onLine` no basta (puede ser `true` con una red sin
   salida a internet). El motor considera "en línea" solo si el **servidor responde**; si no, la barra
   muestra 🔴 *Sin conexión* y la cola se queda intacta.
5. **Catálogos offline.** Las categorías viajan empaquetadas en la app; los eventos activos se
   descargan del servidor y se guardan en IndexedDB para asociar reportes sin conexión.

Stores de IndexedDB (`senso`): `reports`, `updates`, `outbox` (cola), `meta` (deviceId, catálogo,
consentimiento, secuencia, última sincronización). `localStorage` solo se usa para recordar si se
cerró la invitación de instalación.

## Sincronización

- **Disparadores:** arranque de la app, evento `online`, volver a la pestaña, verificación periódica
  (15 s si el servidor no responde, 30 s si hay pendientes, 2 min en reposo) y botón
  **SINCRONIZAR AHORA**.
- **Orden:** FIFO por secuencia monótona. Una actualización solo se envía si su reporte ya está
  confirmado o viaja antes en el mismo lote.
- **Idempotencia:** cada operación lleva un `clientOperationId` (UUID). El servidor guarda en
  `sync_operations` el id y un hash SHA-256 del contenido:
  - primera vez → `APPLIED`;
  - reenvío idéntico → `DUPLICATE` con los mismos datos (folio, id) — **nunca crea otro registro**;
  - mismo id con contenido distinto → `OPERATION_CONFLICT` (no sobrescribe).
  Las carreras (dos peticiones simultáneas) se resuelven con claves únicas en MySQL y reintento
  automático ante deadlocks de InnoDB.
- **Estados locales:** `PENDING → SYNCING → SYNCED` o `FAILED`. **Solo se marca `SYNCED` lo que el
  servidor confirmó** (`APPLIED`/`DUPLICATE`); al confirmarse la operación se elimina de la cola.
- **Fallos:** error de red o respuesta inválida → `FAILED` con reintento automático y espera
  exponencial (5 s, 10 s, 20 s… máx. 10 min). Errores permanentes (validación) no se reintentan
  solos, pero el botón *Sincronizar ahora* los fuerza.
- **Recuperación:** operaciones que quedaron en `SYNCING` al cerrar la app vuelven a `PENDING` al
  abrirla (reenviarlas es seguro por la idempotencia).
- **Varias pestañas:** Web Locks API evita que dos pestañas sincronicen a la vez.
- **Folios:** sin conexión se genera un folio provisional legible (`SENSO-2026-P-7K3QXM`); el
  servidor asigna el folio oficial consecutivo por año (`SENSO-2026-000001`) al sincronizar.

> Limitación conocida: no se usa Background Sync (no existe en iOS/Safari). La sincronización ocurre
> mientras la app está abierta o al volver a abrirla.

## GPS

- `navigator.geolocation.watchPosition` con alta precisión: **no requiere internet** (usa el GPS).
- La búsqueda empieza al abrir el flujo de reporte, mientras la persona elige la categoría.
- Conserva la **mejor lectura**; se detiene al lograr ≤ 30 m o al agotar 20 s.
- Lecturas > 100 m se marcan como *Ubicación aproximada* (con botón *Mejorar ubicación*).
- Sin permiso / sin señal / tiempo agotado → *"No fue posible obtener la ubicación."* con
  *Reintentar ubicación* y, como excepción, *Guardar sin ubicación*. **Nunca se pierde un reporte por
  fallo de GPS.**
- Se guardan latitud, longitud (6 decimales), precisión y fecha/hora de captura. El mapa **no** es
  requisito para reportar.
- En actualizaciones (restablecimiento) la ubicación actual se intenta por 10 s y es opcional.

## Base de datos

MySQL 8 / MariaDB 10.11, fechas en UTC (`DATETIME(3)`). Migración: `drizzle/0000_init.sql`.

| Tabla | Propósito |
|---|---|
| `events` | Eventos/emergencias (tipo, nombre, activo). `system_key = 'GENERAL'` = "Emergencia general" |
| `users` | Dispositivos que reportan, **solo** con un UUID anónimo y plataforma (sin datos personales) |
| `reports` | Reporte: folio, evento, categoría, estado inicial/actual, nivel, comentario, municipio, GPS, hora de captura, conectividad al reportar |
| `report_updates` | Historial (restablecido/intermitente/no restablecido) con hora y ubicación opcional |
| `sync_operations` | Registro de idempotencia (`client_operation_id` único + hash) |
| `folio_counters` | Consecutivo de folios por año |
| `admin_users` | Cuentas del centro de monitoreo (scrypt, rol, bloqueo por intentos) |
| `audit_log` | Accesos, exportaciones y cambios de eventos (IP truncada) |

Índices: fecha (`created_at_client`), evento+fecha, categoría, estado, `(latitude, longitude)`,
municipio, usuario; únicos en folio, `client_report_id`, `client_operation_id`.

Asignación de evento: el solicitado por el dispositivo si existe; si no, el único evento activo; si
hay varios o ninguno, "Emergencia general".

Preparado para crecer: evidencias fotográficas se agregarían como store `evidence` en IndexedDB,
operación de cola `UPLOAD_EVIDENCE` y tabla `report_evidence` (no implementado en el MVP).

## Variables de entorno

Ver `.env.example`. **Nunca subir `.env`** (está en `.gitignore`).

| Variable | Uso |
|---|---|
| `DATABASE_URL` | `mysql://usuario:contraseña@host:3306/senso` (solo servidor) |
| `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE` | Alternativa a `DATABASE_URL` (p. ej. TiDB Cloud). Solo se usan si `DATABASE_URL` **no** existe; conectan siempre con TLS verificando el certificado. `DB_PORT` por defecto 4000 |
| `ADMIN_SECRET` | Secreto ≥ 32 caracteres para firmar sesiones admin. Obligatorio en producción |
| `APP_TIMEZONE` | Zona para "Reportes hoy" (por defecto `America/Mexico_City`) |
| `CORS_ALLOWED_ORIGINS` | Orígenes extra permitidos (coma). Vacío = mismo origen |
| `PORT` | Puerto del servidor local (8787) |
| `DB_POOL_SIZE` | Conexiones por instancia (5) |
| `SENSO_BASE` | Ruta base del build (por defecto `/senso/`) |
| `TEST_DATABASE_URL` | BD para pruebas de servidor (su nombre debe contener `test`; se borra) |
| `E2E_DATABASE_URL` | BD para pruebas E2E (por defecto `senso_e2e_test`) |

Ninguna variable se expone al frontend (no hay variables `VITE_*`).

**Arranque sin configuración.** La API nunca falla al iniciar por falta de variables:

- Sin `DATABASE_URL` (o inválida): `/senso/api/health` responde `200 {"ok":true,"db":false,"dbConfigured":false}`
  y el resto de la API responde `503` con un mensaje claro. La app sigue funcionando sin conexión y la cola
  queda pendiente hasta que el servidor tenga base de datos.
- Sin `ADMIN_SECRET` válido en producción: la API pública funciona; el centro de monitoreo responde `503`
  (`"adminConfigured": false` en `/health`). Nunca se usa el secreto de desarrollo en producción.
- `/health` nunca expone valores de configuración; solo indica si están presentes y si la BD responde.

## Desarrollo local

Requisitos: Node 20+ (probado en 22), MySQL 8 o MariaDB 10.11.

```bash
npm ci
cp .env.example .env          # completar DATABASE_URL y ADMIN_SECRET
npm run db:migrate            # crea tablas y el evento "Emergencia general"
SENSO_ADMIN_PASSWORD='…' npm run admin:create -- --email tu@correo --name "Tu nombre" --role ADMIN

# Opción A: servidor de desarrollo con recarga
npm run dev:api               # API en :8787
npm run dev                   # Vite en :5173/senso/ (proxy de /senso/api)

# Opción B: igual que producción (build + Express sirviendo /senso)
npm run build && npm start    # http://localhost:8787/senso/
```

Rutas: `/senso/` (landing pública) · `/senso/app` (app) · `/senso/admin` (centro de monitoreo).
Todas las rutas y recursos son relativos a la base `/senso/`; nada asume la raíz del dominio. El service worker
tiene alcance `/senso/` y la cookie de administración `Path=/senso`, de modo que SENSO puede convivir en el mismo
dominio que LeySillaPro sin interceptar ni recibir tráfico del resto del sitio.

## Administración

- `/senso/admin` requiere usuario creado con `npm run admin:create` (la contraseña se toma de
  `SENSO_ADMIN_PASSWORD`, mínimo 12 caracteres, para no dejarla en el historial del shell).
- Roles: **ADMIN** (crea/activa eventos, exporta CSV) y **VIEWER** (consulta).
- Centro de monitoreo: KPIs (totales, hoy, pendientes sin restablecer, servicios afectados,
  restablecidos), mapa de calor ponderado por nivel de afectación, mapa de puntos (folio, servicio,
  estado, fecha), estadísticas por tipo y estado, tabla con detalle e historial, exportación CSV.
- Filtros: evento, categoría, servicio/daño, estado, periodo (24 h / 7 / 30 días / personalizado),
  municipio/zona, conectividad al reportar y **zona visible del mapa**.
- Eventos: crear (tipo + nombre, p. ej. *Huracán · Polo 2026*) y activar/desactivar. Los eventos
  activos se descargan a los dispositivos.
- Exportación preparada para Excel/PDF: el CSV (UTF-8 con BOM, abre en Excel) está implementado.

## Pruebas

```bash
npm run lint          # ESLint
npm run typecheck     # TypeScript (frontend y backend)
npm run test:unit     # Vitest + fake-indexeddb: almacenamiento, cola, sincronización, GPS
npm run test:server   # Vitest + supertest contra MySQL real (TEST_DATABASE_URL)
npm run test:e2e      # Playwright (Chromium): PWA, offline, GPS, responsivo, flujo MVP completo
npm run verify        # todo lo anterior + build + verificación PWA
```

Escenarios cubiertos (obligatorios del proyecto):

| Escenario | Dónde |
|---|---|
| A con conexión · B sin conexión · C crear sin conexión | unit `sync-engine`, `offline-storage`; e2e `mvp-flow` |
| D cerrar navegador · E reabrir · F ver reporte | e2e `mvp-flow` (perfil persistente cerrado y relanzado sin red) |
| G recuperar conexión · H sincronizar | unit + e2e (detección automática, también cuando `navigator.onLine` miente) |
| I falla de sincronización · J reintento | unit (backoff/forzado) + e2e (servidor que falla → FAILED → *Sincronizar ahora*) |
| K evitar duplicados | unit (respuesta perdida), server (reenvío, 8 peticiones concurrentes, conflicto), e2e |
| L actualizar offline · M sincronizar actualización | unit + server (desorden, antes del reporte) + e2e |
| GPS disponible / no disponible / baja precisión / recuperado | unit `gps` + e2e `gps` |
| 390, 430, 768, 1024, 1366 px; Android; iPhone; desktop | e2e `responsive` (sin scroll horizontal, controles ≥ 40 px, barra visible) |
| Seguridad: validación, sanitización, auth, roles, CSRF, rate limit, CSV injection, IP truncada | server `admin`, `sync`, `unit-lib` |

Notas honestas sobre las pruebas:
- "iPhone" se emula sobre Chromium (viewport, user agent, táctil). No se ejecutó WebKit/Safari real.
- MariaDB 10.11 se usó localmente; el CI usa MySQL 8.4.

## Deploy

### Vercel (proyecto propio de SENSO)

1. Crear proyecto en Vercel desde este repositorio (framework: *Other*; `vercel.json` ya define
   build, salida `dist`, función `api/index.ts`, reescrituras y cabeceras).
2. Variables de entorno: `DATABASE_URL`, `ADMIN_SECRET`, `APP_TIMEZONE`.
3. MySQL administrado accesible desde Vercel (PlanetScale, AWS RDS, DigitalOcean, etc.).
4. Ejecutar migraciones desde una máquina con acceso a la BD: `npm run db:migrate`.
5. Crear el primer administrador: `npm run admin:create`.

Rutas resultantes: `https://<proyecto>.vercel.app/senso/` y `/senso/api/*`.

### Publicación en `https://www.leysillapro.com/senso`

En el proyecto de LeySillaPro agregar una reescritura hacia el despliegue de SENSO (sin modificar
el código de LeySillaPro más allá de su configuración de rutas):

```json
{ "rewrites": [ { "source": "/senso/:path*", "destination": "https://<proyecto-senso>.vercel.app/senso/:path*" } ] }
```

y añadir al `robots.txt` raíz del dominio las reglas de `public/robots.txt`
(`Disallow: /senso/admin`, `Disallow: /senso/api/`, `Sitemap: …/senso/sitemap.xml`).

> El despliegue en Vercel **no se ha ejecutado** todavía (no hay credenciales en este entorno).
> La configuración está lista, pero debe validarse en el primer despliegue.

## Seguridad y privacidad

- Todo dato del cliente se valida en servidor (Zod): tipos, rangos de coordenadas, catálogos,
  longitudes, fechas futuras; texto sin caracteres de control.
- Consultas parametrizadas (Drizzle); filtros validados; `LIKE` con comodines escapados.
- Rate limiting: `/sync` 60/min, lectura 300/min, login 20/15 min por IP (en Vercel el contador es
  por instancia; para límites globales usar un almacén compartido, p. ej. Redis).
- Admin: contraseñas scrypt, bloqueo 15 min tras 5 intentos, sesión firmada HMAC en cookie
  `HttpOnly; SameSite=Strict; Secure` (producción) con `Path=/senso` (no viaja al resto de www.leysillapro.com) de 8 h, verificada contra la BD en cada
  petición; cabecera anti-CSRF `X-Senso-Request` en peticiones que modifican.
- Cabeceras: Helmet/CSP estricta, `X-Robots-Tag: noindex` en API y admin, sin `X-Powered-By`.
- Errores sin trazas ni detalles internos hacia el cliente.
- CSV con neutralización de inyección de fórmulas.
- Privacidad: sin nombre/teléfono/correo; identificador de dispositivo anónimo; **no se guarda la
  IP** de quien reporta (solo se usa en memoria para rate limiting); el `audit_log` guarda la IP
  truncada (/24, /48). Aviso de privacidad en `/senso/privacidad` y consentimiento antes del primer
  reporte, explicando el uso de la ubicación.

## Pendiente / fuera del MVP

No implementado deliberadamente: fotografías (arquitectura preparada), videollamadas, chat,
llamadas SOS, integración con 911, SMS, WhatsApp, reconocimiento de imágenes, IA, notificaciones
masivas, exportación Excel/PDF (estructura lista; CSV implementado), Background Sync.
