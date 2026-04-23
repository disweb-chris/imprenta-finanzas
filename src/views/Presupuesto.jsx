import { useEffect, useState } from 'react'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, orderBy } from 'firebase/firestore'
import { db } from '../firebase/config'
import { fmt, todayStr } from '../utils/helpers'
import { useCats } from '../context/CatContext'
import { useToast } from '../components/Toast'
import { usePeriod } from '../context/PeriodContext'

export default function Presupuesto() {
  const { getCat } = useCats()
  const toast = useToast()
  const { getPeriodDates, periodLabel } = usePeriod()

  const [presupuestos, setPresupuestos] = useState([])
  const [egresos, setEgresos] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editDoc, setEditDoc] = useState(null)
  const [form, setForm] = useState({ categoria: '', monto: '', descripcion: '' })

  useEffect(() => { load() }, [getPeriodDates])

  const load = async () => {
    setLoading(true)
    const { start, end } = getPeriodDates()
    const startStr = start.toISOString().split('T')[0]
    const endStr = end.toISOString().split('T')[0]

    const [presSnap, egrSnap] = await Promise.all([
      getDocs(query(collection(db, 'presupuestos'), orderBy('categoria'))),
      getDocs(query(collection(db, 'egresos'), where('fecha', '>=', startStr), where('fecha', '<=', endStr))),
    ])

    const pres = []
    presSnap.forEach(d => pres.push({ id: d.id, ...d.data() }))

    const egr = {}
    egrSnap.forEach(d => {
      const x = d.data()
      egr[x.categoria] = (egr[x.categoria] || 0) + parseFloat(x.monto || 0)
    })

    setPresupuestos(pres)
    setEgresos(egr)
    setLoading(false)
  }

  const openNew = () => {
    setEditDoc(null)
    setForm({ categoria: '', monto: '', descripcion: '' })
    setShowForm(true)
  }

  const openEdit = (p) => {
    setEditDoc(p)
    setForm({ categoria: p.categoria, monto: p.monto, descripcion: p.descripcion || '' })
    setShowForm(true)
  }

  const save = async () => {
    if (!form.categoria || !form.monto) return toast('Completá categoría y monto', 'error')
    const data = { categoria: form.categoria, monto: parseFloat(form.monto), descripcion: form.descripcion }
    if (editDoc) {
      await updateDoc(doc(db, 'presupuestos', editDoc.id), data)
      toast('Presupuesto actualizado')
    } else {
      await addDoc(collection(db, 'presupuestos'), data)
      toast('Presupuesto creado')
    }
    setShowForm(false)
    load()
  }

  const remove = async (id) => {
    if (!confirm('¿Eliminar este presupuesto?')) return
    await deleteDoc(doc(db, 'presupuestos', id))
    toast('Presupuesto eliminado')
    load()
  }

  // KPIs globales
  const totalPresupuestado = presupuestos.reduce((s, p) => s + parseFloat(p.monto || 0), 0)
  const totalGastado = presupuestos.reduce((s, p) => s + (egresos[p.categoria] || 0), 0)
  const totalDisponible = totalPresupuestado - totalGastado

  return (
    <div className="view">
      <div className="view-header-row">
        <div>
          <h2>Presupuesto</h2>
          <p>Control de gastos vs presupuesto — {periodLabel()}</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openNew}>+ Nuevo presupuesto</button>
      </div>

      {/* KPIs */}
      <div className="cards-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="stat-card card-blue">
          <div className="card-label">Total presupuestado</div>
          <div className="card-value">{fmt(totalPresupuestado)}</div>
        </div>
        <div className="stat-card card-red">
          <div className="card-label">Total gastado</div>
          <div className="card-value">{fmt(totalGastado)}</div>
        </div>
        <div className="stat-card" style={{ borderLeft: `4px solid ${totalDisponible >= 0 ? 'var(--success)' : 'var(--danger)'}` }}>
          <div className="card-label">Disponible</div>
          <div className="card-value" style={{ color: totalDisponible >= 0 ? 'var(--success)' : 'var(--danger)' }}>
            {fmt(Math.abs(totalDisponible))}
          </div>
          <div className="card-sub">{totalDisponible >= 0 ? 'dentro del presupuesto' : '⚠️ presupuesto superado'}</div>
        </div>
      </div>

      {/* Tabla de presupuestos */}
      <div className="table-card">
        <div className="table-card-header"><h3>Detalle por categoría</h3></div>
        {loading
          ? <div className="loading-state"><div className="spinner" /></div>
          : presupuestos.length === 0
            ? <div className="empty-state"><p>No hay presupuestos definidos. Creá uno para empezar.</p></div>
            : (
              <table>
                <thead>
                  <tr>
                    <th>Categoría</th>
                    <th>Descripción</th>
                    <th className="text-right">Presupuesto</th>
                    <th className="text-right">Gastado</th>
                    <th className="text-right">Disponible</th>
                    <th>Progreso</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {presupuestos.map(p => {
                    const cat = getCat(p.categoria)
                    const gastado = egresos[p.categoria] || 0
                    const disponible = parseFloat(p.monto) - gastado
                    const pct = parseFloat(p.monto) > 0 ? Math.min(gastado / parseFloat(p.monto) * 100, 100) : 0
                    const superado = gastado > parseFloat(p.monto)
                    return (
                      <tr key={p.id}>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 10, height: 10, borderRadius: '50%', background: cat.color, display: 'inline-block' }} />
                            {cat.nombre}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.descripcion || '—'}</td>
                        <td className="text-right">{fmt(p.monto)}</td>
                        <td className="text-right" style={{ color: superado ? 'var(--danger)' : 'inherit' }}>
                          {fmt(gastado)}
                        </td>
                        <td className="text-right" style={{ fontWeight: 700, color: disponible >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                          {disponible >= 0 ? fmt(disponible) : `−${fmt(Math.abs(disponible))}`}
                        </td>
                        <td style={{ width: 140 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ flex: 1, height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                              <div style={{
                                height: '100%', borderRadius: 4,
                                background: superado ? 'var(--danger)' : pct > 80 ? '#f59e0b' : 'var(--success)',
                                width: `${pct}%`,
                                transition: 'width .3s'
                              }} />
                            </div>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 32 }}>{pct.toFixed(0)}%</span>
                          </div>
                          {superado && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2 }}>⚠️ Superado</div>}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn btn-sm" onClick={() => openEdit(p)} style={{ padding: '3px 10px' }}>Editar</button>
                            <button className="btn btn-sm" onClick={() => remove(p.id)} style={{ padding: '3px 10px', background: 'var(--danger)', color: '#fff', border: 'none' }}>✕</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
        }
      </div>

      {/* Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h3>{editDoc ? 'Editar presupuesto' : 'Nuevo presupuesto'}</h3>
              <button onClick={() => setShowForm(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="field-label">Categoría</label>
                <select className="field-input" value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}>
                  <option value="">Elegir categoría...</option>
                  {['alquiler','insumos','credito','sueldos','marketing','impuestos','maquinaria','suscripciones','varios'].map(c => (
                    <option key={c} value={c}>{getCat(c).nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">Monto presupuestado ($)</label>
                <input className="field-input" type="number" min="0" value={form.monto}
                  onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
                  placeholder="Ej: 150000" />
              </div>
              <div>
                <label className="field-label">Descripción (opcional)</label>
                <input className="field-input" type="text" value={form.descripcion}
                  onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                  placeholder="Ej: 2 empleados a $75.000 c/u" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowForm(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={save}>
                {editDoc ? 'Guardar cambios' : 'Crear presupuesto'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
