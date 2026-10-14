import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { fetchOrders } from './woocommerce'
import { esPedidoCobroSaldo } from './pedidos'
import { localDateStr } from './helpers'

const mesKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const mesLabel = (d) => d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })

// Un egreso cuenta como pago de AGIP si salió del botón (origen_agip_venc) o si se cargó a mano
// en impuestos mencionando AGIP / IIBB y cubre al menos la mitad de lo estimado.
// Lo segundo evita confundirlo con percepciones chicas por pedido ("AGIP Pedido #7950").
const esPagoAgip = (e, venc, estimado) => {
  if (e.origen_agip_venc === venc) return true
  if (e.categoria !== 'impuestos') return false
  const texto = `${e.subcategoria || ''} ${e.descripcion || ''}`
  if (!/agip|iibb|ingresos brutos/i.test(texto)) return false
  return parseFloat(e.monto || 0) >= estimado * 0.5
}

// AGIP — Ingresos Brutos mensual: alícuota sobre lo vendido el mes anterior al vencimiento.
// Muestra el período más viejo sin pagar: si el vencimiento de este mes ya pasó y no se pagó,
// queda como vencido en vez de saltar al mes siguiente.
export async function calcAgip(cfg, hoy = new Date()) {
  const alicuota = parseFloat(cfg.iibb_alicuota_pct ?? 4) / 100
  const dia = parseInt(cfg.iibb_dia_venc ?? 10) || 10

  const periodo = async (vencDate) => {
    const base = new Date(vencDate.getFullYear(), vencDate.getMonth() - 1, 1)
    const baseFin = new Date(vencDate.getFullYear(), vencDate.getMonth(), 0, 23, 59, 59)
    const venc = localDateStr(vencDate)
    const inicioMesVenc = localDateStr(new Date(vencDate.getFullYear(), vencDate.getMonth(), 1))
    const finMesVenc = localDateStr(new Date(vencDate.getFullYear(), vencDate.getMonth() + 1, 0))
    const [ords, egrSnap] = await Promise.all([
      fetchOrders(base, baseFin, 'completed,processing'),
      getDocs(query(collection(db, 'egresos'), where('fecha', '>=', inicioMesVenc), where('fecha', '<=', finMesVenc))),
    ])
    const baseImponible = ords.filter(o => !esPedidoCobroSaldo(o)).reduce((s, o) => s + parseFloat(o.total || 0), 0)
    const monto = baseImponible * alicuota
    let pago = null
    egrSnap.forEach(d => { const e = { id: d.id, ...d.data() }; if (!pago && esPagoAgip(e, venc, monto)) pago = e })
    return {
      monto, base: baseImponible, venc,
      days: Math.round((new Date(venc + 'T00:00:00') - new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())) / 86400000),
      mes: mesKey(base), mesLabel: mesLabel(base),
      alicuotaPct: alicuota * 100,
      pagado: !!pago, pago,
    }
  }

  const vencEsteMes = new Date(hoy.getFullYear(), hoy.getMonth(), dia)
  const actual = await periodo(vencEsteMes)
  const hoyStr = localDateStr(hoy)
  if (actual.venc < hoyStr && actual.pagado) {
    return periodo(new Date(hoy.getFullYear(), hoy.getMonth() + 1, dia))
  }
  return actual
}

// Recategorización del monotributo: en enero (se evalúa ene–dic) y en julio (se evalúa jul–jun).
export function proximaRecategorizacion(hoy = new Date()) {
  const y = hoy.getFullYear()
  const enPrimerSemestre = hoy.getMonth() < 6
  const corte = enPrimerSemestre ? new Date(y, 5, 30) : new Date(y, 11, 31)
  const inicioVentana = new Date(corte.getFullYear(), corte.getMonth() - 11, 1)
  const mesRecat = enPrimerSemestre ? new Date(y, 6, 1) : new Date(y + 1, 0, 1)
  return { corte, inicioVentana, mesRecat, mesRecatLabel: mesLabel(mesRecat) }
}

// Facturación del monotributo: 12 meses móviles + proyección al próximo corte de recategorización,
// usando el promedio de los últimos 3 meses completos como ritmo de venta.
export async function calcMonotributo(cfg, hoy = new Date()) {
  const techo = parseFloat(cfg.monotributo_techo || 0)
  const desde = new Date(hoy.getFullYear(), hoy.getMonth() - 11, 1)
  const ords = (await fetchOrders(desde, hoy, 'completed,processing')).filter(o => !esPedidoCobroSaldo(o))

  const porMes = {}
  ords.forEach(o => {
    const k = String(o.date_created || '').slice(0, 7)
    if (k) porMes[k] = (porMes[k] || 0) + parseFloat(o.total || 0)
  })
  const facturado = Object.values(porMes).reduce((s, v) => s + v, 0)

  const meses = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1)
    meses.push({ mes: mesKey(d), label: d.toLocaleDateString('es-AR', { month: 'short' }), monto: porMes[mesKey(d)] || 0 })
  }

  const completos = meses.slice(-4, -1) // los 3 meses anteriores al actual
  const ritmo = completos.reduce((s, m) => s + m.monto, 0) / 3

  const recat = proximaRecategorizacion(hoy)
  const inicioVentanaKey = mesKey(recat.inicioVentana)
  const facturadoVentana = meses.filter(m => m.mes >= inicioVentanaKey).reduce((s, m) => s + m.monto, 0)
  // Meses que faltan hasta el corte, contando el resto del mes actual como fracción
  const diasMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate()
  const restoMesActual = 1 - hoy.getDate() / diasMes
  const mesesEnteros = (recat.corte.getFullYear() - hoy.getFullYear()) * 12 + (recat.corte.getMonth() - hoy.getMonth())
  const proyectado = facturadoVentana + ritmo * (mesesEnteros + restoMesActual)

  return {
    techo, facturado, pct: techo ? facturado / techo * 100 : null,
    meses, ritmo, recat, facturadoVentana, proyectado,
    pctProyectado: techo ? proyectado / techo * 100 : null,
  }
}
