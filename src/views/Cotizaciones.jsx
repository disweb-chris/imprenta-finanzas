import { useEffect, useState } from 'react'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, storage } from '../firebase/config'
import { searchCustomers } from '../utils/woocommerce'
import { fmt, fmtDate, todayStr } from '../utils/helpers'
import { useToast } from '../components/Toast'
import { useAuth } from '../context/AuthContext'

const ESTADOS = {
  borrador: { label: 'Borrador', cls: 'badge-gray' },
  enviado: { label: 'Enviado', cls: 'badge-blue' },
  aprobado: { label: 'Aprobado', cls: 'badge-green' },
  rechazado: { label: 'Rechazado', cls: 'badge-red' },
  convertido: { label: 'Convertido a pedido', cls: 'badge-orange' },
}

const FORM_VACIO = {
  id: '', cliente_nombre: '', cliente_email: '', cliente_telefono: '', cliente_wc_id: null,
  fecha: todayStr(), estado: 'borrador', monto: '', detalle: '',
  archivos_presupuesto: [], archivos_oc: [],
}

const waLink = (telefono) => {
  const digits = String(telefono || '').replace(/\D/g, '')
  return digits ? `https://wa.me/${digits}` : null
}

const subirArchivo = async (cotId, carpeta, file) => {
  const path = `cotizaciones/${cotId}/${carpeta}/${Date.now()}_${file.name}`
  const r = ref(storage, path)
  await uploadBytes(r, file)
  const url = await getDownloadURL(r)
  return { name: file.name, url, path }
}

