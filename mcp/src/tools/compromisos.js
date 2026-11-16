import { z } from 'zod';
import { getDb, getMesRange, getMesActual } from '../firebase.js';
import {
  USUARIO, ahora, hoyStr, fechaSchema, montoSchema, MEDIOS_PAGO, resolverCategoria,
  getDocOrFail, sinUndefined, respuesta, conErrores, ESCRITURA, MODIFICA,
} from '../comun.js';

export function registerCompromisos(server) {
  server.tool(
    'listar_compromisos',
    'Lista los compromisos de pago del negocio. Hay dos tipos:\n' +
    '- "recurrente": pagos fijos mensuales sin fin (sueldos, suscripciones, servicios).\n' +
    '- "cuotas": créditos con N cuotas fijas (maquinaria, préstamos). ' +
    'Para cuotas muestra deuda restante = (total_cuotas - cuotas_pagadas) * monto.\n' +
    'También calcula la deuda total pendiente del negocio en créditos activos.',
    {
      mes: z.string().optional().describe(
        'Filtrar por mes de próximo pago (YYYY-MM). Por defecto: mes actual.'
      ),
      tipo: z.enum(['recurrente', 'cuotas', 'todos']).optional().describe(
        '"recurrente" para fijos mensuales, "cuotas" para créditos, "todos" para ambos. Por defecto: todos.'
      ),
      proximos_dias: z.number().int().min(1).max(90).optional().describe(
        'Mostrar compromisos que vencen en los próximos N días (alternativa al filtro por mes).'
      ),
      solo_activos: z.boolean().optional().describe(
        'Si es true (default), solo muestra compromisos con estado "activo".'
      ),
    },
    async ({ mes, tipo = 'todos', proximos_dias, solo_activos = true }) => {
      const db = getDb();

      let query = db.collection('compromisos');
      if (solo_activos) query = query.where('estado', '==', 'activo');
      if (tipo !== 'todos') query = query.where('tipo', '==', tipo);

      const snap = await query.orderBy('fecha_proximo_pago', 'asc').get();

      let items = snap.docs.map(d => {
        const data = d.data();
        const esCuota = data.tipo === 'cuotas';
        const cuotasPagadas  = data.cuotas_pagadas ?? 0;
        const totalCuotas    = data.total_cuotas ? Number(data.total_cuotas) : null;
        const cuotasRestantes = esCuota && totalCuotas ? totalCuotas - cuotasPagadas : null;
        const deudaRestante   = esCuota && cuotasRestantes !== null
          ? cuotasRestantes * (data.monto || 0)
          : null;

        return {
          id: d.id,
          nombre: data.nombre,
          monto: data.monto || 0,
          categoria: data.categoria || '',
          estado: data.estado,
          fecha_proximo_pago: data.fecha_proximo_pago,
          frecuencia: data.frecuencia,
          tipo: data.tipo,
          // Solo para cuotas:
          ...(esCuota && {
            cuotas_pagadas: cuotasPagadas,
            total_cuotas: totalCuotas,
            cuotas_restantes: cuotasRestantes,
            deuda_restante: deudaRestante,
          }),
          notas: data.notas || '',
        };
      });

      // Filtro por mes de próximo pago
      if (mes) {
        const { from, to } = getMesRange(mes);
        items = items.filter(c =>
          c.fecha_proximo_pago >= from && c.fecha_proximo_pago <= to
        );
      }

      // Filtro por próximos N días
      if (proximos_dias) {
        const hoy   = new Date().toISOString().substring(0, 10);
        const limite = new Date();
        limite.setDate(limite.getDate() + proximos_dias);
        const limiteSt = limite.toISOString().substring(0, 10);
        items = items.filter(c =>
          c.fecha_proximo_pago >= hoy && c.fecha_proximo_pago <= limiteSt
        );
      }

      const hoy = new Date().toISOString().substring(0, 10);

      // Separar por tipo para resumen
      const recurrentes = items.filter(c => c.tipo === 'recurrente');
      const cuotas      = items.filter(c => c.tipo === 'cuotas');

      // Deuda total de créditos activos (independiente del filtro de mes)
      const todasCuotasSnap = await db.collection('compromisos')
        .where('estado', '==', 'activo')
        .where('tipo', '==', 'cuotas')
        .get();
      const deudaTotalNegocio = todasCuotasSnap.docs.reduce((s, d) => {
        const data = d.data();
        const restantes = (Number(data.total_cuotas) || 0) - (data.cuotas_pagadas || 0);
        return s + restantes * (data.monto || 0);
      }, 0);

      // Alertas
      const vencidos = items.filter(c => c.fecha_proximo_pago < hoy);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            filtro_aplicado: {
              mes: mes || getMesActual(),
              tipo,
              proximos_dias: proximos_dias || null,
            },
            resumen: {
              total_a_pagar_en_filtro: items.reduce((s, c) => s + c.monto, 0),
              recurrentes_en_filtro: recurrentes.length,
              cuotas_en_filtro: cuotas.length,
              deuda_total_creditos_activos: deudaTotalNegocio,
            },
            alertas: vencidos.length > 0
              ? [`⚠️ ${vencidos.length} compromiso(s) vencido(s): ${vencidos.map(v => v.nombre).join(', ')}`]
              : [],
            recurrentes,
            cuotas,
          }, null, 2),
        }],
      };
    }
  );

  const camposCompromiso = {
    nombre: z.string().min(1).describe('Nombre (ej: "Sueldo Juan", "Crédito plotter").'),
    tipo: z.enum(['recurrente', 'cuotas']).describe('"recurrente" sin fin, "cuotas" con cantidad fija.'),
    frecuencia: z.enum(['mensual', 'semanal', 'anual']).describe('Cada cuánto se paga.'),
    monto: montoSchema.describe('Monto de cada pago (o de cada cuota).'),
    categoria: z.string().describe('Id o nombre de la categoría (ver listar_categorias).'),
    fecha_proximo_pago: fechaSchema.describe('Próximo vencimiento (YYYY-MM-DD).'),
    total_cuotas: z.number().int().positive().describe('Solo para tipo "cuotas".'),
    cuotas_pagadas: z.number().int().min(0).describe('Solo para tipo "cuotas". Por defecto: 0.'),
    estado: z.enum(['activo', 'finalizado']).describe('Por defecto: activo.'),
    notas: z.string(),
  };
  const opcionales = (campos) =>
    Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, v.optional()]));

  server.tool(
    'crear_compromiso',
    'Crea un compromiso de pago: un gasto recurrente (sueldo, alquiler, suscripción) o un crédito en cuotas.',
    {
      ...opcionales(camposCompromiso),
      nombre: camposCompromiso.nombre,
      monto: camposCompromiso.monto,
      categoria: camposCompromiso.categoria,
    },
    ESCRITURA,
    conErrores(async (c) => {
      const tipo = c.tipo || 'recurrente';
      if (tipo === 'cuotas' && !c.total_cuotas) throw new Error('Para tipo "cuotas" falta total_cuotas');
      const data = sinUndefined({
        nombre: c.nombre, tipo, frecuencia: c.frecuencia || 'mensual', monto: c.monto,
        categoria: await resolverCategoria(c.categoria),
        fecha_proximo_pago: c.fecha_proximo_pago || '',
        estado: c.estado || 'activo', notas: c.notas || '',
        ...(tipo === 'cuotas' && { total_cuotas: c.total_cuotas, cuotas_pagadas: c.cuotas_pagadas || 0 }),
        usuario: USUARIO, createdAt: ahora(), updatedAt: ahora(),
      });
      const ref = await getDb().collection('compromisos').add(data);
      return respuesta({ ok: true, id: ref.id, compromiso: data });
    })
  );

  server.tool(
    'editar_compromiso',
    'Modifica un compromiso existente (monto, vencimiento, estado, etc.). Solo cambia los campos que se pasen. ' +
    'Para registrar que se pagó usá registrar_pago_compromiso.',
    { id: z.string().describe('Id del compromiso (lo devuelve listar_compromisos).'), ...opcionales(camposCompromiso) },
    MODIFICA,
    conErrores(async ({ id, categoria, ...campos }) => {
      const { ref, data: antes } = await getDocOrFail('compromisos', id);
      const cambios = sinUndefined({
        ...campos,
        categoria: categoria !== undefined ? await resolverCategoria(categoria) : undefined,
      });
      if (!Object.keys(cambios).length) throw new Error('No se pasó ningún campo para cambiar');
      await ref.update({ ...cambios, updatedAt: ahora() });
      return respuesta({ ok: true, id, antes, cambios });
    })
  );

  server.tool(
    'eliminar_compromiso',
    'Elimina un compromiso. No borra los egresos ya pagados. No se puede deshacer: confirmá con el usuario antes. ' +
    'Si solo dejó de pagarse, conviene editar_compromiso con estado "finalizado".',
    { id: z.string().describe('Id del compromiso.') },
    MODIFICA,
    conErrores(async ({ id }) => {
      const { ref, data } = await getDocOrFail('compromisos', id);
      await ref.delete();
      return respuesta({ ok: true, eliminado: { id, ...data } });
    })
  );

  server.tool(
    'registrar_pago_compromiso',
    'Registra el pago de un compromiso, igual que el botón "Pagar" de la app: crea el egreso y avanza el compromiso. ' +
    'Cuotas: suma una cuota (y lo finaliza en la última). Sueldos: el vencimiento avanza recién cuando lo pagado ' +
    'en el mes cubre el monto completo, así se pueden cargar pagos parciales. Otros: avanza al próximo período.',
    {
      id: z.string().describe('Id del compromiso.'),
      monto: montoSchema.optional().describe('Monto pagado. Por defecto: el monto del compromiso.'),
      fecha: fechaSchema.optional().describe('Fecha del pago (YYYY-MM-DD). Por defecto: hoy.'),
      medio_pago: z.enum(MEDIOS_PAGO).optional().describe('Por defecto: banco.'),
    },
    ESCRITURA,
    conErrores(async ({ id, monto, fecha, medio_pago = 'banco' }) => {
      const db = getDb();
      const { ref, data: comp } = await getDocOrFail('compromisos', id);
      if (comp.estado !== 'activo') throw new Error(`El compromiso "${comp.nombre}" no está activo (${comp.estado})`);
      const pago = monto ?? parseFloat(comp.monto || 0);
      const fechaPago = fecha || hoyStr();

      // Para sueldos: lo ya pagado en el mes, leído antes de crear este egreso
      let pagadoAntes = 0;
      if (comp.tipo !== 'cuotas' && comp.categoria === 'sueldos') {
        const hoy = hoyStr();
        const snap = await db.collection('egresos')
          .where('origen_compromiso', '==', id)
          .where('fecha', '>=', `${hoy.slice(0, 7)}-01`)
          .where('fecha', '<=', hoy)
          .get();
        snap.forEach(d => { pagadoAntes += parseFloat(d.data().monto || 0); });
      }

      const egreso = {
        fecha: fechaPago, monto: pago,
        categoria: comp.categoria || 'varios',
        descripcion: `Pago: ${comp.nombre}`,
        medio_pago, origen_compromiso: id,
        usuario: USUARIO, createdAt: ahora(),
      };
      const egresoRef = await db.collection('egresos').add(egreso);

      const updates = { updatedAt: ahora() };
      let nota;
      if (comp.tipo === 'cuotas') {
        updates.cuotas_pagadas = (comp.cuotas_pagadas || 0) + 1;
        if (updates.cuotas_pagadas >= comp.total_cuotas) {
          updates.estado = 'finalizado';
          nota = 'Última cuota: el compromiso quedó finalizado';
        } else {
          updates.fecha_proximo_pago = proximaFecha(fechaPago, comp.frecuencia);
          nota = `Cuota ${updates.cuotas_pagadas} de ${comp.total_cuotas}`;
        }
      } else if (comp.categoria === 'sueldos') {
        const total = pagadoAntes + pago;
        if (total >= parseFloat(comp.monto)) {
          updates.fecha_proximo_pago = proximaFecha(fechaPago, comp.frecuencia);
          nota = 'Pago completo del mes';
        } else {
          nota = `Pago parcial: van ${total} de ${comp.monto}, el vencimiento no se mueve`;
        }
      } else {
        updates.fecha_proximo_pago = proximaFecha(fechaPago, comp.frecuencia);
      }
      await ref.update(updates);

      return respuesta({ ok: true, egreso_id: egresoRef.id, egreso, compromiso_actualizado: updates, nota });
    })
  );
}

// Igual que nextDate() de la vista Compromisos
function proximaFecha(desde, frecuencia) {
  const [y, m, d] = desde.split('-').map(Number);
  const f = new Date(Date.UTC(y, m - 1, d));
  if (frecuencia === 'mensual') f.setUTCMonth(f.getUTCMonth() + 1);
  else if (frecuencia === 'anual') f.setUTCFullYear(f.getUTCFullYear() + 1);
  else f.setUTCDate(f.getUTCDate() + 7);
  return f.toISOString().slice(0, 10);
}
