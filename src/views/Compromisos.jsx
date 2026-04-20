import { useEffect, useState } from 'react'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, orderBy } from 'firebase/firestore'
import { db } from '../firebase/config'
import { fetchOrders } from '../utils/woocommerce'
import { fmt, fmtDate, todayStr, daysUntil } from '../utils/helpers'
import { useCats } from '../context/CatContext'
import { useToast } from '../components/Toast'
import { useAuth } from '../context/AuthContext'

export default function Compromisos() {
  const { getCat } = useCats()
  const toast = useToast()
  const { user } = useAuth()
  const [compromisos, setCompromisos] = useState([])
  const [agip, setAgip] = useState(null)
  const [tab, setTab] = useState('activos')
  const [showModal, setShowModal] = useState(false)
  const [showPagar, setShowPagar] = useState(false)
  const [editData, setEditData] = useState(null)
  const [pagarComp, setPagarComp] = useState(null)
  const [pagarForm, setPagarForm] = useState({ monto: '', fecha: todayStr() })
  const [form, setForm] = useState({ nombre: '', tipo: 'recurrente', frecuencia: 'mensual', monto: '', categoria: '', total_cuotas: '', cuotas_pagadas: 0, fecha_proximo_pago: '', estado: 'activo', notas: '' })
  const { categorias } = useCats()
  const [kpis, setKpis] = useState({ totalMensual: 0, vencen: 0, activos: 0 })

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    const snap = await getDocs(query(collection(db, 'compromisos'), orderBy('fecha_proximo_pago', 'asc')))
    let comps = []
    snap.forEach(d => comps.push({ id: d.id, ...d.data() }))
    comps = await recalcSueldos(comps)
    setCompromisos(comps)
    calcKpis(comps)
    calcAGIP()
  }

  const recalcSueldos = async (comps) => {
    const hoy = todayStr()
    // Traer todos los egresos de sueldos del mes — filtrar por período en JS
    const now = new Date()
    const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const snap = await getDocs(query(collection(db, 'egresos'), where('categoria', '==', 'sueldos'), where('fecha', '>=', inicioMes), where('fecha', '<=', hoy)))

    // Agrupar todos los egresos por compromiso
    const todosPagos = {}
    snap.forEach(d => {
      const x = d.data()
      if (!x.origen_compromiso) return
      if (!todosPagos[x.origen_compromiso]) todosPagos[x.origen_compromiso] = []
      todosPagos[x.origen_compromiso].push({ fecha: x.fecha, monto: parseFloat(x.monto || 0) })
    })

    return comps.map(c => {
      if (c.categoria !== 'sueldos') return c
      const pagos = todosPagos[c.id] || []
      if (!pagos.length) return { ...c, monto_pagado: 0 }

      // Calcular inicio del período actual según frecuencia
      let inicioPeriodo
      if (c.fecha_proximo_pago) {
        const prox = new Date(c.fecha_proximo_pago + 'T00:00:00')
        if (c.frecuencia === 'semanal') {
          // Período actual = desde hace 7 días hasta fecha_proximo_pago
          inicioPeriodo = new Date(prox.getTime() - 7 * 86400000)
        } else if (c.frecuencia === 'mensual') {
          // Período actual = desde el mes anterior al próximo vencimiento
          inicioPeriodo = new Date(prox.getFullYear(), prox.getMonth() - 1, prox.getDate())
        } else {
          inicioPeriodo = new Date(prox.getFullYear() - 1, prox.getMonth(), prox.getDate())
        }
      } else {
        // Sin fecha próxima: usar inicio del mes
        inicioPeriodo = new Date(now.getFullYear(), now.getMonth(), 1)
      }

      const inicioStr = inicioPeriodo.toISOString().split('T')[0]
      // Solo sumar pagos del período actual
      const montoPagado = pagos
        .filter(p => p.fecha >= inicioStr && p.fecha <= hoy)
        .reduce((s, p) => s + p.monto, 0)

      return { ...c, monto_pagado: montoPagado }
    })
  }

  const calcKpis = (comps) => {
    const activos = comps.filter(c => c.estado === 'activo')
    const totalMensual = activos.reduce((s, c) => {
      const m = parseFloat(c.monto || 0)
      if (c.frecuencia === 'anual') return s + m / 12
      if (c.frecuencia === 'semanal') return s + m * 4.33
      return s + m
    }, 0)
    const now = new Date(), nextWeek = new Date(now.getTime() + 7 * 86400000)
    const vencen = activos.filter(c => { if (!c.fecha_proximo_pago) return false; const d = new Date(c.fecha_proximo_pago + 'T00:00:00'); return d >= now && d <= nextWeek }).length
    setKpis({ totalMensual, vencen, activos: activos.length })
  }

  const calcAGIP = async () => {
    const now = new Date()
    let venc = new Date(now.getFullYear(), now.getMonth(), 10)
    if (now > venc) venc = new Date(now.getFullYear(), now.getMonth() + 1, 10)
    const mesAnt = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const mesAntFin = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
    try {
      const ords = await fetchOrders(mesAnt, mesAntFin, 'completed,processing')
      const base = ords.reduce((s, o) => s + parseFloat(o.total || 0), 0)
      const monto = base * 0.04
      const days = daysUntil(venc.toISOString().split('T')[0])
      setAgip({ monto, base, venc: venc.toISOString().split('T')[0], days, mesLabel: mesAnt.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }) })
    } catch {}
  }

  const openNew = () => { setEditData(null); setForm({ nombre: '', tipo: 'recurrente', frecuencia: 'mensual', monto: '', categoria: '', total_cuotas: '', cuotas_pagadas: 0, fecha_proximo_pago: '', estado: 'activo', notas: '' }); setShowModal(true) }
  const openEdit = (c) => { setEditData(c); setForm({ nombre: c.nombre, tipo: c.tipo, frecuencia: c.frecuencia, monto: c.monto, categoria: c.categoria, total_cuotas: c.total_cuotas || '', cuotas_pagadas: c.cuotas_pagadas || 0, fecha_proximo_pago: c.fecha_proximo_pago || '', estado: c.estado, notas: c.notas || '' }); setShowModal(true) }

  const save = async () => {
    if (!form.nombre || !form.monto) { toast('Completá nombre y monto', 'error'); return }
    const data = { ...form, monto: parseFloat(form.monto), updatedAt: new Date().toISOString() }
    if (form.tipo === 'cuotas') { data.total_cuotas = parseInt(form.total_cuotas); data.cuotas_pagadas = parseInt(form.cuotas_pagadas) || 0 }
    if (editData) { await updateDoc(doc(db, 'compromisos', editData.id), data) }
    else { await addDoc(collection(db, 'compromisos'), { ...data, createdAt: new Date().toISOString() }) }
    setShowModal(false); toast('Compromiso guardado', 'success'); loadAll()
  }

  const remove = async (id) => { if (!confirm('¿Eliminar?')) return; await deleteDoc(doc(db, 'compromisos', id)); toast('Eliminado'); loadAll() }

  const openPagar = (c) => { setPagarComp(c); setPagarForm({ monto: c.monto, fecha: todayStr() }); setShowPagar(true) }

  const confirmarPago = async () => {
    const monto = parseFloat(pagarForm.monto)
    if (!monto) { toast('Ingresá un monto', 'error'); return }
    // Crear egreso
    await addDoc(collection(db, 'egresos'), { fecha: pagarForm.fecha, monto, categoria: pagarComp.categoria || 'varios', descripcion: `Pago: ${pagarComp.nombre}`, origen_compromiso: pagarComp.id, usuario: user.email, createdAt: new Date().toISOString() })
    // Avanzar fecha si es cuotas o recurrente
    const updates = { updatedAt: new Date().toISOString() }
    if (pagarComp.tipo === 'cuotas') {
      const pagadas = (pagarComp.cuotas_pagadas || 0) + 1
      updates.cuotas_pagadas = pagadas
      if (pagadas >= pagarComp.total_cuotas) updates.estado = 'finalizado'
      else updates.fecha_proximo_pago = nextDate(pagarForm.fecha, pagarComp.frecuencia)
    } else {
      updates.fecha_proximo_pago = nextDate(pagarForm.fecha, pagarComp.frecuencia)
    }
    await updateDoc(doc(db, 'compromisos', pagarComp.id), updates)
    setShowPagar(false); toast('Pago registrado', 'success'); loadAll()
  }

  const pagarAGIP = async () => {
    if (!agip) return
    await addDoc(collection(db, 'egresos'), { fecha: todayStr(), monto: Math.round(agip.monto), categoria: 'impuestos', descripcion: 'AGIP — Ingresos Brutos (4%)', usuario: user.email, createdAt: new Date().toISOString() })
    toast('Pago AGIP registrado como egreso', 'success')
  }

  const nextDate = (from, freq) => {
    const d = new Date(from + 'T00:00:00')
    if (freq === 'mensual') d.setMonth(d.getMonth() + 1)
    else if (freq === 'anual') d.setFullYear(d.getFullYear() + 1)
    else d.setDate(d.getDate() + 7)
    return d.toISOString().split('T')[0]
  }

  const activos = compromisos.filter(c => c.estado === 'activo' && c.tipo === 'recurrente')
  const cuotas = compromisos.filter(c => c.tipo === 'cuotas' && c.estado !== 'finalizado')
  const finalizados = compromisos.filter(c => c.estado === 'finalizado')

  const urgentes = compromisos.filter(c => { const d = daysUntil(c.fecha_proximo_pago); return d !== null && d <= 7 && d >= 0 && c.estado === 'activo' })

  const CompCard = ({ c }) => {
    const cat = getCat(c.categoria)
    const days = daysUntil(c.fecha_proximo_pago)
    const daysEl = days === null ? null : days < 0
      ? <span className="badge badge-red">Vencido hace {Math.abs(days)}d</span>
      : days === 0 ? <span className="badge badge-red">Vence hoy</span>
      : days <= 7 ? <span className="badge badge-yellow">Vence en {days}d</span>
      : <span className="badge badge-gray">Próx: {fmtDate(c.fecha_proximo_pago)}</span>

    const pagado = parseFloat(c.monto_pagado || 0)
    const monto = parseFloat(c.monto)
    const freq = { mensual: '/ mes', anual: '/ año', semanal: '/ sem' }[c.frecuencia] || ''

    return (
      <div style={{ background: '#fff', borderRadius: 10, padding: '16px 18px', boxShadow: 'var(--shadow)', display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
        <div style={{ width: 40, height: 40, borderRadius: 9, background: cat.color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="18" height="18" fill="none" stroke={cat.color} strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{c.nombre}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{cat.nombre} · {c.tipo === 'cuotas' ? 'Cuotas' : 'Recurrente'} · {c.frecuencia} {daysEl}</div>
          {c.tipo === 'cuotas' && c.total_cuotas && (
            <div style={{ marginTop: 6 }}>
              <div style={{ height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: 'var(--blue)', width: `${Math.min((c.cuotas_pagadas || 0) / c.total_cuotas * 100, 100)}%` }} />
              </div>
              <small style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.cuotas_pagadas || 0}/{c.total_cuotas} cuotas</small>
            </div>
          )}
          {c.categoria === 'sueldos' && pagado > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                <span style={{ color: 'var(--success)', fontWeight: 600 }}>✓ Pagado: {fmt(pagado)}</span>
                <span style={{ color: 'var(--danger)', fontWeight: 600 }}>Pendiente: {fmt(Math.max(monto - pagado, 0))}</span>
              </div>
              <div style={{ height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: pagado >= monto ? 'var(--success)' : 'var(--orange)', width: `${Math.min(pagado / monto * 100, 100)}%` }} />
              </div>
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 15 }}>{fmt(c.monto)}<span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}> {freq}</span></div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
            {c.estado !== 'finalizado' && <button className="btn btn-orange btn-sm" onClick={() => openPagar(c)}>Pagar</button>}
            <button className="btn btn-secondary btn-sm" onClick={() => openEdit(c)}>Editar</button>
            <button className="btn btn-danger btn-sm" onClick={() => remove(c.id)}>×</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="view">
      <div className="view-header-row">
        <div><h2>Compromisos de Pago</h2><p>Suscripciones, cuotas y pagos fijos</p></div>
        <button className="btn btn-primary" onClick={openNew}>+ Nuevo compromiso</button>
      </div>

      <div className="cards-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="stat-card card-orange"><div className="card-label">Total mensual</div><div className="card-value">{fmt(kpis.totalMensual)}</div></div>
        <div className="stat-card card-red"><div className="card-label">Vence esta semana</div><div className="card-value">{kpis.vencen}</div></div>
        <div className="stat-card card-blue"><div className="card-label">Activos</div><div className="card-value">{kpis.activos}</div></div>
      </div>

      {urgentes.map(c => {
        const d = daysUntil(c.fecha_proximo_pago)
        return <div key={c.id} className="alert-warning">⚠️ <strong>{c.nombre}</strong> vence {d === 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} días`} — {fmt(c.monto)}</div>
      })}

      {/* AGIP card */}
      {agip && (
        <div style={{ background: 'linear-gradient(135deg,#1e3a7a,#2e509e)', borderRadius: 12, padding: '18px 20px', marginBottom: 16, color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 42, height: 42, background: 'rgba(255,255,255,.15)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 13 }}>AGIP</div>
              <div>
                <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 15 }}>AGIP — Ingresos Brutos</div>
                <div style={{ fontSize: 12, opacity: .75 }}>4% sobre ingresos de {agip.mesLabel} · Vence día 10</div>
                <div style={{ fontSize: 11, opacity: .6, marginTop: 4 }}>Base: {fmt(agip.base)}</div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 800 }}>{fmt(agip.monto)}</div>
              <div style={{ marginTop: 4 }}>
                <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 20, fontWeight: 600, background: agip.days <= 0 ? '#ef4444' : agip.days <= 5 ? '#f59e0b' : 'rgba(255,255,255,.2)', color: '#fff' }}>
                  {agip.days <= 0 ? 'Vence hoy' : agip.days <= 5 ? `Vence en ${agip.days}d` : `Vence ${fmtDate(agip.venc)}`}
                </span>
              </div>
              <button onClick={pagarAGIP} style={{ marginTop: 8, padding: '8px 16px', background: 'var(--orange)', border: 'none', borderRadius: 7, color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                Registrar pago
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="tabs">
        {[['activos','Activos'],['cuotas','Cuotas'],['finalizados','Finalizados']].map(([k,l]) => (
          <button key={k} className={`tab-btn ${tab===k?'active':''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'activos' && (activos.length ? activos.map(c => <CompCard key={c.id} c={c} />) : <div className="empty-state"><p>Sin compromisos recurrentes</p></div>)}
      {tab === 'cuotas' && (cuotas.length ? cuotas.map(c => <CompCard key={c.id} c={c} />) : <div className="empty-state"><p>Sin cuotas activas</p></div>)}
      {tab === 'finalizados' && (finalizados.length ? finalizados.map(c => <CompCard key={c.id} c={c} />) : <div className="empty-state"><p>Sin compromisos finalizados</p></div>)}

      {/* Modal compromiso */}
      {showModal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="modal-header"><h3>{editData ? 'Editar' : 'Nuevo'} Compromiso</h3><button className="modal-close" onClick={() => setShowModal(false)}>×</button></div>
            <div className="field"><label>Nombre</label><input value={form.nombre} onChange={e => setForm(f=>({...f,nombre:e.target.value}))} placeholder="Ej: Hosting, Máquina laminadora..." /></div>
            <div className="field-row">
              <div className="field"><label>Tipo</label><select value={form.tipo} onChange={e => setForm(f=>({...f,tipo:e.target.value}))}><option value="recurrente">Recurrente</option><option value="cuotas">Cuotas</option></select></div>
              <div className="field"><label>Frecuencia</label><select value={form.frecuencia} onChange={e => setForm(f=>({...f,frecuencia:e.target.value}))}><option value="mensual">Mensual</option><option value="anual">Anual</option><option value="semanal">Semanal</option></select></div>
            </div>
            <div className="field-row">
              <div className="field"><label>Monto ($)</label><input type="number" value={form.monto} onChange={e => setForm(f=>({...f,monto:e.target.value}))} /></div>
              <div className="field"><label>Categoría</label><select value={form.categoria} onChange={e => setForm(f=>({...f,categoria:e.target.value}))}><option value="">Seleccionar...</option>{categorias.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}</select></div>
            </div>
            {form.tipo === 'cuotas' && (
              <div className="field-row">
                <div className="field"><label>Total cuotas</label><input type="number" value={form.total_cuotas} onChange={e => setForm(f=>({...f,total_cuotas:e.target.value}))} /></div>
                <div className="field"><label>Cuotas pagadas</label><input type="number" value={form.cuotas_pagadas} onChange={e => setForm(f=>({...f,cuotas_pagadas:e.target.value}))} /></div>
              </div>
            )}
            <div className="field-row">
              <div className="field"><label>Próximo vencimiento</label><input type="date" value={form.fecha_proximo_pago} onChange={e => setForm(f=>({...f,fecha_proximo_pago:e.target.value}))} /></div>
              <div className="field"><label>Estado</label><select value={form.estado} onChange={e => setForm(f=>({...f,estado:e.target.value}))}><option value="activo">Activo</option><option value="pausado">Pausado</option><option value="finalizado">Finalizado</option></select></div>
            </div>
            <div className="field"><label>Notas</label><textarea value={form.notas} onChange={e => setForm(f=>({...f,notas:e.target.value}))} /></div>
            <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar</button></div>
          </div>
        </div>
      )}

      {/* Modal pagar */}
      {showPagar && pagarComp && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowPagar(false)}>
          <div className="modal" style={{ width: 360 }}>
            <div className="modal-header"><h3>Registrar pago</h3><button className="modal-close" onClick={() => setShowPagar(false)}>×</button></div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              {pagarComp.nombre}{pagarComp.tipo === 'cuotas' ? ` — cuota ${(pagarComp.cuotas_pagadas || 0) + 1} de ${pagarComp.total_cuotas}` : ''}
            </p>
            <div className="field"><label>Monto ($)</label><input type="number" value={pagarForm.monto} onChange={e => setPagarForm(f=>({...f,monto:e.target.value}))} /></div>
            <div className="field"><label>Fecha de pago</label><input type="date" value={pagarForm.fecha} onChange={e => setPagarForm(f=>({...f,fecha:e.target.value}))} /></div>
            <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowPagar(false)}>Cancelar</button><button className="btn btn-primary" onClick={confirmarPago}>Confirmar pago</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
