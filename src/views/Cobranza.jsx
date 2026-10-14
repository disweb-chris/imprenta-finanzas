import { useEffect, useState } from 'react'
import { collection, getDocs, setDoc, doc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { fetchOrders, getWCConfig } from '../utils/woocommerce'
import { fmt, fmtDate, statusBadge, waLink } from '../utils/helpers'
import { esPedidoCobroSaldo, saldoPedido } from '../utils/pedidos'
import { useToast } from '../components/Toast'
import { useAuth } from '../context/AuthContext'

const MESES_ATRAS = 6
const DIAS_VENCIDO = 30

const TRAMOS = [
  { key: '0-15', label: '0–15 días', max: 15 },
  { key: '16-30', label: '16–30 días', max: 30 },
  { key: '31-60', label: '31–60 días', max: 60 },
  { key: '60+', label: 'Más de 60', max: Infinity },
]

const diasDesde = (fecha) => Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000)

export default function Cobranza() {
  const toast = useToast()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])
  const [recordatorios, setRecordatorios] = useState({})
  const [filtroTramo, setFiltroTramo] = useState('')
  const [buscar, setBuscar] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const hoy = new Date()
      const desde = new Date(hoy.getFullYear(), hoy.getMonth() - MESES_ATRAS, 1)
      const [ords, recSnap] = await Promise.all([
        fetchOrders(desde, hoy, 'processing,completed,on-hold'),
        getDocs(collection(db, 'cobranza_recordatorios')),
      ])
      const rec = {}
      recSnap.forEach(d => { rec[d.id] = d.data() })
      setRecordatorios(rec)

      const pendientes = ords
        .filter(o => !esPedidoCobroSaldo(o))
        .map(o => {
          const s = saldoPedido(o)
          const dias = diasDesde(o.date_created)
          return {
            id: o.id, number: o.number, status: o.status, fecha: o.date_created, dias,
            tramo: TRAMOS.find(t => dias <= t.max).key,
            cliente: `${o.billing?.first_name || ''} ${o.billing?.last_name || ''}`.trim() || o.billing?.company || 'Sin nombre',
            telefono: o.billing?.phone || '',
            ...s,
          }
        })
        .filter(r => r.saldo > 1)
        .sort((a, b) => b.dias - a.dias)
      setRows(pendientes)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  const recordar = async (r) => {
    const nombre = r.cliente.split(' ')[0]
    const texto = `Hola ${nombre}! Te escribimos de Imprenta Online por tu pedido #${r.number}. ` +
      `Nos queda pendiente un saldo de ${fmt(r.saldo)}. ¿Nos avisás cuando puedas abonarlo? ¡Gracias!`
    const link = waLink(r.telefono, texto)
    if (!link) { toast('El pedido no tiene un teléfono válido', 'error'); return }
    window.open(link, '_blank', 'noopener,noreferrer')
    const data = { fecha: new Date().toISOString(), usuario: user.email, numero: r.number }
    await setDoc(doc(db, 'cobranza_recordatorios', String(r.id)), data)
    setRecordatorios(prev => ({ ...prev, [r.id]: data }))
  }

  const wcUrl = getWCConfig().url
  const linkPedido = (id) => wcUrl ? `${wcUrl}/wp-admin/post.php?post=${id}&action=edit` : null

  const q = buscar.trim().toLowerCase()
  const filtradas = rows.filter(r =>
    (!filtroTramo || r.tramo === filtroTramo) &&
    (!q || r.cliente.toLowerCase().includes(q) || String(r.number).includes(q)))

  const total = rows.reduce((s, r) => s + r.saldo, 0)
  const vencidas = rows.filter(r => r.dias > DIAS_VENCIDO)
  const entregadasSinCobrar = rows.filter(r => r.status === 'completed')
  const porTramo = TRAMOS.map(t => ({ ...t, monto: rows.filter(r => r.tramo === t.key).reduce((s, r) => s + r.saldo, 0) }))

  return (
    <div className="view">
      <div className="view-header-row">
        <div>
          <h2>Cobranza</h2>
          <p>Pedidos con saldo pendiente de los últimos {MESES_ATRAS} meses — señas sin completar y pedidos en espera de pago</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load}>Actualizar</button>
      </div>

      {error && <div className="alert-warning">⚠️ {error}</div>}

      <div className="cards-grid">
        <div className="stat-card" style={{ borderLeft: '4px solid #f59e0b' }}><div className="card-label">Por cobrar</div><div className="card-value" style={{ color: '#f59e0b' }}>{fmt(total)}</div><div className="card-sub">{rows.length} pedido{rows.length !== 1 ? 's' : ''}</div></div>
        <div className="stat-card card-red"><div className="card-label">Más de {DIAS_VENCIDO} días</div><div className="card-value">{fmt(vencidas.reduce((s, r) => s + r.saldo, 0))}</div><div className="card-sub">{vencidas.length} pedido{vencidas.length !== 1 ? 's' : ''}</div></div>
        <div className="stat-card card-orange"><div className="card-label">Entregados sin cobrar</div><div className="card-value">{fmt(entregadasSinCobrar.reduce((s, r) => s + r.saldo, 0))}</div><div className="card-sub">pedidos completados con saldo</div></div>
      </div>

      {rows.length > 0 && (
        <div className="chart-card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginBottom: 12 }}>Antigüedad de la deuda</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            {porTramo.map(t => (
              <button key={t.key} onClick={() => setFiltroTramo(f => f === t.key ? '' : t.key)}
                style={{ textAlign: 'left', padding: 12, borderRadius: 8, cursor: 'pointer', background: filtroTramo === t.key ? '#eff3ff' : '#f8fafc', border: `1.5px solid ${filtroTramo === t.key ? 'var(--blue)' : 'var(--border)'}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{t.label}</div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700, marginTop: 4 }}>{fmt(t.monto)}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="filters">
        <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar cliente o N° de pedido..." />
        {filtroTramo && <button className="btn btn-secondary btn-sm" onClick={() => setFiltroTramo('')}>Quitar filtro de antigüedad</button>}
      </div>

      <div className="table-card">
        <div className="table-card-header"><h3>Saldos pendientes</h3></div>
        {loading
          ? <div className="loading-state"><div className="spinner" /></div>
          : filtradas.length === 0
            ? <div className="empty-state"><p>{rows.length === 0 ? 'No hay pedidos con saldo pendiente 🎉' : 'Nada para mostrar con estos filtros'}</p></div>
            : (
              <table>
                <thead>
                  <tr>
                    <th>Pedido</th><th>Fecha</th><th>Cliente</th><th>Estado</th>
                    <th className="text-right">Total</th><th className="text-right">Cobrado</th><th className="text-right">Saldo</th>
                    <th className="text-center">Recordar</th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map(r => {
                    const st = statusBadge(r.status)
                    const rec = recordatorios[r.id]
                    const link = linkPedido(r.id)
                    return (
                      <tr key={r.id}>
                        <td>{link ? <a href={link} target="_blank" rel="noopener noreferrer"><strong>#{r.number}</strong></a> : <strong>#{r.number}</strong>}</td>
                        <td>{fmtDate(r.fecha)}<div style={{ fontSize: 11, color: r.dias > DIAS_VENCIDO ? 'var(--danger)' : 'var(--text-muted)' }}>hace {r.dias}d</div></td>
                        <td>{r.cliente}</td>
                        <td>
                          <span className={`badge ${st.cls}`}>{st.label}</span>
                          {r.sinPagos && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>sin pagos registrados</div>}
                        </td>
                        <td className="text-right">{fmt(r.total)}</td>
                        <td className="text-right" style={{ color: 'var(--success)' }}>{fmt(r.cobrado)}</td>
                        <td className="text-right"><strong style={{ color: '#f59e0b' }}>{fmt(r.saldo)}</strong></td>
                        <td className="text-center">
                          {waLink(r.telefono)
                            ? <button className="btn btn-secondary btn-sm" onClick={() => recordar(r)}>WhatsApp</button>
                            : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>sin tel.</span>}
                          {rec && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>recordado {fmtDate(rec.fecha.slice(0, 10))}</div>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
        }
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        Los cobros se registran en el pedido de WooCommerce (historial de pagos). Hacé clic en el número de pedido para abrirlo.
      </p>
    </div>
  )
}
