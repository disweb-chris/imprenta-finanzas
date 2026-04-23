import { useEffect, useState } from 'react'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, orderBy } from 'firebase/firestore'
import { db } from '../firebase/config'
import { fmt } from '../utils/helpers'
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

  const totalPresupuestado = presupuestos.reduce((s, p) => s + parseFloat(p.monto || 0), 0)
  const totalGastado = presupuestos.reduce((s, p) => s + (egresos[p.categoria] || 0), 0)
  const totalDisponible = totalPresupuestado - totalGastado

  // Estilos del modal completamente autónomos
  const S = {
    overlay: {
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.55)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px'
    },
    modal: {
      background: '#fff', borderRadius: 10, width: '100%', maxWidth: 440,
      boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden',
      fontFamily: 'Poppins, sans-serif'
    },
    header: {
      padding: '18px 24px', borderBottom: '1px solid #e2e8f0',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between'
    },
    title: { margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' },
    closeBtn: { background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#64748b', lineHeight: 1, padding: 0 },
    body: { padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 },
    field: { display: 'flex', flexDirection: 'column', gap: 6 },
    label: { fontSize: 12, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.4px' },
    input: {
      padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: 6,
      fontSize: 14, color: '#0f172a', outline: 'none', width: '100%',
      boxSizing: 'border-box', fontFamily: 'inherit',
      background: '#fff'
    },
    footer: {
      padding: '16px 24px', borderTop: '1px solid #e2e8f0',
      display: 'flex', justifyContent: 'flex-end', gap: 10
    },
    btnCancel: {
      padding: '8px 20px', border: '1px solid #cbd5e1', borderRadius: 6,
      background: '#fff', cursor: 'pointer', fontSize: 14, color: '#475569',
      fontFamily: 'inherit'
    },
    btnSave: {
      padding: '8px 20px', border: 'none', borderRadius: 6,
      background: '#2e509e', color: '#fff', cursor: 'pointer',
      fontSize: 14, fontWeight: 600, fontFamily: 'inherit'
    },
  }

  return (
    <div className="view">
      <div className="view-header-row">
        <div>
          <h2>Presupuesto</h2>
          <p>Control de gastos vs presupuesto — {periodLabel()}</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openNew}>+ Nuevo presupuesto</button>
      </div>

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
                        <td className="text-right" style={{ color: superado ? 'var(--danger)' : 'inherit' }}>{fmt(gastado)}</td>
                        <td className="text-right" style={{ fontWeight: 700, color: disponible >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                          {disponible >= 0 ? fmt(disponible) : `−${fmt(Math.abs(disponible))}`}
                        </td>
                        <td style={{ width: 140 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ flex: 1, height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                              <div style={{
                                height: '100%', borderRadius: 4,
                                background: superado ? 'var(--danger)' : pct > 80 ? '#f59e0b' : 'var(--success)',
                                width: `${pct}%`, transition: 'width .3s'
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

      {showForm && (
        <div style={S.overlay} onClick={() => setShowForm(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={S.header}>
              <h3 style={S.title}>{editDoc ? 'Editar presupuesto' : 'Nuevo presupuesto'}</h3>
              <button style={S.closeBtn} onClick={() => setShowForm(false)}>✕</button>
            </div>
            <div style={S.body}>
              <div style={S.field}>
                <label style={S.label}>Categoría</label>
                <select style={S.input} value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}>
                  <option value="">Elegir categoría...</option>
                  {['alquiler','insumos','credito','sueldos','marketing','impuestos','maquinaria','suscripciones','varios'].map(c => (
                    <option key={c} value={c}>{getCat(c)?.nombre || c}</option>
                  ))}
                </select>
              </div>
              <div style={S.field}>
                <label style={S.label}>Monto presupuestado ($)</label>
                <input style={S.input} type="number" min="0" value={form.monto}
                  onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
                  placeholder="Ej: 150000" />
              </div>
              <div style={S.field}>
                <label style={S.label}>Descripción (opcional)</label>
                <input style={S.input} type="text" value={form.descripcion}
                  onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                  placeholder="Ej: 2 empleados a $75.000 c/u" />
              </div>
            </div>
            <div style={S.footer}>
              <button style={S.btnCancel} onClick={() => setShowForm(false)}>Cancelar</button>
              <button style={S.btnSave} onClick={save}>{editDoc ? 'Guardar cambios' : 'Crear presupuesto'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
