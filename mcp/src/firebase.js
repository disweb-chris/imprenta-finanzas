import admin from 'firebase-admin';

let db = null;

export function getDb() {
  if (db) return db;

  if (!admin.apps.length) {
    const config = {
      projectId: process.env.FIREBASE_PROJECT_ID || 'imprenta-online-finanzas',
    };

    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      // Desarrollo local: credenciales JSON como variable de entorno
      config.credential = admin.credential.cert(
        JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      );
    } else {
      // Cloud Run: usa Application Default Credentials automáticamente
      // El service account del Cloud Run service necesita rol "Cloud Datastore User"
      config.credential = admin.credential.applicationDefault();
    }

    admin.initializeApp(config);
    console.log('[Firebase] Inicializado, proyecto:', config.projectId);
  }

  db = admin.firestore();
  return db;
}

/**
 * Dado un mes "YYYY-MM", devuelve el rango de fechas como strings "YYYY-MM-DD"
 * para usar en queries de Firestore (campo `fecha`)
 */
export function getMesRange(mes) {
  const [year, month] = mes.split('-').map(Number);
  const from = `${mes}-01`;
  const lastDay = new Date(year, month, 0).getDate(); // día 0 del mes siguiente = último día del mes
  const to = `${mes}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

/**
 * Devuelve el mes actual como "YYYY-MM" usando hora local (no UTC)
 */
export function getMesActual() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Carga el mapa id → nombre de la colección `categorias`
 */
export async function getCatMap() {
  const db = getDb();
  const snap = await db.collection('categorias').get();
  const map = {};
  snap.forEach(d => { map[d.id] = d.data().nombre || d.id; });
  return map;
}
