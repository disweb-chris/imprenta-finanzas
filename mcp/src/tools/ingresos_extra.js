import { z } from 'zod';
import { getDb, getMesRange, getMesActual } from '../firebase.js';
import {
  USUARIO, ahora, hoyStr, fechaSchema, montoSchema,
  getDocOrFail, sinUndefined, respuesta, conErrores, ESCRITURA, MODIFICA,
} from '../comun.js';

export function registerIngresosExtra(server) {
  server.tool(
    'listar_ingresos_extra',
    'Lista ingresos que no pasan por WooCommerce (cobros manuales, transferencias directas, etc.). ' +
    'El campo "tipo" es "credito" (crédito o préstamo recibido), "transferencia", "devolucion" u "otro". ' +
    'Son todos ingresos: los gastos están en listar_egresos.',
    {
      mes: z.string().optional().describe(
        'Mes a consultar (YYYY-MM). Por defecto: mes actual.'
      ),
      tipo: z.string().optional().describe(
        'Filtrar por tipo (ej: "credito").'
      ),
    },
    async ({ mes, tipo }) => {
      const db = getDb();
      const mesKey = mes || getMesActual();
      const { from, to } = getMesRange(mesKey);

      const snap = await db.collection('ingresos_extra')
        .where('fecha', '>=', from)
        .where('fecha', '<=', to)
        .orderBy('fecha', 'desc')
        .get();

      let items = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          fecha: data.fecha,
          descripcion: data.descripcion || '',
          monto: data.monto || 0,
          tipo: data.tipo || '',
          usuario: data.usuario,
        };
      });

      if (tipo) items = items.filter(i => i.tipo === tipo);

      const total = items.reduce((s, i) => s + i.monto, 0);
      const porTipo = {};
      items.forEach(i => {
        const t = i.tipo || 'sin_tipo';
        porTipo[t] = (porTipo[t] || 0) + i.monto;
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            mes: mesKey,
            total_ingresos_extra: total,
            por_tipo: porTipo,
            cantidad: items.length,
            items,
          }, null, 2),
        }],
      };
    }
  );

  // Tipos que ofrece la vista Caja
  const camposIngreso = {
    fecha: fechaSchema.describe('Fecha (YYYY-MM-DD).'),
    monto: montoSchema.describe('Monto en pesos.'),
    tipo: z.enum(['credito', 'transferencia', 'devolucion', 'otro']).describe(
      '"credito" = crédito o préstamo recibido, "transferencia", "devolucion" u "otro".'
    ),
    descripcion: z.string(),
  };

  server.tool(
    'crear_ingreso_extra',
    'Registra un ingreso de plata que no viene de un pedido de WooCommerce (préstamo, aporte, devolución). ' +
    'Suma al saldo de banco en Caja.',
    {
      ...camposIngreso,
      fecha: camposIngreso.fecha.optional().describe('Fecha (YYYY-MM-DD). Por defecto: hoy.'),
      tipo: camposIngreso.tipo.optional().describe(camposIngreso.tipo.description + ' Por defecto: otro.'),
      descripcion: camposIngreso.descripcion.optional(),
    },
    ESCRITURA,
    conErrores(async ({ fecha, monto, tipo = 'otro', descripcion = '' }) => {
      const data = {
        fecha: fecha || hoyStr(), monto, tipo, descripcion,
        usuario: USUARIO, createdAt: ahora(), updatedAt: ahora(),
      };
      const ref = await getDb().collection('ingresos_extra').add(data);
      return respuesta({ ok: true, id: ref.id, ingreso: data });
    })
  );

  server.tool(
    'editar_ingreso_extra',
    'Modifica un ingreso extra existente. Solo cambia los campos que se pasen.',
    {
      id: z.string().describe('Id del ingreso (lo devuelve listar_ingresos_extra).'),
      ...Object.fromEntries(Object.entries(camposIngreso).map(([k, v]) => [k, v.optional()])),
    },
    MODIFICA,
    conErrores(async ({ id, ...campos }) => {
      const { ref, data: antes } = await getDocOrFail('ingresos_extra', id);
      const cambios = sinUndefined(campos);
      if (!Object.keys(cambios).length) throw new Error('No se pasó ningún campo para cambiar');
      await ref.update({ ...cambios, usuario: USUARIO, updatedAt: ahora() });
      return respuesta({ ok: true, id, antes, cambios });
    })
  );

  server.tool(
    'eliminar_ingreso_extra',
    'Elimina un ingreso extra. No se puede deshacer: confirmá con el usuario antes de usarla.',
    { id: z.string().describe('Id del ingreso.') },
    MODIFICA,
    conErrores(async ({ id }) => {
      const { ref, data } = await getDocOrFail('ingresos_extra', id);
      await ref.delete();
      return respuesta({ ok: true, eliminado: { id, ...data } });
    })
  );
}
