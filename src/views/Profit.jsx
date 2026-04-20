import { useEffect, useState, useRef } from 'react'
import { fetchOrders } from '../utils/woocommerce'
import { fmt } from '../utils/helpers'
import { usePeriod } from '../context/PeriodContext'

export default function Profit() {
  const { getPeriodDates, periodLabel } = usePeriod()
  const [products, setProducts] = useState([])
  const [kpis, setKpis] = useState({ ingresos: 0, costo: 0, profit: 0, margen: 0 })
  const [loading, setLoading] = useState(false)
  const cacheRef = useRef({})

  useEffect(() => { load() }, [getPeriodDates])

  const load = async () => {
    setLoading(true)
    cacheRef.current = {}
    const { start, end } = getPeriodDates()
    const orders = await fetchOrders(start, end, 'completed,processing').catch(() => [])
    const map = {}
    for (const order of orders) {
      for (const item of (order.line_items || [])) {
        const pid = item.product_id, vid = item.variation_id || null
        const key = vid ? `v${vid}` : `p${pid}`
        const costMeta = (item.meta_data || []).find(m => m.key === 'yith_cog_item_cost' || m.key === '_yith_cog_item_cost')
        let cost = costMeta ? parseFloat(costMeta.value) || 0 : 0
        if (!cost && !cacheRef.current[key + '_checked']) {
          cacheRef.current[key + '_checked'] = true
          // no fallback fetch to avoid CORS issues
        }
        if (!map[key]) map[key] = { nombre: item.name, cantidad: 0, ingresos: 0, costo_total: 0 }
        const qty = parseInt(item.quantity) || 1
        map[key].cantidad += qty
        map[key].ingresos += parseFloat(item.total) || 0
        map[key].costo_total += cost * qty
      }
    }
    const prods = Object.values(map).map(p => ({ ...p, profit: p.ingresos - p.costo_total, margen: p.ingresos > 0 ? (p.ingresos - p.costo_total) / p.ingresos * 100 : 0 })).sort((a, b) => b.profit - a.profit)
    const totI = prods.reduce((s, p) => s + p.ingresos, 0)
    const totC = prods.reduce((s, p) => s + p.costo_total, 0)
    const totP = totI - totC
    setKpis({ ingresos: totI, costo: totC, profit: totP, margen: totI > 0 ? totP / totI * 100 : 0 })
    setProducts(prods)
    setLoading(false)
  }

  const maxProfit = Math.max(...products.map(p => Math.abs(p.profit)), 1)

  return (
    <div className="view">
      <div className="view-header-row">
        <div><h2>Profit por Producto</h2><p>Ingresos vs costo YITH · {periodLabel()}</p></div>
        <button className="btn btn-primary btn-sm" onClick={load}>↻ Recalcular</button>
      </div>

      <div className="cards-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <div className="stat-card card-blue"><div className="card-label">Ingresos</div><div className="card-value">{fmt(kpis.ingresos)}</div></div>
        <div className="stat-card card-red"><div className="card-label">Costo total</div><div className="card-value">{fmt(kpis.costo)}</div></div>
        <div className="stat-card card-green"><div className="card-label">Profit total</div><div className="card-value" style={{ color: kpis.profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmt(kpis.profit)}</div></div>
        <div className="stat-card card-orange"><div className="card-label">Margen promedio</div><div className="card-value">{kpis.margen.toFixed(1)}%</div></div>
      </div>

      <div className="table-card">
        <div className="table-card-header"><h3>Profit por producto</h3></div>
        {loading ? <div className="loading-state"><div className="spinner" /><p style={{ marginTop: 12 }}>Calculando...</p></div> :
          products.length === 0 ? <div className="empty-state"><p>Sin datos en el período</p></div> :
          <table>
            <thead><tr><th>Producto</th><th className="text-right">Cant.</th><th className="text-right">Ingresos</th><th className="text-right">Costo</th><th className="text-right">Profit</th><th className="text-right">Margen</th><th>Barra</th></tr></thead>
            <tbody>
              {products.map((p, i) => (
                <tr key={i}>
                  <td>{p.nombre}</td>
                  <td className="text-right">{p.cantidad}</td>
                  <td className="text-right">{fmt(p.ingresos)}</td>
                  <td className="text-right">{p.costo_total > 0 ? fmt(p.costo_total) : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>sin costo</span>}</td>
                  <td className={`text-right ${p.profit >= 0 ? 'profit-positive' : 'profit-negative'}`}>{fmt(p.profit)}</td>
                  <td className="text-right">{p.margen.toFixed(1)}%</td>
                  <td style={{ width: 120 }}>
                    <div style={{ height: 6, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 3, background: p.profit >= 0 ? 'var(--success)' : 'var(--danger)', width: `${Math.abs(p.profit) / maxProfit * 100}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      </div>
    </div>
  )
}
