# Imprenta Online — Finanzas

App interna de gestión financiera para Imprenta Online.

## Stack
- React + Vite
- Firebase (Firestore + Auth)
- WooCommerce REST API

## Setup local

```bash
npm install
npm run dev
```

## Deploy a Hostinger

```bash
npm run build
# Subir carpeta dist/ a public_html/finanzas/
```

## Estructura
- `src/views/` — Vistas principales
- `src/components/` — Sidebar, Toast
- `src/context/` — Auth, Categorías, Período
- `src/utils/` — WooCommerce API, helpers
- `src/firebase/` — Configuración Firebase
