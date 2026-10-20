import { useState } from 'react'
import { saveAppConfig } from '../utils/appConfig'
import { useToast } from './Toast'

// Panel de Configuración con una lista editable de conceptos en % (nombre + porcentaje),
// guardada en config/general bajo `configKey`. Lo usan los descuentos de Avealma y las comisiones de GetNet.
export default function ListaPorcentajes({ titulo, descripcion, configKey, inicial, placeholder, mensajeGuardado, vacio }) {
  const toast = useToast()
  // `inicial` se lee una sola vez: el panel se monta cuando la config ya está cargada
  const [items, setItems] = useState(() => inicial || [])

  const update = (i, field, value) => setItems(prev => prev.map((d, j) => j === i ? { ...d, [field]: value } : d))

  const guardar = async () => {
    const lista = items
      .map(d => ({ nombre: (d.nombre || '').trim(), pct: parseFloat(d.pct) || 0 }))
      .filter(d => d.nombre)
    await saveAppConfig({ [configKey]: lista })
    setItems(lista)
    toast(mensajeGuardado, 'success')
  }

  return (
    <div className="table-card">
      <div className="table-card-header">
        <h3>{titulo}</h3>
        <button className="btn btn-secondary btn-sm" onClick={() => setItems(prev => [...prev, { nombre: '', pct: '' }])}>+ Agregar</button>
      </div>
      <div style={{ padding: '16px 20px' }}>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>{descripcion}</p>
        {items.length === 0 && <div className="empty-state"><p>{vacio}</p></div>}
        {items.map((d, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input value={d.nombre} onChange={e => update(i, 'nombre', e.target.value)} placeholder={placeholder} style={{ flex: 1 }} />
            <input type="number" step="0.01" value={d.pct} onChange={e => update(i, 'pct', e.target.value)} placeholder="%" style={{ width: 90 }} />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>%</span>
            <button className="btn btn-danger btn-sm" onClick={() => setItems(prev => prev.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <span style={{ fontSize: 13 }}>Total: <strong>{items.reduce((s, d) => s + (parseFloat(d.pct) || 0), 0).toFixed(2)}%</strong></span>
          <button className="btn btn-primary" onClick={guardar}>Guardar</button>
        </div>
      </div>
    </div>
  )
}
