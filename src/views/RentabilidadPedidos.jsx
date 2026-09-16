import { useEffect, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { fetchOrders } from '../utils/woocommerce'
import { fmt, fmtDate } from '../utils/helpers'
import { esPedidoCobroSaldo, getIngresoReal } from '../utils/pedidos'
import { usePeriod } from '../context/PeriodContext'

export default function RentabilidadPedidos() {
  const { getPeriodDates, periodLabel } = usePeriod()
  const [loading, setLoading] = useState(true)
  const [pedidos, setPedidos] = useState([])
  const [sortDir, setSortDir] = useState('asc')

  useEffect(() => { loadAll() }, [getPeriodDates])

  const loadAll = async () => {
    setLoading(true)
    const { start, end } = getPeriodDates()

    const [ords, costoSnap] = await Promise.all([
      fetchOrders(start, end, 'completed,processing').catch(() => []),
      getDocs(query(collection(db, 'egresos'), where('categoria', '==', 'produccion-tercerizada'))),
    ])

    // Costo de producción tercerizada por pedido — viene de las líneas de Liquidación
    // vinculadas por pedido (origen_pedido) desde Etapa 1
    const costoPorPedido = {}
    costoSnap.forEach(d => {
      const x = d.data()
      if (!x.origen_pedido) return
      costoPorPedido[x.origen_pedido] = (costoPorPedido[x.origen_pedido] || 0) + parseFloat(x.monto || 0)
    })

    const filtrados = ords.filter(o => !esPedidoCobroSaldo(o))
    const rows = filtrados.map(o => {
      const ingreso = getIngresoReal(o)
      const tieneCosto = Object.prototype.hasOwnProperty.call(costoPorPedido, o.id)
      const costo = tieneCosto ? costoPorPedido[o.id] : null
      const margen = tieneCosto ? ingreso - costo : null
      const margenPct = tieneCosto ? (ingreso > 0 ? (margen / ingreso) * 100 : 0) : null
      return {
        id: o.id,
        number: o.number,
        cliente: `${o.billing?.first_name || ''} ${o.billing?.last_name || ''}`.trim() || '—',
        fecha: o.date_created,
        ingreso,
        costo,
        margen,
        margenPct,
      }
    })

    setPedidos(rows)
    setLoading(false)
  }

  const toggleSort = () => setSortDir(d => d === 'asc' ? 'desc' : 'asc')

  const sorted = [...pedidos].sort((a, b) => {
    // Los N/D (sin costo por pedido) van siempre al final
    if (a.margenPct === null && b.margenPct === null) return 0
    if (a.margenPct === null) return 1
    if (b.margenPct === null) return -1
    return sortDir === 'asc' ? a.margenPct - b.margenPct : b.margenPct - a.margenPct
  })

  const conCosto = pedidos.filter(p => p.margenPct !== null)
  const margenPromedio = conCosto.length ? conCosto.reduce((s, p) => s + p.margenPct, 0) / conCosto.length : 0

  return (
    <div className="view">
      <div className="view-header"><h2>Rentabilidad por Pedido</h2><p>{periodLabel()}</p></div>

      <div className="cards-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="stat-card card-blue"><div className="card-label">Pedidos en el período</div><div className="card-value">{pedidos.length}</div></div>
        <div className="stat-card card-green">
          <div className="card-label">Con costo por pedido</div>
          <div className="card-value">{conCosto.length}</div>
          <div className="card-sub">{pedidos.length - conCosto.length} sin liquidar / insumos propios</div>
        </div>
        <div className="stat-card card-orange"><div className="card-label">Margen % promedio</div><div className="card-value">{conCosto.length ? margenPromedio.toFixed(1) + '%' : '—'}</div></div>
      </div>

      <div className="table-card">
        <div className="table-card-header">
          <h3>Pedidos</h3>
          <button className="btn btn-secondary btn-sm" onClick={toggleSort}>
            Margen % {sortDir === 'asc' ? '↑ peor primero' : '↓ mejor primero'}
          </button>
        </div>
        {loading
          ? <div className="loading-state"><div className="spinner" /></div>
          : sorted.length === 0
            ? <div className="empty-state"><p>Sin pedidos en el período</p></div>
            : (
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Cliente</th>
                    <th>Fecha</th>
                    <th className="text-right">Ingreso cobrado</th>
                    <th className="text-right">Costo producción</th>
                    <th className="text-right">Margen $</th>
                    <th className="text-right">Margen %</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(p => (
                    <tr key={p.id}>
                      <td><strong>#{p.number}</strong></td>
                      <td>{p.cliente}</td>
                      <td>{fmtDate(p.fecha)}</td>
                      <td className="text-right">{fmt(p.ingreso)}</td>
                      <td className="text-right">
                        {p.costo !== null ? fmt(p.costo) : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                      </td>
                      <td className="text-right" style={{ fontWeight: 700, color: p.margen === null ? 'var(--text-muted)' : p.margen >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {p.margen !== null ? fmt(p.margen) : '-'}
                      </td>
                      <td className="text-right">
                        {p.margenPct !== null
                          ? <span style={{ fontWeight: 700, color: p.margenPct >= 0 ? 'var(--success)' : 'var(--danger)' }}>{p.margenPct.toFixed(1)}%</span>
                          : <span style={{ fontSize: 11, color: 'var(--text-muted)' }} title="Costo por insumos propios, no vinculado a un pedido de Liquidación">N/D — costo por insumos, no por pedido</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
        }
      </div>
    </div>
  )
}
