import { useEffect, useState } from 'react'
import { collection, doc, writeBatch } from 'firebase/firestore'
import { db } from '../firebase/config'
import { searchCustomers, saveWCConfig, getWCConfig } from '../utils/woocommerce'
import { fmt, todayStr } from '../utils/helpers'
import { calcularPresupuesto, PROD_MODES } from '../utils/calculadoraPliegos'
import { useToast } from '../components/Toast'
import { useAuth } from '../context/AuthContext'

const LS_KEY = 'io_pc_state_v3'
// Productos ya calculados del pedido que se está armando, hasta guardarlo
const LS_ITEMS_KEY = 'io_pc_items_v1'

const DEFAULTS = {
  paperType: 'Obra 75g', paperSize: '32x47',
  sheetW: '32', sheetH: '47', itemW: '9', itemH: '5',
  bleedMM: '3', gutterMM: '0', extraSheets: '2', qty: '100',
  doubleFace: false, applyVat: false,
  costPaper: '0', costPrint: '0', costSetup: '0',
  prodMode: PROD_MODES.PORCENTAJE, prodValor: '0', profitPct: '0', iibbPct: '4',
  extras: [],
}

const leerItems = () => {
  try {
    const raw = localStorage.getItem(LS_ITEMS_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* localStorage no disponible */ }
  return []
}

const signo = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n))

const PAPER_SIZES = [
  ['22x34', '22 × 34 cm'], ['32x47', '32 × 47 cm'],
  ['21.6x35.6', 'Oficio / Legal (21.6 × 35.6 cm)'], ['21x29.7', 'A4 (21 × 29.7 cm)'],
  ['29.7x42', 'A3 (29.7 × 42 cm)'], ['100x100', '1 m² (100 × 100 cm)'], ['custom', 'Personalizado'],
]
const PAPER_TYPES = ['Obra 75g', 'Obra 90g', 'Ilustración 150g', 'Ilustración 300g']

const Fila = ({ k, v, strong, color, sub }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 18px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
    <span style={{ color: 'var(--text-muted)' }}>{k}{sub && <div style={{ fontSize: 11 }}>{sub}</div>}</span>
    <strong style={{ fontWeight: strong ? 800 : 600, color: color || 'inherit', whiteSpace: 'nowrap', marginLeft: 12 }}>{v}</strong>
  </div>
)

