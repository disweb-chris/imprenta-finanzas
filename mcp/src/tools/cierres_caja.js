import { z } from 'zod';
import { getDb } from '../firebase.js';

export function registerCierresCaja(server) {
  server.tool(
    'listar_cierres_caja',
    'Devuelve los cierres de caja registrados. Cada cierre registra el saldo bancario, ' +
    'efectivo y saldo final en una fecha determinada. Útil para conocer el estado real ' +
    'de liquidez del negocio.',
    {
      limit: z.number().int().min(1).max(30).optional().describe(
        'Cantidad de cierres a devolver (más reciente primero). Por defecto: 5.'
      ),
      desde: z.string().optional().describe(
        'Fecha desde (YYYY-MM-DD). Si se omite, trae los últimos N cierres.'
      ),
      hasta: z.string().optional().describe(
        'Fecha hasta (YYYY-MM-DD).'
      ),
    },
    async ({ limit = 5, desde, hasta }) => {
      const db = getDb();

      let query = db.collection('cierres_caja').orderBy('fecha', 'desc');

      if (desde) query = query.where('fecha', '>=', desde);
      if (hasta) query = query.where('fecha', '<=', hasta);
      if (!desde && !hasta) query = query.limit(limit);

      const snap = await query.get();
      const items = snap.docs.slice(0, limit).map(d => {
        const data = d.data();
        return {
          id: d.id,
          fecha: data.fecha,
          saldo_banco: data.saldo_banco || 0,
          saldo_efectivo: data.saldo_efectivo || 0,
          saldo_final: data.saldo_final || 0,
          notas: data.notas || '',
          usuario: data.usuario,
        };
      });

      const ultimo = items[0] || null;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ultimo_cierre: ultimo,
            historial: items,
            cantidad: items.length,
          }, null, 2),
        }],
      };
    }
  );
}
