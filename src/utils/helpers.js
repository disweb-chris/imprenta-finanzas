export const fmt = (n) =>
  n == null ? '-' : '$' + Math.round(n).toLocaleString('es-AR')

// Parse YYYY-MM-DD as local date (avoids UTC timezone shift)
export const parseLocalDate = (s) => {
  if (!s) return null
  const parts = String(s).substring(0, 10).split('-')
  if (parts.length === 3) return new Date(+parts[0], +parts[1] - 1, +parts[2])
  return new Date(s)
}

export const fmtDate = (s) => {
  if (!s) return '-'
  const d = parseLocalDate(s)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export const fmtDateTime = (s) => {
  if (!s) return '-'
  const d = new Date(s)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

// Formatea un Date como YYYY-MM-DD en hora local (evita el shift de toISOString, que usa UTC)
export const localDateStr = (d) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Usar hora local en lugar de UTC para evitar que a las 21hs+ cambie al día siguiente
export const todayStr = () => localDateStr(new Date())

export const daysUntil = (dateStr) => {
  if (!dateStr) return null
  const d = parseLocalDate(dateStr)
  d.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((d - today) / 86400000)
}

export const DEFAULT_CATS = [
  { id: 'alquiler',              nombre: 'Alquiler',                color: '#6366f1' },
  { id: 'insumos',               nombre: 'Insumos',                  color: '#0ea5e9' },
  { id: 'produccion-tercerizada', nombre: 'Producción tercerizada',  color: '#0891b2' },
  { id: 'credito',       nombre: 'Crédito',         color: '#f59e0b' },
  { id: 'sueldos',       nombre: 'Sueldos',         color: '#10b981' },
  { id: 'marketing',     nombre: 'Marketing',       color: '#FF6B00' },
  { id: 'impuestos',     nombre: 'Impuestos',       color: '#ef4444' },
  { id: 'maquinaria',    nombre: 'Maquinaria',      color: '#8b5cf6' },
  { id: 'suscripciones', nombre: 'Suscripciones',   color: '#14b8a6' },
  { id: 'varios',        nombre: 'Varios',          color: '#94a3b8' },
]

// Medios de pago de egresos. La caja chica es un fondo propio: se repone desde banco/efectivo
// (movimiento interno en `caja_chica_movimientos`, no es egreso) y los gastos chicos salen de ahí.
export const MEDIOS_PAGO = [
  { id: 'banco',      label: 'Banco / Transferencia', short: 'Banco',      badge: 'badge-blue',   color: '#2e509e' },
  { id: 'efectivo',   label: 'Efectivo',              short: 'Efectivo',   badge: 'badge-orange', color: '#FF6B00' },
  { id: 'caja_chica', label: 'Caja chica',            short: 'Caja chica', badge: 'badge-green',  color: '#10b981' },
]

// Medios desde/hacia los que se mueve plata de la caja chica
export const ORIGENES_CAJA_CHICA = MEDIOS_PAGO.filter(m => m.id !== 'caja_chica')

export const medioInfo = (id) =>
  MEDIOS_PAGO.find(m => m.id === id) || { id, label: id || 'Banco', short: id || 'Banco', badge: 'badge-gray', color: '#94a3b8' }

// Normaliza el medio de un egreso: cualquier valor no reconocido (incl. 'tarjeta' o vacío) cuenta como banco
export const medioEgreso = (x) =>
  x?.medio_pago === 'efectivo' || x?.medio_pago === 'caja_chica' ? x.medio_pago : 'banco'

export const statusBadge = (s) => {
  const map = { completed: 'badge-green', processing: 'badge-blue', 'on-hold': 'badge-yellow', cancelled: 'badge-red', pending: 'badge-gray' }
  const labels = { completed: 'Completado', processing: 'En proceso', 'on-hold': 'En espera', cancelled: 'Cancelado', pending: 'Pendiente' }
  return { cls: map[s] || 'badge-gray', label: labels[s] || s }
}