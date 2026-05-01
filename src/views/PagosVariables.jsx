import { useEffect, useState } from 'react'
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, query, orderBy, where, setDoc
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { fmt, fmtDate, todayStr } from '../utils/helpers'
import { useCats } from '../context/CatContext'
import { useToast } from '../components/Toast'
import { useAuth } from '../context/AuthContext'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

export default function PagosVariables() {
  const { categorias, getCat } = useCats()
  const toast = useToast()
  const { user } = useAuth()

  const now = new Date()
  const [viewMonth, setViewMonth] = useState(now.getMonth())
  const [viewYear, setViewYear] = useState(now.getFullYear())

  const [conceptos, setConceptos] = useState([])
  const [montos, setMontos] = useState({}) // { conceptoId: { monto, notas, id } }
  const [loading, setLoading] = useState(true)
  const [cerrando, setCerrando] = useState(false)
  const [mesCerrado, setMesCerrado] = useState(false)

  // Modales
  const [showConcepto, setShowConcepto] = useState(false)
  const [editConcepto, setEditConcepto] = useState(null)
  const [conceptoForm, setConceptoForm] = useState({ nombre: '', categoria: 'sueldos', dia_vencimiento: 30, activo: true })

  useEffect(() => { loadAll() }, [viewMonth, viewYear])

  const loadAll = async () => {
    setLoading(true)
    // 1. Conceptos activos
    const snap = await getDocs(query(collection(db, 'pv_conceptos'), orderBy('nombre', 'asc')))
    const cons = []
    snap.forEach(d => cons.push({ id: d.id, ...d.data() }))
    setConceptos(cons)

    // 2. Montos del mes actual
    const mesKey = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`
    const mSnap = await getDocs(query(collection(db, 'pv_montos'), where('mes_key', '==', mesKey)))
    const ms = {}
    mSnap.forEach(d => { ms[d.data().concepto_id] = { id: d.id, ...d.data() } })
    setMontos(ms)

    // 3. ¿Ya se cerró este mes?
    const cierreSnap = await getDocs(query(collection(db, 'pv_cierres'), where('mes_key', '==', mesKey)))
    setMesCerrado(!cierreSnap.empty)

    setLoading(false)
  }

  // ── Navegación de mes ──────────────────────────────────
  const prevMes = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  const nextMes = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }
  const isCurrentMonth = viewMonth === now.getMonth() && viewYear === now.getFullYear()

  // ── Guardar monto de un concepto ──────────────────────
  const saveMonto = async (conceptoId, monto, notas = '') => {
    const mesKey = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`
    const existing = montos[conceptoId]
    const data = { concepto_id: conceptoId, mes_key: mesKey, monto: parseFloat(monto) || 0, notas, updatedAt: new Date().toISOString() }
    if (existing?.id) {
      await updateDoc(doc(db, 'pv_montos', existing.id), data)
    } else {
      await addDoc(collection(db, 'pv_montos'), { ...data, createdAt: new Date().toISOString() })
    }
    loadAll()
  }

  // ── Cerrar mes y generar compromisos ──────────────────
  const cerrarMes = async () => {
    const conceptosConMonto = conceptos.filter(c => c.activo && montos[c.id]?.monto > 0)
    if (!conceptosConMonto.length) { toast('No hay conceptos con monto cargado', 'error'); return }

    const mesKey = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`
    const nextMonthDate = new Date(viewYear, viewMonth + 1, 1)
    const nextMesLabel = `${MESES[nextMonthDate.getMonth()]} ${nextMonthDate.getFullYear()}`

    if (!confirm(`¿Generar ${conceptosConMonto.length} compromisos para ${nextMesLabel}?`)) return

    setCerrando(true)
    try {
      for (const c of conceptosConMonto) {
        const m = montos[c.id]
        // Fecha de vencimiento: día configurado del mes siguiente
        const diaVenc = parseInt(c.dia_vencimiento) || 30
        const fechaVenc = new Date(nextMonthDate.getFullYear(), nextMonthDate.getMonth(), diaVenc)
        // Si el día no existe en ese mes (ej: 31 en febrero), usar el último día
        const ultimoDia = new Date(nextMonthDate.getFullYear(), nextMonthDate.getMonth() + 1, 0).getDate()
        const diaReal = Math.min(diaVenc, ultimoDia)
        const fechaStr = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-${String(diaReal).padStart(2, '0')}`

        await addDoc(collection(db, 'compromisos'), {
          nombre: c.nombre,
          tipo: 'recurrente',
          frecuencia: 'mensual',
          monto: m.monto,
          categoria: c.categoria,
          fecha_proximo_pago: fechaStr,
          estado: 'activo',
          notas: m.notas || '',
          origen_pv: true,
          origen_concepto_id: c.id,
          mes_key: mesKey,
          usuario: user.email,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      }

      // Registrar cierre del mes
      await addDoc(collection(db, 'pv_cierres'), {
        mes_key: mesKey, usuario: user.email,
        cantidad: conceptosConMonto.length,
        createdAt: new Date().toISOString(),
      })

      toast(`${conceptosConMonto.length} compromisos generados para ${nextMesLabel}`, 'success')
      loadAll()
    } catch (e) {
      toast('Error al cerrar el mes: ' + e.message, 'error')
    }
    setCerrando(false)
  }

  // ── CRUD Conceptos ─────────────────────────────────────
  const openNuevoConcepto = () => {
    setEditConcepto(null)
    setConceptoForm({ nombre: '', categoria: 'sueldos', dia_vencimiento: 30, activo: true })
    setShowConcepto(true)
  }
  const openEditConcepto = (c) => {
    setEditConcepto(c)
    setConceptoForm({ nombre: c.nombre, categoria: c.categoria, dia_vencimiento: c.dia_vencimiento || 30, activo: c.activo !== false })
    setShowConcepto(true)
  }
  const saveConcepto = async () => {
    if (!conceptoForm.nombre.trim()) { toast('Ingresá un nombre', 'error'); return }
    const data = { ...conceptoForm, dia_vencimiento: parseInt(conceptoForm.dia_vencimiento), updatedAt: new Date().toISOString() }
    if (editConcepto) {
      await updateDoc(doc(db, 'pv_conceptos', editConcepto.id), data)
    } else {
      await addDoc(collection(db, 'pv_conceptos'), { ...data, createdAt: new Date().toISOString() })
    }
    setShowConcepto(false)
    toast('Concepto guardado', 'success')
    loadAll()
  }
  const deleteConcepto = async (id) => {
    if (!confirm('¿Eliminar este concepto? No elimina los compromisos ya generados.')) return
    await deleteDoc(doc(db, 'pv_conceptos', id))
    toast('Concepto eliminado')
    loadAll()
  }
  const toggleActivo = async (c) => {
    await updateDoc(doc(db, 'pv_conceptos', c.id), { activo: !c.activo })
    loadAll()
  }

  // ── Totales ────────────────────────────────────────────
  const totalMes = conceptos.filter(c => c.activo).reduce((s, c) => s + (parseFloat(montos[c.id]?.monto) || 0), 0)
  const conceptosActivos = conceptos.filter(c => c.activo)
  const conceptosConMonto = conceptosActivos.filter(c => montos[c.id]?.monto > 0)

  if (loading) return <div className="view"><div className="loading-state"><div className="spinner"/><p style={{marginTop:12}}>Cargando...</p></div></div>

  return (
    <div className="view">
      {/* Header */}
      <div className="view-header-row">
        <div>
          <h2>Pagos Variables</h2>
          <p>Sueldos, impuestos y compromisos con monto variable por mes</p>
        </div>
        <button className="btn btn-secondary" onClick={openNuevoConcepto}>
          + Nuevo concepto
        </button>
      </div>

      {/* Navegador de mes */}
      <div style={{ background: '#fff', borderRadius: 10, padding: '16px 20px', boxShadow: 'var(--shadow)', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={prevMes} className="btn btn-secondary btn-sm">‹</button>
          <span style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 16, minWidth: 160, textAlign: 'center' }}>
            {MESES[viewMonth]} {viewYear}
          </span>
          <button onClick={nextMes} className="btn btn-secondary btn-sm">›</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {mesCerrado
            ? <span className="badge badge-green" style={{ fontSize: 12, padding: '6px 14px' }}>✓ Mes cerrado — compromisos generados</span>
            : <span className="badge badge-yellow" style={{ fontSize: 12, padding: '6px 14px' }}>Pendiente de cierre</span>
          }
          {!mesCerrado && (
            <button
              className="btn btn-primary"
              onClick={cerrarMes}
              disabled={cerrando || !conceptosConMonto.length}
            >
              {cerrando
                ? 'Generando...'
                : <>
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                    Cerrar mes y generar compromisos
                  </>
              }
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="cards-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 20 }}>
        <div className="stat-card card-blue">
          <div className="card-label">Total del mes</div>
          <div className="card-value">{fmt(totalMes)}</div>
          <div className="card-sub">{conceptosConMonto.length} conceptos cargados</div>
        </div>
        <div className="stat-card card-orange">
          <div className="card-label">Conceptos activos</div>
          <div className="card-value">{conceptosActivos.length}</div>
          <div className="card-sub">{conceptosActivos.length - conceptosConMonto.length} sin monto este mes</div>
        </div>
        <div className="stat-card" style={{ borderLeft: '3px solid var(--blue)' }}>
          <div className="card-label">Próximo mes</div>
          <div className="card-value" style={{ fontSize: 16, color: 'var(--text-muted)' }}>
            {MESES[viewMonth === 11 ? 0 : viewMonth + 1]} {viewMonth === 11 ? viewYear + 1 : viewYear}
          </div>
          <div className="card-sub">se generarán los compromisos</div>
        </div>
      </div>

      {/* Tabla de conceptos + montos */}
      <div className="table-card">
        <div className="table-card-header">
          <h3>Conceptos del mes</h3>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Cargá el monto de cada concepto para {MESES[viewMonth]}
          </span>
        </div>

        {conceptos.length === 0
          ? <div className="empty-state"><p>No hay conceptos. Agregá el primero con "+ Nuevo concepto".</p></div>
          : <table>
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th>Categoría</th>
                  <th>Vence día</th>
                  <th className="text-right" style={{ color: 'var(--blue)', fontWeight: 700 }}>
                    Monto {MESES[viewMonth]}
                  </th>
                  <th>Notas</th>
                  <th>Estado</th>
                  <th className="text-center">Acc.</th>
                </tr>
              </thead>
              <tbody>
                {conceptos.map(c => {
                  const cat = getCat(c.categoria)
                  const m = montos[c.id]
                  return (
                    <tr key={c.id} style={{ opacity: c.activo ? 1 : .45 }}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{c.nombre}</div>
                      </td>
                      <td>
                        <span className="cat-dot" style={{ background: cat.color }} />
                        {cat.nombre}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        día {c.dia_vencimiento || 30}
                      </td>
                      <td className="text-right">
                        {c.activo
                          ? <MontoInput
                              key={`${c.id}-${viewMonth}-${viewYear}`}
                              initialValue={m?.monto || ''}
                              disabled={mesCerrado}
                              onSave={(v, n) => saveMonto(c.id, v, n)}
                            />
                          : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>inactivo</span>
                        }
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 140 }}>
                        {mesCerrado
                          ? m?.notas || '-'
                          : <input
                              defaultValue={m?.notas || ''}
                              placeholder="Opcional..."
                              disabled={!c.activo}
                              onBlur={e => {
                                if (m?.monto) saveMonto(c.id, m.monto, e.target.value)
                              }}
                              style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', fontSize: 12, width: '100%', background: c.activo ? '#fff' : 'transparent' }}
                            />
                        }
                      </td>
                      <td>
                        <button
                          onClick={() => toggleActivo(c)}
                          className={`badge ${c.activo ? 'badge-green' : 'badge-gray'}`}
                          style={{ cursor: 'pointer', border: 'none' }}
                        >
                          {c.activo ? 'Activo' : 'Inactivo'}
                        </button>
                      </td>
                      <td className="text-center" style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => openEditConcepto(c)}>Editar</button>
                        <button className="btn btn-danger btn-sm" onClick={() => deleteConcepto(c.id)}>×</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
        }

        {/* Total row */}
        {conceptos.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 16px', borderTop: '2px solid var(--border)', background: '#f8fafc' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', marginRight: 16 }}>Total del mes:</span>
            <span style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 18, color: 'var(--blue)' }}>{fmt(totalMes)}</span>
          </div>
        )}
      </div>

      {/* Modal concepto */}
      {showConcepto && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowConcepto(false)}>
          <div className="modal" style={{ width: 420 }}>
            <div className="modal-header">
              <h3>{editConcepto ? 'Editar concepto' : 'Nuevo concepto'}</h3>
              <button className="modal-close" onClick={() => setShowConcepto(false)}>×</button>
            </div>
            <div className="field">
              <label>Nombre</label>
              <input value={conceptoForm.nombre} onChange={e => setConceptoForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Sueldo Emmanuel, Monotributo..." />
            </div>
            <div className="field-row">
              <div className="field">
                <label>Categoría</label>
                <select value={conceptoForm.categoria} onChange={e => setConceptoForm(f => ({ ...f, categoria: e.target.value }))}>
                  {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Día de vencimiento</label>
                <input
                  type="number" min="1" max="31"
                  value={conceptoForm.dia_vencimiento}
                  onChange={e => setConceptoForm(f => ({ ...f, dia_vencimiento: e.target.value }))}
                  placeholder="30"
                />
              </div>
            </div>
            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={conceptoForm.activo} onChange={e => setConceptoForm(f => ({ ...f, activo: e.target.checked }))} style={{ width: 'auto' }} />
                Activo este mes
              </label>
            </div>
            <div style={{ background: '#f0f4f8', borderRadius: 8, padding: 12, fontSize: 12, color: 'var(--text-muted)' }}>
              💡 El monto lo cargás cada mes en la tabla. Al cerrar el mes se genera un compromiso mensual con el monto indicado y vencimiento el día {conceptoForm.dia_vencimiento} del mes siguiente.
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowConcepto(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveConcepto}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Componente inline para editar monto con auto-save ──
function MontoInput({ initialValue, onSave, disabled }) {
  const [val, setVal] = useState(initialValue)
  const [saved, setSaved] = useState(!!initialValue)

  const handleBlur = () => {
    if (val !== initialValue) {
      onSave(val, '')
      setSaved(true)
    }
  }

  const handleKey = (e) => {
    if (e.key === 'Enter') { e.target.blur() }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
      {saved && val > 0 && <span style={{ color: 'var(--success)', fontSize: 12 }}>✓</span>}
      <input
        type="number"
        value={val}
        onChange={e => { setVal(e.target.value); setSaved(false) }}
        onBlur={handleBlur}
        onKeyDown={handleKey}
        disabled={disabled}
        placeholder="0"
        style={{
          border: `1.5px solid ${val > 0 ? 'var(--blue)' : 'var(--border)'}`,
          borderRadius: 6, padding: '5px 8px', fontSize: 13, fontWeight: 700,
          width: 110, textAlign: 'right', color: 'var(--blue)',
          background: disabled ? '#f8fafc' : '#fff',
        }}
      />
    </div>
  )
}
