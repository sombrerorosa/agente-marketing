# meta-ads-bigquery-sync

Sincroniza los insights de Meta Ads (Facebook/Instagram Ads) a BigQuery, para
poder armar un reporte en Looker Studio (Google Data Studio) con conector
nativo de BigQuery.

Dos piezas:

- **`src/worker.ts`** (Cloudflare Worker) — corre todos los días vía Cron
  Trigger y sincroniza el día anterior. Una vez desplegado, no requiere que
  nadie lo ejecute a mano.
- **`scripts/backfill.ts`** — script local que se corre **una sola vez** para
  cargar el histórico (todo lo que ya pasó) antes de que el cron empiece a
  cubrir el día a día.

Ambos comparten la misma lógica (`src/metaClient.ts`, `src/bigquery.ts`,
`src/sync.ts`) — nada se duplica.

Los datos quedan en una sola tabla a **nivel de anuncio** (`ad`), un registro
por anuncio por día. Es el nivel más fino que reporta Meta; los totales por
campaña/adset se calculan agregando en Looker Studio/BigQuery en vez de
guardarse aparte — así nunca se duplica el gasto al mirar distintos niveles.

## 1. Preparar BigQuery

1. En tu proyecto de GCP, habilitá la **BigQuery API** (APIs & Services →
   Library → BigQuery API → Enable).
2. Creá el dataset (BigQuery → Create dataset): nombre `meta_ads` (o el que
   prefieras, ajustando `BQ_DATASET` más abajo), región la que uses
   normalmente (ej. `us` o `southamerica-east1`).
3. Creá la tabla corriendo `sql/schema.sql` en el editor de queries de
   BigQuery, reemplazando `PROJECT_ID` por tu project id real.

## 2. Crear la Service Account

1. **IAM & Admin → Service Accounts → Create Service Account.** Nombre
   sugerido: `meta-ads-bigquery-sync`.
2. Asignale estos roles (a nivel proyecto, o a nivel dataset desde BigQuery
   → Sharing → Permissions si preferís acotarlo):
   - `BigQuery Data Editor` (para poder hacer DELETE/INSERT en la tabla)
   - `BigQuery Job User` (para poder correr los queries)
3. **Keys → Add Key → Create new key → JSON.** Se descarga un archivo
   `.json`. **No lo subas al repo** (el `.gitignore` de esta carpeta ya
   excluye `*.key.json`).
4. De ese JSON necesitás dos campos para el resto de la guía:
   - `client_email` → va en `GCP_CLIENT_EMAIL`
   - `private_key` → va en `GCP_PRIVATE_KEY` (ya viene con los `\n` como
     texto literal dentro del JSON, tal cual los necesitás)

## 3. Backfill histórico (una sola vez)

```bash
cd mcp-servers/meta-ads-bigquery-sync
npm install
cp .env.example .env
# completá .env: META_ACCESS_TOKEN / META_AD_ACCOUNT_ID (los mismos que
# meta-ads-mcp-server) + GCP_PROJECT_ID / GCP_CLIENT_EMAIL / GCP_PRIVATE_KEY

set -a; source .env; set +a

# 1) probá primero sin escribir nada en BigQuery, solo para validar que trae
#    datos de Meta:
npm run backfill -- --since 2023-01-01 --dry-run

# 2) corrida real (ajustá --since a cuándo arrancó la cuenta; si se omite,
#    toma los últimos 36 meses por defecto — Meta no guarda mucho más que eso):
npm run backfill -- --since 2023-01-01 --until 2026-08-28
```

Corre mes a mes (para no pasar los límites de una sola llamada a Meta ni de
BigQuery) y es re-corrible: si se corta a mitad de camino, volvés a
ejecutarlo con el mismo `--since` — cada mes hace `DELETE` + `INSERT` de ese
rango, así que no duplica nada.

## 4. Desplegar el Worker (sync diario)

Mismo mecanismo que `meta-ads-mcp-server` — conectar el repo desde el
dashboard de Cloudflare:

1. **dash.cloudflare.com → Workers & Pages → Create → Connect to Git.**
2. Repositorio: este mismo. **Root directory:**
   `mcp-servers/meta-ads-bigquery-sync`.
3. Wrangler se autodetecta, no hace falta build command.
4. Antes (o después) del primer deploy, en **Settings → Variables and
   Secrets**, agregá como **Secrets**:
   - `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`
   - `GCP_PROJECT_ID`, `GCP_CLIENT_EMAIL`, `GCP_PRIVATE_KEY`
   - opcional: `BQ_DATASET`, `BQ_TABLE` (si no usaste los nombres por
     defecto), `SYNC_SHARED_SECRET` (para proteger el endpoint manual)
5. Deploy. El cron (`0 6 * * *`, 06:00 UTC) queda activo solo — no hay que
   tocar nada más.

Para probarlo sin esperar al cron, pegale al endpoint manual:

```bash
curl -X POST "https://meta-ads-bigquery-sync.<tu-subdominio>.workers.dev/sync?date=2026-08-28" \
  -H "x-sync-secret: <SYNC_SHARED_SECRET si lo configuraste>"
```

## 5. Conectar Looker Studio

1. En [lookerstudio.google.com](https://lookerstudio.google.com), **Create →
   Data source → BigQuery**.
2. Elegí tu proyecto → dataset `meta_ads` → tabla `insights_daily`.
3. Conectá esa fuente a un reporte nuevo (o uno existente) y armá las
   visualizaciones: spend/impressions/clicks por día, ROAS por campaña,
   comparativos por adset, etc. Como todo vive a nivel `ad`, para ver
   totales por campaña alcanza con agregar (SUM/AVG) agrupando por
   `campaign_id`/`campaign_name` en el propio gráfico o campo calculado de
   Looker Studio.
4. La cuenta de Google con la que entrás a Looker Studio necesita permiso de
   lectura sobre el dataset (agregalo en BigQuery → dataset → Sharing →
   Permissions, rol `BigQuery Data Viewer`, si es una cuenta distinta a la
   que ya tiene acceso al proyecto).

## Notas

- **Costo:** BigQuery cobra por datos escaneados en queries y por
  almacenamiento; para el volumen de un reporte de ads (miles de filas por
  mes) esto entra cómodo en el free tier mensual (1 TB de queries, 10 GB de
  storage). El sync diario hace 2 statements por día (`DELETE` + `INSERT`),
  nada que se acerque a límites de cuota.
- **Nunca commitear credenciales reales** — ni el JSON de la Service
  Account, ni `META_ACCESS_TOKEN`, ni `.env`. Todo vive en Secrets de
  Cloudflare o en tu `.env` local (gitignored).
- Si el token de Meta expira o cambian permisos, el error se ve en los logs
  del Worker (Cloudflare dashboard → Worker → Logs) o en la respuesta del
  endpoint `/sync`.
