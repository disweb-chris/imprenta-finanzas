import { useEffect, useState } from 'react'
import { collection, getDocs, addDoc, deleteDoc, doc, query, orderBy, limit, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { fetchOrders } from '../utils/woocommerce'
import { fmt, fmtDate, todayStr } from '../utils/helpers'
import { useCats } from '../context/CatContext'
import { useToast } from '../components/Toast'
import { useAuth } from '../context/AuthContext'

// Parsear fecha del historial: "27/04/2026 13:45" -> Date
function parseFechaHistorial(s) {
  if (!s) return null
  const [dp, tp] = s.split(' ')
  if (!dp) return null
  const [d, m, y] = dp.split('/')
  const [h='0', mi='0'] = (tp||'0:0').split(':')
  return new Date(+y, +m-1, +d, +h, +mi)
}

// Cobros de una orden posteriores al timestamp del cierre
function getCobrosDelPeriodo(order, desde) {
  const hist = order.io_pagos_historial
  if (Array.isArray(hist) && hist.length > 0) {
    return hist
      .filter(p => { const f = parseFechaHistorial(p.fecha); return f && f > desde })
      .map(p => ({ monto: parseFloat(p.monto||0), medio: (p.metodo||'').toLowerCase()==='efectivo'?'efectivo':'banco' }))
  }
  if (new Date(order.date_created) > desde) {
    const pm = order.payment_method||''
    return [{ monto: parseFloat(order.total||0), medio: pm==='cod'?'efectivo':'banco' }]
  }
  return []
}

const _ls = (d) => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')

export default function Caja() {
  const { getCat } = useCats()
  const toast = useToast()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [lastCierre, setLastCierre] = useState(null)
  const [kpis, setKpis] = useState({ saldoCierre:0, ventas:0, ingExtra:0, egresos:0, saldoActual:0, ventasBanco:0, ventasEfectivo:0, egresosBanco:0, egresosEfectivo:0, saldoBanco:0, saldoEfectivo:0, ordenes:0 })
  const [extraDocs, setExtraDocs] = useState([])
  const [historial, setHistorial] = useState([])
  const [proyeccion, setProyeccion] = useState(null)
  const [showCierre, setShowCierre] = useState(false)
  const [showExtra, setShowExtra] = useState(false)
  const [editExtra, setEditExtra] = useState(null)
  const [cierreForm, setCierreForm] = useState({ saldo:'', saldo_banco:'', saldo_efectivo:'', fecha:todayStr(), notas:'' })
  const [extraForm, setExtraForm] = useState({ fecha:todayStr(), monto:'', tipo:'credito', descripcion:'' })
  const [saldoCalc, setSaldoCalc] = useState(0)
  const [alertMsg, setAlertMsg] = useState('')

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    setLoading(true)
    try {
      // Ordenar por fecha (siempre existe) — timestamp solo para comparación de hora
      const cierreSnap = await getDocs(query(collection(db,'cierres_caja'), orderBy('fecha','desc'), limit(5)))
      let cierre = null
      // De los últimos 5 por fecha, elegir el que tenga timestamp más reciente
      const candidatos = []
      cierreSnap.forEach(d => candidatos.push({id:d.id,...d.data()}))
      if (candidatos.length > 0) {
        // Ordenar por timestamp si existe, sino por fecha+hora estimada
        candidatos.sort((a,b) => {
          const ta = a.timestamp ? new Date(a.timestamp).getTime() : new Date(a.fecha+'T23:59:59').getTime()
          const tb = b.timestamp ? new Date(b.timestamp).getTime() : new Date(b.fecha+'T23:59:59').getTime()
          return tb - ta
        })
        cierre = candidatos[0]
      }
      setLastCierre(cierre)

      const hoy = todayStr()
      const ayer = _ls(new Date(Date.now()-86400000))
      if (!cierre) setAlertMsg('No hay cierres registrados. Ingresá el saldo inicial haciendo un cierre de caja.')
      else if (cierre.fecha < ayer) {
        const dias = Math.round((new Date(hoy)-new Date(cierre.fecha))/86400000)
        setAlertMsg(`Último cierre hace ${dias} día${dias>1?'s':''} (${fmtDate(cierre.fecha)}). Recordá hacer el cierre diario.`)
      } else setAlertMsg('')

      const saldoCierre = cierre ? parseFloat(cierre.saldo_final||0) : 0
      let desde
      if (!cierre) desde = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      else if (cierre.timestamp) desde = new Date(cierre.timestamp)
      else { const [y,m,d]=cierre.fecha.split('-').map(Number); desde=new Date(y,m-1,d,23,59,59,999) }
      const ahora = new Date()
      const desdeFecha = cierre?.timestamp
        ? _ls(new Date(desde))
        : (()=>{ const n=new Date(desde); n.setDate(n.getDate()+1); return _ls(n) })()

      const [ordNuevas, ordAntiguas, egrSnap, extraSnap] = await Promise.all([
        fetchOrders(desde, ahora, 'completed,processing').catch(()=>[]),
        fetchOrders(new Date(desde.getTime()-60*86400000), desde, 'completed,processing,on-hold').catch(()=>[]),
        getDocs(query(collection(db,'egresos'), where('fecha','>=',desdeFecha), where('fecha','<=',todayStr()))),
        getDocs(query(collection(db,'ingresos_extra'), where('fecha','>=',desdeFecha), where('fecha','<=',todayStr()))),
      ])

      const ordMap = {}
      ordNuevas.forEach(o => { ordMap[o.id]=o })
      ordAntiguas.forEach(o => { if (!ordMap[o.id]) ordMap[o.id]=o })
      const todas = Object.values(ordMap)

      let ventas=0, ventasBanco=0, ventasEfectivo=0
      const conMov = new Set()
      todas.forEach(o => {
        const cobros = getCobrosDelPeriodo(o, desde)
        if (cobros.length) {
          conMov.add(o.id)
          cobros.forEach(c => {
            ventas+=c.monto
            if (c.medio==='efectivo') ventasEfectivo+=c.monto
            else ventasBanco+=c.monto
          })
        }
      })

      let egresosTotal=0, egresosBanco=0, egresosEfectivo=0
      egrSnap.forEach(d => {
        const x=d.data()
        if (cierre?.timestamp && x.fecha===cierre.fecha) {
          const ec = x.createdAt ? new Date(x.createdAt) : null
          const ct = new Date(cierre.timestamp)
          if (!ec || ec<=ct) return
        }
        const m=parseFloat(x.monto||0)
        egresosTotal+=m
        if (x.medio_pago==='efectivo') egresosEfectivo+=m
        else egresosBanco+=m
      })

      let ingExtra=0
      const extras=[]
      extraSnap.forEach(d => { const x={id:d.id,...d.data()}; extras.push(x); ingExtra+=parseFloat(x.monto||0) })

      const saldoActual = saldoCierre+ventas+ingExtra-egresosTotal
      const sCB = cierre?.saldo_banco!=null ? parseFloat(cierre.saldo_banco) : saldoCierre
      const sCE = cierre?.saldo_efectivo!=null ? parseFloat(cierre.saldo_efectivo) : 0
      const saldoBanco = sCB+ventasBanco+ingExtra-egresosBanco
      const saldoEfectivo = sCE+ventasEfectivo-egresosEfectivo

      setKpis({ saldoCierre, ventas, ingExtra, egresos:egresosTotal, saldoActual, ordenes:conMov.size, ventasBanco, ventasEfectivo, egresosBanco, egresosEfectivo, saldoBanco, saldoEfectivo })
      setExtraDocs(extras)
      setSaldoCalc(saldoActual)

      const compSnap = await getDocs(collection(db,'compromisos'))
      const comps=[]; compSnap.forEach(d=>comps.push({id:d.id,...d.data()}))
      await calcProyeccion(saldoActual, comps)

      const histSnap = await getDocs(query(collection(db,'cierres_caja'), orderBy('fecha','desc'), limit(30)))
      const hist=[]; histSnap.forEach(d=>hist.push({id:d.id,...d.data()}))
      setHistorial(hist)
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  const calcProyeccion = async (saldoActual, comps) => {
    const now=new Date(), hoy=todayStr()
    const finMes=_ls(new Date(now.getFullYear(),now.getMonth()+1,0))
    const inicioMes=_ls(new Date(now.getFullYear(),now.getMonth(),1))
    const ss = await getDocs(query(collection(db,'egresos'),where('categoria','==','sueldos'),where('fecha','>=',inicioMes),where('fecha','<=',hoy)))
    const ppc={}; ss.forEach(d=>{const x=d.data();if(x.origen_compromiso)ppc[x.origen_compromiso]=(ppc[x.origen_compromiso]||0)+parseFloat(x.monto||0)})
    const pendientes=[]
    comps.forEach(c=>{
      if(c.estado!=='activo') return
      const fp=c.fecha_proximo_pago, monto=parseFloat(c.monto||0)
      if(c.categoria==='sueldos'){
        const p=Math.max(monto-(ppc[c.id]||0),0)
        if(p>0) pendientes.push({nombre:c.nombre,monto:p,categoria:c.categoria,fecha:fp&&fp<=finMes?fp:finMes})
      } else {
        if(!fp||fp<hoy||fp>finMes) return
        const p=Math.max(monto-parseFloat(c.monto_pagado||0),0)
        if(p>0) pendientes.push({nombre:c.nombre,monto:p,categoria:c.categoria,fecha:fp})
      }
    })
    const vA=new Date(now.getFullYear(),now.getMonth(),10)
    if(vA>=now){try{
      const mA=new Date(now.getFullYear(),now.getMonth()-1,1)
      const mAF=new Date(now.getFullYear(),now.getMonth(),0,23,59,59)
      const ob=await fetchOrders(mA,mAF,'completed,processing')
      const base=ob.reduce((s,o)=>s+parseFloat(o.total||0),0)
      if(base>0) pendientes.push({nombre:'AGIP — Ingresos Brutos',monto:base*0.04,categoria:'impuestos',fecha:_ls(vA)})
    }catch{}}
    const total=pendientes.reduce((s,p)=>s+p.monto,0)
    setProyeccion({saldoActual,totalPendiente:total,saldoProyectado:saldoActual-total,pendientes})
  }

  const openCierre=()=>{setCierreForm({saldo:Math.round(saldoCalc),saldo_banco:Math.round(kpis.saldoBanco),saldo_efectivo:Math.round(kpis.saldoEfectivo),fecha:todayStr(),notas:''});setShowCierre(true)}

  const guardarCierre=async()=>{
    const saldo=parseFloat(cierreForm.saldo)
    if(!cierreForm.fecha||isNaN(saldo)){toast('Completá fecha y saldo','error');return}
    const ex=await getDocs(query(collection(db,'cierres_caja'),where('fecha','==',cierreForm.fecha)))
    if(!ex.empty){if(!confirm('Ya existe un cierre para esta fecha. ¿Reemplazarlo?')) return; for(const d of ex.docs) await deleteDoc(doc(db,'cierres_caja',d.id))}
    await addDoc(collection(db,'cierres_caja'),{fecha:cierreForm.fecha,saldo_final:saldo,saldo_banco:parseFloat(cierreForm.saldo_banco)||0,saldo_efectivo:parseFloat(cierreForm.saldo_efectivo)||0,notas:cierreForm.notas,timestamp:new Date().toISOString(),usuario:user.email,createdAt:new Date().toISOString()})
    setShowCierre(false);toast('Cierre guardado','success');loadAll()
  }

  const guardarExtra=async()=>{
    const monto=parseFloat(extraForm.monto)
    if(!extraForm.fecha||isNaN(monto)||monto<=0){toast('Completá fecha y monto','error');return}
    const data={...extraForm,monto,usuario:user.email,updatedAt:new Date().toISOString()}
    if(editExtra){await import('firebase/firestore').then(({setDoc,doc:df})=>setDoc(df(db,'ingresos_extra',editExtra.id),data))}
    else{await addDoc(collection(db,'ingresos_extra'),{...data,createdAt:new Date().toISOString()})}
    setShowExtra(false);toast('Ingreso guardado','success');loadAll()
  }

  const deleteExtra=async(id)=>{if(!confirm('¿Eliminar?')) return;await deleteDoc(doc(db,'ingresos_extra',id));toast('Eliminado');loadAll()}
  const deleteCierre=async(id)=>{if(!confirm('¿Eliminar este cierre?')) return;await deleteDoc(doc(db,'cierres_caja',id));toast('Eliminado');loadAll()}
  const tipoLabel={credito:'Crédito/Préstamo',transferencia:'Transferencia',devolucion:'Devolución',otro:'Otro'}

  if(loading) return <div className="view"><div className="loading-state"><div className="spinner"/><p style={{marginTop:12}}>Cargando caja...</p></div></div>

  return (
    <div className="view">
      <div className="view-header-row">
        <div><h2>Flujo de Caja</h2><p>Saldo en tiempo real + proyección de fin de mes</p></div>
        <div style={{display:'flex',gap:10}}>
          <button className="btn btn-secondary" onClick={()=>{setEditExtra(null);setExtraForm({fecha:todayStr(),monto:'',tipo:'credito',descripcion:''});setShowExtra(true)}}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Ingreso extra
          </button>
          <button className="btn btn-primary" onClick={openCierre}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            Cierre de caja
          </button>
        </div>
      </div>

      {alertMsg && <div className="alert-warning" style={{marginBottom:16}}>⚠️ {alertMsg}</div>}

      <div className="cards-grid" style={{gridTemplateColumns:'repeat(4,1fr)',marginBottom:12}}>
        <div className="stat-card card-blue"><div className="card-label">Saldo último cierre</div><div className="card-value">{fmt(kpis.saldoCierre)}</div><div className="card-sub">{lastCierre?'al '+fmtDate(lastCierre.fecha)+(lastCierre.timestamp?' '+new Date(lastCierre.timestamp).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}):''):'sin cierre previo'}</div></div>
        <div className="stat-card card-green"><div className="card-label">+ Cobrado desde cierre</div><div className="card-value">{fmt(kpis.ventas)}</div><div className="card-sub">{kpis.ordenes} pedidos con cobros</div></div>
        <div className="stat-card card-red"><div className="card-label">− Egresos desde cierre</div><div className="card-value">{fmt(kpis.egresos)}</div></div>
        <div className="stat-card" style={{borderLeft:'3px solid var(--blue)',background:'linear-gradient(135deg,#eff3ff,#fff)'}}><div className="card-label">Saldo actual estimado</div><div className="card-value" style={{fontSize:22,color:kpis.saldoActual>=0?'var(--blue)':'var(--danger)'}}>{fmt(kpis.saldoActual)}</div><div className="card-sub">en cuenta ahora</div></div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:20}}>
        <div style={{background:'#fff',borderRadius:10,padding:'16px 20px',boxShadow:'var(--shadow)',borderLeft:'4px solid #2e509e'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
            <svg width="18" height="18" fill="none" stroke="#2e509e" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
            <span style={{fontFamily:'var(--font-head)',fontWeight:700,fontSize:14,color:'#2e509e'}}>Banco / Transferencia</span>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text-muted)',marginBottom:4}}><span>+ Cobros transferencia</span><span style={{color:'var(--success)',fontWeight:600}}>{fmt(kpis.ventasBanco)}</span></div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text-muted)',marginBottom:4}}><span>+ Ingresos extra</span><span style={{color:'var(--success)',fontWeight:600}}>{fmt(kpis.ingExtra)}</span></div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text-muted)',marginBottom:8}}><span>− Egresos banco</span><span style={{color:'var(--danger)',fontWeight:600}}>{fmt(kpis.egresosBanco)}</span></div>
          <div style={{borderTop:'1px solid var(--border)',paddingTop:8,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontSize:12,fontWeight:600,color:'var(--text-muted)'}}>SALDO BANCO</span>
            <span style={{fontFamily:'var(--font-head)',fontWeight:800,fontSize:20,color:kpis.saldoBanco>=0?'#2e509e':'var(--danger)'}}>{fmt(kpis.saldoBanco)}</span>
          </div>
        </div>
        <div style={{background:'#fff',borderRadius:10,padding:'16px 20px',boxShadow:'var(--shadow)',borderLeft:'4px solid #FF6B00'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
            <svg width="18" height="18" fill="none" stroke="#FF6B00" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/></svg>
            <span style={{fontFamily:'var(--font-head)',fontWeight:700,fontSize:14,color:'#FF6B00'}}>Efectivo</span>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text-muted)',marginBottom:4}}><span>+ Cobros efectivo</span><span style={{color:'var(--success)',fontWeight:600}}>{fmt(kpis.ventasEfectivo)}</span></div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text-muted)',marginBottom:8,marginTop:20}}><span>− Egresos efectivo</span><span style={{color:'var(--danger)',fontWeight:600}}>{fmt(kpis.egresosEfectivo)}</span></div>
          <div style={{borderTop:'1px solid var(--border)',paddingTop:8,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontSize:12,fontWeight:600,color:'var(--text-muted)'}}>SALDO EFECTIVO</span>
            <span style={{fontFamily:'var(--font-head)',fontWeight:800,fontSize:20,color:kpis.saldoEfectivo>=0?'#FF6B00':'var(--danger)'}}>{fmt(kpis.saldoEfectivo)}</span>
          </div>
        </div>
      </div>

      {proyeccion && (
        <div className="chart-card">
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
            <h3>Proyección fin de mes</h3>
            <span style={{fontSize:12,color:'var(--text-muted)'}}>Proyección al {fmtDate(_ls(new Date(new Date().getFullYear(),new Date().getMonth()+1,0)))}</span>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16}}>
            <div style={{textAlign:'center',padding:16,background:'#f8fafc',borderRadius:8}}><div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',color:'var(--text-muted)',marginBottom:6}}>Saldo actual</div><div style={{fontFamily:'var(--font-head)',fontSize:20,fontWeight:700}}>{fmt(proyeccion.saldoActual)}</div></div>
            <div style={{textAlign:'center',padding:16,background:'#fff3e8',borderRadius:8}}><div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',color:'var(--orange)',marginBottom:6}}>− Compromisos pendientes</div><div style={{fontFamily:'var(--font-head)',fontSize:20,fontWeight:700,color:'var(--orange)'}}>{fmt(proyeccion.totalPendiente)}</div><div style={{fontSize:11,color:'var(--text-muted)',marginTop:4}}>{proyeccion.pendientes.length} compromisos</div></div>
            <div style={{textAlign:'center',padding:16,background:proyeccion.saldoProyectado>=0?'#ecfdf5':'#fef2f2',borderRadius:8}}><div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',color:'var(--text-muted)',marginBottom:6}}>= Saldo proyectado</div><div style={{fontFamily:'var(--font-head)',fontSize:22,fontWeight:800,color:proyeccion.saldoProyectado>=0?'var(--success)':'var(--danger)'}}>{fmt(proyeccion.saldoProyectado)}</div></div>
          </div>
          {proyeccion.pendientes.length>0&&(
            <div style={{borderTop:'1px solid var(--border)',paddingTop:12,marginTop:14}}>
              <div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',color:'var(--text-muted)',marginBottom:8}}>Detalle de compromisos pendientes</div>
              {proyeccion.pendientes.sort((a,b)=>a.fecha.localeCompare(b.fecha)).map((p,i)=>(
                <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px solid var(--border)',fontSize:13}}>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span className="cat-dot" style={{background:getCat(p.categoria).color}}/>{p.nombre}
                    <span className="badge badge-gray" style={{fontSize:10}}>{fmtDate(p.fecha)}</span>
                  </div>
                  <strong style={{color:'var(--danger)'}}>{fmt(p.monto)}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="table-card">
        <div className="table-card-header"><h3>Ingresos extra</h3><span style={{fontSize:12,color:'var(--text-muted)'}}>Créditos, transferencias y otros desde el último cierre</span></div>
        {extraDocs.length===0?<div className="empty-state"><p>Sin ingresos extra desde el último cierre</p></div>:
          <table><thead><tr><th>Fecha</th><th>Tipo</th><th>Descripción</th><th className="text-right">Monto</th><th className="text-center">Acciones</th></tr></thead>
          <tbody>{extraDocs.map(x=>(
            <tr key={x.id}>
              <td>{fmtDate(x.fecha)}</td><td><span className="badge badge-green">{tipoLabel[x.tipo]||x.tipo}</span></td>
              <td>{x.descripcion||'-'}</td><td className="text-right"><strong style={{color:'var(--success)'}}>{fmt(x.monto)}</strong></td>
              <td className="text-center" style={{display:'flex',gap:6,justifyContent:'center'}}>
                <button className="btn btn-secondary btn-sm" onClick={()=>{setEditExtra(x);setExtraForm({fecha:x.fecha,monto:x.monto,tipo:x.tipo,descripcion:x.descripcion});setShowExtra(true)}}>Editar</button>
                <button className="btn btn-danger btn-sm" onClick={()=>deleteExtra(x.id)}>×</button>
              </td>
            </tr>
          ))}</tbody></table>}
      </div>

      <div className="table-card">
        <div className="table-card-header"><h3>Historial de cierres</h3><button className="btn btn-secondary btn-sm" onClick={loadAll}>Actualizar</button></div>
        {historial.length===0?<div className="empty-state"><p>Sin cierres registrados</p></div>:
          <table><thead><tr><th>Fecha</th><th>Hora</th><th className="text-right">Total</th><th className="text-right">Banco</th><th className="text-right">Efectivo</th><th>Notas</th><th className="text-center">Acciones</th></tr></thead>
          <tbody>{historial.map(c=>(
            <tr key={c.id}>
              <td><strong>{fmtDate(c.fecha)}</strong></td>
              <td style={{fontSize:12,color:'var(--text-muted)'}}>{c.timestamp?new Date(c.timestamp).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}):'-'}</td>
              <td className="text-right" style={{fontFamily:'var(--font-head)',fontWeight:700,color:'var(--blue)'}}>{fmt(c.saldo_final)}</td>
              <td className="text-right" style={{fontSize:13,color:'#2e509e',fontWeight:600}}>{c.saldo_banco!=null?fmt(c.saldo_banco):'-'}</td>
              <td className="text-right" style={{fontSize:13,color:'#FF6B00',fontWeight:600}}>{c.saldo_efectivo!=null?fmt(c.saldo_efectivo):'-'}</td>
              <td style={{fontSize:12,color:'var(--text-muted)'}}>{c.notas||'-'}</td>
              <td className="text-center"><button className="btn btn-danger btn-sm" onClick={()=>deleteCierre(c.id)}>×</button></td>
            </tr>
          ))}</tbody></table>}
      </div>

      {showCierre&&(
        <div className="modal-overlay open" onClick={e=>e.target===e.currentTarget&&setShowCierre(false)}>
          <div className="modal" style={{width:420}}>
            <div className="modal-header"><h3>Cierre de Caja</h3><button className="modal-close" onClick={()=>setShowCierre(false)}>×</button></div>
            <div style={{background:'#f0f4f8',borderRadius:8,padding:14,marginBottom:16,fontSize:13}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}><span style={{color:'var(--text-muted)'}}>Saldo calculado:</span><strong>{fmt(saldoCalc)}</strong></div>
              <div style={{fontSize:11,color:'var(--text-muted)'}}>Ajustá si hay diferencia con el saldo real en cuenta.</div>
            </div>
            <div className="field"><label>Saldo total en cuenta ($)</label><input type="number" value={cierreForm.saldo} onChange={e=>setCierreForm(f=>({...f,saldo:e.target.value}))}/></div>
            <div className="field-row">
              <div className="field"><label>Del cual, en banco ($)</label><input type="number" value={cierreForm.saldo_banco} onChange={e=>setCierreForm(f=>({...f,saldo_banco:e.target.value}))} placeholder="0"/></div>
              <div className="field"><label>Del cual, en efectivo ($)</label><input type="number" value={cierreForm.saldo_efectivo} onChange={e=>setCierreForm(f=>({...f,saldo_efectivo:e.target.value}))} placeholder="0"/></div>
            </div>
            <div className="field"><label>Fecha del cierre</label><input type="date" value={cierreForm.fecha} onChange={e=>setCierreForm(f=>({...f,fecha:e.target.value}))}/></div>
            <div className="field"><label>Notas (opcional)</label><textarea value={cierreForm.notas} onChange={e=>setCierreForm(f=>({...f,notas:e.target.value}))} placeholder="Observaciones..."/></div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={()=>setShowCierre(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardarCierre}>Guardar cierre</button>
            </div>
          </div>
        </div>
      )}

      {showExtra&&(
        <div className="modal-overlay open" onClick={e=>e.target===e.currentTarget&&setShowExtra(false)}>
          <div className="modal" style={{width:420}}>
            <div className="modal-header"><h3>{editExtra?'Editar Ingreso Extra':'Nuevo Ingreso Extra'}</h3><button className="modal-close" onClick={()=>setShowExtra(false)}>×</button></div>
            <div className="field-row">
              <div className="field"><label>Fecha</label><input type="date" value={extraForm.fecha} onChange={e=>setExtraForm(f=>({...f,fecha:e.target.value}))}/></div>
              <div className="field"><label>Monto ($)</label><input type="number" value={extraForm.monto} onChange={e=>setExtraForm(f=>({...f,monto:e.target.value}))} placeholder="0"/></div>
            </div>
            <div className="field"><label>Tipo</label><select value={extraForm.tipo} onChange={e=>setExtraForm(f=>({...f,tipo:e.target.value}))}><option value="credito">Crédito / Préstamo</option><option value="transferencia">Transferencia recibida</option><option value="devolucion">Devolución</option><option value="otro">Otro</option></select></div>
            <div className="field"><label>Descripción</label><textarea value={extraForm.descripcion} onChange={e=>setExtraForm(f=>({...f,descripcion:e.target.value}))} placeholder="Ej: Crédito banco BBVA..."/></div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={()=>setShowExtra(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardarExtra}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export async function migrarCierresSinTimestamp(db) {
  const snap = await getDocs(collection(db,'cierres_caja'))
  let n=0
  for(const d of snap.docs){
    const c=d.data()
    if(!c.timestamp&&c.fecha){
      const [y,m,day]=c.fecha.split('-').map(Number)
      const ts=new Date(y,m-1,day,23,59,59).toISOString()
      const {updateDoc,doc:df}=await import('firebase/firestore')
      await updateDoc(df(db,'cierres_caja',d.id),{timestamp:ts})
      n++
    }
  }
  return n
}
