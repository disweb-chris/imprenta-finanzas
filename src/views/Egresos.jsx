import { useEffect, useState } from 'react'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, orderBy } from 'firebase/firestore'
import { db } from '../firebase/config'
import { fmt, fmtDate, todayStr } from '../utils/helpers'
import { usePeriod } from '../context/PeriodContext'
import { useCats } from '../context/CatContext'
import { useToast } from '../components/Toast'
import { useAuth } from '../context/AuthContext'

export default function Egresos() {
  const { getPeriodDates, periodLabel } = usePeriod()
  const { categorias, getCat } = useCats()
  const toast = useToast()
  const { user } = useAuth()

  const [egresos, setEgresos] = useState([])
  const [compromisos, setCompromisos] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterCat, setFilterCat] = useState('')
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ id: '', fecha: todayStr(), monto: '', categoria: '', subcategoria: '', descripcion: '', origen_compromiso: '', medio_pago: 'banco' })
  const [kpis, setKpis] = useState({ total: 0, topCat: '', topVal: 0, count: 0 })

  useEffect(() => { loadAll() }, [getPeriodDates, filterCat])

  const loadAll = async () => {
    setLoading(true)
    const { start, end } = getPeriodDates()
    const startStr = start.toISOString().split('T')[0]
    const endStr = end.toISOString().split('T')[0]
    let q = query(collection(db, 'egresos'), where('fecha', '>=', startStr), where('fecha', '<=', endStr), orderBy('fecha', 'desc'))
    const snap = await getDocs(q)
    let docs = []
    snap.forEach(d => docs.push({ id: d.id, ...d.data() }))
    if (filterCat) docs = docs.filter(e => e.categoria === filterCat)
    setEgresos(docs)

    const total = docs.reduce((s, e) => s + parseFloat(e.monto || 0), 0)
    const catTotals = {}
    docs.forEach(e => { catTotals[e.categoria] = (catTotals[e.categoria] || 0) + parseFloat(e.monto || 0) })
    const top = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0]
    setKpis({ total, topCat: top ? getCat(top[0]).nombre : '-', topVal: top?.[1] || 0, count: docs.length })

    // Load compromisos for sueldos select (lazy)
    if (!compromisos.length) {
      const cs = await getDocs(query(collection(db, 'compromisos'), where('estado', '==', 'activo')))
      const arr = []; cs.forEach(d => arr.push({ id: d.id, ...d.data() }))
      setCompromisos(arr)
    }
    setLoading(false)
  }

  const openNew = () => setForm({ id: '', fecha: todayStr(), monto: '', categoria: '', subcategoria: '', descripcion: '', origen_compromiso: '' })
  const openEdit = (e) => setForm({ id: e.id, fecha: e.fecha, monto: e.monto, categoria: e.categoria, subcategoria: e.subcategoria || '', descripcion: e.descripcion || '', origen_compromiso: e.origen_compromiso || '', medio_pago: e.medio_pago || 'banco' })

  const save = async () => {
    if (!form.fecha || !form.monto || !form.categoria) { toast('Completá todos los campos obligatorios', 'error'); return }
    const data = { fecha: form.fecha, monto: parseFloat(form.monto), categoria: form.categoria, subcategoria: form.subcategoria, descripcion: form.descripcion, medio_pago: form.medio_pago || 'banco', usuario: user.email, updatedAt: new Date().toISOString() }
    if (form.origen_compromiso) data.origen_compromiso = form.origen_compromiso
    if (form.id) {
      await updateDoc(doc(db, 'egresos', form.id), data)
    } else {
      await addDoc(collection(db, 'egresos'), { ...data, createdAt: new Date().toISOString() })
      // Update sueldo if linked
      if (form.origen_compromiso) await recalcSueldo(form.origen_compromiso)
    }
    setShowModal(false)
    toast('Egreso guardado', 'success')
    loadAll()
  }

  const remove = async (e) => {
    if (!confirm('¿Eliminar este egreso?')) return
    await deleteDoc(doc(db, 'egresos', e.id))
    toast('Egreso eliminado')
    loadAll()
  }

  const recalcSueldo = async (compId) => {
    // Trigger recalc by just reloading compromisos — actual calc is in Compromisos view
  }

  const sueldoComps = compromisos.filter(c => c.categoria === 'sueldos')
  const filtered = egresos.filter(e => !search || (e.descripcion || '').toLowerCase().includes(search.toLowerCase()) || getCat(e.categoria).nombre.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="view">
      <div className="view-header-row">
        <div><h2>Egresos</h2><p>Gastos registrados — {periodLabel()}</p></div>
        <button className="btn btn-primary" onClick={() => { openNew(); setShowModal(true) }}>+ Nuevo egreso</button>
      </div>

      <div className="cards-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="stat-card card-red"><div className="card-label">Total período</div><div className="card-value">{fmt(kpis.total)}</div></div>
        <div className="stat-card card-orange"><div className="card-label">Mayor gasto</div><div className="card-value">{kpis.topCat}</div><div className="card-sub">{fmt(kpis.topVal)}</div></div>
        <div className="stat-card card-blue"><div className="card-label">Registros</div><div className="card-value">{kpis.count}</div></div>
      </div>

      <div className="filters">
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)}>
          <option value="">Todas las categorías</option>
          {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="table-card">
        <div className="table-card-header"><h3>Gastos</h3></div>
        {loading ? <div className="loading-state"><div className="spinner" /></div> :
          filtered.length === 0 ? <div className="empty-state"><p>Sin egresos en el período</p></div> :
          <table>
            <thead><tr><th>Fecha</th><th>Categoría</th><th>Subcategoría</th><th>Descripción</th><th>Medio</th><th className="text-right">Monto</th><th className="text-center">Acciones</th></tr></thead>
            <tbody>
              {filtered.map(e => {
                const cat = getCat(e.categoria)
                return (
                  <tr key={e.id}>
                    <td>{fmtDate(e.fecha)}</td>
                    <td><span className="cat-dot" style={{ background: cat.color }} />{cat.nombre}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{e.subcategoria || '-'}</td>
                    <td>{e.descripcion || '-'}</td>
                    <td><span className={`badge ${e.medio_pago === 'efectivo' ? 'badge-orange' : 'badge-blue'}`}>{e.medio_pago === 'efectivo' ? 'Efectivo' : 'Banco'}</span></td>
                    <td className="text-right"><strong>{fmt(e.monto)}</strong></td>
                    <td className="text-center" style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => { openEdit(e); setShowModal(true) }}>Editar</button>
                      <button className="btn btn-danger btn-sm" onClick={() => remove(e)}>×</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        }
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="modal-header">
              <h3>{form.id ? 'Editar Egreso' : 'Nuevo Egreso'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="field-row">
              <div className="field"><label>Fecha</label><input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} /></div>
              <div className="field"><label>Monto ($)</label><input type="number" value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} placeholder="0" /></div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Categoría</label>
                <select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value, origen_compromiso: '', subcategoria: '' }))}>
                  <option value="">Seleccionar...</option>
                  {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
              {form.categoria === 'sueldos' ? (
                <div className="field">
                  <label>Empleado</label>
                  <select value={form.origen_compromiso} onChange={e => {
                    const comp = sueldoComps.find(c => c.id === e.target.value)
                    const pagado = parseFloat(comp?.monto_pagado || 0)
                    const pendiente = comp ? Math.max(parseFloat(comp.monto) - pagado, 0) : 0
                    setForm(f => ({ ...f, origen_compromiso: e.target.value, subcategoria: comp?.nombre || '', monto: pendiente || comp?.monto || f.monto }))
                  }}>
                    <option value="">Seleccionar empleado...</option>
                    {sueldoComps.map(c => <option key={c.id} value={c.id}>{c.nombre} ({fmt(c.monto)}/{c.frecuencia})</option>)}
                  </select>
                </div>
              ) : (
                <div className="field"><label>Subcategoría</label><input value={form.subcategoria} onChange={e => setForm(f => ({ ...f, subcategoria: e.target.value }))} placeholder="Opcional..." /></div>
              )}
            </div>
            <div className="field"><label>Descripción</label><textarea value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Detalle del gasto..." /></div>
            <div className="field">
              <label>Medio de pago</label>
              <select value={form.medio_pago} onChange={e => setForm(f => ({ ...f, medio_pago: e.target.value }))}>
                <option value="banco">Banco / Transferencia</option>
                <option value="efectivo">Efectivo</option>
              </select>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={save}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
