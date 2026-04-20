import { useState, useEffect } from 'react'
import { collection, getDocs, updateDoc, doc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useCats } from '../context/CatContext'
import { useToast } from '../components/Toast'
import { saveWCConfig, getWCConfig, wcFetch } from '../utils/woocommerce'
import { DEFAULT_CATS } from '../utils/helpers'

export default function Config() {
  const { categorias, addCat, deleteCat, isDefault } = useCats()
  const toast = useToast()
  const wc = getWCConfig()
  const [wcForm, setWcForm] = useState({ url: wc.url, key: wc.key, secret: wc.secret })
  const [testResult, setTestResult] = useState('')
  const [catForm, setCatForm] = useState({ nombre: '', color: '#2e509e' })
  const [showCatModal, setShowCatModal] = useState(false)
  const [migrando, setMigrando] = useState(false)

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
