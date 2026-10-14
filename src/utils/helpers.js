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

export const statusBadge = (s) => {
  const map = { completed: 'badge-green', processing: 'badge-blue', 'on-hold': 'badge-yellow', cancelled: 'badge-red', pending: 'badge-gray' }
  const labels = { completed: 'Completado', processing: 'En proceso', 'on-hold': 'En espera', cancelled: 'Cancelado', pending: 'Pendiente' }
  return { cls: map[s] || 'badge-gray', label: labels[s] || s }
}
// Medios de pago de egresos. "canje" = pago en especie (trabajo de Imprenta Online).
// "a_pagar" = costo de una cuenta corriente con el proveedor (ver utils/cuentasPagar.js).
export const MEDIO_PAGO = {
  banco:    { label: 'Banco',    badge: 'badge-blue' },
  efectivo: { label: 'Efectivo', badge: 'badge-orange' },
  canje:    { label: 'Canje',    badge: 'badge-gray' },
  a_pagar:  { label: 'A pagar',  badge: 'badge-yellow' },
}
export const medioPagoInfo = (m) => MEDIO_PAGO[m] || MEDIO_PAGO.banco
// Egresos que registran el costo pero no sacan plata de banco ni de efectivo:
// el canje se paga con trabajo y lo 'a_pagar' sale después, como pago de la cuenta corriente.
export const mueveCaja = (medio) => medio !== 'canje' && medio !== 'a_pagar'

// wa.me necesita el número internacional: 549 + área + número, sin 0 ni 15.
// Los teléfonos de WooCommerce suelen venir como "11 15-3456-7890" o "011 3456-7890".
export const waNumero = (telefono) => {
  let d = String(telefono || '').replace(/\D/g, '')
  if (!d) return null
  if (d.startsWith('00')) d = d.slice(2)
  const original = d
  if (d.startsWith('54')) {
    d = d.slice(2)
    if (d.startsWith('9')) d = d.slice(1)
  }
  if (d.startsWith('0')) d = d.slice(1)
  // "15" después del código de área (2 a 4 dígitos) cuando sobran 2 dígitos
  if (d.length === 12) {
    for (const largoArea of [2, 3, 4]) {
      if (d.slice(largoArea, largoArea + 2) === '15') { d = d.slice(0, largoArea) + d.slice(largoArea + 2); break }
    }
  }
  if (d.length === 10) return `549${d}`
  // No parece un número argentino: si es largo, se asume que ya viene con código de país
  return original.length >= 11 && !original.startsWith('54') ? original : null
}

export const waLink = (telefono, texto) => {
  const n = waNumero(telefono)
  if (!n) return null
  return `https://wa.me/${n}` + (texto ? `?text=${encodeURIComponent(texto)}` : '')
}
