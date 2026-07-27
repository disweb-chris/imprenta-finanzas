import { useEffect, useState } from 'react'
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore'
import { Bar, Doughnut } from 'react-chartjs-2'
import { Chart, CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend } from 'chart.js'
import { db } from '../firebase/config'
import { fetchOrders } from '../utils/woocommerce'
import { fmt, fmtDate, statusBadge, localDateStr } from '../utils/helpers'
import { esPedidoCobroSaldo, getIngresoReal, calcularComisionMP } from '../utils/pedidos'
import { getAppConfig } from '../utils/appConfig'
import { usePeriod } from '../context/PeriodContext'
import { useCats } from '../context/CatContext'

Chart.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

export default function Dashboard() {
  const { getPeriodDates, periodLabel } = usePeriod()
  const { getCat } = useCats()
  const [loading, setLoading] = useState(true)
  const [kpis, setKpis] = useState({
    vendido: 0, egresos: 0, balance: 0, compMes: 0, ordenes: 0, compItems: 0,
    cobrado: 0, pendiente: 0, ingresosExtra: 0, saldoBanco: 0, saldoEfectivo: 0
  })
  const [comisionMP, setComisionMP] = useState({ total: 0, tieneReal: false })
  const [senasActivas, setSenasActivas] = useState([])
  const [orders, setOrders] = useState([])
  const [overviewData, setOverviewData] = useState(null)
  const [catData, setCatData] = useState(null)

  useEffect(() => { loadAll() }, [getPeriodDates])

  const loadAll = async () => {
    setLoading(true)
    const { start, end } = getPeriodDates()
    const startStr = localDateStr(start)
    const endStr = localDateStr(end)

    const [ords, egrSnap, compSnap, cierreSnap, extraSnap, appCfg, mpRealesSnap] = await Promise.all([
      fetchOrders(start, end, 'completed,processing,on-hold').catch(() => []),
      getDocs(query(collection(db, 'egresos'), where('fecha', '>=', startStr), where('fecha', '<=', endStr))),
      getDocs(query(collection(db, 'compromisos'), where('estado', '==', 'activo'))),
      getDocs(query(collection(db, 'cierres_caja'), orderBy('timestamp', 'desc'), limit(1))),
      getDocs(query(collection(db, 'ingresos_extra'), where('fecha', '>=', startStr), where('fecha', '<=', endStr))),
      getAppConfig(),
      getDocs(collection(db, 'comisiones_mp_reales')),
    ])

    // Filtrar cobro saldo
    const filtrados = ords.filter(o => !esPedidoCobroSaldo(o))

    // Comisión MercadoPago estimada — reemplazada por el monto real cuando está cargado
    const realesPorMes = {}
    mpRealesSnap.forEach(d => { realesPorMes[d.id] = parseFloat(d.data().monto || 0) })
    const comisionMPCalc = calcularComisionMP(filtrados, appCfg.mp_comision_pct, realesPorMes)
    setComisionMP({ total: comisionMPCalc.total, tieneReal: comisionMPCalc.detalle.some(x => x.real != null) })

    // Vendido: valor total de los pedidos del período (independiente de lo cobrado)
    const vendido = filtrados.reduce((s, o) => s + parseFloat(o.total || 0), 0)

    // Cobrado y pendiente desde io_pagos_historial
    let cobrado = 0
    let pendiente = 0
    const senasArr = []

    filtrados.forEach(o => {
      const historial = o.io_pagos_historial || []
      const montoCobrado = getIngresoReal(o)
      const totalPedido = parseFloat(o.total || 0)
      cobrado += montoCobrado

      if (historial.length > 0) {
        const saldo = totalPedido - montoCobrado
        if (saldo > 0) {
          pendiente += saldo
          senasArr.push({
            id: o.id,
            number: o.number,
            cliente: `${o.billing?.first_name || ''} ${o.billing?.last_name || ''}`.trim(),
            cobrado: montoCobrado,
            pendiente: saldo,
            total: totalPedido,
          })
        }
      }
    })

    setSenasActivas(senasArr)

    let totalEgresos = 0
    const egrDocs = []
    egrSnap.forEach(d => { const x = d.data(); egrDocs.push(x); totalEgresos += parseFloat(x.monto || 0) })

    let ingresosExtra = 0
    extraSnap.forEach(d => { ingresosExtra += parseFloat(d.data().monto || 0) })

    const now = new Date()
    let compMes = 0, compItems = 0
    compSnap.forEach(d => {
      const c = d.data()
      if (!c.fecha_proximo_pago) return
      const fp = new Date(c.fecha_proximo_pago)
      if (fp.getFullYear() === now.getFullYear() && fp.getMonth() === now.getMonth()) {
        compMes += parseFloat(c.monto || 0); compItems++
      }
    })

    // Saldo banco y efectivo del último cierre
    let saldoBanco = 0, saldoEfectivo = 0
    cierreSnap.forEach(d => {
      const c = d.data()
      saldoBanco = parseFloat(c.saldo_banco || c.saldo_final || 0)
      saldoEfectivo = parseFloat(c.saldo_efectivo || 0)
    })

    setKpis({
      vendido, egresos: totalEgresos,
      balance: cobrado + ingresosExtra - totalEgresos,
      compMes, ordenes: filtrados.length, compItems,
      cobrado, pendiente, ingresosExtra, saldoBanco, saldoEfectivo
    })
    setOrders(filtrados.slice(0, 8))

    // Cat chart
    const catTotals = {}
    egrDocs.forEach(e => { catTotals[e.categoria] = (catTotals[e.categoria] || 0) + parseFloat(e.monto || 0) })
    const cats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 6)
    if (cats.length) setCatData({
      labels: cats.map(([k]) => getCat(k).nombre),
      datasets: [{ data: cats.map(([, v]) => v), backgroundColor: cats.map(([k]) => getCat(k).color), borderWidth: 2 }]
    })

    // Overview chart
    const months = [], ingArr = [], egrArr = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i)
      const s = new Date(d.getFullYear(), d.getMonth(), 1)
      const e = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59)
      months.push(d.toLocaleDateString('es-AR', { month: 'short' }))
      const [mo, es] = await Promise.all([
        fetchOrders(s, e, 'completed,processing').catch(() => []),
        getDocs(query(collection(db, 'egresos'), where('fecha', '>=', localDateStr(s)), where('fecha', '<=', localDateStr(e))))
      ])
      const mof = mo.filter(o => !esPedidoCobroSaldo(o))
      ingArr.push(mof.reduce((sum, o) => sum + getIngresoReal(o), 0))
      let et = 0; es.forEach(d => et += parseFloat(d.data().monto || 0))
      egrArr.push(et)
    }
    setOverviewData({
      labels: months,
      datasets: [
        { label: 'Ingresos', data: ingArr, backgroundColor: 'rgba(46,80,158,.75)', borderRadius: 5 },
        { label: 'Egresos', data: egrArr, backgroundColor: 'rgba(239,68,68,.65)', borderRadius: 5 },
      ]
    })
    setLoading(false)
  }

  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { font: { family: 'Poppins', size: 11 } } } },
    scales: { y: { ticks: { callback: v => '$' + Math.round(v / 1000) + 'k', font: { family: 'Poppins', size: 10 } } } }
  }

  return (
    <div className="view">
      <div className="view-header"><h2>Dashboard</h2><p>{periodLabel()}</p></div>

      {/* KPIs principales — Vendido / Cobrado / Por cobrar como números separados */}
      <div className="cards-grid">
        <div className="stat-card card-blue">
          <div className="card-label">Vendido</div>
          <div className="card-value">{fmt(kpis.vendido)}</div>
          <div className="card-sub">{kpis.ordenes} órdenes</div>
        </div>
        <div className="stat-card" style={{ borderLeft: '4px solid var(--success)' }}>
          <div className="card-label">💰 Cobrado</div>
          <div className="card-value" style={{ color: 'var(--success)' }}>{fmt(kpis.cobrado)}</div>
          <div className="card-sub">ingresado al período</div>
        </div>
        <div className="stat-card" style={{ borderLeft: '4px solid #f59e0b' }}>
          <div className="card-label">⏳ Por cobrar</div>
          <div className="card-value" style={{ color: '#f59e0b' }}>{fmt(kpis.pendiente)}</div>
          <div className="card-sub">{senasActivas.length} trabajo{senasActivas.length !== 1 ? 's' : ''} con saldo</div>
        </div>
        <div className="stat-card card-red">
          <div className="card-label">Egresos</div>
          <div className="card-value">{fmt(kpis.egresos)}</div>
        </div>
      </div>

      <div className="cards-grid">
        <div className="stat-card" style={{ borderLeft: '4px solid #14b8a6' }}>
          <div className="card-label">➕ Ingresos extra</div>
          <div className="card-value" style={{ fontSize: 20 }}>{fmt(kpis.ingresosExtra)}</div>
          <div className="card-sub">créditos, transferencias, etc.</div>
        </div>
        <div className="stat-card card-green">
          <div className="card-label">Balance Neto</div>
          <div className="card-value" style={{ color: kpis.balance >= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmt(kpis.balance)}</div>
          <div className="card-sub">cobrado + ingresos extra − egresos</div>
        </div>
        <div className="stat-card card-orange">
          <div className="card-label">Compromisos (mes)</div>
          <div className="card-value">{fmt(kpis.compMes)}</div>
          <div className="card-sub">{kpis.compItems} vencen este mes</div>
        </div>
        <div className="stat-card" style={{ borderLeft: '4px solid #2e509e' }}>
          <div className="card-label">🏦 Banco</div>
          <div className="card-value" style={{ fontSize: 20 }}>{fmt(kpis.saldoBanco)}</div>
          <div className="card-sub">último cierre</div>
        </div>
        <div className="stat-card" style={{ borderLeft: '4px solid #FF6B00' }}>
          <div className="card-label">💵 Efectivo</div>
          <div className="card-value" style={{ fontSize: 20 }}>{fmt(kpis.saldoEfectivo)}</div>
          <div className="card-sub">último cierre</div>
        </div>
        <div className="stat-card" style={{ borderLeft: '4px solid #009ee3' }}>
          <div className="card-label">💳 Comisión MP {comisionMP.tieneReal ? '' : 'estimada'}</div>
          <div className="card-value" style={{ fontSize: 20 }}>{fmt(comisionMP.total)}</div>
          <div className="card-sub">{comisionMP.tieneReal ? 'incluye monto real cargado' : 'no registrada como egreso'}</div>
        </div>
      </div>

      {/* Trabajos con saldo pendiente */}
      {senasActivas.length > 0 && (
        <div className="table-card" style={{ borderLeft: '4px solid #f59e0b' }}>
          <div className="table-card-header">
            <h3>⏳ Saldos pendientes de cobro</h3>
          </div>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Cliente</th>
                <th className="text-right">Total trabajo</th>
                <th className="text-right">Cobrado</th>
                <th className="text-right">Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {senasActivas.map(s => (
                <tr key={s.id}>
                  <td><strong>#{s.number}</strong></td>
                  <td>{s.cliente}</td>
                  <td className="text-right">{fmt(s.total)}</td>
                  <td className="text-right" style={{ color: 'var(--success)' }}>{fmt(s.cobrado)}</td>
                  <td className="text-right" style={{ color: '#f59e0b', fontWeight: 700 }}>{fmt(s.pendiente)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Gráficos */}
      <div className="charts-grid">
        <div className="chart-card">
          <h3>Ingresos vs Egresos — Últimos 6 meses</h3>
          <div style={{ height: 220 }}>{overviewData && <Bar data={overviewData} options={chartOpts} />}</div>
        </div>
        <div className="chart-card">
          <h3>Egresos por categoría</h3>
          <div style={{ height: 220 }}>{catData && <Doughnut data={catData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { family: 'Poppins', size: 10 }, boxWidth: 10 } } } }} />}</div>
        </div>
      </div>

      {/* Últimas órdenes */}
      <div className="table-card">
        <div className="table-card-header"><h3>Últimas órdenes</h3></div>
        {orders.length === 0
          ? <div className="empty-state"><p>Sin órdenes en el período</p></div>
          : (
            <table>
              <thead><tr><th>#</th><th>Cliente</th><th>Fecha</th><th className="text-right">Total</th><th>Estado</th></tr></thead>
              <tbody>
                {orders.map(o => {
                  const { cls, label } = statusBadge(o.status)
                  const h = o.io_pagos_historial || []
                  const totalMostrar = h.length > 0 ? h.reduce((a, p) => a + (parseFloat(p.monto) || 0), 0) : parseFloat(o.total || 0)
                  return (
                    <tr key={o.id}>
                      <td>#{o.number}</td>
                      <td>{o.billing?.first_name} {o.billing?.last_name}</td>
                      <td>{fmtDate(o.date_created)}</td>
                      <td className="text-right"><strong>{fmt(totalMostrar)}</strong></td>
                      <td><span className={`badge ${cls}`}>{label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        }
      </div>
    </div>
  )
}
