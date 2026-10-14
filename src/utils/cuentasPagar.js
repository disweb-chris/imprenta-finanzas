import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, orderBy } from 'firebase/firestore'
import { db } from '../firebase/config'
import { todayStr, daysUntil } from './helpers'

// Cuentas a pagar a proveedores (cuenta corriente).
//
// Para no contar dos veces el mismo gasto:
// - El COSTO se registra una sola vez como egreso con medio_pago 'a_pagar' (lo ven Rentabilidad,
//   Reportes, Profit y Presupuesto). Caja lo ignora porque todavía no salió plata.
// - Cada PAGO se guarda en 'pagos_proveedores' (no en egresos). Caja lo descuenta del banco o del
//   efectivo según el medio. Un pago en canje cancela deuda sin mover plata.

export const saldoCuenta = (c) => {
  const pagado = (c.pagos || []).reduce((s, p) => s + parseFloat(p.monto || 0), 0)
  return { pagado, saldo: Math.max(parseFloat(c.monto || 0) - pagado, 0) }
}

export const estadoCuenta = (c) => {
  const { pagado, saldo } = saldoCuenta(c)
  if (saldo <= 0.5) return 'pagada'
  const d = daysUntil(c.vencimiento)
  if (d !== null && d < 0) return 'vencida'
  return pagado > 0 ? 'parcial' : 'pendiente'
}

export const ESTADOS_CUENTA = {
  pendiente: { label: 'Pendiente', cls: 'badge-yellow' },
  parcial: { label: 'Pago parcial', cls: 'badge-blue' },
  vencida: { label: 'Vencida', cls: 'badge-red' },
  pagada: { label: 'Pagada', cls: 'badge-green' },
}

export async function loadCuentasPagar({ soloAbiertas = false } = {}) {
  const snap = await getDocs(soloAbiertas
    ? query(collection(db, 'cuentas_pagar'), where('cerrada', '==', false))
    : query(collection(db, 'cuentas_pagar'), orderBy('vencimiento', 'asc')))
  const rows = []
  snap.forEach(d => {
    const c = { id: d.id, ...d.data() }
    rows.push({ ...c, ...saldoCuenta(c), estado: estadoCuenta(c) })
  })
  return rows.sort((a, b) => String(a.vencimiento || '').localeCompare(String(b.vencimiento || '')))
}

// Crea la deuda. Los egresos de costo (medio 'a_pagar') los crea quien llama, porque la Liquidación
// los arma línea por línea con su pedido de origen.
export async function crearCuentaPagar({ proveedor, concepto, monto, fecha, vencimiento, egreso_ids = [], origen_liquidacion = null, usuario }) {
  const ref = await addDoc(collection(db, 'cuentas_pagar'), {
    proveedor, concepto, monto: parseFloat(monto) || 0,
    fecha: fecha || todayStr(), vencimiento: vencimiento || fecha || todayStr(),
    pagos: [], cerrada: false,
    egreso_ids, origen_liquidacion,
    usuario, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  })
  return ref.id
}

export async function registrarPagoCuenta(cuenta, { monto, fecha, medio_pago, usuario }) {
  const m = parseFloat(monto) || 0
  const pagoRef = await addDoc(collection(db, 'pagos_proveedores'), {
    fecha, monto: m, medio_pago,
    cuenta_id: cuenta.id, proveedor: cuenta.proveedor, concepto: cuenta.concepto,
    usuario, createdAt: new Date().toISOString(),
  })
  const pagos = [...(cuenta.pagos || []), { id: pagoRef.id, fecha, monto: m, medio_pago }]
  const { saldo } = saldoCuenta({ ...cuenta, pagos })
  await updateDoc(doc(db, 'cuentas_pagar', cuenta.id), { pagos, cerrada: saldo <= 0.5, updatedAt: new Date().toISOString() })
}

export async function anularPagoCuenta(cuenta, pagoId) {
  await deleteDoc(doc(db, 'pagos_proveedores', pagoId)).catch(() => { /* ya no existe */ })
  const pagos = (cuenta.pagos || []).filter(p => p.id !== pagoId)
  await updateDoc(doc(db, 'cuentas_pagar', cuenta.id), { pagos, cerrada: false, updatedAt: new Date().toISOString() })
}

export async function eliminarCuentaPagar(cuenta, { conEgresos }) {
  await Promise.all((cuenta.pagos || []).map(p => deleteDoc(doc(db, 'pagos_proveedores', p.id)).catch(() => {})))
  if (conEgresos) await Promise.all((cuenta.egreso_ids || []).map(id => deleteDoc(doc(db, 'egresos', id)).catch(() => {})))
  await deleteDoc(doc(db, 'cuentas_pagar', cuenta.id))
}
