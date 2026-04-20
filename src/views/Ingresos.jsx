import { useEffect, useState } from 'react'
import { fetchOrders } from '../utils/woocommerce'
import { fmt, fmtDate, statusBadge } from '../utils/helpers'
import { usePeriod } from '../context/PeriodContext'

export default function Ingresos() {
  const { getPeriodDates, periodLabel } = usePeriod()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('completed')
  const [kpis, setKpis] = useState({ total: 0, avg: 0, shipping: 0, count: 0 })

  useEffect(() => { load() }, [getPeriodDates, status])

  const load = async () => {
    setLoading(true)
    const { start, end } = getPeriodDates()
    const ords = await fetchOrders(start, end, status || 'any').catch(() => [])
    const total = ords.reduce((s, o) => s + parseFloat(o.total || 0), 0)
    const shipping = ords.reduce((s, o) => s + parseFloat(o.shipping_total || 0), 0)
    setKpis({ total, avg: ords.length ? total / ords.length : 0, shipping, count: ords.length })
    setOrders(ords)
    setLoading(false)
  }

  return (
    <div className="view">
      <div className="view-header"><h2>Ingresos</h2><p>Órdenes de WooCommerce — {periodLabel()}</p></div>

      <div className="cards-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="stat-card card-blue"><div className="card-label">Total período</div><div className="card-value">{fmt(kpis.total)}</div><div className="card-sub">{kpis.count} órdenes</div></div>
        <div className="stat-card card-green"><div className="card-label">Ticket promedio</div><div className="card-value">{fmt(kpis.avg)}</div></div>
        <div className="stat-card card-orange"><div className="card-label">Envíos</div><div className="card-value">{fmt(kpis.shipping)}</div></div>
      </div>

      <div className="filters">
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="any">Todos los estados</option>
          <option value="completed">Completado</option>
          <option value="processing">En proceso</option>
          <option value="on-hold">En espera</option>
        </select>
        <button className="btn btn-primary btn-sm" onClick={load}>↻ Actualizar</button>
      </div>

      <div className="table-card">
        <div className="table-card-header"><h3>Órdenes</h3></div>
        {loading ? <div className="loading-state"><div className="spinner" /><p style={{ marginTop: 12 }}>Cargando...</p></div> :
          orders.length === 0 ? <div className="empty-state"><p>Sin órdenes en el período</p></div> :
          <table>
            <thead><tr><th>#</th><th>Cliente</th><th>Fecha</th><th>Productos</th><th className="text-right">Envío</th><th className="text-right">Total</th><th>Estado</th></tr></thead>
            <tbody>
              {orders.map(o => {
                const { cls, label } = statusBadge(o.status)
                return (
                  <tr key={o.id}>
                    <td><strong>#{o.number}</strong></td>
                    <td>{o.billing?.first_name} {o.billing?.last_name}<br /><small style={{ color: 'var(--text-muted)' }}>{o.billing?.email}</small></td>
                    <td>{fmtDate(o.date_created)}</td>
                    <td style={{ fontSize: 12, maxWidth: 180 }}>{(o.line_items || []).map(i => `${i.name} ×${i.quantity}`).join(', ')}</td>
                    <td className="text-right">{fmt(o.shipping_total)}</td>
                    <td className="text-right"><strong>{fmt(o.total)}</strong></td>
                    <td><span className={`badge ${cls}`}>{label}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        }
      </div>
    </div>
  )
}
