import { useEffect, useState } from 'react'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy } from 'firebase/firestore'
import { db } from '../firebase/config'
import { fetchOrders } from '../utils/woocommerce'
import { fmt, fmtDate, todayStr } from '../utils/helpers'
import { useToast } from '../components/Toast'
import { useAuth } from '../context/AuthContext'

const DEFAULT_PROVEEDORES = ['Proveedor principal', 'Papel y materiales', 'Tinta', 'Sublimación', 'Otros']

const _ls = (d) => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')

export default function Liquidacion() {
  const toast = useToast()
  const { user } = useAuth()

  const [proveedores, setProveedores] = useState(DEFAULT_PROVEEDORES)
  const [historial, setHistorial] = useState([])
  const [loadingHist, setLoadingHist] = useState(true)

  // Período selector
  const now = new Date()
  const primerDiaMesAnt = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const [periodoStart, setPeriodoStart] = useState(_ls(primerDiaMesAnt))
  const [periodoEnd, setPeriodoEnd] = useState(_ls(new Date(now.getFullYear(), now.getMonth(), 0)))

  // Mes de imputación contable — puede diferir del período de pedidos usado para calcular costos
  const [mesImputacion, setMesImputacion] = useState(
    `${primerDiaMesAnt.getFullYear()}-${String(primerDiaMesAnt.getMonth() + 1).padStart(2, '0')}`
  )

  // Líneas de la liquidación actual
  const [lineas, setLineas] = useState([])
  const [calculando, setCalculando] = useState(false)
  const [calculado, setCalculado] = useState(false)
  const [registrando, setRegistrando] = useState(false)

  // Modal proveedor
  const [showProvModal, setShowProvModal] = useState(false)
  const [nuevoProov, setNuevoProov] = useState('')

  // Modal historial detalle
  const [showDetalle, setShowDetalle] = useState(null)

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    setLoadingHist(true)
    // Cargar proveedores guardados
    const provSnap = await getDocs(collection(db, 'proveedores'))
    const provArr = [...DEFAULT_PROVEEDORES]
    provSnap.forEach(d => { if (!provArr.includes(d.data().nombre)) provArr.push(d.data().nombre) })
    setProveedores(provArr)

    // Historial liquidaciones
    const histSnap = await getDocs(query(collection(db, 'liquidaciones'), orderBy('fecha', 'desc')))
    const hist = []
    histSnap.forEach(d => hist.push({ id: d.id, ...d.data() }))
    setHistorial(hist)
    setLoadingHist(false)
  }

  // ── Calcular costos del período ──────────────────────────
  const calcular = async () => {
    setCalculando(true)
    setCalculado(false)
    try {
      const start = new Date(periodoStart + 'T00:00:00')
      const end = new Date(periodoEnd + 'T23:59:59')
      const orders = await fetchOrders(start, end, 'completed,processing')

      // Agrupar costos por pedido + producto — permite ajustar el costo pedido por pedido,
      // no solo un total agregado por producto en todo el período
      const productMap = {}
      for (const order of orders) {
        for (const item of (order.line_items || [])) {
          const prodKey = item.variation_id
            ? `v${item.variation_id}`
            : `p${item.product_id}`
          const key = `o${order.id}_${prodKey}`
          const costMeta = (item.meta_data || []).find(
            m => m.key === 'yith_cog_item_cost' || m.key === '_yith_cog_item_cost'
          )
          const costoUnit = costMeta ? parseFloat(costMeta.value) || 0 : 0
          const qty = parseInt(item.quantity) || 1
          const costoTotal = costoUnit * qty

          if (!productMap[key]) {
            productMap[key] = {
              key,
              pedido_id: order.id,
              pedido_numero: order.number,
              nombre: item.name,
              cantidad: 0,
              costo_calculado: 0,
              costo_unit: costoUnit,
            }
          }
          productMap[key].cantidad += qty
          productMap[key].costo_calculado += costoTotal
        }
      }

      // Convertir a líneas editables — solo líneas con costo > 0
      const nuevasLineas = Object.values(productMap)
        .filter(p => p.costo_calculado > 0)
        .sort((a, b) => b.costo_calculado - a.costo_calculado)
        .map(p => ({
          ...p,
          costo_ajustado: p.costo_calculado, // editable por pedido
          proveedor: proveedores[0],
          medio_pago: 'banco',
          incluir: true,
        }))

      // Agregar línea vacía para gastos extra manuales
      setLineas(nuevasLineas)
      setCalculado(true)

      if (nuevasLineas.length === 0) {
        toast('No hay costos YITH registrados en ese período', 'error')
      } else {
        toast(`${nuevasLineas.length} productos encontrados`, 'success')
      }
    } catch (e) {
      toast('Error al calcular: ' + e.message, 'error')
    }
    setCalculando(false)
  }

  // ── Editar línea ─────────────────────────────────────────
  const updateLinea = (idx, field, value) => {
    setLineas(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l))
  }

  const addLinea = () => {
    setLineas(prev => [...prev, {
      key: `manual_${Date.now()}`,
      pedido_id: null,
      pedido_numero: null,
      nombre: '',
      cantidad: 1,
      costo_calculado: 0,
      costo_unit: 0,
      costo_ajustado: 0,
      proveedor: proveedores[0],
      medio_pago: 'banco',
      incluir: true,
      manual: true,
    }])
  }

  const removeLinea = (idx) => setLineas(prev => prev.filter((_, i) => i !== idx))

  // ── Totales ──────────────────────────────────────────────
  const lineasActivas = lineas.filter(l => l.incluir)
  const totalCalculado = lineas.reduce((s, l) => s + (l.incluir ? parseFloat(l.costo_calculado || 0) : 0), 0)
  const totalAjustado = lineasActivas.reduce((s, l) => s + parseFloat(l.costo_ajustado || 0), 0)
  const diferencia = totalAjustado - totalCalculado

  // ── Registrar pago ───────────────────────────────────────
  const registrarPago = async () => {
    if (!lineasActivas.length) { toast('No hay líneas activas', 'error'); return }
    if (!confirm(`¿Registrar ${lineasActivas.length} egresos por ${fmt(totalAjustado)} total?`)) return

    setRegistrando(true)
    try {
      const fecha = todayStr()
      const egresoIds = []

      for (const l of lineasActivas) {
        const monto = parseFloat(l.costo_ajustado || 0)
        if (!monto) continue
        const ref = await addDoc(collection(db, 'egresos'), {
          fecha,
          monto,
          categoria: 'produccion-tercerizada',
          subcategoria: l.proveedor,
          descripcion: `Costo producción: ${l.nombre}${l.pedido_numero ? ` (pedido #${l.pedido_numero})` : ''}${l.manual ? ' (manual)' : ''}`,
          medio_pago: l.medio_pago,
          mes_imputacion: mesImputacion,
          origen_liquidacion: true,
          origen_pedido: l.pedido_id || null,
          usuario: user.email,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        egresoIds.push(ref.id)
      }

      // Guardar liquidación en historial
      await addDoc(collection(db, 'liquidaciones'), {
        fecha,
        periodo_start: periodoStart,
        periodo_end: periodoEnd,
        mes_imputacion: mesImputacion,
        total_calculado: totalCalculado,
        total_ajustado: totalAjustado,
        lineas: lineasActivas.map(l => ({
          pedido_id: l.pedido_id || null,
          pedido_numero: l.pedido_numero || null,
          nombre: l.nombre,
          cantidad: l.cantidad,
          costo_calculado: parseFloat(l.costo_calculado || 0),
          costo_ajustado: parseFloat(l.costo_ajustado || 0),
          proveedor: l.proveedor,
          medio_pago: l.medio_pago,
        })),
        egreso_ids: egresoIds,
        usuario: user.email,
        createdAt: new Date().toISOString(),
      })

      toast(`${egresoIds.length} egresos registrados correctamente`, 'success')
      setLineas([])
      setCalculado(false)
      loadAll()
    } catch (e) {
      toast('Error al registrar: ' + e.message, 'error')
    }
    setRegistrando(false)
  }

  // ── Proveedor nuevo ──────────────────────────────────────
  const guardarProveedor = async () => {
    if (!nuevoProov.trim()) return
    await addDoc(collection(db, 'proveedores'), { nombre: nuevoProov.trim() })
    setProveedores(p => [...p, nuevoProov.trim()])
    setNuevoProov('')
    setShowProvModal(false)
    toast('Proveedor agregado', 'success')
  }

  const deleteLiquidacion = async (id) => {
    if (!confirm('¿Eliminar esta liquidación del historial? Los egresos generados NO se eliminan automáticamente.')) return
    await deleteDoc(doc(db, 'liquidaciones', id))
    toast('Liquidación eliminada del historial')
    loadAll()
  }

  return (
    <div className="view">
      {/* Header */}
      <div className="view-header-row">
        <div>
          <h2>Liquidación de Costos</h2>
          <p>Calculá y registrá los costos de producción del período</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowProvModal(true)}>
          + Proveedor
        </button>
      </div>

      {/* Selector de período + botón calcular */}
      <div style={{ background: '#fff', borderRadius: 10, padding: '20px 24px', boxShadow: 'var(--shadow)', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 140 }}>
            <label>Desde</label>
            <input type="date" value={periodoStart} onChange={e => { setPeriodoStart(e.target.value); setCalculado(false) }} />
          </div>
          <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 140 }}>
            <label>Hasta</label>
            <input type="date" value={periodoEnd} onChange={e => { setPeriodoEnd(e.target.value); setCalculado(false) }} />
          </div>
          <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 140 }}>
            <label>Mes de imputación</label>
            <input type="month" value={mesImputacion} onChange={e => setMesImputacion(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={calcular} disabled={calculando} style={{ marginBottom: 0 }}>
            {calculando
              ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Calculando...</>
              : <><svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.61"/></svg> Calcular costos</>
            }
          </button>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
            Período: {fmtDate(periodoStart)} — {fmtDate(periodoEnd)}
          </div>
        </div>
      </div>

      {/* Tabla de líneas */}
      {calculado && (
        <>
          <div className="table-card" style={{ marginBottom: 16 }}>
            <div className="table-card-header">
              <h3>Líneas de costo</h3>
              <button className="btn btn-secondary btn-sm" onClick={addLinea}>
                + Agregar línea manual
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>✓</th>
                  <th>Pedido</th>
                  <th>Producto / Concepto</th>
                  <th className="text-right">Cant.</th>
                  <th className="text-right">Costo YITH</th>
                  <th className="text-right" style={{ color: 'var(--blue)' }}>Costo ajustado</th>
                  <th>Proveedor</th>
                  <th>Medio</th>
                  <th className="text-center">Acc.</th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l, i) => (
                  <tr key={l.key} style={{ opacity: l.incluir ? 1 : .4 }}>
                    <td>
                      <input type="checkbox" checked={l.incluir}
                        onChange={e => updateLinea(i, 'incluir', e.target.checked)}
                        style={{ cursor: 'pointer', width: 16, height: 16 }} />
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {l.pedido_numero ? `#${l.pedido_numero}` : '-'}
                    </td>
                    <td>
                      {l.manual
                        ? <input value={l.nombre} onChange={e => updateLinea(i, 'nombre', e.target.value)}
                            placeholder="Descripción..." style={{ border: '1.5px solid var(--border)', borderRadius: 6, padding: '4px 8px', fontSize: 12, width: '100%' }} />
                        : <span style={{ fontSize: 13 }}>{l.nombre}</span>
                      }
                    </td>
                    <td className="text-right" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {l.manual
                        ? <input type="number" value={l.cantidad} onChange={e => updateLinea(i, 'cantidad', e.target.value)}
                            style={{ border: '1.5px solid var(--border)', borderRadius: 6, padding: '4px 6px', fontSize: 12, width: 60, textAlign: 'right' }} />
                        : l.cantidad
                      }
                    </td>
                    <td className="text-right" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {l.manual ? '-' : fmt(l.costo_calculado)}
                    </td>
                    <td className="text-right">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                        {!l.manual && l.costo_ajustado !== l.costo_calculado && (
                          <span style={{ fontSize: 10, color: diferencia > 0 ? 'var(--danger)' : 'var(--success)' }}>
                            {diferencia > 0 ? '▲' : '▼'}
                          </span>
                        )}
                        <input
                          type="number"
                          value={l.costo_ajustado}
                          onChange={e => updateLinea(i, 'costo_ajustado', e.target.value)}
                          style={{
                            border: '1.5px solid var(--blue)', borderRadius: 6,
                            padding: '5px 8px', fontSize: 13, fontWeight: 700,
                            width: 110, textAlign: 'right', color: 'var(--blue)',
                          }}
                        />
                      </div>
                    </td>
                    <td>
                      <select value={l.proveedor} onChange={e => updateLinea(i, 'proveedor', e.target.value)}
                        style={{ border: '1.5px solid var(--border)', borderRadius: 6, padding: '5px 8px', fontSize: 12, width: '100%' }}>
                        {proveedores.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={l.medio_pago} onChange={e => updateLinea(i, 'medio_pago', e.target.value)}
                        style={{ border: '1.5px solid var(--border)', borderRadius: 6, padding: '5px 8px', fontSize: 12 }}>
                        <option value="banco">Banco</option>
                        <option value="efectivo">Efectivo</option>
                      </select>
                    </td>
                    <td className="text-center">
                      <button className="btn btn-danger btn-sm" onClick={() => removeLinea(i)}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Resumen + botón registrar */}
          <div style={{ background: '#fff', borderRadius: 10, padding: '18px 24px', boxShadow: 'var(--shadow)', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Costo YITH calculado</div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 700, color: 'var(--text-muted)' }}>{fmt(totalCalculado)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Total ajustado a pagar</div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 800, color: 'var(--blue)' }}>{fmt(totalAjustado)}</div>
              </div>
              {diferencia !== 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Diferencia</div>
                  <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700, color: diferencia > 0 ? 'var(--danger)' : 'var(--success)' }}>
                    {diferencia > 0 ? '+' : ''}{fmt(diferencia)}
                  </div>
                </div>
              )}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Líneas activas</div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 700 }}>{lineasActivas.length}</div>
              </div>
            </div>
            <button
              className="btn btn-primary"
              onClick={registrarPago}
              disabled={registrando || !lineasActivas.length}
              style={{ fontSize: 15, padding: '12px 28px' }}
            >
              {registrando
                ? 'Registrando...'
                : <><svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> Registrar pago</>
              }
            </button>
          </div>
        </>
      )}

      {/* Historial liquidaciones */}
      <div className="table-card">
        <div className="table-card-header">
          <h3>Historial de liquidaciones</h3>
        </div>
        {loadingHist
          ? <div className="loading-state"><div className="spinner" /></div>
          : historial.length === 0
            ? <div className="empty-state"><p>Sin liquidaciones registradas</p></div>
            : <table>
                <thead>
                  <tr>
                    <th>Fecha pago</th>
                    <th>Período</th>
                    <th>Mes imputado</th>
                    <th className="text-right">Costo YITH</th>
                    <th className="text-right">Total pagado</th>
                    <th className="text-right">Diferencia</th>
                    <th className="text-center">Líneas</th>
                    <th className="text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {historial.map(h => {
                    const dif = (h.total_ajustado || 0) - (h.total_calculado || 0)
                    return (
                      <tr key={h.id}>
                        <td><strong>{fmtDate(h.fecha)}</strong></td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {fmtDate(h.periodo_start)} — {fmtDate(h.periodo_end)}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{h.mes_imputacion || '-'}</td>
                        <td className="text-right" style={{ color: 'var(--text-muted)' }}>{fmt(h.total_calculado)}</td>
                        <td className="text-right" style={{ fontFamily: 'var(--font-head)', fontWeight: 700, color: 'var(--blue)' }}>{fmt(h.total_ajustado)}</td>
                        <td className="text-right" style={{ fontWeight: 600, color: dif > 0 ? 'var(--danger)' : dif < 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                          {dif === 0 ? '—' : (dif > 0 ? '+' : '') + fmt(dif)}
                        </td>
                        <td className="text-center">
                          <button className="btn btn-secondary btn-sm" onClick={() => setShowDetalle(h)}>
                            Ver {(h.lineas || []).length}
                          </button>
                        </td>
                        <td className="text-center">
                          <button className="btn btn-danger btn-sm" onClick={() => deleteLiquidacion(h.id)}>×</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
        }
      </div>

      {/* Modal detalle liquidación */}
      {showDetalle && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowDetalle(null)}>
          <div className="modal" style={{ width: 640 }}>
            <div className="modal-header">
              <h3>Liquidación — {fmtDate(showDetalle.fecha)}</h3>
              <button className="modal-close" onClick={() => setShowDetalle(null)}>×</button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
              Período: {fmtDate(showDetalle.periodo_start)} — {fmtDate(showDetalle.periodo_end)}
              {showDetalle.mes_imputacion && <> · Mes imputado: <strong>{showDetalle.mes_imputacion}</strong></>}
            </p>
            <table>
              <thead><tr><th>Pedido</th><th>Producto</th><th className="text-right">Cant.</th><th className="text-right">YITH</th><th className="text-right">Pagado</th><th>Proveedor</th><th>Medio</th></tr></thead>
              <tbody>
                {(showDetalle.lineas || []).map((l, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{l.pedido_numero ? `#${l.pedido_numero}` : '-'}</td>
                    <td style={{ fontSize: 12 }}>{l.nombre}</td>
                    <td className="text-right" style={{ fontSize: 12 }}>{l.cantidad}</td>
                    <td className="text-right" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmt(l.costo_calculado)}</td>
                    <td className="text-right" style={{ fontWeight: 700, color: 'var(--blue)' }}>{fmt(l.costo_ajustado)}</td>
                    <td style={{ fontSize: 12 }}>{l.proveedor}</td>
                    <td><span className={`badge ${l.medio_pago === 'efectivo' ? 'badge-orange' : 'badge-blue'}`}>{l.medio_pago === 'efectivo' ? 'Efectivo' : 'Banco'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0 0', borderTop: '1px solid var(--border)', marginTop: 12 }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>YITH total: <strong>{fmt(showDetalle.total_calculado)}</strong></span>
              <span style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 16, color: 'var(--blue)' }}>Total pagado: {fmt(showDetalle.total_ajustado)}</span>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowDetalle(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal nuevo proveedor */}
      {showProvModal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowProvModal(false)}>
          <div className="modal" style={{ width: 360 }}>
            <div className="modal-header">
              <h3>Nuevo proveedor</h3>
              <button className="modal-close" onClick={() => setShowProvModal(false)}>×</button>
            </div>
            <div className="field">
              <label>Nombre del proveedor</label>
              <input value={nuevoProov} onChange={e => setNuevoProov(e.target.value)}
                placeholder="Ej: Imprenta Mayorista SA" onKeyDown={e => e.key === 'Enter' && guardarProveedor()} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              Proveedores actuales: {proveedores.join(', ')}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowProvModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardarProveedor}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
