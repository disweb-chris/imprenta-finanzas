import { z } from 'zod';
import { getDb, getMesActual } from '../firebase.js';
import { ahora, hoyStr, mesSchema, respuesta, conErrores, MODIFICA } from '../comun.js';

export function registerPvMontos(server) {
  server.tool(
    'listar_pagos_variables',
    'Lista los pagos variables del mes: montos registrados para cada concepto variable ' +
    '(sueldos con variación, bonos, etc.). Cruza pv_montos con pv_conceptos para mostrar ' +
    'nombre de concepto + monto + notas.',
    {
      mes: z.string().optional().describe(
        'Mes a consultar en formato YYYY-MM. Por defecto: mes actual.'
      ),
    },
    async ({ mes }) => {
      const db = getDb();
      const mesKey = mes || getMesActual();

      // Cargar conceptos para resolver nombres
      const conceptosSnap = await db.collection('pv_conceptos').get();
      const conceptoMap = {};
      conceptosSnap.forEach(d => {
        conceptoMap[d.id] = d.data();
      });

      // Montos del mes
      const montosSnap = await db.collection('pv_montos')
        .where('mes_key', '==', mesKey)
        .get();

      const items = montosSnap.docs.map(d => {
        const data = d.data();
        const concepto = conceptoMap[data.concepto_id] || {};
        return {
          id: d.id,
          concepto_id: data.concepto_id,
          nombre: concepto.nombre || data.concepto_id,
          categoria: concepto.categoria || '',
          monto: data.monto || 0,
          notas: data.notas || '',
          mes_key: data.mes_key,
          dia_vencimiento: concepto.dia_vencimiento,
          activo: concepto.activo ?? true,
        };
      });

      // Cierre del mes (si existe)
      const cierreSnap = await db.collection('pv_cierres')
        .where('mes_key', '==', mesKey)
        .get();
      const cierre = cierreSnap.empty ? null : cierreSnap.docs[0].data();

      const total = items.reduce((s, i) => s + i.monto, 0);

      // Conceptos activos sin monto registrado este mes (pendientes)
      const conceptosActivos = Object.entries(conceptoMap)
        .filter(([, v]) => v.activo !== false)
        .map(([id, v]) => id);
      const conceptosConMonto = items.map(i => i.concepto_id);
      const pendientes = conceptosActivos
        .filter(id => !conceptosConMonto.includes(id))
        .map(id => ({ id, nombre: conceptoMap[id]?.nombre || id }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            mes: mesKey,
            total_pagos_variables: total,
            cantidad: items.length,
            cierre: cierre
              ? { cantidad_conceptos: cierre.cantidad, fecha: cierre.createdAt }
              : 'Sin cierre registrado este mes',
            pendientes_sin_cargar: pendientes,
            pagos: items,
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'cargar_pago_variable',
    'Carga o corrige el monto de un concepto variable (sueldo con variación, bono, etc.) para un mes. ' +
    'Si ya había monto cargado, lo reemplaza. No se puede si el mes ya se cerró en la app ' +
    '(al cerrar, los montos pasan a ser compromisos del mes siguiente).',
    {
      concepto: z.string().describe('Id o nombre del concepto (ver listar_pagos_variables).'),
      monto: z.number().min(0).describe('Monto del mes. 0 para dejarlo sin monto.'),
      mes: mesSchema.optional().describe('Mes (YYYY-MM). Por defecto: mes actual.'),
      notas: z.string().optional(),
    },
    MODIFICA,
    conErrores(async ({ concepto, monto, mes, notas }) => {
      const db = getDb();
      const mesKey = mes || hoyStr().slice(0, 7);

      const conceptosSnap = await db.collection('pv_conceptos').get();
      const v = concepto.trim().toLowerCase();
      const c = conceptosSnap.docs.find(d => d.id === concepto || (d.data().nombre || '').toLowerCase() === v);
      if (!c) {
        const opciones = conceptosSnap.docs.map(d => d.data().nombre).join(', ');
        throw new Error(`No existe el concepto "${concepto}". Opciones: ${opciones}`);
      }

      const cierre = await db.collection('pv_cierres').where('mes_key', '==', mesKey).limit(1).get();
      if (!cierre.empty) throw new Error(`El mes ${mesKey} ya está cerrado en Pagos variables`);

      const existente = await db.collection('pv_montos')
        .where('mes_key', '==', mesKey)
        .where('concepto_id', '==', c.id)
        .limit(1)
        .get();
      const data = { concepto_id: c.id, mes_key: mesKey, monto, notas: notas ?? '', updatedAt: ahora() };
      if (existente.empty) {
        const ref = await db.collection('pv_montos').add({ ...data, createdAt: ahora() });
        return respuesta({ ok: true, accion: 'creado', id: ref.id, concepto: c.data().nombre, ...data });
      }
      const doc = existente.docs[0];
      if (notas === undefined) data.notas = doc.data().notas || '';
      await doc.ref.update(data);
      return respuesta({ ok: true, accion: 'actualizado', id: doc.id, concepto: c.data().nombre, antes: doc.data(), ...data });
    })
  );
}
