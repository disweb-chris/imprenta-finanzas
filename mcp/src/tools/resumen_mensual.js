import { z } from 'zod';
import { getDb, getMesRange, getMesActual, getCatMap } from '../firebase.js';
import { getResumenPedidosMes } from '../woocommerce.js';

export function registerResumenMensual(server) {
  server.tool(
    'resumen_mensual',
    'Genera el resumen financiero completo de un mes: ingresos (WooCommerce + extra), ' +
    'egresos reales, compromisos pendientes, pagos variables, costos de producción y ' +
    'último saldo de caja. Es la herramienta principal para diagnóstico y recomendaciones.',
    {
      mes: z.string().optional().describe(
        'Mes a resumir (YYYY-MM). Por defecto: mes actual.'
      ),
    },
    async ({ mes }) => {
      const db = getDb();
      const mesKey = mes || getMesActual();
      const { from, to } = getMesRange(mesKey);

      // ── 1. Ingresos WooCommerce ──────────────────────────────────────────────
      let wc = { cantidad: 0, total: 0, por_estado: {}, pedidos: [] };
      try {
        wc = await getResumenPedidosMes(mesKey);
      } catch (err) {
        wc.error = `No se pudo conectar con WooCommerce: ${err.message}`;
      }

      // ── 2. Ingresos extra ────────────────────────────────────────────────────
      const ingresosExtraSnap = await db.collection('ingresos_extra')
        .where('fecha', '>=', from)
        .where('fecha', '<=', to)
        .get();
      const ingresosExtra = ingresosExtraSnap.docs.map(d => d.data());
      const totalIngresosExtra = ingresosExtra.reduce((s, i) => s + (i.monto || 0), 0);

      // ── 3. Egresos del mes ───────────────────────────────────────────────────
      const catMap = await getCatMap();
      const egresosSnap = await db.collection('egresos')
        .where('fecha', '>=', from)
        .where('fecha', '<=', to)
        .get();

      const egresos = egresosSnap.docs.map(d => {
        const data = d.data();
        return {
          monto: data.monto || 0,
          medio_pago: data.medio_pago || '',
          categoria: catMap[data.categoria] || data.categoria || '',
          descripcion: data.descripcion || '',
          fecha: data.fecha,
        };
      });

      const porMedioPago = {};
      const porCategoria = {};
      egresos.forEach(e => {
        const mp = e.medio_pago || 'sin_medio';
        porMedioPago[mp] = (porMedioPago[mp] || 0) + e.monto;
        const cat = e.categoria || 'sin_categoria';
        porCategoria[cat] = (porCategoria[cat] || 0) + e.monto;
      });
      const totalEgresos = egresos.reduce((s, e) => s + e.monto, 0);

      // ── 4. Compromisos del mes (recurrentes + cuotas) ────────────────────────
      const compromisosSnap = await db.collection('compromisos')
        .where('estado', '==', 'activo')
        .where('fecha_proximo_pago', '>=', from)
        .where('fecha_proximo_pago', '<=', to)
        .get();

      const compromisosRecurrentes = [];
      const compromisosCuotas = [];
      compromisosSnap.docs.forEach(d => {
        const data = d.data();
        const item = { nombre: data.nombre, monto: data.monto || 0, fecha: data.fecha_proximo_pago };
        if (data.tipo === 'cuotas') {
          const restantes = (Number(data.total_cuotas) || 0) - (data.cuotas_pagadas || 0);
          compromisosCuotas.push({
            ...item,
            cuotas_pagadas: data.cuotas_pagadas || 0,
            total_cuotas: Number(data.total_cuotas) || 0,
            cuotas_restantes: restantes,
            deuda_restante: restantes * item.monto,
          });
        } else {
          compromisosRecurrentes.push(item);
        }
      });
      const totalCompromisos =
        [...compromisosRecurrentes, ...compromisosCuotas].reduce((s, c) => s + c.monto, 0);

      // Deuda total en créditos activos (todas las cuotas, no solo del mes)
      const todasCuotasSnap = await db.collection('compromisos')
        .where('estado', '==', 'activo')
        .where('tipo', '==', 'cuotas')
        .get();
      const deudaTotalCreditos = todasCuotasSnap.docs.reduce((s, d) => {
        const data = d.data();
        const restantes = (Number(data.total_cuotas) || 0) - (data.cuotas_pagadas || 0);
        return s + restantes * (data.monto || 0);
      }, 0);

      // ── 5. Pagos variables del mes ───────────────────────────────────────────
      const pvMontosSnap = await db.collection('pv_montos')
        .where('mes_key', '==', mesKey)
        .get();
      const totalPvMontos = pvMontosSnap.docs.reduce((s, d) => s + (d.data().monto || 0), 0);

      // ── 6. Costos de producción (liquidaciones) ──────────────────────────────
      const liqSnap = await db.collection('liquidaciones')
        .where('fecha', '>=', from)
        .where('fecha', '<=', to)
        .get();
      const totalProduccion = liqSnap.docs.reduce((s, d) => {
        const lineas = d.data().lineas || [];
        return s + lineas.reduce((ls, l) => ls + (l.costo_ajustado || 0), 0);
      }, 0);

      // ── 7. Último cierre de caja ─────────────────────────────────────────────
      const cierreSnap = await db.collection('cierres_caja')
        .orderBy('fecha', 'desc')
        .limit(1)
        .get();
      const ultimoCierre = cierreSnap.empty ? null : (() => {
        const d = cierreSnap.docs[0].data();
        return {
          fecha: d.fecha,
          saldo_banco: d.saldo_banco,
          saldo_efectivo: d.saldo_efectivo,
          saldo_final: d.saldo_final,
        };
      })();

      // ── 8. Presupuestos para comparación ────────────────────────────────────
      const presupuestosSnap = await db.collection('presupuestos').get();
      const presupuestos = presupuestosSnap.docs.map(d => d.data());
      const totalPresupuestado = presupuestos.reduce((s, p) => s + (p.monto || 0), 0);

      // ── Cálculos finales ─────────────────────────────────────────────────────
      const totalIngresos = wc.total + totalIngresosExtra;
      const totalGastos   = totalEgresos + totalPvMontos; // egresos + pagos variables
      const resultadoNeto = totalIngresos - totalGastos;
      const margenBruto   = totalIngresos > 0
        ? ((totalIngresos - totalProduccion) / totalIngresos * 100).toFixed(1)
        : '0';

      // ── Alertas automáticas ──────────────────────────────────────────────────
      const alertas = [];
      const hoy = new Date().toISOString().substring(0, 10);

      // Compromisos vencidos
      const allCompromisosSnap = await db.collection('compromisos')
        .where('estado', '==', 'activo')
        .where('fecha_proximo_pago', '<', hoy)
        .get();
      if (!allCompromisosSnap.empty) {
        alertas.push(`⚠️ ${allCompromisosSnap.size} compromisos vencidos sin pagar`);
      }

      // Ingresos bajos vs meta
      if (wc.cantidad < 50) {
        alertas.push(`📦 Pedidos del mes: ${wc.cantidad}/50 (meta mensual)`);
      }

      // Gastos vs presupuesto
      if (totalGastos > totalPresupuestado * 1.1) {
        alertas.push(`🔴 Gastos ${((totalGastos / totalPresupuestado - 1) * 100).toFixed(0)}% sobre presupuesto`);
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            mes: mesKey,
            resumen: {
              ingresos: {
                woocommerce: { total: wc.total, cantidad_pedidos: wc.cantidad, por_estado: wc.por_estado },
                extra: { total: totalIngresosExtra, cantidad: ingresosExtra.length },
                total: totalIngresos,
                error_wc: wc.error || null,
              },
              egresos: {
                total_real: totalEgresos,
                por_medio_pago: porMedioPago,
                por_categoria: porCategoria,
                pagos_variables: totalPvMontos,
                total_con_pv: totalGastos,
              },
              produccion: {
                costo_total: totalProduccion,
                margen_bruto_pct: `${margenBruto}%`,
              },
              compromisos_mes: {
                total_a_pagar: totalCompromisos,
                recurrentes: { cantidad: compromisosRecurrentes.length, items: compromisosRecurrentes },
                cuotas: { cantidad: compromisosCuotas.length, items: compromisosCuotas },
              },
              deuda_total_creditos: {
                monto: deudaTotalCreditos,
                nota: 'Suma de cuotas restantes × monto en todos los créditos activos',
              },
              presupuesto: {
                total_presupuestado: totalPresupuestado,
                total_gastado: totalGastos,
                diferencia: totalPresupuestado - totalGastos,
                estado: totalGastos <= totalPresupuestado ? '✅ Dentro del presupuesto' : '🔴 Sobre presupuesto',
              },
              resultado_neto: resultadoNeto,
              caja: ultimoCierre || 'Sin cierre registrado',
            },
            alertas: alertas.length > 0 ? alertas : ['✅ Sin alertas activas'],
          }, null, 2),
        }],
      };
    }
  );
}
