// SKU/nombre del producto que se usa solo para cobrar saldo (flujo viejo) — se excluye de ingresos y profit
export const COBRO_SALDO_SKU = 'CS'
export const COBRO_SALDO_NOMBRE = 'Cobro Saldo'

export function esPedidoCobroSaldo(order) {
  const items = order.line_items || []
  return items.length > 0 && items.every(
    item => item.sku === COBRO_SALDO_SKU || item.name === COBRO_SALDO_NOMBRE
  )
}

// Ingreso real de un pedido: si tiene historial de pagos del metabox, usamos la suma
// de esos montos (evita distorsión por señas/descuentos); si no, el total del pedido.
export function getIngresoReal(order) {
  const historial = order.io_pagos_historial
  if (Array.isArray(historial) && historial.length > 0) {
    return historial.reduce((s, p) => s + (parseFloat(p.monto) || 0), 0)
  }
  return parseFloat(order.total || 0)
}

export function esPedidoMercadoPago(order) {
  const pm = `${order.payment_method || ''} ${order.payment_method_title || ''}`.toLowerCase()
  return pm.includes('mercadopago') || pm.includes('mercado pago') || pm.includes('mercado_pago')
}

// Estima la comisión de MercadoPago agrupando por mes calendario del pedido, y reemplaza
// la estimación por el monto real cargado a mano cuando está disponible para ese mes.
export function calcularComisionMP(orders, tasaPct, realesPorMes = {}) {
  const porMes = {}
  orders.forEach(o => {
    if (!esPedidoMercadoPago(o)) return
    const mes = String(o.date_created || '').slice(0, 7) // YYYY-MM
    if (!mes) return
    porMes[mes] = (porMes[mes] || 0) + getIngresoReal(o) * (tasaPct / 100)
  })
  let total = 0
  const detalle = Object.entries(porMes).map(([mes, estimado]) => {
    const real = realesPorMes[mes]
    const monto = real != null ? real : estimado
    total += monto
    return { mes, estimado, real: real != null ? real : null, monto }
  })
  return { total, detalle }
}
