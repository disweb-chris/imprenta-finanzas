# MCP Finanzas — Imprenta Online

Servidor MCP que deja a Claude leer y cargar datos de la app de finanzas (Firestore).
Corre en Cloud Run, servicio `mcp-finanzas` del proyecto `imprenta-online-finanzas`.

Las escrituras guardan los mismos campos que la app web, así que lo que carga Claude
se ve igual en la app. En el campo `usuario` queda `MCP_USUARIO` (por defecto `claude-mcp`).

## Herramientas

| Lectura | Escritura |
|---|---|
| `resumen_mensual` | |
| `listar_egresos` | `crear_egreso`, `editar_egreso`, `eliminar_egreso` |
| `listar_compromisos` | `crear_compromiso`, `editar_compromiso`, `eliminar_compromiso`, `registrar_pago_compromiso` |
| `listar_ingresos_extra` | `crear_ingreso_extra`, `editar_ingreso_extra`, `eliminar_ingreso_extra` |
| `listar_presupuestos` | `guardar_presupuesto`, `eliminar_presupuesto` |
| `listar_pagos_variables` | `cargar_pago_variable` |
| `listar_cierres_caja` | — (el cierre se hace en la app: el arqueo necesita los cobros de WooCommerce) |
| `listar_liquidaciones` | — (la liquidación se arma pedido por pedido en la app) |
| `listar_categorias` | |

`registrar_pago_compromiso` hace lo mismo que el botón "Pagar" de Compromisos: crea el egreso
y avanza el compromiso (cuotas, sueldos con pagos parciales, recurrentes).

## Firebase o IO Finanzas

Con estas dos variables en el servicio, todas las herramientas hablan con IO Finanzas
(WordPress) en vez de Firebase. Sin ellas, sigue todo como antes. Las herramientas se llaman
igual; se suma `listar_cuentas`.

| Variable | Qué es |
|---|---|
| `IO_FINANZAS_URL` | La dirección del sitio |
| `IO_FINANZAS_CLAVE` | Una clave de alcance **completo** de Finanzas → Ajustes → Conexiones |

```bash
gcloud run services update mcp-finanzas --project imprenta-online-finanzas --region us-central1 \
  --update-env-vars IO_FINANZAS_URL=https://imprentaonline.ar,IO_FINANZAS_CLAVE=<LA_CLAVE>
```

Para volver a Firebase: `--remove-env-vars IO_FINANZAS_URL,IO_FINANZAS_CLAVE`.

En IO Finanzas, "eliminar" no borra: un gasto o un ingreso queda anulado y un compromiso, finalizado.

## Seguridad

El servidor escribe en Firestore, así que **no arranca sin `MCP_ACCESS_TOKEN`**.
El token va en la URL del conector (`/t/<token>/mcp`) porque claude.ai no deja cargar headers;
también acepta `Authorization: Bearer <token>`. Quien tenga la URL completa puede leer y
escribir: no la compartas ni la subas al repo (el repo es público).

Para cortar el acceso, cambiá el token (paso 3) y volvé a cargar el conector.

## Deploy en Cloud Run

Todos los comandos se corren desde la carpeta `mcp/`.

### 1. Permiso de escritura en Firestore

El service account tenía solo lectura (`roles/datastore.viewer`). Para escribir necesita
`roles/datastore.user`:

```bash
gcloud projects add-iam-policy-binding imprenta-online-finanzas \
  --member="serviceAccount:mcp-finanzas@imprenta-online-finanzas.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
```

### 2. Guardar el token en Secret Manager (solo la primera vez)

```bash
openssl rand -hex 32 | tr -d '\n' | gcloud secrets create mcp-access-token \
  --project imprenta-online-finanzas --data-file=-

gcloud secrets add-iam-policy-binding mcp-access-token \
  --project imprenta-online-finanzas \
  --member="serviceAccount:mcp-finanzas@imprenta-online-finanzas.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 3. Cambiar el token (cuando haga falta)

```bash
openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add mcp-access-token \
  --project imprenta-online-finanzas --data-file=-
```

Después hay que volver a deployar (paso 4) y actualizar la URL del conector.

### 4. Deploy

Las variables de WooCommerce ya están cargadas en el servicio y se mantienen.

```bash
gcloud run deploy mcp-finanzas \
  --source . \
  --project imprenta-online-finanzas \
  --region us-central1 \
  --service-account mcp-finanzas@imprenta-online-finanzas.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --timeout 3600 \
  --update-secrets MCP_ACCESS_TOKEN=mcp-access-token:latest
```

`--allow-unauthenticated` es para que claude.ai llegue al servicio; el que controla el acceso
es el token.

### 5. Conectar en Claude

```bash
gcloud secrets versions access latest --secret mcp-access-token --project imprenta-online-finanzas
```

En claude.ai → Settings → Connectors, editá (o creá) el conector "MCP Finanzas" con la URL:

```
https://mcp-finanzas-919246442188.us-central1.run.app/t/<TOKEN>/mcp
```

La URL vieja (`/sse` sin token) deja de funcionar con este deploy. Si un cliente solo soporta
SSE, usá `/t/<TOKEN>/sse`.

Para que otra persona lo use desde su cuenta de Claude, pasale la URL completa por un canal
privado. Si en algún momento deja de tener acceso, cambiá el token.

## Desarrollo local

```bash
npm install
cp .env.example .env   # completar MCP_ACCESS_TOKEN y FIREBASE_SERVICE_ACCOUNT
node --env-file=.env src/index.js
```

Ojo: en local escribe sobre la base real de producción.
