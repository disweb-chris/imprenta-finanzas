import { z } from 'zod';
import { getDb } from '../firebase.js';
import {
  montoSchema, resolverCategoria, getDocOrFail, sinUndefined, respuesta, conErrores, MODIFICA,
} from '../comun.js';

export function registerPresupuestos(server) {
  server.tool(
    'listar_presupuestos',
    'Devuelve los presupuestos mensuales definidos por categoría (ej: sueldos $260.000). ' +
    'Útil para comparar presupuesto vs gasto real. Esta colección es pequeña y se lee completa.',
    {},
    async () => {
      const db = getDb();
      const snap = await db.collection('presupuestos').get();

      const items = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          categoria: data.categoria || '',
          descripcion: data.descripcion || '',
          monto: data.monto || 0,
        };
      });

      const total = items.reduce((s, p) => s + p.monto, 0);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            total_presupuestado: total,
            cantidad: items.length,
            presupuestos: items,
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'guardar_presupuesto',
    'Define el presupuesto mensual de una categoría. Si la categoría ya tiene presupuesto, lo reemplaza.',
    {
      categoria: z.string().describe('Id o nombre de la categoría (ver listar_categorias).'),
      monto: montoSchema.describe('Monto mensual presupuestado.'),
      descripcion: z.string().optional(),
    },
    MODIFICA,
    conErrores(async ({ categoria, monto, descripcion }) => {
      const db = getDb();
      const cat = await resolverCategoria(categoria);
      const snap = await db.collection('presupuestos').where('categoria', '==', cat).limit(1).get();
      const data = sinUndefined({ categoria: cat, monto, descripcion });
      if (snap.empty) {
        const ref = await db.collection('presupuestos').add({ descripcion: '', ...data });
        return respuesta({ ok: true, accion: 'creado', id: ref.id, presupuesto: data });
      }
      const existente = snap.docs[0];
      await existente.ref.update(data);
      return respuesta({ ok: true, accion: 'actualizado', id: existente.id, antes: existente.data(), presupuesto: data });
    })
  );

  server.tool(
    'eliminar_presupuesto',
    'Elimina el presupuesto de una categoría. Confirmá con el usuario antes de usarla.',
    { id: z.string().describe('Id del presupuesto (lo devuelve listar_presupuestos).') },
    MODIFICA,
    conErrores(async ({ id }) => {
      const { ref, data } = await getDocOrFail('presupuestos', id);
      await ref.delete();
      return respuesta({ ok: true, eliminado: { id, ...data } });
    })
  );
}
