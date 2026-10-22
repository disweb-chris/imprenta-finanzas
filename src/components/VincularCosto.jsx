import { useEffect, useState } from 'react'
import { collection, getDocs, doc, updateDoc, query, orderBy, limit } from 'firebase/firestore'
import { db } from '../firebase/config'
import { findOrder, cargarCostosPedido } from '../utils/woocommerce'
import { COBRO_SALDO_SKU, COBRO_SALDO_NOMBRE, costoLinea } from '../utils/pedidos'
import { fmt, fmtDate } from '../utils/helpers'
import { useToast } from './Toast'
import { useAuth } from '../context/AuthContext'

const lineasDelPedido = (order) => (order?.line_items || [])
  .filter(i => i.sku !== COBRO_SALDO_SKU && i.name !== COBRO_SALDO_NOMBRE)

// Propuesta inicial: el producto N del costo va a la línea N del pedido
const asignacionInicial = (order, costo) => {
  const lineas = lineasDelPedido(order)
  const items = costo?.items || []
  const asign = {}
  lineas.forEach((l, i) => { asign[l.id] = i < items.length ? String(i) : '' })
  return asign
}

// Modal para enlazar un costo de la calculadora con un pedido de WooCommerce y cargar ese
// costo en cada producto del pedido (plugin IO Costos). Recibe el costo, el pedido o los dos;
// lo que falte se elige adentro.
export default function VincularCosto({ costo: costoInicial = null, order: orderInicial = null, onClose, onAplicado }) {
  const toast = useToast()
  const { user } = useAuth()

  const [costo, setCosto] = useState(costoInicial)
  const [order, setOrder] = useState(orderInicial)
  const [asign, setAsign] = useState(() => asignacionInicial(orderInicial, costoInicial))

  const [costos, setCostos] = useState([])
  const [cargandoCostos, setCargandoCostos] = useState(!costoInicial)
  const [filtro, setFiltro] = useState('')

  const [numero, setNumero] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [aplicando, setAplicando] = useState(false)

  useEffect(() => {
    if (costoInicial) return
    getDocs(query(collection(db, 'costos'), orderBy('createdAt', 'desc'), limit(200)))
      .then(snap => {
        const rows = []
        snap.forEach(d => rows.push({ id: d.id, ...d.data() }))
        setCostos(rows)
      })
      .catch(e => toast('No se pudieron leer los costos: ' + e.message, 'error'))
      .finally(() => setCargandoCostos(false))
  }, [costoInicial, toast])

  const elegirCosto = (c) => { setCosto(c); setAsign(asignacionInicial(order, c)) }

  const buscarPedido = async () => {
    setBuscando(true)
    try {
      const o = await findOrder(numero)
      if (!o) toast(`No se encontró el pedido #${numero}`, 'error')
      else { setOrder(o); setAsign(asignacionInicial(o, costo)) }
    } catch (e) {
      toast('Error al buscar el pedido: ' + e.message, 'error')
    }
    setBuscando(false)
  }

  const lineas = lineasDelPedido(order)
  const items = costo?.items || []

  // Si un producto del costo va a varias líneas, su costo se reparte en partes iguales
  const lineasPorItem = {}
  Object.values(asign).forEach(v => { if (v !== '') lineasPorItem[v] = (lineasPorItem[v] || 0) + 1 })
  const costoAsignado = (lineId) => {
    const v = asign[lineId]
    if (v === '' || v === undefined || !items[v]) return null
    return items[v].costo / lineasPorItem[v]
  }
  const totalAsignado = lineas.reduce((s, l) => s + (costoAsignado(l.id) || 0), 0)
  const itemsSinUsar = items.filter((_, i) => !lineasPorItem[String(i)])

  const aplicar = async () => {
    const aEnviar = lineas.filter(l => costoAsignado(l.id) !== null)
    if (!aEnviar.length) { toast('Elegí qué producto del costo va en cada línea', 'error'); return }
    setAplicando(true)
    try {
      const ioCostos = await cargarCostosPedido(order.id, aEnviar.map(l => {
        const qty = parseFloat(l.quantity) || 0
        const total = costoAsignado(l.id)
        return { id: l.id, costo_unitario: qty > 0 ? total / qty : total }
      }), `costo de ${costo.cliente_nombre || 'la calculadora'}`)

      const ahora = new Date().toISOString()
      const vinculo = {
        estado: 'aplicado',
        pedido_id: order.id,
        pedido_numero: order.number,
        asignaciones: aEnviar.map(l => ({
          line_id: l.id, linea_nombre: l.name, item_idx: Number(asign[l.id]),
          item_nombre: items[asign[l.id]].nombre, costo: costoAsignado(l.id),
        })),
        costo_aplicado: aEnviar.reduce((s, l) => s + costoAsignado(l.id), 0),
        aplicadoAt: ahora,
        updatedAt: ahora,
        usuario: user.email,
      }
      await updateDoc(doc(db, 'costos', costo.id), vinculo)
      if (costo.cotizacion_id) {
        await updateDoc(doc(db, 'cotizaciones', costo.cotizacion_id), {
          estado: 'convertido', pedido_id: order.id, pedido_numero: order.number, updatedAt: ahora,
        }).catch(() => { /* la cotización se borró: el costo igual queda vinculado */ })
      }

      toast(`Costo cargado en el pedido #${order.number}`, 'success')
      onAplicado?.({ order: { ...order, io_costos: ioCostos }, costo: { ...costo, ...vinculo } })
      onClose()
    } catch (e) {
      toast('No se pudo cargar el costo: ' + e.message, 'error')
    }
    setAplicando(false)
  }

  // Primero los del mismo cliente del pedido y los que todavía no se usaron
  const q = filtro.trim().toLowerCase()
  const costosVisibles = costos
    .filter(c => !q || `${c.cliente_nombre} ${c.cliente_email} ${(c.items || []).map(i => i.nombre).join(' ')}`.toLowerCase().includes(q))
    .sort((a, b) => {
      const pa = (order && a.cliente_wc_id && a.cliente_wc_id === order.customer_id ? 0 : 2) + (a.estado === 'aplicado' ? 1 : 0)
      const pb = (order && b.cliente_wc_id && b.cliente_wc_id === order.customer_id ? 0 : 2) + (b.estado === 'aplicado' ? 1 : 0)
      return pa - pb
    })

  return (
    <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 680 }}>
        <div className="modal-header">
          <h3>Traer costo de la calculadora</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {/* 1. Costo */}
        {costo ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, marginBottom: 14, padding: '10px 12px', background: 'var(--bg)', borderRadius: 8 }}>
            <span>
              Costo de <strong>{costo.cliente_nombre}</strong> — {fmtDate(costo.fecha)} — {items.length} producto(s) — <strong>{fmt(costo.costo_total)}</strong>
              {costo.pedido_numero && <div style={{ fontSize: 11, color: 'var(--warning)' }}>Ya está vinculado al pedido #{costo.pedido_numero}: si seguís, queda vinculado a este.</div>}
            </span>
            {!costoInicial && <button className="btn btn-secondary btn-sm" onClick={() => setCosto(null)}>Cambiar</button>}
          </div>
        ) : (
          <div className="field">
            <label>Elegí el costo guardado</label>
            <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar por cliente o producto..." />
            {cargandoCostos
              ? <div className="loading-state"><div className="spinner" /></div>
              : (
                <div style={{ border: '1px solid var(--border)', borderRadius: 7, marginTop: 6, maxHeight: 220, overflowY: 'auto' }}>
                  {costosVisibles.length === 0 && <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)' }}>No hay costos guardados. Se guardan desde la Calculadora.</div>}
                  {costosVisibles.map(c => (
                    <div key={c.id} onClick={() => elegirCosto(c)}
                      style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span>
                        <strong>{c.cliente_nombre}</strong> — {fmtDate(c.fecha)}
                        <div style={{ color: 'var(--text-muted)' }}>{(c.items || []).map(i => i.nombre).join(' · ')}</div>
                      </span>
                      <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <strong>{fmt(c.costo_total)}</strong>
                        <div>{c.estado === 'aplicado'
                          ? <span className="badge badge-green">#{c.pedido_numero}</span>
                          : <span className="badge badge-gray">Sin vincular</span>}</div>
                      </span>
                    </div>
                  ))}
                </div>
              )}
          </div>
        )}

        {/* 2. Pedido */}
        {order ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, marginBottom: 14, padding: '10px 12px', background: 'var(--bg)', borderRadius: 8 }}>
            <span>
              Pedido <strong>#{order.number}</strong> — {`${order.billing?.first_name || ''} ${order.billing?.last_name || ''}`.trim() || 'sin nombre'} — {fmt(parseFloat(order.total || 0))}
            </span>
            {!orderInicial && <button className="btn btn-secondary btn-sm" onClick={() => setOrder(null)}>Cambiar</button>}
          </div>
        ) : (
          <div className="field">
            <label>Número de pedido</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={numero} onChange={e => setNumero(e.target.value)} placeholder="Ej: 12345" inputMode="numeric"
                onKeyDown={e => e.key === 'Enter' && buscarPedido()} style={{ flex: 1 }} />
              <button className="btn btn-secondary" onClick={buscarPedido} disabled={buscando || !numero.trim()}>
                {buscando ? 'Buscando...' : 'Buscar'}
              </button>
            </div>
          </div>
        )}

        {/* 3. Qué producto del costo va en cada línea */}
        {costo && order && (
          <>
            {!order.io_costos && (
              <div className="alert-warning" style={{ marginBottom: 12 }}>
                ⚠️ La tienda no devolvió los costos del pedido. Revisá que IO Costos esté en la versión 1.3.0 o más nueva.
              </div>
            )}
            <table>
              <thead>
                <tr>
                  <th>Producto del pedido</th>
                  <th className="text-right">Cant.</th>
                  <th className="text-right">Costo actual</th>
                  <th>Costo de la calculadora</th>
                  <th className="text-right">Queda</th>
                </tr>
              </thead>
              <tbody>
                {lineas.map(l => {
                  const nuevo = costoAsignado(l.id)
                  return (
                    <tr key={l.id}>
                      <td style={{ fontSize: 12 }}>{l.name}</td>
                      <td className="text-right" style={{ fontSize: 12 }}>{l.quantity}</td>
                      <td className="text-right" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmt(costoLinea(order, l))}</td>
                      <td>
                        <select value={asign[l.id] ?? ''} onChange={e => setAsign(a => ({ ...a, [l.id]: e.target.value }))}
                          style={{ border: '1.5px solid var(--border)', borderRadius: 6, padding: '5px 8px', fontSize: 12, width: '100%' }}>
                          <option value="">— no cambiar —</option>
                          {items.map((it, i) => <option key={i} value={String(i)}>{it.nombre} ({fmt(it.costo)})</option>)}
                        </select>
                      </td>
                      <td className="text-right" style={{ fontWeight: 700, color: nuevo !== null ? 'var(--blue)' : 'var(--text-muted)' }}>
                        {nuevo !== null ? fmt(nuevo) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
              Se carga como «Costo a mano» en cada producto del pedido (IO Costos) y se recalcula la ganancia.
              Total a cargar: <strong>{fmt(totalAsignado)}</strong> de {fmt(costo.costo_total)}.
              {itemsSinUsar.length > 0 && <> Sin usar: {itemsSinUsar.map(i => i.nombre).join(', ')}.</>}
            </p>
          </>
        )}

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={aplicar} disabled={aplicando || !costo || !order}>
            {aplicando ? 'Cargando...' : 'Cargar costo en el pedido'}
          </button>
        </div>
      </div>
    </div>
  )
}
