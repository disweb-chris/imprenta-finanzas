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
