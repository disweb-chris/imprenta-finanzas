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

export const todayStr = () => new Date().toISOString().split('T')[0]

export const daysUntil = (dateStr) => {
  if (!dateStr) return null
  const d = parseLocalDate(dateStr)
  d.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((d - today) / 86400000)
}

export const DEFAULT_CATS = [
  { id: 'alquiler',      nombre: 'Alquiler',       color: '#6366f1' },
  { id: 'insumos',       nombre: 'Insumos',         color: '#0ea5e9' },
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
