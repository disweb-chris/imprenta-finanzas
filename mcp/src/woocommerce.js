import axios from 'axios';

const WC_URL = process.env.WC_URL || 'https://imprentaonline.ar/wp-json/wc/v3';
const WC_CK  = process.env.WC_CONSUMER_KEY;
const WC_CS  = process.env.WC_CONSUMER_SECRET;

/**
 * Trae los pedidos de WooCommerce de un mes dado ("YYYY-MM")
 * Por defecto trae completed + processing (ambos son ventas reales)
 */
export async function getPedidosMes(mes, statuses = ['completed', 'processing']) {
  const [year, month] = mes.split('-').map(Number);
  // after/before en ISO 8601 — WC filtra por fecha de creación
  const after  = new Date(year, month - 1, 1).toISOString();
  const before = new Date(year, month, 0, 23, 59, 59).toISOString();

  const results = [];
  for (const status of statuses) {
    const res = await axios.get(`${WC_URL}/orders`, {
      auth: { username: WC_CK, password: WC_CS },
      params: { after, before, status, per_page: 100 },
      timeout: 15000,
    });
    results.push(...res.data);
  }

  return results.map(o => ({
    id: o.id,
    numero: o.number,
    fecha: o.date_created?.substring(0, 10),
    total: parseFloat(o.total),
    estado: o.status,
    cliente: `${o.billing?.first_name || ''} ${o.billing?.last_name || ''}`.trim(),
    medio_pago: o.payment_method_title,
    items: o.line_items?.map(i => i.name) || [],
  }));
}

/**
 * Resumen agregado de pedidos de un mes
 */
export async function getResumenPedidosMes(mes) {
  const pedidos = await getPedidosMes(mes);
  const total = pedidos.reduce((s, p) => s + p.total, 0);
  const porEstado = {};
  pedidos.forEach(p => {
    porEstado[p.estado] = (porEstado[p.estado] || 0) + p.total;
  });
  return { cantidad: pedidos.length, total, por_estado: porEstado, pedidos };
}
