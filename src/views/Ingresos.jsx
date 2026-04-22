import { useEffect, useState } from 'react'
import { fetchOrders } from '../utils/woocommerce'
import { fmt, fmtDate, statusBadge } from '../utils/helpers'
import { usePeriod } from '../context/PeriodContext'

const COBRO_SALDO_SKU = 'CS'
const COBRO_SALDO_NOMBRE = 'Cobro Saldo'

function esPedidoCobroSaldo(order) {
  const items = order.line_items || []
  return items.length > 0 && items.every(
    item => item.sku === COBRO_SALDO_SKU || item.name === COBRO_SALDO_NOMBRE
  )
}

function getIngresoReal(order) {
  const historial = order.io_pagos_historial
  if (Array.isArray(historial) && historial.length > 0) {
    return historial.reduce((s, p) => s + (parseFloat(p.monto) || 0), 0)
  }
  return parseFloat(order.total || 0)
}

function getTiposPago(order) {
  const historial = order.io_pagos_historial
  if (!Array.isArray(historial) || historial.length === 0) return null
  const tipos = [...new Set(historial.map(p => p.tipo))]
  return tipos
}

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

    // Filtrar pedidos de Cobro Saldo (flujo viejo)
    const filtrados = ords.filter(o => !esPedidoCobroSaldo(o))

    const total = filtrados.reduce((s, o) => s + getIngresoReal(o), 0)
    const shipping = filtrados.reduce((s, o) => s + parseFloat(o.shipping_total || 0), 0)
    setKpis({ total, avg: filtrados.length ? total / filtrados.length : 0, shipping, count: filtrados.length })
    setOrders(filtrados)
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
        {loading
          ? <div className="loading-state"><div className="spinner" /><p style={{ marginTop: 12 }}>Cargando...</p></div>
          : orders.length === 0
            ? <div className="empty-state"><p>Sin órdenes en el período</p></div>
            : (
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Cliente</th>
                    <th>Fecha</th>
                    <th>Productos</th>
                    <th className="text-right">Envío</th>
                    <th className="text-right">Total</th>
                    <th>Pago</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map(o => {
                    const { cls, label } = statusBadge(o.status)
                    const ingresoReal = getIngresoReal(o)
                    const totalOriginal = parseFloat(o.total || 0)
                    const tieneHistorial = Array.isArray(o.io_pagos_historial) && o.io_pagos_historial.length > 0
                    const tipos = getTiposPago(o)
                    return (
                      <tr key={o.id}>
                        <td><strong>#{o.number}</strong></td>
                        <td>
                          {o.billing?.first_name} {o.billing?.last_name}<br />
                          <small style={{ color: 'var(--text-muted)' }}>{o.billing?.email}</small>
                        </td>
                        <td>{fmtDate(o.date_created)}</td>
                        <td style={{ fontSize: 12, maxWidth: 180 }}>
                          {(o.line_items || []).map(i => `${i.name} ×${i.quantity}`).join(', ')}
                        </td>
                        <td className="text-right">{fmt(o.shipping_total)}</td>
                        <td className="text-right">
                          <strong>{fmt(ingresoReal)}</strong>
                          {tieneHistorial && ingresoReal !== totalOriginal && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              pedido: {fmt(totalOriginal)}
                            </div>
                          )}
                        </td>
                        <td>
                          {tipos ? (
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {tipos.map(t => (
                                <span key={t} style={{
                                  fontSize: 11, padding: '2px 6px', borderRadius: 10,
                                  background: t === 'seña' ? '#fff3cd' : t === 'saldo' ? '#d1fae5' : '#dbeafe',
                                  color: t === 'seña' ? '#92400e' : t === 'saldo' ? '#065f46' : '#1e40af',
                                }}>
                                  {t === 'seña' ? '🟡 Seña' : t === 'saldo' ? '🟢 Saldo' : '✅ Completo'}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>
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