export default function Cotizaciones() {
  const toast = useToast()
  const { user } = useAuth()

  const [cotizaciones, setCotizaciones] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterEstado, setFilterEstado] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(FORM_VACIO)
  const [nuevosPresupuesto, setNuevosPresupuesto] = useState([])
  const [nuevosOc, setNuevosOc] = useState([])
  const [guardando, setGuardando] = useState(false)

  const [clienteQuery, setClienteQuery] = useState('')
  const [clienteResults, setClienteResults] = useState([])
  const [buscandoCliente, setBuscandoCliente] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const snap = await getDocs(query(collection(db, 'cotizaciones'), orderBy('fecha', 'desc')))
    const rows = []
    snap.forEach(d => rows.push({ id: d.id, ...d.data() }))
    setCotizaciones(rows)
    setLoading(false)
  }

  useEffect(() => {
    if (!showModal) return
    if (clienteQuery.trim().length < 2) { setClienteResults([]); return }
    const t = setTimeout(async () => {
      setBuscandoCliente(true)
      try { setClienteResults(await searchCustomers(clienteQuery)) }
      catch { setClienteResults([]) }
      setBuscandoCliente(false)
    }, 350)
    return () => clearTimeout(t)
  }, [clienteQuery, showModal])

  const elegirCliente = (c) => {
    setForm(f => ({
      ...f,
      cliente_nombre: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.username || f.cliente_nombre,
      cliente_email: c.email || f.cliente_email,
      cliente_telefono: c.billing?.phone || f.cliente_telefono,
      cliente_wc_id: c.id,
    }))
    setClienteQuery('')
    setClienteResults([])
  }

  const openNew = () => {
    setForm(FORM_VACIO)
    setNuevosPresupuesto([])
    setNuevosOc([])
    setClienteQuery('')
    setClienteResults([])
    setShowModal(true)
  }

  const openEdit = (c) => {
    setForm({
      id: c.id,
      cliente_nombre: c.cliente_nombre || '',
      cliente_email: c.cliente_email || '',
      cliente_telefono: c.cliente_telefono || '',
      cliente_wc_id: c.cliente_wc_id || null,
      fecha: c.fecha || todayStr(),
      estado: c.estado || 'borrador',
      monto: c.monto ?? '',
      detalle: c.detalle || '',
      archivos_presupuesto: c.archivos_presupuesto || [],
      archivos_oc: c.archivos_oc || [],
    })
    setNuevosPresupuesto([])
    setNuevosOc([])
    setClienteQuery('')
    setClienteResults([])
    setShowModal(true)
  }

  const guardar = async () => {
    if (!form.cliente_nombre.trim() || !form.monto) { toast('Completá cliente y monto', 'error'); return }
    setGuardando(true)
    try {
      const data = {
        cliente_nombre: form.cliente_nombre.trim(),
        cliente_email: form.cliente_email.trim(),
        cliente_telefono: form.cliente_telefono.trim(),
        cliente_wc_id: form.cliente_wc_id || null,
        fecha: form.fecha,
        estado: form.estado,
        monto: parseFloat(form.monto) || 0,
        detalle: form.detalle,
        usuario: user.email,
        updatedAt: new Date().toISOString(),
      }

      let id = form.id
      if (id) {
        await updateDoc(doc(db, 'cotizaciones', id), data)
      } else {
        const ref_ = await addDoc(collection(db, 'cotizaciones'), {
          ...data, archivos_presupuesto: [], archivos_oc: [], createdAt: new Date().toISOString(),
        })
        id = ref_.id
      }

      if (nuevosPresupuesto.length || nuevosOc.length) {
        const [subidosPresupuesto, subidosOc] = await Promise.all([
          Promise.all(nuevosPresupuesto.map(f => subirArchivo(id, 'presupuestos', f))),
          Promise.all(nuevosOc.map(f => subirArchivo(id, 'oc', f))),
        ])
        await updateDoc(doc(db, 'cotizaciones', id), {
          archivos_presupuesto: [...form.archivos_presupuesto, ...subidosPresupuesto],
          archivos_oc: [...form.archivos_oc, ...subidosOc],
        })
      }

      toast('Cotización guardada', 'success')
      setShowModal(false)
      load()
    } catch (e) {
      toast('Error al guardar: ' + e.message, 'error')
    }
    setGuardando(false)
  }

  const eliminarArchivo = async (carpeta, archivo) => {
    if (!confirm('¿Eliminar este archivo?')) return
    try { await deleteObject(ref(storage, archivo.path)) } catch { /* ya no existe en Storage, igual lo sacamos del registro */ }
    setForm(f => ({
      ...f,
      [carpeta]: f[carpeta].filter(a => a.path !== archivo.path),
    }))
    if (form.id) {
      const campo = carpeta
      const actualizados = form[carpeta].filter(a => a.path !== archivo.path)
      await updateDoc(doc(db, 'cotizaciones', form.id), { [campo]: actualizados })
    }
  }

  const remove = async (id) => {
    if (!confirm('¿Eliminar esta cotización? Los archivos subidos no se eliminan automáticamente.')) return
    await deleteDoc(doc(db, 'cotizaciones', id))
    toast('Cotización eliminada')
    load()
  }

  const filtradas = cotizaciones.filter(c => !filterEstado || c.estado === filterEstado)
  const activas = cotizaciones.filter(c => c.estado === 'borrador' || c.estado === 'enviado')
  const convertidas = cotizaciones.filter(c => c.estado === 'convertido')
  const montoTotal = cotizaciones.reduce((s, c) => s + (c.estado !== 'rechazado' ? parseFloat(c.monto || 0) : 0), 0)

  return (
    <div className="view">
      <div className="view-header-row">
        <div>
          <h2>Cotizaciones</h2>
          <p>Presupuestos enviados a clientes — cliente, archivos, WhatsApp y estado en un solo lugar</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ Nueva cotización</button>
      </div>

      <div className="cards-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="stat-card card-blue"><div className="card-label">Activas</div><div className="card-value">{activas.length}</div><div className="card-sub">borrador + enviado</div></div>
        <div className="stat-card card-green"><div className="card-label">Convertidas a pedido</div><div className="card-value">{convertidas.length}</div></div>
        <div className="stat-card card-orange"><div className="card-label">Monto total cotizado</div><div className="card-value">{fmt(montoTotal)}</div><div className="card-sub">sin contar rechazadas</div></div>
      </div>

      <div className="filters">
        <select value={filterEstado} onChange={e => setFilterEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      <div className="table-card">
        <div className="table-card-header"><h3>Cotizaciones</h3></div>
        {loading
          ? <div className="loading-state"><div className="spinner" /></div>
          : filtradas.length === 0
            ? <div className="empty-state"><p>Sin cotizaciones registradas</p></div>
            : (
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Cliente</th>
                    <th>Estado</th>
                    <th className="text-right">Monto</th>
                    <th className="text-center">Archivos</th>
                    <th className="text-center">WhatsApp</th>
                    <th className="text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map(c => {
                    const est = ESTADOS[c.estado] || ESTADOS.borrador
                    const wa = waLink(c.cliente_telefono)
                    return (
                      <tr key={c.id}>
                        <td>{fmtDate(c.fecha)}</td>
                        <td>
                          <strong>{c.cliente_nombre}</strong>
                          {c.cliente_email && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.cliente_email}</div>}
                        </td>
                        <td><span className={`badge ${est.cls}`}>{est.label}</span></td>
                        <td className="text-right"><strong>{fmt(c.monto)}</strong></td>
                        <td className="text-center" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          📄 {(c.archivos_presupuesto || []).length} · 🧾 {(c.archivos_oc || []).length}
                        </td>
                        <td className="text-center">
                          {wa
                            ? <a href={wa} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">WhatsApp</a>
                            : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>sin tel.</span>
                          }
                        </td>
                        <td className="text-center" style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => openEdit(c)}>Ver / Editar</button>
                          <button className="btn btn-danger btn-sm" onClick={() => remove(c.id)}>×</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
        }
      </div>

      {showModal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal" style={{ width: 560 }}>
            <div className="modal-header">
              <h3>{form.id ? 'Editar cotización' : 'Nueva cotización'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>

            {!form.cliente_wc_id && (
              <div className="field">
                <label>Buscar cliente en WooCommerce</label>
                <input value={clienteQuery} onChange={e => setClienteQuery(e.target.value)} placeholder="Nombre, usuario o email..." />
                {buscandoCliente && <small style={{ color: 'var(--text-muted)' }}>Buscando...</small>}
                {clienteResults.length > 0 && (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 7, marginTop: 6, maxHeight: 160, overflowY: 'auto' }}>
                    {clienteResults.map(c => (
                      <div key={c.id} onClick={() => elegirCliente(c)}
                        style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <strong>{`${c.first_name || ''} ${c.last_name || ''}`.trim() || c.username}</strong>
                        {c.email && <span style={{ color: 'var(--text-muted)' }}> — {c.email}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="field-row">
              <div className="field"><label>Nombre del cliente</label>
                <input value={form.cliente_nombre} onChange={e => setForm(f => ({ ...f, cliente_nombre: e.target.value, cliente_wc_id: null }))} placeholder="Nombre y apellido" />
              </div>
              <div className="field"><label>Teléfono (WhatsApp)</label>
                <input value={form.cliente_telefono} onChange={e => setForm(f => ({ ...f, cliente_telefono: e.target.value }))} placeholder="Ej: 54911..." />
              </div>
            </div>
            <div className="field"><label>Email</label>
              <input value={form.cliente_email} onChange={e => setForm(f => ({ ...f, cliente_email: e.target.value }))} placeholder="cliente@email.com" />
            </div>

            <div className="field-row">
              <div className="field"><label>Fecha</label>
                <input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
              </div>
              <div className="field"><label>Estado</label>
                <select value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))}>
                  {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
            </div>
            <div className="field"><label>Monto cotizado ($)</label>
              <input type="number" value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} placeholder="0" />
            </div>

            <div className="field">
              <label>Detalle del trabajo</label>
              <textarea value={form.detalle} onChange={e => setForm(f => ({ ...f, detalle: e.target.value }))}
                placeholder="Medidas, papel, cantidad, precio — pegá acá el resultado de la calculadora de pliegos hasta que quede conectada directo" />
              <a href="https://imprentaonline.ar" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11 }}>Abrir sitio con la calculadora ↗</a>
            </div>

            <div className="field">
              <label>Presupuesto enviado (PDF, imagen, etc.)</label>
              {form.archivos_presupuesto.map(a => (
                <div key={a.path} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 4 }}>
                  <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, color: 'var(--blue)' }}>{a.name}</a>
                  <button className="btn btn-danger btn-sm" onClick={() => eliminarArchivo('archivos_presupuesto', a)}>×</button>
                </div>
              ))}
              {nuevosPresupuesto.map((f, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>⏳ {f.name} (se sube al guardar)</div>
              ))}
              <input type="file" multiple onChange={e => setNuevosPresupuesto(prev => [...prev, ...Array.from(e.target.files)])} />
            </div>

            <div className="field">
              <label>Orden de compra</label>
              {form.archivos_oc.map(a => (
                <div key={a.path} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 4 }}>
                  <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, color: 'var(--blue)' }}>{a.name}</a>
                  <button className="btn btn-danger btn-sm" onClick={() => eliminarArchivo('archivos_oc', a)}>×</button>
                </div>
              ))}
              {nuevosOc.map((f, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>⏳ {f.name} (se sube al guardar)</div>
              ))}
              <input type="file" multiple onChange={e => setNuevosOc(prev => [...prev, ...Array.from(e.target.files)])} />
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardar} disabled={guardando}>
                {guardando ? 'Guardando...' : 'Guardar cotización'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
