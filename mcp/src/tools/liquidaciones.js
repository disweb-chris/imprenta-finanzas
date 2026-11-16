import { z } from 'zod';
import { getDb, getMesRange, getMesActual } from '../firebase.js';

export function registerLiquidaciones(server) {
  server.tool(
    'listar_liquidaciones',
    'Lista las liquidaciones de producción: lo que se le paga a proveedores por trabajos ' +
    'de impresión (ej: Copia y Grafica). Cada liquidación tiene líneas con nombre, cantidad, ' +
    'costo calculado vs ajustado y proveedor. Útil para analizar margen real vs costo de producción.',
    {
      mes: z.string().optional().describe(
        'Mes a consultar (YYYY-MM). Por defecto: mes actual.'
      ),
      proveedor: z.string().optional().describe(
        'Filtrar por nombre de proveedor (ej: "Copia y Grafica").'
      ),
    },
    async ({ mes, proveedor }) => {
      const db = getDb();
      const mesKey = mes || getMesActual();
      const { from, to } = getMesRange(mesKey);

      const snap = await db.collection('liquidaciones')
        .where('fecha', '>=', from)
        .where('fecha', '<=', to)
        .orderBy('fecha', 'desc')
        .get();

      let items = snap.docs.map(d => {
        const data = d.data();
        const lineas = data.lineas || [];
        const totalAjustado   = lineas.reduce((s, l) => s + (l.costo_ajustado || 0), 0);
        const totalCalculado  = lineas.reduce((s, l) => s + (l.costo_calculado || 0), 0);
        return {
          id: d.id,
          fecha: data.fecha,
          egreso_ids: data.egreso_ids || [],
          lineas,
          total_ajustado: totalAjustado,
          total_calculado: totalCalculado,
          ahorro_vs_calculado: totalCalculado - totalAjustado,
        };
      });

      if (proveedor) {
        items = items.filter(liq =>
          liq.lineas.some(l =>
            (l.proveedor || '').toLowerCase().includes(proveedor.toLowerCase())
          )
        );
      }

      const totalAjustado  = items.reduce((s, l) => s + l.total_ajustado, 0);
      const totalCalculado = items.reduce((s, l) => s + l.total_calculado, 0);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            mes: mesKey,
            total_costo_produccion: totalAjustado,
            total_costo_calculado: totalCalculado,
            ahorro_total: totalCalculado - totalAjustado,
            cantidad_liquidaciones: items.length,
            liquidaciones: items,
          }, null, 2),
        }],
      };
    }
  );
}
