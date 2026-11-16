import { z } from 'zod';
import { getDb } from './firebase.js';

// Helpers compartidos por las herramientas de escritura.
// Los campos y valores replican lo que guarda la app web (src/views y src/utils del repo).

// Quién figura como `usuario` en los registros creados desde Claude
export const USUARIO = process.env.MCP_USUARIO || 'claude-mcp';

export const ahora = () => new Date().toISOString();

// Fecha de hoy YYYY-MM-DD en hora de Argentina (Cloud Run corre en UTC)
export const hoyStr = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });

export const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD');
export const mesSchema = z.string().regex(/^\d{4}-\d{2}$/, 'Formato YYYY-MM');
export const montoSchema = z.number().positive();

// Medios de pago de egresos (utils/helpers.js → MEDIO_PAGO). Queda afuera 'a_pagar':
// esos egresos van atados a una cuenta corriente que se arma desde la app.
export const MEDIOS_PAGO = ['banco', 'efectivo', 'caja_chica', 'avealma', 'getnet', 'canje'];

// Igual que DEFAULT_CATS de la app. Las categorías nuevas se guardan en la colección `categorias`.
export const DEFAULT_CATS = [
  { id: 'alquiler', nombre: 'Alquiler' },
  { id: 'insumos', nombre: 'Insumos' },
  { id: 'produccion-tercerizada', nombre: 'Producción tercerizada' },
  { id: 'credito', nombre: 'Crédito' },
  { id: 'sueldos', nombre: 'Sueldos' },
  { id: 'marketing', nombre: 'Marketing' },
  { id: 'impuestos', nombre: 'Impuestos' },
  { id: 'maquinaria', nombre: 'Maquinaria' },
  { id: 'suscripciones', nombre: 'Suscripciones' },
  { id: 'varios', nombre: 'Varios' },
];

export async function getCategorias() {
  const snap = await getDb().collection('categorias').get();
  const extra = snap.docs
    .filter(d => !DEFAULT_CATS.some(c => c.id === d.id))
    .map(d => ({ id: d.id, nombre: d.data().nombre || d.id }));
  return [...DEFAULT_CATS, ...extra];
}

// Acepta el id o el nombre de la categoría y devuelve el id que guarda la app
export async function resolverCategoria(valor) {
  const cats = await getCategorias();
  const v = String(valor).trim().toLowerCase();
  const cat = cats.find(c => c.id.toLowerCase() === v || c.nombre.toLowerCase() === v);
  if (!cat) {
    throw new Error(`Categoría "${valor}" no existe. Opciones: ${cats.map(c => c.id).join(', ')}`);
  }
  return cat.id;
}

// Trae un documento o falla con un mensaje claro
export async function getDocOrFail(coleccion, id) {
  const ref = getDb().collection(coleccion).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`No existe el registro ${id} en ${coleccion}`);
  return { ref, data: snap.data() };
}

// Saca las claves undefined (Firestore no las acepta y en un update significan "no tocar")
export const sinUndefined = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

export const respuesta = (obj) => ({
  content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }],
});

// Envuelve el handler para que los errores lleguen a Claude como texto y no como un 500
export const conErrores = (fn) => async (args) => {
  try {
    return await fn(args);
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
};

// Anotaciones MCP: Claude las usa para decidir cuándo pedir confirmación
export const LECTURA = { readOnlyHint: true, openWorldHint: false };
export const ESCRITURA = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
// Editar o borrar pisa datos existentes
export const MODIFICA = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
