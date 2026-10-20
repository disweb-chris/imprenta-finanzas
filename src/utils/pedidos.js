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

// Cuenta a la que entró un cobro del historial de pagos, según el método cargado en el
// metabox «Registro de Pagos» o en el mostrador (io-punto-venta).
export function medioCobro(metodo) {
  const m = String(metodo || '').toLowerCase()
  if (m === 'efectivo') return 'efectivo'
  if (m.includes('avealma')) return 'avealma'
  return 'banco' // transferencia, Mercado Pago y GetNet se acreditan en el banco
}

// Total cobrado de un pedido por depósitos en la cuenta de Avealma
export function cobradoAvealma(order) {
  const hist = Array.isArray(order.io_pagos_historial) ? order.io_pagos_historial : []
  return hist.filter(p => medioCobro(p.metodo) === 'avealma').reduce((s, p) => s + (parseFloat(p.monto) || 0), 0)
}

// Total cobrado de un pedido con GetNet: los cobros del historial con método GetNet o, si el pedido
// no tiene historial, el total cuando la pasarela de pago del pedido es GetNet.
export function cobradoGetnet(order) {
  const hist = Array.isArray(order.io_pagos_historial) ? order.io_pagos_historial : []
  if (hist.length) {
    return hist.filter(p => String(p.metodo || '').toLowerCase().includes('getnet')).reduce((s, p) => s + (parseFloat(p.monto) || 0), 0)
  }
  const pm = `${order.payment_method || ''} ${order.payment_method_title || ''}`.toLowerCase()
  return pm.includes('getnet') ? parseFloat(order.total || 0) : 0
}

// Estima la comisión de GetNet aplicando la suma de los % de Configuración a lo cobrado con GetNet
export function calcularComisionGetnet(orders, comisiones = []) {
  const pct = comisiones.reduce((s, c) => s + (parseFloat(c.pct) || 0), 0)
  const base = orders.reduce((s, o) => s + cobradoGetnet(o), 0)
  return { base, pct, total: base * pct / 100 }
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

// Saldo pendiente de un pedido. Con historial de pagos (metabox de cobros) es total − cobrado.
// Sin historial: pendiente de pago (pending) y en espera (on-hold) se consideran todo pendiente;
// el resto se asume cobrado.
const ESTADOS_SIN_COBRAR = ['pending', 'on-hold']
export function saldoPedido(o) {
  const total = parseFloat(o.total || 0)
  const tieneHistorial = Array.isArray(o.io_pagos_historial) && o.io_pagos_historial.length > 0
  const cobrado = tieneHistorial ? getIngresoReal(o) : (ESTADOS_SIN_COBRAR.includes(o.status) ? 0 : total)
  return { total, cobrado, saldo: total - cobrado, sinPagos: !tieneHistorial }
}
