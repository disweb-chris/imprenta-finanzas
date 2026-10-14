import { useEffect, useState } from 'react'
import { collection, getDocs, addDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { fmt, fmtDate, todayStr, localDateStr, daysUntil, medioPagoInfo } from '../utils/helpers'
import { loadCuentasPagar, crearCuentaPagar, registrarPagoCuenta, anularPagoCuenta, eliminarCuentaPagar, ESTADOS_CUENTA } from '../utils/cuentasPagar'
import { useCats } from '../context/CatContext'
import { useToast } from '../components/Toast'
import { useAuth } from '../context/AuthContext'

const mesActual = () => todayStr().slice(0, 7)
const nuevaVacia = () => ({
  proveedor: '', concepto: '', monto: '', fecha: todayStr(),
  vencimiento: localDateStr(new Date(Date.now() + 15 * 86400000)),
  categoria: 'produccion-tercerizada', mes_imputacion: mesActual(),
})

export default function CuentasPagar() {
  const toast = useToast()
  const { user } = useAuth()
  const { categorias } = useCats()

  const [cuentas, setCuentas] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtroEstado, setFiltroEstado] = useState('abiertas')
  const [filtroProv, setFiltroProv] = useState('')

  const [showNueva, setShowNueva] = useState(false)
  const [nueva, setNueva] = useState(nuevaVacia)
  const [pagando, setPagando] = useState(null)
  const [pagoForm, setPagoForm] = useState({ monto: '', fecha: todayStr(), medio_pago: 'banco' })
  const [detalle, setDetalle] = useState(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    try {
      const [rows, provSnap] = await Promise.all([loadCuentasPagar(), getDocs(collection(db, 'proveedores'))])
      setCuentas(rows)
      const provs = new Set(rows.map(r => r.proveedor))
      provSnap.forEach(d => d.data().nombre && provs.add(d.data().nombre))
      setProveedores([...provs].sort())
    } catch (e) {
      toast('Error al cargar: ' + e.message, 'error')
    }
    setLoading(false)
  }

  const guardarNueva = async () => {
    const monto = parseFloat(nueva.monto)
    if (!nueva.proveedor.trim() || !nueva.concepto.trim() || !monto) { toast('Completá proveedor, concepto y monto', 'error'); return }
    setGuardando(true)
    try {
      // El costo se registra como egreso 'a_pagar' (cuenta en reportes, no en caja)
      const egreso = await addDoc(collection(db, 'egresos'), {
        fecha: nueva.fecha, monto,
        categoria: nueva.categoria, subcategoria: nueva.proveedor.trim(),
        descripcion: `${nueva.concepto.trim()} (cta. cte.)`,
        medio_pago: 'a_pagar', mes_imputacion: nueva.mes_imputacion,
        usuario: user.email, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      })
      await crearCuentaPagar({
        proveedor: nueva.proveedor.trim(), concepto: nueva.concepto.trim(), monto,
        fecha: nueva.fecha, vencimiento: nueva.vencimiento, egreso_ids: [egreso.id], usuario: user.email,
      })
      toast('Deuda registrada', 'success')
      setShowNueva(false)
      load()
    } catch (e) {
      toast('Error al guardar: ' + e.message, 'error')
    }
    setGuardando(false)
  }

  const abrirPago = (c) => {
    setPagando(c)
    setPagoForm({ monto: Math.round(c.saldo * 100) / 100, fecha: todayStr(), medio_pago: 'banco' })
  }

  const confirmarPago = async () => {
    const monto = parseFloat(pagoForm.monto)
    if (!monto || monto <= 0) { toast('Ingresá un monto', 'error'); return }
    if (monto > pagando.saldo + 0.5 && !confirm(`El pago (${fmt(monto)}) supera el saldo (${fmt(pagando.saldo)}). ¿Registrarlo igual?`)) return
    setGuardando(true)
    try {
      await registrarPagoCuenta(pagando, { ...pagoForm, monto, usuario: user.email })
      toast(pagoForm.medio_pago === 'canje' ? 'Canje registrado' : 'Pago registrado', 'success')
      setPagando(null)
      load()
    } catch (e) {
      toast('Error al registrar el pago: ' + e.message, 'error')
    }
    setGuardando(false)
  }

  const anularPago = async (c, p) => {
    if (!confirm(`¿Anular el pago de ${fmt(p.monto)} del ${fmtDate(p.fecha)}?`)) return
    await anularPagoCuenta(c, p.id)
    toast('Pago anulado')
    setDetalle(null)
    load()
  }

  const eliminar = async (c) => {
    if (!confirm(`¿Eliminar la deuda con ${c.proveedor} (${fmt(c.monto)})? Se borran también sus pagos registrados.`)) return
    const conEgresos = (c.egreso_ids || []).length > 0 &&
      confirm('¿Eliminar también el costo registrado en Egresos?\n\nAceptar: se borra el costo (no aparece más en reportes ni rentabilidad).\nCancelar: el costo queda registrado.')
    await eliminarCuentaPagar(c, { conEgresos })
    toast('Deuda eliminada')
    load()
  }

  const abiertas = cuentas.filter(c => c.estado !== 'pagada')
  const totalPendiente = abiertas.reduce((s, c) => s + c.saldo, 0)
  const vencidas = abiertas.filter(c => c.estado === 'vencida')
  const totalVencido = vencidas.reduce((s, c) => s + c.saldo, 0)
  const prox7 = abiertas.filter(c => { const d = daysUntil(c.vencimiento); return d !== null && d >= 0 && d <= 7 })
  const mes = mesActual()
  const pagadoMes = cuentas.reduce((s, c) => s + (c.pagos || []).filter(p => String(p.fecha).startsWith(mes)).reduce((a, p) => a + parseFloat(p.monto || 0), 0), 0)

  const filtradas = cuentas.filter(c => {
    if (filtroProv && c.proveedor !== filtroProv) return false
    if (filtroEstado === 'abiertas') return c.estado !== 'pagada'
    if (filtroEstado) return c.estado === filtroEstado
    return true
  })

  const venceTxt = (c) => {
    if (c.estado === 'pagada') return null
    const d = daysUntil(c.vencimiento)
    if (d === null) return null
    if (d < 0) return <span style={{ color: 'var(--danger)', fontSize: 11 }}>hace {Math.abs(d)}d</span>
    if (d === 0) return <span style={{ color: 'var(--danger)', fontSize: 11 }}>hoy</span>
    return <span style={{ color: d <= 7 ? '#f59e0b' : 'var(--text-muted)', fontSize: 11 }}>en {d}d</span>
  }

  return (
    <div className="view">
      <div className="view-header-row">
        <div>
          <h2>Cuentas a pagar</h2>
          <p>Deudas con proveedores en cuenta corriente: saldo, vencimiento y pagos parciales</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setNueva(nuevaVacia()); setShowNueva(true) }}>+ Nueva deuda</button>
      </div>

      <div className="cards-grid">
        <div className="stat-card card-orange"><div className="card-label">Total a pagar</div><div className="card-value">{fmt(totalPendiente)}</div><div className="card-sub">{abiertas.length} cuenta{abiertas.length !== 1 ? 's' : ''} abierta{abiertas.length !== 1 ? 's' : ''}</div></div>
        <div className="stat-card card-red"><div className="card-label">Vencido</div><div className="card-value">{fmt(totalVencido)}</div><div className="card-sub">{vencidas.length} vencida{vencidas.length !== 1 ? 's' : ''}</div></div>
        <div className="stat-card" style={{ borderLeft: '4px solid #f59e0b' }}><div className="card-label">Vence en 7 días</div><div className="card-value">{fmt(prox7.reduce((s, c) => s + c.saldo, 0))}</div><div className="card-sub">{prox7.length} cuenta{prox7.length !== 1 ? 's' : ''}</div></div>
        <div className="stat-card card-green"><div className="card-label">Pagado este mes</div><div className="card-value">{fmt(pagadoMes)}</div><div className="card-sub">incluye canjes</div></div>
      </div>

      <div className="filters">
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
          <option value="abiertas">Abiertas (sin pagar)</option>
          <option value="">Todas</option>
          {Object.entries(ESTADOS_CUENTA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={filtroProv} onChange={e => setFiltroProv(e.target.value)}>
          <option value="">Todos los proveedores</option>
          {proveedores.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div className="table-card">
        <div className="table-card-header"><h3>Cuentas</h3></div>
        {loading
          ? <div className="loading-state"><div className="spinner" /></div>
          : filtradas.length === 0
            ? <div className="empty-state"><p>{cuentas.length === 0 ? 'Sin deudas registradas. Se crean desde Liquidación eligiendo "A pagar (cta. cte.)", o con "+ Nueva deuda".' : 'Nada para mostrar con estos filtros'}</p></div>
            : (
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th><th>Proveedor</th><th>Concepto</th><th>Vence</th>
                    <th className="text-right">Total</th><th className="text-right">Pagado</th><th className="text-right">Saldo</th>
                    <th>Estado</th><th className="text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map(c => {
                    const est = ESTADOS_CUENTA[c.estado]
                    return (
                      <tr key={c.id}>
                        <td>{fmtDate(c.fecha)}</td>
                        <td><strong>{c.proveedor}</strong></td>
                        <td style={{ fontSize: 12 }}>{c.concepto}{c.origen_liquidacion && <span className="badge badge-gray" style={{ marginLeft: 6, fontSize: 10 }}>liquidación</span>}</td>
                        <td>{fmtDate(c.vencimiento)} <div>{venceTxt(c)}</div></td>
                        <td className="text-right">{fmt(c.monto)}</td>
                        <td className="text-right" style={{ color: 'var(--success)' }}>{fmt(c.pagado)}</td>
                        <td className="text-right"><strong style={{ color: c.saldo > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{fmt(c.saldo)}</strong></td>
                        <td><span className={`badge ${est.cls}`}>{est.label}</span></td>
                        <td className="text-center" style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                          {c.estado !== 'pagada' && <button className="btn btn-primary btn-sm" onClick={() => abrirPago(c)}>Pagar</button>}
                          <button className="btn btn-secondary btn-sm" onClick={() => setDetalle(c)}>Pagos ({(c.pagos || []).length})</button>
                          <button className="btn btn-danger btn-sm" onClick={() => eliminar(c)}>×</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
        }
      </div>

      {showNueva && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowNueva(false)}>
          <div className="modal" style={{ width: 520 }}>
            <div className="modal-header">
              <h3>Nueva deuda con proveedor</h3>
              <button className="modal-close" onClick={() => setShowNueva(false)}>×</button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              Registra el costo en Egresos (sin mover banco ni efectivo) y deja el saldo pendiente hasta que lo pagues.
            </p>
            <div className="field-row">
              <div className="field"><label>Proveedor</label>
                <input list="cp-proveedores" value={nueva.proveedor} onChange={e => setNueva(f => ({ ...f, proveedor: e.target.value }))} placeholder="Ej: Copia y Grafica" />
                <datalist id="cp-proveedores">{proveedores.map(p => <option key={p} value={p} />)}</datalist>
              </div>
              <div className="field"><label>Monto ($)</label>
                <input type="number" value={nueva.monto} onChange={e => setNueva(f => ({ ...f, monto: e.target.value }))} placeholder="0" />
              </div>
            </div>
            <div className="field"><label>Concepto</label>
              <input value={nueva.concepto} onChange={e => setNueva(f => ({ ...f, concepto: e.target.value }))} placeholder="Ej: Factura 0003-00001234 — vinilos" />
            </div>
            <div className="field-row">
              <div className="field"><label>Fecha</label>
                <input type="date" value={nueva.fecha} onChange={e => setNueva(f => ({ ...f, fecha: e.target.value }))} />
              </div>
              <div className="field"><label>Vencimiento</label>
                <input type="date" value={nueva.vencimiento} onChange={e => setNueva(f => ({ ...f, vencimiento: e.target.value }))} />
              </div>
            </div>
            <div className="field-row">
              <div className="field"><label>Categoría del costo</label>
                <select value={nueva.categoria} onChange={e => setNueva(f => ({ ...f, categoria: e.target.value }))}>
                  {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
              <div className="field"><label>Mes de imputación</label>
                <input type="month" value={nueva.mes_imputacion} onChange={e => setNueva(f => ({ ...f, mes_imputacion: e.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowNueva(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardarNueva} disabled={guardando}>{guardando ? 'Guardando...' : 'Registrar deuda'}</button>
            </div>
          </div>
        </div>
      )}

      {pagando && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setPagando(null)}>
          <div className="modal" style={{ width: 420 }}>
            <div className="modal-header">
              <h3>Pagar a {pagando.proveedor}</h3>
              <button className="modal-close" onClick={() => setPagando(null)}>×</button>
            </div>
            <div style={{ background: '#f0f4f8', borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 13 }}>
              <div>{pagando.concepto}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                <span style={{ color: 'var(--text-muted)' }}>Saldo pendiente</span><strong>{fmt(pagando.saldo)}</strong>
              </div>
            </div>
            <div className="field-row">
              <div className="field"><label>Monto ($)</label>
                <input type="number" value={pagoForm.monto} onChange={e => setPagoForm(f => ({ ...f, monto: e.target.value }))} />
              </div>
              <div className="field"><label>Fecha</label>
                <input type="date" value={pagoForm.fecha} onChange={e => setPagoForm(f => ({ ...f, fecha: e.target.value }))} />
              </div>
            </div>
            <div className="field"><label>Medio</label>
              <select value={pagoForm.medio_pago} onChange={e => setPagoForm(f => ({ ...f, medio_pago: e.target.value }))}>
                <option value="banco">Banco / Transferencia</option>
                <option value="efectivo">Efectivo</option>
                <option value="canje">Canje (no mueve banco ni efectivo)</option>
              </select>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              El costo ya está en Egresos desde que se registró la deuda: este pago solo descuenta de Caja (salvo canje) y baja el saldo.
            </p>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPagando(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={confirmarPago} disabled={guardando}>{guardando ? 'Guardando...' : 'Registrar pago'}</button>
            </div>
          </div>
        </div>
      )}

      {detalle && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setDetalle(null)}>
          <div className="modal" style={{ width: 520 }}>
            <div className="modal-header">
              <h3>Pagos — {detalle.proveedor}</h3>
              <button className="modal-close" onClick={() => setDetalle(null)}>×</button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              {detalle.concepto} · Total {fmt(detalle.monto)} · Vence {fmtDate(detalle.vencimiento)}
            </p>
            {(detalle.pagos || []).length === 0
              ? <div className="empty-state"><p>Sin pagos todavía</p></div>
              : (
                <table>
                  <thead><tr><th>Fecha</th><th>Medio</th><th className="text-right">Monto</th><th className="text-center">Anular</th></tr></thead>
                  <tbody>
                    {detalle.pagos.map(p => (
                      <tr key={p.id}>
                        <td>{fmtDate(p.fecha)}</td>
                        <td><span className={`badge ${medioPagoInfo(p.medio_pago).badge}`}>{medioPagoInfo(p.medio_pago).label}</span></td>
                        <td className="text-right"><strong>{fmt(p.monto)}</strong></td>
                        <td className="text-center"><button className="btn btn-danger btn-sm" onClick={() => anularPago(detalle, p)}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 12, marginTop: 8, borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: 13 }}>Pagado: <strong style={{ color: 'var(--success)' }}>{fmt(detalle.pagado)}</strong></span>
              <span style={{ fontSize: 13 }}>Saldo: <strong style={{ color: detalle.saldo > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{fmt(detalle.saldo)}</strong></span>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDetalle(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
