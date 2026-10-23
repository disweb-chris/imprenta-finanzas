// SKU/nombre del producto que se usa solo para cobrar saldo (flujo viejo) — se excluye de ingresos y profit
export const COBRO_SALDO_SKU = 'CS'
export const COBRO_SALDO_NOMBRE = 'Cobro Saldo'

export function esPedidoCobroSaldo(order) {
  const items = order.line_items || []
  return items.length > 0 && items.every(
    item => item.sku === COBRO_SALDO_SKU || item.name === COBRO_SALDO_NOMBRE
  )
}

// Costo total de una línea de pedido. Primero el que calcula el plugin IO Costos (viene en
// `order.io_costos`); si el pedido es anterior al plugin, el que dejaba YITH por unidad.
export function costoLinea(order, item) {
  const io = (order.io_costos?.lineas || []).find(l => l.id === item.id)
  if (io && io.origen && io.origen !== 'sin_costo') return io.total
  const yith = (item.meta_data || []).find(m => m.key === 'yith_cog_item_cost' || m.key === '_yith_cog_item_cost')
  return yith ? (parseFloat(yith.value) || 0) * (parseInt(item.quantity) || 1) : 0
}

// Pedido pagado online desde la web: pasarela de Mercado Pago o GetNet con el pago confirmado
// por WooCommerce (fecha de pago o id de transacción) y en un estado que no sea de espera.
const ESTADOS_SIN_COBRAR = ['pending', 'on-hold', 'failed', 'cancelled']
export function pagadoOnline(order) {
  if (ESTADOS_SIN_COBRAR.includes(order.status)) return false
  const pm = `${order.payment_method || ''} ${order.payment_method_title || ''}`.toLowerCase()
  const pasarela = pm.includes('mercadopago') || pm.includes('mercado pago') || pm.includes('mercado_pago') || pm.includes('getnet')
  return pasarela && !!(order.date_paid || order.transaction_id)
}

// Ingreso real de un pedido: si tiene historial de pagos del metabox, usamos la suma
// de esos montos (evita distorsión por señas/descuentos). Sin historial, solo se da por
// cobrado el total si se pagó online; si no, no hay nada cobrado todavía.
export function getIngresoReal(order) {
  const historial = order.io_pagos_historial
  if (Array.isArray(historial) && historial.length > 0) {
    return historial.reduce((s, p) => s + (parseFloat(p.monto) || 0), 0)
  }
  return pagadoOnline(order) ? parseFloat(order.total || 0) : 0
}

// Cuenta a la que entró un cobro del historial de pagos, según el método cargado en el
// metabox «Registro de Pagos» o en el mostrador (io-punto-venta).
export function medioCobro(metodo) {
  const m = String(metodo || '').toLowerCase()
  if (m === 'efectivo') return 'efectivo'
  if (m.includes('avealma')) return 'avealma'
  if (m.includes('getnet')) return 'getnet' // queda en la cuenta de GetNet hasta que se liquida al banco
  return 'banco' // transferencia y Mercado Pago se acreditan en el banco
}

// Cuenta a la que entró un pedido pagado online sin historial de pagos
export function medioPagoOnline(order) {
  const pm = `${order.payment_method || ''} ${order.payment_method_title || ''}`.toLowerCase()
  return pm.includes('getnet') ? 'getnet' : 'banco'
}

// Total cobrado de un pedido por depósitos en la cuenta de Avealma
export function cobradoAvealma(order) {
  const hist = Array.isArray(order.io_pagos_historial) ? order.io_pagos_historial : []
  return hist.filter(p => medioCobro(p.metodo) === 'avealma').reduce((s, p) => s + (parseFloat(p.monto) || 0), 0)
}

// Total cobrado de un pedido con GetNet: los cobros del historial con método GetNet o, si el pedido
// no tiene historial, el total cuando se pagó online con la pasarela de GetNet.
export function cobradoGetnet(order) {
  const hist = Array.isArray(order.io_pagos_historial) ? order.io_pagos_historial : []
  if (hist.length) {
    return hist.filter(p => String(p.metodo || '').toLowerCase().includes('getnet')).reduce((s, p) => s + (parseFloat(p.monto) || 0), 0)
  }
  const pm = `${order.payment_method || ''} ${order.payment_method_title || ''}`.toLowerCase()
  return pm.includes('getnet') && pagadoOnline(order) ? parseFloat(order.total || 0) : 0
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

// Saldo pendiente de un pedido: total − cobrado. Sin historial de pagos (metabox de cobros),
// solo los pedidos pagados online se consideran cobrados.
export function saldoPedido(o) {
  const total = parseFloat(o.total || 0)
  const tieneHistorial = Array.isArray(o.io_pagos_historial) && o.io_pagos_historial.length > 0
  const cobrado = getIngresoReal(o)
  return { total, cobrado, saldo: total - cobrado, sinPagos: !tieneHistorial }
}
