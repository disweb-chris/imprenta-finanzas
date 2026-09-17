import { useState, useEffect } from 'react'
import { collection, getDocs, updateDoc, setDoc, deleteDoc, doc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useCats } from '../context/CatContext'
import { useToast } from '../components/Toast'
import { saveWCConfig, getWCConfig, wcFetch } from '../utils/woocommerce'
import { getAppConfig, saveAppConfig } from '../utils/appConfig'
import { DEFAULT_CATS, fmt } from '../utils/helpers'

const mesActual = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

export default function Config() {
  const { categorias, addCat, deleteCat, isDefault } = useCats()
  const toast = useToast()
  const wc = getWCConfig()
  const [wcForm, setWcForm] = useState({ url: wc.url, key: wc.key, secret: wc.secret })
  const [testResult, setTestResult] = useState('')
  const [catForm, setCatForm] = useState({ nombre: '', color: '#2e509e' })
  const [showCatModal, setShowCatModal] = useState(false)
  const [migrando, setMigrando] = useState(false)

  const [paramsForm, setParamsForm] = useState({ mp_comision_pct: '', monotributo_techo: '' })
  const [mpReales, setMpReales] = useState([])
  const [mpForm, setMpForm] = useState({ mes: mesActual(), monto: '' })

  const [roles, setRoles] = useState([])
  const [roleForm, setRoleForm] = useState({ email: '', rol: 'gestor' })

  useEffect(() => {
    getAppConfig().then(cfg => setParamsForm({ mp_comision_pct: cfg.mp_comision_pct, monotributo_techo: cfg.monotributo_techo }))
    loadMpReales()
    loadRoles()
  }, [])

  const loadRoles = async () => {
    const snap = await getDocs(collection(db, 'roles'))
    const rows = []
    snap.forEach(d => rows.push({ id: d.id, ...d.data() }))
    setRoles(rows)
  }

  const guardarRol = async () => {
    const email = roleForm.email.trim().toLowerCase()
    if (!email) { toast('Ingresá el email', 'error'); return }
    await setDoc(doc(db, 'roles', email), { rol: roleForm.rol, updatedAt: new Date().toISOString() })
    setRoleForm({ email: '', rol: 'gestor' })
    toast('Acceso guardado', 'success')
    loadRoles()
  }

  const eliminarRol = async (email) => {
    if (!confirm(`¿Sacarle el rol restringido a ${email}? Va a volver a tener acceso completo.`)) return
    await deleteDoc(doc(db, 'roles', email))
    toast('Eliminado')
    loadRoles()
  }

  const loadMpReales = async () => {
    const snap = await getDocs(collection(db, 'comisiones_mp_reales'))
    const rows = []
    snap.forEach(d => rows.push({ id: d.id, ...d.data() }))
    rows.sort((a, b) => b.id.localeCompare(a.id))
    setMpReales(rows)
  }

  const saveParams = async () => {
    await saveAppConfig({
      mp_comision_pct: parseFloat(paramsForm.mp_comision_pct) || 0,
      monotributo_techo: parseFloat(paramsForm.monotributo_techo) || 0,
    })
    toast('Parámetros guardados', 'success')
  }

  const guardarMp = async () => {
    if (!mpForm.mes || !mpForm.monto) { toast('Completá mes y monto', 'error'); return }
    await setDoc(doc(db, 'comisiones_mp_reales', mpForm.mes), { monto: parseFloat(mpForm.monto), updatedAt: new Date().toISOString() })
    setMpForm({ mes: mesActual(), monto: '' })
    toast('Comisión real guardada', 'success')
    loadMpReales()
  }

  const eliminarMp = async (mes) => {
    if (!confirm('¿Eliminar este monto real?')) return
    await deleteDoc(doc(db, 'comisiones_mp_reales', mes))
    toast('Eliminado')
    loadMpReales()
  }

  const migrarCierres = async () => {
    setMigrando(true)
    const snap = await getDocs(collection(db, 'cierres_caja'))
    let n = 0
    for (const d of snap.docs) {
      const c = d.data()
      if (!c.timestamp && c.fecha) {
        const [y, m, day] = c.fecha.split('-').map(Number)
        const ts = new Date(y, m - 1, day, 23, 59, 59).toISOString()
        await updateDoc(doc(db, 'cierres_caja', d.id), { timestamp: ts })
        n++
      }
    }
    setMigrando(false)
    toast(n > 0 ? `${n} cierres migrados correctamente` : 'Todos los cierres ya tienen timestamp', 'success')
  }

  const saveWC = () => {
    saveWCConfig(wcForm.url.replace(/\/$/, ''), wcForm.key, wcForm.secret)
    toast('Configuración guardada', 'success')
  }

  const testWC = async () => {
    setTestResult('Probando...')
    try {
      await wcFetch('/products?per_page=1')
      setTestResult('✓ Conexión exitosa')
    } catch (e) {
      setTestResult('✗ Error: ' + e.message)
    }
  }

  const saveCat = async () => {
    if (!catForm.nombre.trim()) return
    await addCat(catForm.nombre.trim(), catForm.color)
    setCatForm({ nombre: '', color: '#2e509e' })
    setShowCatModal(false)
    toast('Categoría agregada', 'success')
  }

  return (
    <div className="view">
      <div className="view-header"><h2>Configuración</h2></div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Categorías */}
        <div className="table-card">
          <div className="table-card-header">
            <h3>Categorías de egreso</h3>
            <button className="btn btn-primary btn-sm" onClick={() => setShowCatModal(true)}>+ Agregar</button>
          </div>
          {categorias.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 13 }}>{c.nombre}</span>
              {isDefault(c.id)
                ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>predeterminada</span>
                : <button className="btn btn-danger btn-sm" onClick={() => deleteCat(c.id)}>×</button>
              }
            </div>
          ))}
        </div>

        {/* WooCommerce */}
        <div className="table-card">
          <div className="table-card-header"><h3>WooCommerce API</h3></div>
          <div style={{ padding: 20 }}>
            <div className="field"><label>URL del sitio</label><input value={wcForm.url} onChange={e => setWcForm(f => ({ ...f, url: e.target.value }))} placeholder="https://imprentaonline.ar" /></div>
            <div className="field"><label>Consumer Key</label><input value={wcForm.key} onChange={e => setWcForm(f => ({ ...f, key: e.target.value }))} placeholder="ck_..." /></div>
            <div className="field"><label>Consumer Secret</label><input type="password" value={wcForm.secret} onChange={e => setWcForm(f => ({ ...f, secret: e.target.value }))} placeholder="cs_..." /></div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn btn-primary" onClick={saveWC}>Guardar</button>
              <button className="btn btn-secondary" onClick={testWC}>Probar conexión</button>
            </div>
            {testResult && <p style={{ marginTop: 10, fontSize: 12, color: testResult.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>{testResult}</p>}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 20 }}>
        {/* Parámetros financieros */}
        <div className="table-card">
          <div className="table-card-header"><h3>Parámetros financieros</h3></div>
          <div style={{ padding: 20 }}>
            <div className="field">
              <label>Comisión MercadoPago estimada (%)</label>
              <input type="number" step="0.1" value={paramsForm.mp_comision_pct}
                onChange={e => setParamsForm(f => ({ ...f, mp_comision_pct: e.target.value }))} placeholder="5.5" />
            </div>
            <div className="field">
              <label>Techo de facturación monotributo ($ / 12 meses)</label>
              <input type="number" value={paramsForm.monotributo_techo}
                onChange={e => setParamsForm(f => ({ ...f, monotributo_techo: e.target.value }))} placeholder="Ej: 68000000" />
            </div>
            <button className="btn btn-primary" onClick={saveParams}>Guardar parámetros</button>
          </div>
        </div>

        {/* Comisiones MercadoPago reales */}
        <div className="table-card">
          <div className="table-card-header"><h3>Comisión MP — montos reales por mes</h3></div>
          <div style={{ padding: '16px 20px 4px' }}>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              Cargá el monto real del resumen de MercadoPago para reemplazar la estimación de ese mes en Dashboard y Reportes.
            </p>
            <div className="field-row">
              <div className="field"><label>Mes</label><input type="month" value={mpForm.mes} onChange={e => setMpForm(f => ({ ...f, mes: e.target.value }))} /></div>
              <div className="field"><label>Monto real ($)</label><input type="number" value={mpForm.monto} onChange={e => setMpForm(f => ({ ...f, monto: e.target.value }))} placeholder="0" /></div>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={guardarMp} style={{ marginBottom: 12 }}>+ Guardar mes</button>
          </div>
          {mpReales.length === 0
            ? <div className="empty-state"><p>Sin montos reales cargados</p></div>
            : mpReales.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderTop: '1px solid var(--border)' }}>
                <span style={{ flex: 1, fontSize: 13 }}>{r.id}</span>
                <strong style={{ fontSize: 13 }}>{fmt(r.monto)}</strong>
                <button className="btn btn-danger btn-sm" onClick={() => eliminarMp(r.id)}>×</button>
              </div>
            ))
          }
        </div>
      </div>

      {/* Accesos por rol */}
      <div className="table-card">
        <div className="table-card-header"><h3>Accesos restringidos</h3></div>
        <div style={{ padding: '16px 20px 4px' }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            Un usuario con rol <strong>Gestor</strong> solo ve la Calculadora al iniciar sesión — sin acceso a ninguna otra pantalla de Finanzas. Cualquier email sin registro acá tiene acceso completo (Admin). Primero creá el login en Firebase Console → Authentication → Add user, y después asignale el rol acá.
          </p>
          <div className="field-row">
            <div className="field"><label>Email</label><input value={roleForm.email} onChange={e => setRoleForm(f => ({ ...f, email: e.target.value }))} placeholder="gestor@imprentaonline.ar" /></div>
            <div className="field"><label>Rol</label>
              <select value={roleForm.rol} onChange={e => setRoleForm(f => ({ ...f, rol: e.target.value }))}>
                <option value="gestor">Gestor (solo Calculadora)</option>
                <option value="admin">Admin (acceso completo)</option>
              </select>
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={guardarRol} style={{ marginBottom: 12 }}>+ Guardar acceso</button>
        </div>
        {roles.length === 0
          ? <div className="empty-state"><p>Sin restricciones cargadas — todos los que inician sesión tienen acceso completo</p></div>
          : roles.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderTop: '1px solid var(--border)' }}>
              <span style={{ flex: 1, fontSize: 13 }}>{r.id}</span>
              <span className={`badge ${r.rol === 'gestor' ? 'badge-orange' : 'badge-blue'}`}>{r.rol === 'gestor' ? 'Gestor' : 'Admin'}</span>
              <button className="btn btn-danger btn-sm" onClick={() => eliminarRol(r.id)}>×</button>
            </div>
          ))
        }
      </div>

      {/* Migración */}
      <div className="table-card" style={{ gridColumn: '1 / -1' }}>
        <div className="table-card-header"><h3>Mantenimiento</h3></div>
        <div style={{ padding: 20 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
            Si tenés cierres de caja antiguos sin hora exacta, migralos para que el cálculo de saldo funcione correctamente.
          </p>
          <button className="btn btn-secondary" onClick={migrarCierres} disabled={migrando}>
            {migrando ? 'Migrando...' : '⚙ Migrar cierres sin timestamp'}
          </button>
        </div>
      </div>

      {/* Modal nueva categoría */}
      {showCatModal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowCatModal(false)}>
          <div className="modal" style={{ width: 360 }}>
            <div className="modal-header"><h3>Nueva categoría</h3><button className="modal-close" onClick={() => setShowCatModal(false)}>×</button></div>
            <div className="field"><label>Nombre</label><input value={catForm.nombre} onChange={e => setCatForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Logística" /></div>
            <div className="field"><label>Color</label><input type="color" value={catForm.color} onChange={e => setCatForm(f => ({ ...f, color: e.target.value }))} style={{ height: 40, padding: '4px 8px', cursor: 'pointer' }} /></div>
            <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowCatModal(false)}>Cancelar</button><button className="btn btn-primary" onClick={saveCat}>Guardar</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