export default function Calculadora() {
  const toast = useToast()
  const { user } = useAuth()

  const [form, setForm] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
    } catch { /* localStorage no disponible */ }
    return DEFAULTS
  })
  const [ajuste, setAjuste] = useState(null)
  const [showAjusteForm, setShowAjusteForm] = useState(false)
  const [ajusteForm, setAjusteForm] = useState({ monto: '', motivo: '' })

  const [items, setItems] = useState(leerItems)

  const [showGuardar, setShowGuardar] = useState(false)
  const [clienteForm, setClienteForm] = useState({ cliente_nombre: '', cliente_email: '', cliente_telefono: '', cliente_wc_id: null })
  const [clienteQuery, setClienteQuery] = useState('')
  const [clienteResults, setClienteResults] = useState([])
  const [buscandoCliente, setBuscandoCliente] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const [wcForm, setWcForm] = useState(() => getWCConfig())
  const [showWcConfig, setShowWcConfig] = useState(() => !getWCConfig().url)
  const [wcTestResult, setWcTestResult] = useState('')

  const guardarWc = () => {
    saveWCConfig(wcForm.url.replace(/\/$/, ''), wcForm.key, wcForm.secret)
    setWcTestResult('✓ Guardado en este navegador')
    toast('Conexión guardada en este navegador', 'success')
  }

  // Cálculo derivado directo del render — no useEffect, es una transformación pura de `form`
  let resultado = null
  let error = ''
  try {
    resultado = calcularPresupuesto(form)
  } catch (e) {
    error = e.message
  }
  // Un ajuste manual solo vale mientras no cambien los datos que lo originaron
  const ajusteVigente = ajuste && ajuste.formSnapshot === JSON.stringify(form) ? ajuste : null

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(form)) } catch { /* localStorage no disponible */ }
  }, [form])

  useEffect(() => {
    try { localStorage.setItem(LS_ITEMS_KEY, JSON.stringify(items)) } catch { /* localStorage no disponible */ }
  }, [items])

  useEffect(() => {
    if (!showGuardar) return
    if (clienteQuery.trim().length < 2) { setClienteResults([]); return }
    const t = setTimeout(async () => {
      setBuscandoCliente(true)
      try { setClienteResults(await searchCustomers(clienteQuery)) }
      catch { setClienteResults([]) }
      setBuscandoCliente(false)
    }, 350)
    return () => clearTimeout(t)
  }, [clienteQuery, showGuardar])

  const setField = (name, value) => setForm(f => ({ ...f, [name]: value }))

  const agregarExtra = () => setForm(f => ({ ...f, extras: [...(f.extras || []), { concepto: '', monto: '' }] }))
  const setExtra = (idx, name, value) => setForm(f => ({ ...f, extras: f.extras.map((e, i) => i === idx ? { ...e, [name]: value } : e) }))
  const quitarExtra = (idx) => setForm(f => ({ ...f, extras: f.extras.filter((_, i) => i !== idx) }))

  const onPaperSizeChange = (value) => {
    if (value === 'custom') { setField('paperSize', value); return }
    const [w, h] = value.split('x')
    setForm(f => ({ ...f, paperSize: value, sheetW: w, sheetH: h }))
  }

  const onSheetDimChange = (name, value) => {
    setForm(f => {
      const next = { ...f, [name]: value }
      const w = name === 'sheetW' ? value : f.sheetW
      const h = name === 'sheetH' ? value : f.sheetH
      if (f.paperSize !== 'custom' && f.paperSize !== `${w}x${h}`) next.paperSize = 'custom'
      return next
    })
  }

  const resetForm = () => {
    setForm(DEFAULTS)
    setAjuste(null)
    try { localStorage.removeItem(LS_KEY) } catch { /* localStorage no disponible */ }
  }

  const abrirAjuste = () => {
    setAjusteForm({ monto: resultado ? String(Math.round(resultado.precioFinalBase)) : '', motivo: '' })
    setShowAjusteForm(true)
  }
  const aplicarAjuste = () => {
    const monto = parseFloat(ajusteForm.monto)
    if (!monto || !ajusteForm.motivo.trim()) { toast('Ingresá el nuevo precio y el motivo del ajuste', 'error'); return }
    setAjuste({ montoAjustado: monto, motivo: ajusteForm.motivo.trim(), formSnapshot: JSON.stringify(form) })
    setShowAjusteForm(false)
  }
  const quitarAjuste = () => setAjuste(null)

  const precioFinalEfectivo = resultado ? (ajusteVigente ? ajusteVigente.montoAjustado : resultado.precioFinalBase) : 0
  // Redondeo o diferencia: lo que se cobra de más (+) o de menos (−) respecto de la calculadora
  const diferenciaAjuste = resultado && ajusteVigente ? ajusteVigente.montoAjustado - resultado.precioFinalBase : 0
  const ivaMonto = form.applyVat ? precioFinalEfectivo * 0.21 : 0
  const precioFinalConIva = precioFinalEfectivo + ivaMonto
  const unitPriceEfectivo = resultado ? precioFinalEfectivo / resultado.qty : 0
  const unitPriceConIva = resultado ? precioFinalConIva / resultado.qty : 0

  const sizeLabel = () => {
    if (form.paperSize === 'custom') return `${form.sheetW} × ${form.sheetH} cm (personalizado)`
    const found = PAPER_SIZES.find(([v]) => v === form.paperSize)
    return found ? found[1] : `${form.sheetW} × ${form.sheetH} cm`
  }

  const elegirCliente = (c) => {
    setClienteForm({
      cliente_nombre: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.username || '',
      cliente_email: c.email || '',
      cliente_telefono: c.billing?.phone || '',
      cliente_wc_id: c.id,
    })
    setClienteQuery('')
    setClienteResults([])
  }

  const armarDetalle = () => {
    if (!resultado) return ''
    const r = resultado
    const lineas = [
      `Papel: ${form.paperType} — Pliego ${form.sheetW}×${form.sheetH} cm`,
      `Pieza: ${form.itemW}×${form.itemH} cm (efectiva con demasía: ${r.piezaEfectiva.ancho.toFixed(1)}×${r.piezaEfectiva.alto.toFixed(1)} cm)`,
      `Orientación: ${r.orientacion} — entran ${r.entranPorPliego.cantidad} por pliego (${r.entranPorPliego.columnas}×${r.entranPorPliego.filas})`,
      `Cantidad a producir: ${r.qty} — ${form.doubleFace ? 'doble faz' : 'una cara'}`,
      `Pliegos: ${r.pliegos.base} base + ${r.pliegos.merma} merma = ${r.pliegos.total} — Impresiones: ${r.impresionesTotales}`,
      `Costo papel: ${fmt(r.costos.papel)} — Costo impresión: ${fmt(r.costos.impresion)} — Costo fijo: ${fmt(r.costos.fijo)}`,
      `Costo base: ${fmt(r.costos.base)} + Producción ${fmt(r.costos.produccion)} + Ganancia ${fmt(r.costos.ganancia)} + IIBB ${fmt(r.costos.iibb)}`,
    ]
    r.extras.forEach(e => lineas.push(`+ ${e.concepto}: ${fmt(e.monto)}`))
    lineas.push(`Costo de producción: ${fmt(r.costos.produccionTotal)}`)
    if (ajusteVigente) lineas.push(`Redondeo / diferencia: ${signo(diferenciaAjuste)} (${fmt(resultado.precioFinalBase)} → ${fmt(ajusteVigente.montoAjustado)}) — Motivo: ${ajusteVigente.motivo}`)
    if (form.applyVat) lineas.push(`+ IVA 21%: ${fmt(ivaMonto)} — Precio final con IVA: ${fmt(precioFinalConIva)}`)
    lineas.push(`Precio final: ${fmt(precioFinalEfectivo)} — Precio unitario: ${fmt(unitPriceEfectivo)}`)
    return lineas.join('\n')
  }

  const nombreSugerido = () => `${form.qty} u. ${form.itemW}×${form.itemH} cm — ${form.paperType}${form.doubleFace ? ' doble faz' : ''}`

  // Foto del cálculo actual: los montos quedan congelados, aunque mañana cambie el precio del papel
  const armarItem = (nombre) => ({
    nombre: (nombre || '').trim() || nombreSugerido(),
    cantidad: resultado.qty,
    costo: resultado.costos.produccionTotal,
    precio_calculadora: resultado.precioFinalBase,
    diferencia: diferenciaAjuste,
    precio: precioFinalEfectivo,
    precio_cobrar: form.applyVat ? precioFinalConIva : precioFinalEfectivo,
    detalle: armarDetalle(),
    calculo: { ...form, ajuste: ajusteVigente },
  })

  const agregarItem = () => {
    if (!resultado) { toast('Corregí los datos del cálculo primero', 'error'); return }
    setItems(prev => [...prev, armarItem()])
    toast('Producto agregado al pedido — podés calcular el siguiente', 'success')
  }

  const renombrarItem = (idx, nombre) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, nombre } : it))
  const quitarItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx))

  // Vuelve a cargar el producto en la calculadora para corregirlo; se agrega de nuevo al terminar
  const editarItem = (idx) => {
    const { ajuste: ajusteGuardado, ...calc } = items[idx].calculo
    const nuevoForm = { ...DEFAULTS, ...calc }
    setForm(nuevoForm)
    setAjuste(ajusteGuardado ? { ...ajusteGuardado, formSnapshot: JSON.stringify(nuevoForm) } : null)
    quitarItem(idx)
  }

  // Lo que se guarda: los productos agregados o, si no hay ninguno, el cálculo de pantalla
  const itemsAGuardar = items.length ? items : (resultado ? [armarItem()] : [])
  const totalCobrar = itemsAGuardar.reduce((s, it) => s + it.precio_cobrar, 0)
  const totalCosto = itemsAGuardar.reduce((s, it) => s + it.costo, 0)

  const guardarCotizacion = async () => {
    if (!clienteForm.cliente_nombre.trim()) { toast('Ingresá el nombre del cliente', 'error'); return }
    if (!itemsAGuardar.length) { toast('Corregí los datos del cálculo primero', 'error'); return }
    setGuardando(true)
    try {
      const cliente = {
        cliente_nombre: clienteForm.cliente_nombre.trim(),
        cliente_email: clienteForm.cliente_email.trim(),
        cliente_telefono: clienteForm.cliente_telefono.trim(),
        cliente_wc_id: clienteForm.cliente_wc_id || null,
      }
      const ahora = new Date().toISOString()
      const cotRef = doc(collection(db, 'cotizaciones'))
      const costoRef = doc(collection(db, 'costos'))
      // Cotización (precio al cliente) y costo (lo que cuesta producirlo) se guardan juntos y enlazados
      const batch = writeBatch(db)
      batch.set(cotRef, {
        ...cliente,
        fecha: todayStr(),
        estado: 'borrador',
        monto: Math.round(totalCobrar),
        detalle: itemsAGuardar.length > 1
          ? itemsAGuardar.map(it => `— ${it.nombre} —\n${it.detalle}`).join('\n\n')
          : itemsAGuardar[0].detalle,
        archivos_presupuesto: [], archivos_oc: [],
        calculo: itemsAGuardar.length === 1 ? itemsAGuardar[0].calculo : null,
        costo_id: costoRef.id,
        usuario: user.email,
        createdAt: ahora,
        updatedAt: ahora,
      })
      batch.set(costoRef, {
        ...cliente,
        cotizacion_id: cotRef.id,
        fecha: todayStr(),
        estado: 'pendiente',
        items: itemsAGuardar,
        costo_total: totalCosto,
        precio_total: totalCobrar,
        pedido_id: null,
        pedido_numero: null,
        asignaciones: [],
        usuario: user.email,
        createdAt: ahora,
        updatedAt: ahora,
      })
      await batch.commit()
      toast('Cotización y costo guardados — ya los ves en Cotizaciones', 'success')
      setShowGuardar(false)
      setItems([])
      setClienteForm({ cliente_nombre: '', cliente_email: '', cliente_telefono: '', cliente_wc_id: null })
    } catch (e) {
      toast('Error al guardar: ' + e.message, 'error')
    }
    setGuardando(false)
  }

  return (
    <div className="view">
      <div className="view-header-row">
        <div>
          <h2>Calculadora de Pliegos</h2>
          <p>Imposición, costos y precio final — con IIBB y ajuste manual</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowWcConfig(s => !s)}>⚙ Conexión WooCommerce</button>
          <button className="btn btn-secondary btn-sm" onClick={resetForm}>Reset</button>
        </div>
      </div>

      {showWcConfig && (
        <div style={{ background: '#fff', borderRadius: 10, padding: '16px 24px', boxShadow: 'var(--shadow)', marginBottom: 20 }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            Necesaria para buscar clientes al guardar una cotización. Se guarda solo en este navegador — hay que cargarla una vez por dispositivo.
          </p>
          <div className="field-row">
            <div className="field"><label>URL del sitio</label><input value={wcForm.url} onChange={e => setWcForm(f => ({ ...f, url: e.target.value }))} placeholder="https://imprentaonline.ar" /></div>
            <div className="field"><label>Consumer Key</label><input value={wcForm.key} onChange={e => setWcForm(f => ({ ...f, key: e.target.value }))} placeholder="ck_..." /></div>
          </div>
          <div className="field"><label>Consumer Secret</label><input type="password" value={wcForm.secret} onChange={e => setWcForm(f => ({ ...f, secret: e.target.value }))} placeholder="cs_..." /></div>
          <button className="btn btn-primary btn-sm" onClick={guardarWc}>Guardar conexión</button>
          {wcTestResult && <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--success)' }}>{wcTestResult}</span>}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px,1fr))', gap: 20, alignItems: 'start' }}>
        {/* Columna de inputs */}
        <div style={{ background: '#fff', borderRadius: 10, padding: '20px 24px', boxShadow: 'var(--shadow)' }}>
          <div className="field-row">
            <div className="field"><label>Tipo de papel</label>
              <select value={form.paperType} onChange={e => setField('paperType', e.target.value)}>
                {PAPER_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="field"><label>Medida de pliego</label>
              <select value={form.paperSize} onChange={e => onPaperSizeChange(e.target.value)}>
                {PAPER_SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>

          <div className="field-row">
            <div className="field"><label>Pliego — Ancho (cm)</label>
              <input value={form.sheetW} onChange={e => onSheetDimChange('sheetW', e.target.value)} inputMode="decimal" />
            </div>
            <div className="field"><label>Pliego — Alto (cm)</label>
              <input value={form.sheetH} onChange={e => onSheetDimChange('sheetH', e.target.value)} inputMode="decimal" />
            </div>
          </div>

          <div className="field-row">
            <div className="field"><label>Pieza — Ancho (cm)</label>
              <input value={form.itemW} onChange={e => setField('itemW', e.target.value)} inputMode="decimal" />
            </div>
            <div className="field"><label>Pieza — Alto (cm)</label>
              <input value={form.itemH} onChange={e => setField('itemH', e.target.value)} inputMode="decimal" />
            </div>
          </div>

          <div className="field-row">
            <div className="field"><label>Demasía (mm/lado)</label>
              <input value={form.bleedMM} onChange={e => setField('bleedMM', e.target.value)} inputMode="decimal" />
            </div>
            <div className="field"><label>Separación (mm)</label>
              <input value={form.gutterMM} onChange={e => setField('gutterMM', e.target.value)} inputMode="decimal" />
            </div>
          </div>

          <div className="field-row">
            <div className="field"><label>Merma (pliegos extra)</label>
              <input value={form.extraSheets} onChange={e => setField('extraSheets', e.target.value)} inputMode="numeric" />
            </div>
            <div className="field"><label>Cantidad a producir</label>
              <input value={form.qty} onChange={e => setField('qty', e.target.value)} inputMode="numeric" />
            </div>
          </div>

          <div className="field-row">
            <div className="field"><label>Impresión</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', border: '1.5px dashed var(--border)', borderRadius: 7 }}>
                <input type="checkbox" checked={form.doubleFace} onChange={e => setField('doubleFace', e.target.checked)} style={{ width: 16, height: 16 }} />
                <span style={{ fontSize: 12 }}>Doble faz</span>
              </div>
            </div>
            <div className="field"><label>Impuestos</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', border: '1.5px dashed var(--border)', borderRadius: 7 }}>
                <input type="checkbox" checked={form.applyVat} onChange={e => setField('applyVat', e.target.checked)} style={{ width: 16, height: 16 }} />
                <span style={{ fontSize: 12 }}>Aplicar IVA 21%</span>
              </div>
            </div>
          </div>

          <div className="field-row">
            <div className="field"><label>Costo papel / pliego</label>
              <input value={form.costPaper} onChange={e => setField('costPaper', e.target.value)} inputMode="decimal" />
            </div>
            <div className="field"><label>Costo impresión / pliego / cara</label>
              <input value={form.costPrint} onChange={e => setField('costPrint', e.target.value)} inputMode="decimal" />
            </div>
          </div>
          <div className="field"><label>Costo fijo por trabajo</label>
            <input value={form.costSetup} onChange={e => setField('costSetup', e.target.value)} inputMode="decimal" />
          </div>

          <div className="field">
            <label>Producción</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={form.prodMode} onChange={e => setField('prodMode', e.target.value)} style={{ flex: 1 }}>
                <option value={PROD_MODES.PORCENTAJE}>% sobre costo base</option>
                <option value={PROD_MODES.MONTO}>Monto fijo</option>
              </select>
              <input value={form.prodValor} onChange={e => setField('prodValor', e.target.value)} inputMode="decimal"
                placeholder={form.prodMode === PROD_MODES.PORCENTAJE ? '%' : '$'} style={{ flex: 1 }} />
            </div>
          </div>

          <div className="field-row">
            <div className="field"><label>% Ganancia</label>
              <input value={form.profitPct} onChange={e => setField('profitPct', e.target.value)} inputMode="decimal" />
            </div>
            <div className="field"><label>% IIBB (Ingresos Brutos)</label>
              <input value={form.iibbPct} onChange={e => setField('iibbPct', e.target.value)} inputMode="decimal" />
            </div>
          </div>

          <div className="field">
            <label>Ítems extra (se suman al final y al costo de producción)</label>
            {(form.extras || []).map((ex, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <input value={ex.concepto} onChange={e => setExtra(i, 'concepto', e.target.value)}
                  placeholder="Ej: diseño, laminado, envío..." style={{ flex: 2 }} />
                <input value={ex.monto} onChange={e => setExtra(i, 'monto', e.target.value)}
                  inputMode="decimal" placeholder="$" style={{ flex: 1 }} />
                <button className="btn btn-secondary btn-sm" onClick={() => quitarExtra(i)} title="Quitar ítem">×</button>
              </div>
            ))}
            <button className="btn btn-secondary btn-sm" onClick={agregarExtra}>+ Agregar ítem extra</button>
          </div>
        </div>

        {/* Columna de resultado */}
        <div>
          {error && <div className="alert-warning">⚠️ {error}</div>}

          {resultado && (
            <>
              <div className="table-card" style={{ marginBottom: 16 }}>
                <div className="table-card-header"><h3>Desglose del presupuesto</h3></div>
                <Fila k="Papel" v={form.paperType} />
                <Fila k="Medida pliego" v={sizeLabel()} />
                <Fila k="Pieza efectiva (con demasía)" v={`${resultado.piezaEfectiva.ancho.toFixed(1)} × ${resultado.piezaEfectiva.alto.toFixed(1)} cm`} />
                <Fila k="Orientación" v={resultado.orientacion} />
                <Fila k="Entran por pliego" v={`${resultado.entranPorPliego.cantidad} (${resultado.entranPorPliego.columnas} × ${resultado.entranPorPliego.filas})`} />
                <Fila k="Pliegos base + merma" v={`${resultado.pliegos.base} + ${resultado.pliegos.merma} = ${resultado.pliegos.total}`} />
                <Fila k="Impresiones totales" v={resultado.impresionesTotales} />
                <Fila k="Costo papel" v={fmt(resultado.costos.papel)} />
                <Fila k="Costo impresión" v={fmt(resultado.costos.impresion)} />
                <Fila k="Costo fijo" v={fmt(resultado.costos.fijo)} />
                <Fila k="= Costo base" v={fmt(resultado.costos.base)} strong />
                <Fila k={`+ Producción ${form.prodMode === PROD_MODES.PORCENTAJE ? `(${form.prodValor}%)` : '(monto fijo)'}`} v={fmt(resultado.costos.produccion)} />
                <Fila k={`+ Ganancia (${form.profitPct}%)`} v={fmt(resultado.costos.ganancia)} />
                <Fila k={`+ IIBB (${form.iibbPct}%)`} v={fmt(resultado.costos.iibb)} />
                {resultado.extras.map((ex, i) => (
                  <Fila key={i} k={`+ ${ex.concepto}`} v={fmt(ex.monto)} />
                ))}
                <Fila k="= Precio final (sin ajustar)" v={fmt(resultado.precioFinalBase)} strong color="var(--blue)" />

                {ajusteVigente && (
                  <>
                    <Fila k="Redondeo / diferencia" sub={ajusteVigente.motivo} v={signo(diferenciaAjuste)}
                      color={diferenciaAjuste < 0 ? 'var(--danger)' : 'var(--success)'} />
                    <Fila k="= Precio a cobrar (ajustado)" v={fmt(ajusteVigente.montoAjustado)} strong color="var(--orange)" />
                  </>
                )}

                {form.applyVat && (
                  <>
                    <Fila k="+ IVA 21%" v={fmt(ivaMonto)} />
                    <Fila k="= Precio final con IVA" v={fmt(precioFinalConIva)} strong color="var(--blue)" />
                  </>
                )}

                <Fila k="Precio final / unidad" v={fmt(unitPriceEfectivo)} />
                {form.applyVat && <Fila k="Precio final / unidad con IVA" v={fmt(unitPriceConIva)} />}
                <Fila k="Costo de producción" sub="costo base + producción + extras — es lo que se carga en el pedido"
                  v={fmt(resultado.costos.produccionTotal)} strong />
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                {ajusteVigente
                  ? <button className="btn btn-secondary" onClick={quitarAjuste}>Quitar ajuste manual</button>
                  : <button className="btn btn-secondary" onClick={abrirAjuste}>Ajustar precio final</button>
                }
                <button className="btn btn-secondary" onClick={agregarItem}>+ Agregar al pedido</button>
                <button className="btn btn-primary" onClick={() => setShowGuardar(true)}>
                  {items.length ? `Guardar pedido (${items.length})` : 'Guardar cotización y costo'}
                </button>
              </div>
            </>
          )}

          {items.length > 0 && (
            <div className="table-card" style={{ marginBottom: 16 }}>
              <div className="table-card-header"><h3>Productos del pedido</h3></div>
              <table>
                <thead>
                  <tr><th>Producto</th><th className="text-right">Costo</th><th className="text-right">Cobrar</th><th /></tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i}>
                      <td style={{ width: '100%', minWidth: 180 }}>
                        <input value={it.nombre} onChange={e => renombrarItem(i, e.target.value)}
                          style={{ border: '1.5px solid var(--border)', borderRadius: 6, padding: '4px 8px', fontSize: 12, width: '100%' }} />
                        {it.diferencia !== 0 && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Redondeo / diferencia: {signo(it.diferencia)}</div>
                        )}
                      </td>
                      <td className="text-right" style={{ fontSize: 12 }}>{fmt(it.costo)}</td>
                      <td className="text-right"><strong>{fmt(it.precio_cobrar)}</strong></td>
                      <td className="text-center" style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => editarItem(i)} title="Volver a cargarlo en la calculadora">Editar</button>{' '}
                        <button className="btn btn-danger btn-sm" onClick={() => quitarItem(i)}>×</button>
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td><strong>Total</strong></td>
                    <td className="text-right"><strong>{fmt(items.reduce((s, it) => s + it.costo, 0))}</strong></td>
                    <td className="text-right"><strong>{fmt(items.reduce((s, it) => s + it.precio_cobrar, 0))}</strong></td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {resultado && (
            <>

              <div className="io-pc-two" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                  <p style={{ fontWeight: 800, fontSize: 13, marginBottom: 4 }}>Normal</p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Entran: <strong>{resultado.alternativas.normal.count}</strong> ({resultado.alternativas.normal.cols}×{resultado.alternativas.normal.rows})</p>
                </div>
                <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                  <p style={{ fontWeight: 800, fontSize: 13, marginBottom: 4 }}>Rotada (90°)</p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Entran: <strong>{resultado.alternativas.rotada.count}</strong> ({resultado.alternativas.rotada.cols}×{resultado.alternativas.rotada.rows})</p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modal ajuste */}
      {showAjusteForm && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowAjusteForm(false)}>
          <div className="modal" style={{ width: 400 }}>
            <div className="modal-header"><h3>Ajustar precio final</h3><button className="modal-close" onClick={() => setShowAjusteForm(false)}>×</button></div>
            <div className="field"><label>Nuevo precio final ($)</label>
              <input type="number" value={ajusteForm.monto} onChange={e => setAjusteForm(f => ({ ...f, monto: e.target.value }))} />
            </div>
            <div className="field"><label>Motivo del ajuste</label>
              <textarea value={ajusteForm.motivo} onChange={e => setAjusteForm(f => ({ ...f, motivo: e.target.value }))}
                placeholder="Ej: descuento por volumen, cliente frecuente, redondeo comercial..." />
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowAjusteForm(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={aplicarAjuste}>Aplicar ajuste</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal guardar como cotización */}
      {showGuardar && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowGuardar(false)}>
          <div className="modal" style={{ width: 480 }}>
            <div className="modal-header"><h3>Guardar cotización y costo</h3><button className="modal-close" onClick={() => setShowGuardar(false)}>×</button></div>

            {!clienteForm.cliente_wc_id && (
              <div className="field">
                <label>Buscar cliente en WooCommerce</label>
                <input value={clienteQuery} onChange={e => setClienteQuery(e.target.value)} placeholder="Nombre, usuario o email..." />
                {buscandoCliente && <small style={{ color: 'var(--text-muted)' }}>Buscando...</small>}
                {clienteResults.length > 0 && (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 7, marginTop: 6, maxHeight: 140, overflowY: 'auto' }}>
                    {clienteResults.map(c => (
                      <div key={c.id} onClick={() => elegirCliente(c)}
                        style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                        <strong>{`${c.first_name || ''} ${c.last_name || ''}`.trim() || c.username}</strong>
                        {c.email && <span style={{ color: 'var(--text-muted)' }}> — {c.email}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="field"><label>Nombre del cliente</label>
              <input value={clienteForm.cliente_nombre} onChange={e => setClienteForm(f => ({ ...f, cliente_nombre: e.target.value, cliente_wc_id: null }))} placeholder="Nombre y apellido" />
            </div>
            <div className="field-row">
              <div className="field"><label>Teléfono (WhatsApp)</label>
                <input value={clienteForm.cliente_telefono} onChange={e => setClienteForm(f => ({ ...f, cliente_telefono: e.target.value }))} placeholder="Ej: 54911..." />
              </div>
              <div className="field"><label>Email</label>
                <input value={clienteForm.cliente_email} onChange={e => setClienteForm(f => ({ ...f, cliente_email: e.target.value }))} />
              </div>
            </div>

            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              {itemsAGuardar.length > 1 ? `${itemsAGuardar.length} productos — ` : ''}
              Se guarda la cotización con estado <strong>Borrador</strong> por {fmt(totalCobrar)} y su costo de producción
              de {fmt(totalCosto)}. Desde Cotizaciones podés cambiar el estado, subir archivos y vincularla a un pedido
              para cargarle el costo en WooCommerce.
            </p>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowGuardar(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardarCotizacion} disabled={guardando}>
                {guardando ? 'Guardando...' : 'Guardar cotización'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
