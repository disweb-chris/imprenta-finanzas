import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { fmt, fmtDate, todayStr, localDateStr, daysUntil } from '../utils/helpers'
import { getAppConfig } from '../utils/appConfig'
import { calcAgip, calcMonotributo } from '../utils/impuestos'
import { loadCuentasPagar } from '../utils/cuentasPagar'
import { useCats } from '../context/CatContext'
import AgipCard from '../components/AgipCard'

const DIAS_CALENDARIO = 45

const colorPct = (p) => p >= 100 ? 'var(--danger)' : p >= 80 ? '#f59e0b' : 'var(--success)'

export default function Impuestos() {
  const { getCat } = useCats()
  const [loading, setLoading] = useState(true)
  const [errorWC, setErrorWC] = useState('')
  const [mono, setMono] = useState(null)
  const [techoConfigurado, setTechoConfigurado] = useState(true)
  const [agip, setAgip] = useState(null)
  const [vencimientos, setVencimientos] = useState([])

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    setErrorWC('')
    const cfg = await getAppConfig()
    setTechoConfigurado(!!parseFloat(cfg.monotributo_techo || 0))
    const hasta = localDateStr(new Date(Date.now() + DIAS_CALENDARIO * 86400000))

    const [monoRes, agipRes, compSnap, cuentas] = await Promise.all([
      calcMonotributo(cfg).catch(e => { setErrorWC(e.message); return null }),
      calcAgip(cfg).catch(() => null),
      getDocs(query(collection(db, 'compromisos'), where('estado', '==', 'activo'))),
      loadCuentasPagar({ soloAbiertas: true }).catch(() => []),
    ])
    setMono(monoRes)
    setAgip(agipRes)

    const items = []
    if (agipRes && !agipRes.pagado) {
      items.push({ fecha: agipRes.venc, concepto: `AGIP — Ingresos Brutos ${agipRes.mesLabel}`, monto: agipRes.monto, tipo: 'impuesto', categoria: 'impuestos', link: null })
    }
    compSnap.forEach(d => {
      const c = d.data()
      if (!c.fecha_proximo_pago || c.fecha_proximo_pago > hasta) return
      items.push({
        fecha: c.fecha_proximo_pago, concepto: c.nombre, monto: parseFloat(c.monto || 0),
        tipo: c.categoria === 'impuestos' ? 'impuesto' : 'compromiso', categoria: c.categoria, link: '/finanzas/compromisos',
      })
    })
    cuentas.forEach(c => {
      if (c.vencimiento > hasta) return
      items.push({ fecha: c.vencimiento, concepto: `${c.proveedor} — ${c.concepto}`, monto: c.saldo, tipo: 'proveedor', categoria: 'produccion-tercerizada', link: '/finanzas/cuentas-pagar' })
    })
    if (monoRes) {
      const recat = localDateStr(monoRes.recat.mesRecat)
      if (recat <= hasta) items.push({ fecha: recat, concepto: 'Recategorización del monotributo', monto: null, tipo: 'impuesto', categoria: 'impuestos', link: null, aviso: true })
    }
    items.sort((a, b) => a.fecha.localeCompare(b.fecha))
    setVencimientos(items)
    setLoading(false)
  }

  if (loading) return <div className="view"><div className="loading-state"><div className="spinner" /><p style={{ marginTop: 12 }}>Calculando impuestos...</p></div></div>

  const hoy = todayStr()
  const vencidos = vencimientos.filter(v => !v.aviso && v.fecha < hoy)
  const proximos7 = vencimientos.filter(v => !v.aviso && v.fecha >= hoy && daysUntil(v.fecha) <= 7)
  const maxMes = mono ? Math.max(...mono.meses.map(m => m.monto), 1) : 1
  const techoMensual = mono?.techo ? mono.techo / 12 : null

  return (
    <div className="view">
      <div className="view-header-row">
        <div><h2>Impuestos y vencimientos</h2><p>Monotributo, Ingresos Brutos y todo lo que vence en los próximos {DIAS_CALENDARIO} días</p></div>
        <button className="btn btn-secondary btn-sm" onClick={load}>Actualizar</button>
      </div>

      {errorWC && <div className="alert-warning">⚠️ No se pudo leer WooCommerce: {errorWC}</div>}

      <div className="cards-grid">
        <div className="stat-card card-red"><div className="card-label">Vencido</div><div className="card-value">{fmt(vencidos.reduce((s, v) => s + (v.monto || 0), 0))}</div><div className="card-sub">{vencidos.length} pendiente{vencidos.length !== 1 ? 's' : ''}</div></div>
        <div className="stat-card card-orange"><div className="card-label">Vence en 7 días</div><div className="card-value">{fmt(proximos7.reduce((s, v) => s + (v.monto || 0), 0))}</div><div className="card-sub">{proximos7.length} vencimiento{proximos7.length !== 1 ? 's' : ''}</div></div>
        {mono && mono.pct != null && (
          <div className="stat-card" style={{ borderLeft: `4px solid ${colorPct(mono.pct)}` }}>
            <div className="card-label">Tope monotributo (12 meses)</div>
            <div className="card-value" style={{ color: colorPct(mono.pct) }}>{mono.pct.toFixed(1)}%</div>
            <div className="card-sub">{fmt(mono.facturado)} de {fmt(mono.techo)}</div>
          </div>
        )}
      </div>

      {/* Monotributo */}
      <div className="chart-card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          <h3>Monotributo — facturación y recategorización</h3>
          {mono && <span className="badge badge-blue">Próxima recategorización: {mono.recat.mesRecatLabel}</span>}
        </div>
        {!techoConfigurado && (
          <div className="alert-warning">Cargá el techo de facturación de tu categoría en Configuración → Parámetros financieros para ver el porcentaje usado y la proyección.</div>
        )}
        {mono && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
              <div style={{ padding: 14, background: '#f8fafc', borderRadius: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Facturado últimos 12 meses</div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 700, marginTop: 4 }}>{fmt(mono.facturado)}</div>
              </div>
              <div style={{ padding: 14, background: '#f8fafc', borderRadius: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Ritmo (promedio 3 meses)</div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 700, marginTop: 4 }}>{fmt(mono.ritmo)}<span style={{ fontSize: 12, color: 'var(--text-muted)' }}> /mes</span></div>
              </div>
              <div style={{ padding: 14, background: mono.pctProyectado != null && mono.pctProyectado >= 100 ? '#fef2f2' : '#f8fafc', borderRadius: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Proyectado al {fmtDate(localDateStr(mono.recat.corte))}</div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 700, marginTop: 4, color: mono.pctProyectado != null ? colorPct(mono.pctProyectado) : undefined }}>{fmt(mono.proyectado)}</div>
                {mono.pctProyectado != null && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{mono.pctProyectado.toFixed(0)}% del techo actual</div>}
              </div>
            </div>

            {mono.pct != null && (
              <div style={{ height: 8, background: '#eef2f7', borderRadius: 4, marginBottom: 18, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(mono.pct, 100)}%`, background: colorPct(mono.pct) }} />
              </div>
            )}

            {/* Barras por mes */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120, position: 'relative' }}>
              {techoMensual && techoMensual <= maxMes * 1.1 && (
                <div title="Techo mensual promedio" style={{ position: 'absolute', left: 0, right: 0, bottom: `${techoMensual / maxMes * 100}%`, borderTop: '1.5px dashed var(--danger)' }} />
              )}
              {mono.meses.map(m => (
                <div key={m.mes} title={`${m.label}: ${fmt(m.monto)}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                  <div style={{ width: '100%', maxWidth: 34, height: `${m.monto / maxMes * 100}%`, minHeight: m.monto ? 2 : 0, background: m.mes >= localDateStr(mono.recat.inicioVentana).slice(0, 7) ? 'rgba(46,80,158,.8)' : 'rgba(46,80,158,.3)', borderRadius: '4px 4px 0 0' }} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              {mono.meses.map(m => <div key={m.mes} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: 'var(--text-muted)' }}>{m.label}</div>)}
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
              En azul fuerte, los meses que cuentan para la recategorización de {mono.recat.mesRecatLabel}{techoMensual ? '; la línea punteada es el techo dividido 12' : ''}.
              Se toman los pedidos completados y en proceso de WooCommerce (lo mismo que facturás con el plugin de ARCA). Es una estimación: el dato oficial es el de ARCA.
            </p>
          </>
        )}
      </div>

      {agip && <AgipCard agip={agip} onPagado={load} />}

      {/* Calendario */}
      <div className="table-card">
        <div className="table-card-header"><h3>Vencimientos — próximos {DIAS_CALENDARIO} días</h3></div>
        {vencimientos.length === 0
          ? <div className="empty-state"><p>Nada vence en los próximos {DIAS_CALENDARIO} días</p></div>
          : (
            <table>
              <thead><tr><th>Fecha</th><th>Concepto</th><th>Tipo</th><th className="text-right">Monto</th><th>Cuándo</th></tr></thead>
              <tbody>
                {vencimientos.map((v, i) => {
                  const d = daysUntil(v.fecha)
                  const tipo = { impuesto: ['Impuesto', 'badge-blue'], compromiso: ['Compromiso', 'badge-gray'], proveedor: ['Proveedor', 'badge-orange'] }[v.tipo]
                  return (
                    <tr key={i} style={v.aviso ? { background: '#f8fafc' } : undefined}>
                      <td><strong>{fmtDate(v.fecha)}</strong></td>
                      <td>
                        <span className="cat-dot" style={{ background: getCat(v.categoria).color }} />
                        {v.link ? <Link to={v.link}>{v.concepto}</Link> : v.concepto}
                        {v.aviso && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Revisá en ARCA la fecha exacta y si te corresponde cambiar de categoría</div>}
                      </td>
                      <td><span className={`badge ${tipo[1]}`}>{tipo[0]}</span></td>
                      <td className="text-right">{v.monto == null ? '-' : <strong>{fmt(v.monto)}</strong>}</td>
                      <td>
                        {v.aviso ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>en {d}d</span>
                          : d < 0 ? <span className="badge badge-red">Vencido hace {Math.abs(d)}d</span>
                          : d === 0 ? <span className="badge badge-red">Hoy</span>
                          : d <= 7 ? <span className="badge badge-yellow">En {d}d</span>
                          : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>en {d}d</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        }
      </div>
    </div>
  )
}
