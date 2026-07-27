import { useEffect, useState } from 'react'
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore'
import { Line } from 'react-chartjs-2'
import { Chart, CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend } from 'chart.js'
import { db } from '../firebase/config'
import { fetchOrders } from '../utils/woocommerce'
import { fmt, localDateStr } from '../utils/helpers'
import { esPedidoCobroSaldo, getIngresoReal, calcularComisionMP } from '../utils/pedidos'
import { getAppConfig } from '../utils/appConfig'
import { usePeriod } from '../context/PeriodContext'
import { useCats } from '../context/CatContext'

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

export default function Reportes() {
  const { getPeriodDates, periodLabel } = usePeriod()
  const { getCat } = useCats()
  const [tab, setTab] = useState('resumen')
  const [resumen, setResumen] = useState(null)
  const [catRows, setCatRows] = useState([])
  const [chartData, setChartData] = useState(null)
  const [deudaChartData, setDeudaChartData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadAll() }, [getPeriodDates])
  useEffect(() => { loadDeudaHistorial() }, [])

  const loadDeudaHistorial = async () => {
    const snap = await getDocs(query(collection(db, 'deuda_historial'), orderBy('mes', 'asc')))
    const rows = []
    snap.forEach(d => rows.push({ id: d.id, ...d.data() }))
    setDeudaChartData({
      labels: rows.map(r => r.mes),
      datasets: [{ label: 'Deuda en cuotas', data: rows.map(r => r.deuda_total || 0), borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,.12)', fill: true, tension: .4, pointRadius: 4 }]
    })
  }

  const loadAll = async () => {
    setLoading(true)
    const { start, end } = getPeriodDates()
    const startStr = localDateStr(start)
    const endStr = localDateStr(end)

    const [ordersRaw, egrSnap, compSnap, appCfg, mpRealesSnap] = await Promise.all([
      fetchOrders(start, end, 'completed,processing').catch(() => []),
      getDocs(query(collection(db, 'egresos'), where('fecha', '>=', startStr), where('fecha', '<=', endStr))),
      getDocs(query(collection(db, 'compromisos'), where('estado', '==', 'activo'))),
      getAppConfig(),
      getDocs(collection(db, 'comisiones_mp_reales')),
    ])

    const orders = ordersRaw.filter(o => !esPedidoCobroSaldo(o))
    const totalIngresos = orders.reduce((s, o) => s + getIngresoReal(o), 0)

    const realesPorMes = {}
    mpRealesSnap.forEach(d => { realesPorMes[d.id] = parseFloat(d.data().monto || 0) })
    const comisionMPCalc = calcularComisionMP(orders, appCfg.mp_comision_pct, realesPorMes)
    let totalEgresos = 0
    const catTotals = {}
    egrSnap.forEach(d => {
      const x = d.data()
      const m = parseFloat(x.monto || 0)
      totalEgresos += m
      catTotals[x.categoria] = (catTotals[x.categoria] || 0) + m
    })
    let compMensual = 0
    compSnap.forEach(d => {
      const c = d.data()
      const m = parseFloat(c.monto || 0)
      if (c.frecuencia === 'anual') compMensual += m / 12
      else if (c.frecuencia === 'semanal') compMensual += m * 4.33
      else compMensual += m
    })

    setResumen({
      totalIngresos, totalEgresos, compMensual, balance: totalIngresos - totalEgresos, ordenes: orders.length,
      comisionMP: comisionMPCalc.total, comisionMPTieneReal: comisionMPCalc.detalle.some(x => x.real != null),
    })
    setCatRows(Object.entries(catTotals).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ cat: k, monto: v, pct: totalEgresos > 0 ? (v / totalEgresos * 100).toFixed(1) : 0 })))

    // 12 month chart
    const months = [], ingArr = [], egrArr = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i)
      const s = new Date(d.getFullYear(), d.getMonth(), 1)
      const e = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59)
      months.push(d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' }))
      const [mo, es] = await Promise.all([
        fetchOrders(s, e, 'completed,processing').catch(() => []),
        getDocs(query(collection(db, 'egresos'), where('fecha', '>=', localDateStr(s)), where('fecha', '<=', localDateStr(e))))
      ])
      ingArr.push(mo.filter(o => !esPedidoCobroSaldo(o)).reduce((sum, o) => sum + getIngresoReal(o), 0))
      let et = 0; es.forEach(d => et += parseFloat(d.data().monto || 0))
      egrArr.push(et)
    }
    setChartData({
      labels: months,
      datasets: [
        { label: 'Ingresos', data: ingArr, borderColor: '#2e509e', backgroundColor: 'rgba(46,80,158,.1)', fill: true, tension: .4, pointRadius: 4 },
        { label: 'Egresos', data: egrArr, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,.1)', fill: true, tension: .4, pointRadius: 4 },
      ]
    })
    setLoading(false)
  }

  return (
    <div className="view">
      <div className="view-header"><h2>Reportes</h2><p>{periodLabel()}</p></div>

      <div className="tabs">
        {[['resumen', 'Resumen'], ['categorias', 'Egresos por categoría'], ['comparativa', 'Comparativa mensual'], ['deuda', 'Evolución de deuda']].map(([k, l]) => (
          <button key={k} className={`tab-btn ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'resumen' && resumen && (
        <div className="cards-grid">
          <div className="stat-card card-blue"><div className="card-label">Ingresos</div><div className="card-value">{fmt(resumen.totalIngresos)}</div><div className="card-sub">{resumen.ordenes} órdenes</div></div>
          <div className="stat-card card-red"><div className="card-label">Egresos</div><div className="card-value">{fmt(resumen.totalEgresos)}</div></div>
          <div className="stat-card card-orange"><div className="card-label">Compromisos /mes</div><div className="card-value">{fmt(resumen.compMensual)}</div></div>
          <div className="stat-card card-green"><div className="card-label">Balance neto</div><div className="card-value" style={{ color: resumen.balance >= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmt(resumen.balance)}</div></div>
          <div className="stat-card" style={{ borderLeft: '4px solid #009ee3' }}>
            <div className="card-label">💳 Comisión MP {resumen.comisionMPTieneReal ? '' : 'estimada'}</div>
            <div className="card-value" style={{ fontSize: 20 }}>{fmt(resumen.comisionMP)}</div>
          </div>
        </div>
      )}

      {tab === 'categorias' && (
        <div className="table-card">
          <div className="table-card-header"><h3>Egresos por categoría</h3></div>
          {catRows.length === 0 ? <div className="empty-state"><p>Sin egresos en el período</p></div> :
            <table>
              <thead><tr><th>Categoría</th><th className="text-right">Monto</th><th className="text-right">% del total</th></tr></thead>
              <tbody>
                {catRows.map(r => {
                  const cat = getCat(r.cat)
                  return <tr key={r.cat}><td><span className="cat-dot" style={{ background: cat.color }} />{cat.nombre}</td><td className="text-right"><strong>{fmt(r.monto)}</strong></td><td className="text-right">{r.pct}%</td></tr>
                })}
              </tbody>
            </table>
          }
        </div>
      )}

      {tab === 'comparativa' && (
        <div className="chart-card">
          <h3>Últimos 12 meses</h3>
          {loading ? <div className="loading-state"><div className="spinner" /></div> :
            chartData && <div style={{ height: 300 }}><Line data={chartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { family: 'Poppins', size: 11 } } } }, scales: { y: { ticks: { callback: v => '$' + Math.round(v / 1000) + 'k' } } } }} /></div>
          }
        </div>
      )}

      {tab === 'deuda' && (
        <div className="chart-card">
          <h3>Evolución de deuda en cuotas</h3>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -8, marginBottom: 16 }}>
            Snapshot mensual tomado al hacer un cierre de caja
          </p>
          {!deudaChartData || deudaChartData.labels.length === 0
            ? <div className="empty-state"><p>Sin snapshots de deuda todavía — se registran al hacer un cierre de caja</p></div>
            : <div style={{ height: 300 }}><Line data={deudaChartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { family: 'Poppins', size: 11 } } } }, scales: { y: { ticks: { callback: v => '$' + Math.round(v / 1000) + 'k' } } } }} /></div>
          }
        </div>
      )}
    </div>
  )
}
