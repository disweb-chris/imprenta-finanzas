import { z } from 'zod';
import { getDb, getMesRange, getMesActual, getCatMap } from '../firebase.js';
import {
  USUARIO, ahora, hoyStr, fechaSchema, montoSchema, MEDIOS_PAGO, resolverCategoria,
  getDocOrFail, sinUndefined, respuesta, conErrores, ESCRITURA, MODIFICA,
} from '../comun.js';

export function registerEgresos(server) {
  server.tool(
    'listar_egresos',
    'Lista los gastos pagados (egresos) del negocio. Filtrá por mes y/o medio de pago. ' +
    'Medios de pago: banco, efectivo, caja_chica, avealma, getnet, canje (pagado con trabajo) ' +
    'y a_pagar (costo de una cuenta corriente con un proveedor, todavía sin pagar).',
    {
      mes: z.string().optional().describe(
        'Mes a consultar en formato YYYY-MM. Por defecto: mes actual.'
      ),
      medio_pago: z.string().optional().describe(
        'Filtrar por medio de pago (ej: "banco", "efectivo").'
      ),
      limit: z.number().int().min(1).max(200).optional().describe(
        'Cantidad máxima de registros. Por defecto: 100.'
      ),
    },
    async ({ mes, medio_pago, limit = 100 }) => {
      const db = getDb();
      const mesKey = mes || getMesActual();
      const { from, to } = getMesRange(mesKey);

      const [snap, catMap] = await Promise.all([
        db.collection('egresos')
          .where('fecha', '>=', from)
          .where('fecha', '<=', to)
          .orderBy('fecha', 'desc')
          .get(),
        getCatMap(),
      ]);

      let items = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          fecha: data.fecha,
          descripcion: data.descripcion || '',
          monto: data.monto || 0,
          medio_pago: data.medio_pago || '',
          categoria: catMap[data.categoria] || data.categoria || '',
          subcategoria: data.subcategoria || '',
        };
      });

      // Filtro client-side para evitar índice compuesto en Firestore
      if (medio_pago) {
        items = items.filter(e => e.medio_pago === medio_pago);
      }
      items = items.slice(0, limit);

      // Totales por medio de pago
      const porMedioPago = {};
      items.forEach(e => {
        const mp = e.medio_pago || 'sin_medio';
        porMedioPago[mp] = (porMedioPago[mp] || 0) + e.monto;
      });

      // Totales por categoría
      const porCategoria = {};
      items.forEach(e => {
        const cat = e.categoria || 'sin_categoria';
        porCategoria[cat] = (porCategoria[cat] || 0) + e.monto;
      });

      const total = items.reduce((s, e) => s + e.monto, 0);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            mes: mesKey,
            total_egresos: total,
            por_medio_pago: porMedioPago,
            por_categoria: porCategoria,
            cantidad: items.length,
            egresos: items,
          }, null, 2),
        }],
      };
    }
  );

  const camposEgreso = {
    fecha: fechaSchema.describe('Fecha del pago (YYYY-MM-DD).'),
    monto: montoSchema.describe('Monto en pesos.'),
    categoria: z.string().describe('Id o nombre de la categoría (ver listar_categorias).'),
    medio_pago: z.enum(MEDIOS_PAGO).describe(
      'De dónde salió la plata. "canje" = pagado con trabajo, no mueve caja.'
    ),
    descripcion: z.string().describe('Detalle del gasto.'),
    subcategoria: z.string().describe('Subcategoría o proveedor.'),
  };

  server.tool(
    'crear_egreso',
    'Registra un gasto pagado (egreso). Para pagar un compromiso (sueldo, cuota, servicio) ' +
    'usá registrar_pago_compromiso, que además avanza el próximo vencimiento.',
    {
      ...camposEgreso,
      fecha: camposEgreso.fecha.optional().describe('Fecha del pago (YYYY-MM-DD). Por defecto: hoy.'),
      medio_pago: camposEgreso.medio_pago.optional().describe(
        camposEgreso.medio_pago.description + ' Por defecto: banco.'
      ),
      descripcion: camposEgreso.descripcion.optional(),
      subcategoria: camposEgreso.subcategoria.optional(),
    },
    ESCRITURA,
    conErrores(async ({ fecha, monto, categoria, medio_pago = 'banco', descripcion = '', subcategoria = '' }) => {
      const data = {
        fecha: fecha || hoyStr(), monto, categoria: await resolverCategoria(categoria),
        subcategoria, descripcion, medio_pago,
        usuario: USUARIO, createdAt: ahora(), updatedAt: ahora(),
      };
      const ref = await getDb().collection('egresos').add(data);
      return respuesta({ ok: true, id: ref.id, egreso: data });
    })
  );

  server.tool(
    'editar_egreso',
    'Modifica un egreso existente. Solo cambia los campos que se pasen.',
    {
      id: z.string().describe('Id del egreso (lo devuelve listar_egresos).'),
      ...Object.fromEntries(Object.entries(camposEgreso).map(([k, v]) => [k, v.optional()])),
    },
    MODIFICA,
    conErrores(async ({ id, categoria, ...campos }) => {
      const { ref, data: antes } = await getDocOrFail('egresos', id);
      const cambios = sinUndefined({
        ...campos,
        categoria: categoria !== undefined ? await resolverCategoria(categoria) : undefined,
      });
      if (!Object.keys(cambios).length) throw new Error('No se pasó ningún campo para cambiar');
      await ref.update({ ...cambios, usuario: USUARIO, updatedAt: ahora() });
      return respuesta({ ok: true, id, antes, cambios });
    })
  );

  server.tool(
    'eliminar_egreso',
    'Elimina un egreso. No se puede deshacer: confirmá con el usuario antes de usarla.',
    { id: z.string().describe('Id del egreso.') },
    MODIFICA,
    conErrores(async ({ id }) => {
      const { ref, data } = await getDocOrFail('egresos', id);
      await ref.delete();
      return respuesta({ ok: true, eliminado: { id, ...data } });
    })
  );
}
