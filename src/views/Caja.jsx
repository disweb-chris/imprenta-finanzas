import { useEffect, useState } from 'react'
import { collection, getDocs, addDoc, setDoc, deleteDoc, doc, query, orderBy, limit, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { fetchOrders } from '../utils/woocommerce'
import { fmt, fmtDate, todayStr, mueveCaja, saldoDeMedio, medioPagoInfo, ORIGENES_CAJA_CHICA } from '../utils/helpers'
import { useCats } from '../context/CatContext'
import { useToast } from '../components/Toast'
import { useAuth } from '../context/AuthContext'
import { getAppConfig } from '../utils/appConfig'
import { calcAgip } from '../utils/impuestos'
import { loadCuentasPagar } from '../utils/cuentasPagar'
import { medioCobro, pagadoOnline, esMetodoOnline } from '../utils/pedidos'

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
  const hist = Array.isArray(order.io_pagos_historial) ? order.io_pagos_historial : []
  const online = pagadoOnline(order)
  const cobros = []
  // Pago online: la pasarela cobró el total en la fecha de pago de WooCommerce
  if (online && new Date(order.date_paid || order.date_created) > desde) {
    cobros.push({ monto: parseFloat(order.total||0), medio: 'banco', numero: order.number })
  }
  // Del historial, en un pedido pagado online se omiten los registros de esa pasarela: se cargan
  // a mano después y no son plata nueva. Sin historial ni pago online, no hay cobros todavía.
  hist
    .filter(p => !(online && esMetodoOnline(p.metodo)))
    .filter(p => { const f = parseFechaHistorial(p.fecha); return f && f > desde })
    .forEach(p => cobros.push({ monto: parseFloat(p.monto||0), medio: medioCobro(p.metodo), fecha: p.fecha, numero: order.number }))
  return cobros
}

// Diferencia de arqueo: positiva = sobra plata, negativa = falta
const DifCell=({v})=>Math.abs(v)<1?<span style={{color:'var(--success)',fontWeight:600}}>OK</span>:<span style={{color:v>0?'var(--success)':'var(--danger)',fontWeight:700}}>{v>0?'+':''}{fmt(v)}</span>

const TIPOS_MOV_CC = { reposicion: 'Reposición', devolucion: 'Devolución' }

const _ls = (d) => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')

export default function Caja() {
  const { getCat } = useCats()
  const toast = useToast()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [lastCierre, setLastCierre] = useState(null)
  const [kpis, setKpis] = useState({ saldoCierre:0, ventas:0, ingExtra:0, egresos:0, saldoActual:0, ventasBanco:0, ventasEfectivo:0, egresosBanco:0, egresosEfectivo:0, saldoBanco:0, saldoEfectivo:0, ordenes:0, egresosCajaChica:0, repoCajaChica:0, devCajaChica:0, netoCCBanco:0, netoCCEfectivo:0, saldoCajaChica:0, ventasAvealma:0, egresosAvealma:0, netoMovBanco:0, netoMovAvealma:0, saldoAvealma:0, descAvealmaPend:0 })
  const [movsAvealma, setMovsAvealma] = useState([])
  const [avDescCfg, setAvDescCfg] = useState([])
  const [showLiqAv, setShowLiqAv] = useState(false)
  const [liqForm, setLiqForm] = useState({ fecha:todayStr(), facturado:'', descuentos:[], transferir:'', descripcion:'' })
  const [movsCajaChica, setMovsCajaChica] = useState([])
  const [showMovCC, setShowMovCC] = useState(false)
  const [movCCForm, setMovCCForm] = useState({ fecha:todayStr(), monto:'', tipo:'reposicion', medio:'efectivo', descripcion:'' })
  const [extraDocs, setExtraDocs] = useState([])
  const [historial, setHistorial] = useState([])
  const [proyeccion, setProyeccion] = useState(null)
  const [showCierre, setShowCierre] = useState(false)
  const [showExtra, setShowExtra] = useState(false)
  const [editExtra, setEditExtra] = useState(null)
  const [cierreForm, setCierreForm] = useState({ saldo:'', saldo_banco:'', saldo_efectivo:'', saldo_caja_chica:'', saldo_avealma:'', fecha:todayStr(), notas:'' })
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

      // Movimientos del mismo día del cierre solo cuentan si se cargaron después del cierre
      const posteriorAlCierre = (x) => {
        if (!(cierre?.timestamp && x.fecha===cierre.fecha)) return true
        const ec = x.createdAt ? new Date(x.createdAt) : null
        return !!ec && ec > new Date(cierre.timestamp)
      }

      const [ordNuevas, ordAntiguas, egrSnap, extraSnap, pagosProvSnap, ccSnap, movCtasSnap, appCfg] = await Promise.all([
        fetchOrders(desde, ahora, 'completed,processing').catch(()=>[]),
        fetchOrders(new Date(desde.getTime()-60*86400000), desde, 'completed,processing,on-hold').catch(()=>[]),
        getDocs(query(collection(db,'egresos'), where('fecha','>=',desdeFecha), where('fecha','<=',todayStr()))),
        getDocs(query(collection(db,'ingresos_extra'), where('fecha','>=',desdeFecha), where('fecha','<=',todayStr()))),
        getDocs(query(collection(db,'pagos_proveedores'), where('fecha','>=',desdeFecha), where('fecha','<=',todayStr()))),
        getDocs(query(collection(db,'caja_chica_movimientos'), where('fecha','>=',desdeFecha), where('fecha','<=',todayStr()))),
        getDocs(query(collection(db,'movimientos_cuentas'), where('fecha','>=',desdeFecha), where('fecha','<=',todayStr()))),
        getAppConfig(),
      ])
      const descCfg = appCfg.avealma_descuentos || []
      setAvDescCfg(descCfg)

      const ordMap = {}
      ordNuevas.forEach(o => { ordMap[o.id]=o })
      ordAntiguas.forEach(o => { if (!ordMap[o.id]) ordMap[o.id]=o })
      const todas = Object.values(ordMap)

      let ventas=0, ventasBanco=0, ventasEfectivo=0, ventasAvealma=0
      const cobrosAv=[]
      const conMov = new Set()
      todas.forEach(o => {
        const cobros = getCobrosDelPeriodo(o, desde)
        if (cobros.length) {
          conMov.add(o.id)
          cobros.forEach(c => {
            ventas+=c.monto
            if (c.medio==='efectivo') ventasEfectivo+=c.monto
            else if (c.medio==='avealma') { ventasAvealma+=c.monto; cobrosAv.push({id:`c${o.id}-${cobrosAv.length}`,tipo:'cobro',numero:c.numero,fechaTxt:c.fecha,fecha:c.fecha?_ls(parseFechaHistorial(c.fecha)):'',monto:c.monto}) }
            else ventasBanco+=c.monto
          })
        }
      })

      let egresosTotal=0, egresosBanco=0, egresosEfectivo=0, egresosCajaChica=0, egresosAvealma=0, descAvealmaReg=0
      const gastosCC=[], gastosAv=[]
      // Egresos con plata real + pagos de cuentas corrientes a proveedores.
      // Los egresos en canje o 'a pagar' son costo sin movimiento: se saltean.
      const sumarSalida = (x, id) => {
        if (!posteriorAlCierre(x)) return
        if (!mueveCaja(x.medio_pago)) return
        const m=parseFloat(x.monto||0)
        egresosTotal+=m
        const medio=saldoDeMedio(x.medio_pago)
        if (medio==='efectivo') egresosEfectivo+=m
        else if (medio==='caja_chica') { egresosCajaChica+=m; gastosCC.push({id,...x,tipo:'gasto'}) }
        else if (medio==='avealma') {
          egresosAvealma+=m; gastosAv.push({id,...x,tipo:x.origen_avealma_liquidacion?'descuento':'gasto'})
          if (x.origen_avealma_liquidacion) descAvealmaReg+=m
        }
        else egresosBanco+=m
      }
      egrSnap.forEach(d => sumarSalida(d.data(), d.id))
      pagosProvSnap.forEach(d => sumarSalida(d.data(), d.id))

      // Reposiciones/devoluciones de caja chica: transferencias internas, no cambian el saldo total
      let repoCajaChica=0, devCajaChica=0, netoCCBanco=0, netoCCEfectivo=0
      const movsCC=[]
      ccSnap.forEach(d => {
        const x={id:d.id,...d.data()}
        if (!posteriorAlCierre(x)) return
        movsCC.push(x)
        const m=parseFloat(x.monto||0)
        const netoOrigen = x.tipo==='devolucion' ? m : -m
        if (x.tipo==='devolucion') devCajaChica+=m
        else repoCajaChica+=m
        if (x.medio==='efectivo') netoCCEfectivo+=netoOrigen
        else netoCCBanco+=netoOrigen
      })

      // Transferencias entre cuentas (ej: Avealma nos pasa el neto al banco): no cambian el saldo total
      const netoMov={}
      const transfAv=[]
      movCtasSnap.forEach(d => {
        const x={id:d.id,...d.data()}
        if (!posteriorAlCierre(x)) return
        const m=parseFloat(x.monto||0)
        netoMov[x.desde]=(netoMov[x.desde]||0)-m
        netoMov[x.hacia]=(netoMov[x.hacia]||0)+m
        if (x.desde==='avealma'||x.hacia==='avealma') transfAv.push({...x,tipo:'transferencia'})
      })
      const netoMovBanco=netoMov.banco||0, netoMovEfectivo=netoMov.efectivo||0, netoMovAvealma=netoMov.avealma||0

      let ingExtra=0
      const extras=[]
      extraSnap.forEach(d => { const x={id:d.id,...d.data()}; extras.push(x); ingExtra+=parseFloat(x.monto||0) })

      const saldoActual = saldoCierre+ventas+ingExtra-egresosTotal
      const sCB = cierre?.saldo_banco!=null ? parseFloat(cierre.saldo_banco) : saldoCierre
      const sCE = cierre?.saldo_efectivo!=null ? parseFloat(cierre.saldo_efectivo) : 0
      const sCC = cierre?.saldo_caja_chica!=null ? parseFloat(cierre.saldo_caja_chica) : 0
      const sCA = cierre?.saldo_avealma!=null ? parseFloat(cierre.saldo_avealma) : 0
      const saldoBanco = sCB+ventasBanco+ingExtra-egresosBanco+netoCCBanco+netoMovBanco
      const saldoEfectivo = sCE+ventasEfectivo-egresosEfectivo+netoCCEfectivo+netoMovEfectivo
      const saldoCajaChica = sCC+repoCajaChica-devCajaChica-egresosCajaChica
      const saldoAvealma = sCA+ventasAvealma-egresosAvealma+netoMovAvealma
      // Descuentos que Avealma todavía no aplicó sobre lo cobrado desde el cierre (estimado con los % de Configuración)
      const pctAv = descCfg.reduce((t,d)=>t+(parseFloat(d.pct)||0),0)
      const descAvealmaPend = Math.max(ventasAvealma*pctAv/100-descAvealmaReg,0)

      setKpis({ saldoCierre, ventas, ingExtra, egresos:egresosTotal, saldoActual, ordenes:conMov.size, ventasBanco, ventasEfectivo, egresosBanco, egresosEfectivo, saldoBanco, saldoEfectivo, egresosCajaChica, repoCajaChica, devCajaChica, netoCCBanco, netoCCEfectivo, saldoCajaChica, ventasAvealma, egresosAvealma, netoMovBanco, netoMovAvealma, saldoAvealma, descAvealmaPend })
      setMovsAvealma([...cobrosAv, ...gastosAv, ...transfAv].sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||'')))
      setMovsCajaChica([...movsCC, ...gastosCC].sort((a,b)=>(b.fecha+(b.createdAt||'')).localeCompare(a.fecha+(a.createdAt||''))))
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
    try{
      const agip=await calcAgip(await getAppConfig())
      if(!agip.pagado&&agip.monto>0&&agip.venc<=finMes) pendientes.push({nombre:`AGIP — IIBB ${agip.mesLabel}`,monto:agip.monto,categoria:'impuestos',fecha:agip.venc<hoy?hoy:agip.venc})
    }catch{ /* sin WooCommerce no hay base para estimar */ }
    try{
      const cuentas=await loadCuentasPagar({soloAbiertas:true})
      cuentas.forEach(c=>{ if(c.saldo>0&&(c.vencimiento||hoy)<=finMes) pendientes.push({nombre:`${c.proveedor} — ${c.concepto}`,monto:c.saldo,categoria:'produccion-tercerizada',fecha:c.vencimiento<hoy?hoy:c.vencimiento}) })
    }catch{ /* colección todavía vacía */ }
    const total=pendientes.reduce((s,p)=>s+p.monto,0)
    setProyeccion({saldoActual,totalPendiente:total,saldoProyectado:saldoActual-total,pendientes})
  }

  const openCierre=()=>{setCierreForm({saldo:Math.round(saldoCalc),saldo_banco:Math.round(kpis.saldoBanco),saldo_efectivo:Math.round(kpis.saldoEfectivo),saldo_caja_chica:Math.round(kpis.saldoCajaChica),saldo_avealma:Math.round(kpis.saldoAvealma),fecha:todayStr(),notas:''});setShowCierre(true)}

  // Arqueo: lo contado/real contra lo que calcula el sistema desde el último cierre
  const difBanco=(parseFloat(cierreForm.saldo_banco)||0)-Math.round(kpis.saldoBanco)
  const difEfectivo=(parseFloat(cierreForm.saldo_efectivo)||0)-Math.round(kpis.saldoEfectivo)
  const difCajaChica=(parseFloat(cierreForm.saldo_caja_chica)||0)-Math.round(kpis.saldoCajaChica)
  const difAvealma=(parseFloat(cierreForm.saldo_avealma)||0)-Math.round(kpis.saldoAvealma)
  const difTotal=(parseFloat(cierreForm.saldo)||0)-Math.round(saldoCalc)

  const guardarCierre=async()=>{
    const saldo=parseFloat(cierreForm.saldo)
    if(!cierreForm.fecha||isNaN(saldo)){toast('Completá fecha y saldo','error');return}
    const ex=await getDocs(query(collection(db,'cierres_caja'),where('fecha','==',cierreForm.fecha)))
    if(!ex.empty){if(!confirm('Ya existe un cierre para esta fecha. ¿Reemplazarlo?')) return; for(const d of ex.docs) await deleteDoc(doc(db,'cierres_caja',d.id))}
    await addDoc(collection(db,'cierres_caja'),{fecha:cierreForm.fecha,saldo_final:saldo,saldo_banco:parseFloat(cierreForm.saldo_banco)||0,saldo_efectivo:parseFloat(cierreForm.saldo_efectivo)||0,saldo_caja_chica:parseFloat(cierreForm.saldo_caja_chica)||0,saldo_avealma:parseFloat(cierreForm.saldo_avealma)||0,notas:cierreForm.notas,
      saldo_calculado:Math.round(saldoCalc),diferencia:difTotal,diferencia_banco:difBanco,diferencia_efectivo:difEfectivo,diferencia_caja_chica:difCajaChica,diferencia_avealma:difAvealma,timestamp:new Date().toISOString(),usuario:user.email,createdAt:new Date().toISOString()})
    await guardarSnapshotDeuda(cierreForm.fecha)
    setShowCierre(false);toast('Cierre guardado','success');loadAll()
  }

  // Snapshot mensual de la deuda total en créditos/cuotas activos — se sobreescribe el snapshot
  // del mes en cada cierre, así siempre refleja el último estado conocido de ese mes
  const guardarSnapshotDeuda=async(fecha)=>{
    const snap=await getDocs(collection(db,'compromisos'))
    let deudaTotal=0, cantidad=0
    snap.forEach(d=>{
      const c=d.data()
      if(c.tipo!=='cuotas'||c.estado==='finalizado') return
      const restantes=Math.max((c.total_cuotas||0)-(c.cuotas_pagadas||0),0)
      if(restantes<=0) return
      deudaTotal+=restantes*parseFloat(c.monto||0)
      cantidad++
    })
    const mes=fecha.slice(0,7)
    await setDoc(doc(db,'deuda_historial',mes),{mes,fecha,deuda_total:deudaTotal,cantidad_compromisos:cantidad,updatedAt:new Date().toISOString()})
  }

  const guardarExtra=async()=>{
    const monto=parseFloat(extraForm.monto)
    if(!extraForm.fecha||isNaN(monto)||monto<=0){toast('Completá fecha y monto','error');return}
    const data={...extraForm,monto,usuario:user.email,updatedAt:new Date().toISOString()}
    if(editExtra){await import('firebase/firestore').then(({setDoc,doc:df})=>setDoc(df(db,'ingresos_extra',editExtra.id),data))}
    else{await addDoc(collection(db,'ingresos_extra'),{...data,createdAt:new Date().toISOString()})}
    setShowExtra(false);toast('Ingreso guardado','success');loadAll()
  }

  const openMovCC=(tipo)=>{setMovCCForm({fecha:todayStr(),monto:'',tipo,medio:'efectivo',descripcion:''});setShowMovCC(true)}

  const guardarMovCC=async()=>{
    const monto=parseFloat(movCCForm.monto)
    if(!movCCForm.fecha||isNaN(monto)||monto<=0){toast('Completá fecha y monto','error');return}
    if(movCCForm.tipo==='devolucion'&&monto>kpis.saldoCajaChica&&!confirm(`El monto supera el saldo estimado de caja chica (${fmt(kpis.saldoCajaChica)}). ¿Registrar igual?`)) return
    await addDoc(collection(db,'caja_chica_movimientos'),{...movCCForm,monto,usuario:user.email,createdAt:new Date().toISOString()})
    setShowMovCC(false);toast(movCCForm.tipo==='reposicion'?'Caja chica repuesta':'Devolución registrada','success');loadAll()
  }

  // Liquidación Avealma: descuentos (IVA, IIBB, Ganancias, etc.) como egresos pagados desde la cuenta
  // de Avealma + transferencia del neto al banco. Ambas partes son opcionales.
  const calcDescuentos=(facturado)=>avDescCfg.map(d=>({nombre:d.nombre,pct:parseFloat(d.pct)||0,monto:Math.round((parseFloat(facturado)||0)*(parseFloat(d.pct)||0))/100}))
  const openLiqAv=()=>{
    const facturado=Math.round(kpis.ventasAvealma)||''
    const descuentos=calcDescuentos(facturado)
    const neto=(parseFloat(facturado)||0)-descuentos.reduce((t,d)=>t+d.monto,0)
    setLiqForm({fecha:todayStr(),facturado,descuentos,transferir:neto>0?Math.round(neto):'',descripcion:''})
    setShowLiqAv(true)
  }
  const setFacturado=(v)=>setLiqForm(f=>{
    const descuentos=calcDescuentos(v)
    const neto=(parseFloat(v)||0)-descuentos.reduce((t,d)=>t+d.monto,0)
    return {...f,facturado:v,descuentos,transferir:neto>0?Math.round(neto):''}
  })
  const liqTotalDesc=liqForm.descuentos.reduce((t,d)=>t+(parseFloat(d.monto)||0),0)
  const liqNeto=(parseFloat(liqForm.facturado)||0)-liqTotalDesc

  const guardarLiqAv=async()=>{
    const facturado=parseFloat(liqForm.facturado)||0
    const transferir=parseFloat(liqForm.transferir)||0
    const descuentos=liqForm.descuentos.map(d=>({...d,monto:parseFloat(d.monto)||0})).filter(d=>d.monto>0)
    if(!liqForm.fecha||(!descuentos.length&&transferir<=0)){toast('Cargá descuentos o un monto a transferir','error');return}
    const now=new Date().toISOString()
    const ref=await addDoc(collection(db,'avealma_liquidaciones'),{fecha:liqForm.fecha,facturado,descuentos,transferido:transferir,descripcion:liqForm.descripcion,usuario:user.email,createdAt:now})
    for(const d of descuentos){
      await addDoc(collection(db,'egresos'),{fecha:liqForm.fecha,monto:d.monto,categoria:'impuestos',subcategoria:`Avealma — ${d.nombre}`,
        descripcion:`${d.nombre} ${d.pct}% sobre ${fmt(facturado)} facturado por Avealma`,medio_pago:'avealma',origen_avealma_liquidacion:ref.id,usuario:user.email,createdAt:now,updatedAt:now})
    }
    if(transferir>0){
      await addDoc(collection(db,'movimientos_cuentas'),{fecha:liqForm.fecha,desde:'avealma',hacia:'banco',monto:transferir,descripcion:liqForm.descripcion||'Transferencia de Avealma',origen_avealma_liquidacion:ref.id,usuario:user.email,createdAt:now})
    }
    setShowLiqAv(false);toast('Liquidación de Avealma registrada','success');loadAll()
  }

  const deleteMovCta=async(id)=>{if(!confirm('¿Eliminar esta transferencia?')) return;await deleteDoc(doc(db,'movimientos_cuentas',id));toast('Eliminado');loadAll()}

  const deleteMovCC=async(id)=>{if(!confirm('¿Eliminar este movimiento de caja chica?')) return;await deleteDoc(doc(db,'caja_chica_movimientos',id));toast('Eliminado');loadAll()}

  const deleteExtra=async(id)=>{if(!confirm('¿Eliminar?')) return;await deleteDoc(doc(db,'ingresos_extra',id));toast('Eliminado');loadAll()}
  const deleteCierre=async(id)=>{if(!confirm('¿Eliminar este cierre?')) return;await deleteDoc(doc(db,'cierres_caja',id));toast('Eliminado');loadAll()}
  const tipoLabel={credito:'Crédito/Préstamo',transferencia:'Transferencia',devolucion:'Devolución',otro:'Otro'}

  if(loading) return <div className="view"><div className="loading-state"><div className="spinner"/><p style={{marginTop:12}}>Cargando caja...</p></div></div>

  return (
    <div className="view">
      <div className="view-header-row">
        <div><h2>Flujo de Caja</h2><p>Saldo en tiempo real + proyección de fin de mes</p></div>
        <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
          <button className="btn btn-secondary" onClick={()=>openMovCC('reposicion')}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Reponer caja chica
          </button>
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

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:12,marginBottom:20}}>
        <div style={{background:'#fff',borderRadius:10,padding:'16px 20px',boxShadow:'var(--shadow)',borderLeft:'4px solid #2e509e'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
            <svg width="18" height="18" fill="none" stroke="#2e509e" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
            <span style={{fontFamily:'var(--font-head)',fontWeight:700,fontSize:14,color:'#2e509e'}}>Banco / Transferencia</span>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text-muted)',marginBottom:4}}><span>+ Cobros transferencia</span><span style={{color:'var(--success)',fontWeight:600}}>{fmt(kpis.ventasBanco)}</span></div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text-muted)',marginBottom:4}}><span>+ Ingresos extra</span><span style={{color:'var(--success)',fontWeight:600}}>{fmt(kpis.ingExtra)}</span></div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text-muted)',marginBottom:4}}><span>− Egresos banco</span><span style={{color:'var(--danger)',fontWeight:600}}>{fmt(kpis.egresosBanco)}</span></div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text-muted)',marginBottom:8}}><span>± Caja chica</span><span style={{color:kpis.netoCCBanco>=0?'var(--success)':'var(--danger)',fontWeight:600}}>{fmt(kpis.netoCCBanco)}</span></div>
          {kpis.netoMovBanco!==0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text-muted)',marginBottom:8}}><span>+ Transferencias de Avealma</span><span style={{color:'var(--success)',fontWeight:600}}>{fmt(kpis.netoMovBanco)}</span></div>}
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
          <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text-muted)',marginBottom:4,marginTop:20}}><span>− Egresos efectivo</span><span style={{color:'var(--danger)',fontWeight:600}}>{fmt(kpis.egresosEfectivo)}</span></div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text-muted)',marginBottom:8}}><span>± Caja chica</span><span style={{color:kpis.netoCCEfectivo>=0?'var(--success)':'var(--danger)',fontWeight:600}}>{fmt(kpis.netoCCEfectivo)}</span></div>
          <div style={{borderTop:'1px solid var(--border)',paddingTop:8,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontSize:12,fontWeight:600,color:'var(--text-muted)'}}>SALDO EFECTIVO</span>
            <span style={{fontFamily:'var(--font-head)',fontWeight:800,fontSize:20,color:kpis.saldoEfectivo>=0?'#FF6B00':'var(--danger)'}}>{fmt(kpis.saldoEfectivo)}</span>
          </div>
        </div>
        <div style={{background:'#fff',borderRadius:10,padding:'16px 20px',boxShadow:'var(--shadow)',borderLeft:'4px solid #10b981'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
            <svg width="18" height="18" fill="none" stroke="#10b981" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2"/><path d="M16 12h5v4h-5a2 2 0 0 1 0-4z"/></svg>
            <span style={{fontFamily:'var(--font-head)',fontWeight:700,fontSize:14,color:'#10b981'}}>Caja chica</span>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text-muted)',marginBottom:4}}><span>+ Reposiciones</span><span style={{color:'var(--success)',fontWeight:600}}>{fmt(kpis.repoCajaChica)}</span></div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text-muted)',marginBottom:4}}><span>− Devoluciones</span><span style={{color:'var(--danger)',fontWeight:600}}>{fmt(kpis.devCajaChica)}</span></div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text-muted)',marginBottom:8}}><span>− Gastos caja chica</span><span style={{color:'var(--danger)',fontWeight:600}}>{fmt(kpis.egresosCajaChica)}</span></div>
          <div style={{borderTop:'1px solid var(--border)',paddingTop:8,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontSize:12,fontWeight:600,color:'var(--text-muted)'}}>SALDO CAJA CHICA</span>
            <span style={{fontFamily:'var(--font-head)',fontWeight:800,fontSize:20,color:kpis.saldoCajaChica>=0?'#10b981':'var(--danger)'}}>{fmt(kpis.saldoCajaChica)}</span>
          </div>
        </div>
        <div style={{background:'#fff',borderRadius:10,padding:'16px 20px',boxShadow:'var(--shadow)',borderLeft:'4px solid #7c3aed'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginBottom:10}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <svg width="18" height="18" fill="none" stroke="#7c3aed" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>
              <span style={{fontFamily:'var(--font-head)',fontWeight:700,fontSize:14,color:'#7c3aed'}}>Avealma</span>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={openLiqAv}>Liquidar</button>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text-muted)',marginBottom:4}}><span>+ Depósitos de clientes</span><span style={{color:'var(--success)',fontWeight:600}}>{fmt(kpis.ventasAvealma)}</span></div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text-muted)',marginBottom:4}}><span>− Descuentos y gastos</span><span style={{color:'var(--danger)',fontWeight:600}}>{fmt(kpis.egresosAvealma)}</span></div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text-muted)',marginBottom:8}}><span>± Transferencias</span><span style={{color:kpis.netoMovAvealma>=0?'var(--success)':'var(--danger)',fontWeight:600}}>{fmt(kpis.netoMovAvealma)}</span></div>
          <div style={{borderTop:'1px solid var(--border)',paddingTop:8,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontSize:12,fontWeight:600,color:'var(--text-muted)'}}>SALDO AVEALMA</span>
            <span style={{fontFamily:'var(--font-head)',fontWeight:800,fontSize:20,color:kpis.saldoAvealma>=0?'#7c3aed':'var(--danger)'}}>{fmt(kpis.saldoAvealma)}</span>
          </div>
          {kpis.descAvealmaPend>0&&<div style={{fontSize:11,color:'var(--text-muted)',marginTop:6}}>Descuentos sin liquidar (est.): <strong style={{color:'var(--danger)'}}>{fmt(kpis.descAvealmaPend)}</strong> · disponible ≈ {fmt(kpis.saldoAvealma-kpis.descAvealmaPend)}</div>}
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
        <div className="table-card-header">
          <h3>Movimientos de Avealma</h3>
          <span style={{fontSize:12,color:'var(--text-muted)'}}>Desde el último cierre</span>
        </div>
        {movsAvealma.length===0?<div className="empty-state"><p>Sin movimientos de Avealma desde el último cierre. Los depósitos de clientes se registran en el pedido con el método "Avealma".</p></div>:
          <table><thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th className="text-right">Monto</th><th className="text-center">Acciones</th></tr></thead>
          <tbody>{movsAvealma.map(x=>{
            const entra = x.tipo==='cobro' || (x.tipo==='transferencia' && x.hacia==='avealma')
            const badge = {cobro:['badge-green','Depósito'],descuento:['badge-red','Descuento'],gasto:['badge-red','Gasto'],transferencia:['badge-blue','Transferencia']}[x.tipo]
            return (
            <tr key={x.tipo+x.id}>
              <td>{x.tipo==='cobro'?(x.fechaTxt||'-'):fmtDate(x.fecha)}</td>
              <td><span className={`badge ${badge[0]}`}>{badge[1]}</span></td>
              <td>{x.tipo==='cobro'
                ? <>Pedido #{x.numero}</>
                : x.tipo==='transferencia'
                  ? <>{x.desde==='avealma'?'Hacia ':'Desde '}{medioPagoInfo(x.desde==='avealma'?x.hacia:x.desde).label}{x.descripcion?' — '+x.descripcion:''}</>
                  : <>{x.subcategoria||(x.categoria?getCat(x.categoria).nombre:'Pago a proveedor')}{x.descripcion&&x.tipo==='gasto'?' — '+x.descripcion:''}</>}</td>
              <td className="text-right"><strong style={{color:entra?'var(--success)':'var(--danger)'}}>{entra?'+':'−'}{fmt(x.monto)}</strong></td>
              <td className="text-center">{x.tipo==='transferencia'
                ? <button className="btn btn-danger btn-sm" onClick={()=>deleteMovCta(x.id)}>×</button>
                : <span style={{fontSize:11,color:'var(--text-muted)'}}>{x.tipo==='cobro'?'en el pedido':'en Egresos'}</span>}</td>
            </tr>)
          })}</tbody></table>}
      </div>

      <div className="table-card">
        <div className="table-card-header">
          <h3>Movimientos de caja chica</h3>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <span style={{fontSize:12,color:'var(--text-muted)'}}>Desde el último cierre</span>
            <button className="btn btn-secondary btn-sm" onClick={()=>openMovCC('devolucion')}>Devolver sobrante</button>
          </div>
        </div>
        {movsCajaChica.length===0?<div className="empty-state"><p>Sin movimientos de caja chica desde el último cierre. Los gastos se cargan en Egresos con medio "Caja chica".</p></div>:
          <table><thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th className="text-right">Monto</th><th className="text-center">Acciones</th></tr></thead>
          <tbody>{movsCajaChica.map(x=>{
            const esGasto=x.tipo==='gasto', esRepo=x.tipo==='reposicion'
            return (
            <tr key={(esGasto?'g':'m')+x.id}>
              <td>{fmtDate(x.fecha)}</td>
              <td><span className={`badge ${esGasto?'badge-red':esRepo?'badge-green':'badge-yellow'}`}>{esGasto?'Gasto':TIPOS_MOV_CC[x.tipo]||x.tipo}</span></td>
              <td>{esGasto
                ? <>{x.categoria?getCat(x.categoria).nombre:'Pago a proveedor'}{x.descripcion?' — '+x.descripcion:''}</>
                : <>{esRepo?'Desde ':'Hacia '}{medioPagoInfo(x.medio).label}{x.descripcion?' — '+x.descripcion:''}</>}</td>
              <td className="text-right"><strong style={{color:esRepo?'var(--success)':'var(--danger)'}}>{esRepo?'+':'−'}{fmt(x.monto)}</strong></td>
              <td className="text-center">{esGasto
                ? <span style={{fontSize:11,color:'var(--text-muted)'}}>en Egresos</span>
                : <button className="btn btn-danger btn-sm" onClick={()=>deleteMovCC(x.id)}>×</button>}</td>
            </tr>)
          })}</tbody></table>}
      </div>

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
          <table><thead><tr><th>Fecha</th><th>Hora</th><th className="text-right">Total</th><th className="text-right">Banco</th><th className="text-right">Efectivo</th><th className="text-right">Caja chica</th><th className="text-right">Avealma</th><th className="text-right">Diferencia</th><th>Notas</th><th className="text-center">Acciones</th></tr></thead>
          <tbody>{historial.map(c=>(
            <tr key={c.id}>
              <td><strong>{fmtDate(c.fecha)}</strong></td>
              <td style={{fontSize:12,color:'var(--text-muted)'}}>{c.timestamp?new Date(c.timestamp).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}):'-'}</td>
              <td className="text-right" style={{fontFamily:'var(--font-head)',fontWeight:700,color:'var(--blue)'}}>{fmt(c.saldo_final)}</td>
              <td className="text-right" style={{fontSize:13,color:'#2e509e',fontWeight:600}}>{c.saldo_banco!=null?fmt(c.saldo_banco):'-'}</td>
              <td className="text-right" style={{fontSize:13,color:'#FF6B00',fontWeight:600}}>{c.saldo_efectivo!=null?fmt(c.saldo_efectivo):'-'}</td>
              <td className="text-right" style={{fontSize:13,color:'#10b981',fontWeight:600}}>{c.saldo_caja_chica!=null?fmt(c.saldo_caja_chica):'-'}</td>
              <td className="text-right" style={{fontSize:13,color:'#7c3aed',fontWeight:600}}>{c.saldo_avealma!=null?fmt(c.saldo_avealma):'-'}</td>
              <td className="text-right" style={{fontSize:12}}>{c.diferencia==null?<span style={{color:'var(--text-muted)'}}>-</span>:<DifCell v={c.diferencia}/>}</td>
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
              <div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',color:'var(--text-muted)',marginBottom:8}}>Arqueo</div>
              <table style={{width:'100%',fontSize:12}}>
                <thead><tr><th style={{textAlign:'left'}}></th><th className="text-right">Sistema</th><th className="text-right">Real</th><th className="text-right">Diferencia</th></tr></thead>
                <tbody>
                  <tr><td>Banco</td><td className="text-right">{fmt(kpis.saldoBanco)}</td><td className="text-right">{fmt(parseFloat(cierreForm.saldo_banco)||0)}</td><td className="text-right"><DifCell v={difBanco}/></td></tr>
                  <tr><td>Efectivo</td><td className="text-right">{fmt(kpis.saldoEfectivo)}</td><td className="text-right">{fmt(parseFloat(cierreForm.saldo_efectivo)||0)}</td><td className="text-right"><DifCell v={difEfectivo}/></td></tr>
                  <tr><td>Caja chica</td><td className="text-right">{fmt(kpis.saldoCajaChica)}</td><td className="text-right">{fmt(parseFloat(cierreForm.saldo_caja_chica)||0)}</td><td className="text-right"><DifCell v={difCajaChica}/></td></tr>
                  <tr><td>Avealma</td><td className="text-right">{fmt(kpis.saldoAvealma)}</td><td className="text-right">{fmt(parseFloat(cierreForm.saldo_avealma)||0)}</td><td className="text-right"><DifCell v={difAvealma}/></td></tr>
                  <tr><td><strong>Total</strong></td><td className="text-right"><strong>{fmt(saldoCalc)}</strong></td><td className="text-right"><strong>{fmt(parseFloat(cierreForm.saldo)||0)}</strong></td><td className="text-right"><DifCell v={difTotal}/></td></tr>
                </tbody>
              </table>
              <div style={{fontSize:11,color:'var(--text-muted)',marginTop:8}}>Cargá lo que realmente hay en el banco y lo que contaste en efectivo y en caja chica, y el saldo que informa Avealma. Si hay diferencia, anotá el motivo en notas.</div>
            </div>
            <div className="field"><label>Saldo total en cuenta ($)</label><input type="number" value={cierreForm.saldo} onChange={e=>setCierreForm(f=>({...f,saldo:e.target.value}))}/></div>
            <div className="field-row">
              <div className="field"><label>Del cual, en banco ($)</label><input type="number" value={cierreForm.saldo_banco} onChange={e=>setCierreForm(f=>({...f,saldo_banco:e.target.value}))} placeholder="0"/></div>
              <div className="field"><label>Del cual, en efectivo ($)</label><input type="number" value={cierreForm.saldo_efectivo} onChange={e=>setCierreForm(f=>({...f,saldo_efectivo:e.target.value}))} placeholder="0"/></div>
            </div>
            <div className="field"><label>Del cual, en caja chica ($)</label><input type="number" value={cierreForm.saldo_caja_chica} onChange={e=>setCierreForm(f=>({...f,saldo_caja_chica:e.target.value}))} placeholder="0"/></div>
            <div className="field"><label>Del cual, en Avealma ($)</label><input type="number" value={cierreForm.saldo_avealma} onChange={e=>setCierreForm(f=>({...f,saldo_avealma:e.target.value}))} placeholder="0"/></div>
            <div className="field"><label>Fecha del cierre</label><input type="date" value={cierreForm.fecha} onChange={e=>setCierreForm(f=>({...f,fecha:e.target.value}))}/></div>
            <div className="field"><label>Notas (opcional)</label><textarea value={cierreForm.notas} onChange={e=>setCierreForm(f=>({...f,notas:e.target.value}))} placeholder="Observaciones..."/></div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={()=>setShowCierre(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardarCierre}>Guardar cierre</button>
            </div>
          </div>
        </div>
      )}

      {showLiqAv&&(
        <div className="modal-overlay open" onClick={e=>e.target===e.currentTarget&&setShowLiqAv(false)}>
          <div className="modal" style={{width:460}}>
            <div className="modal-header"><h3>Liquidación de Avealma</h3><button className="modal-close" onClick={()=>setShowLiqAv(false)}>×</button></div>
            <div style={{background:'#f0f4f8',borderRadius:8,padding:14,marginBottom:16,fontSize:13}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span style={{color:'var(--text-muted)'}}>Depositado en Avealma desde el último cierre:</span><strong>{fmt(kpis.ventasAvealma)}</strong></div>
              <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'var(--text-muted)'}}>Saldo Avealma estimado:</span><strong>{fmt(kpis.saldoAvealma)}</strong></div>
            </div>
            <div className="field-row">
              <div className="field"><label>Fecha</label><input type="date" value={liqForm.fecha} onChange={e=>setLiqForm(f=>({...f,fecha:e.target.value}))}/></div>
              <div className="field"><label>Monto facturado ($)</label><input type="number" value={liqForm.facturado} onChange={e=>setFacturado(e.target.value)} placeholder="0"/></div>
            </div>
            <div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',color:'var(--text-muted)',margin:'4px 0 8px'}}>Descuentos (se registran como egresos)</div>
            {liqForm.descuentos.length===0&&<p style={{fontSize:12,color:'var(--text-muted)'}}>No hay descuentos configurados. Cargalos en Configuración → Avealma.</p>}
            {liqForm.descuentos.map((d,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,fontSize:13}}>
                <span style={{flex:1}}>{d.nombre} <span style={{color:'var(--text-muted)'}}>({d.pct}%)</span></span>
                <input type="number" value={d.monto} onChange={e=>setLiqForm(f=>({...f,descuentos:f.descuentos.map((x,j)=>j===i?{...x,monto:e.target.value}:x)}))} style={{width:130}}/>
              </div>
            ))}
            <div style={{display:'flex',justifyContent:'space-between',borderTop:'1px solid var(--border)',paddingTop:8,margin:'8px 0 14px',fontSize:13}}>
              <span>Neto (facturado − descuentos)</span><strong>{fmt(liqNeto)}</strong>
            </div>
            <div className="field"><label>Transferir al banco ahora ($)</label><input type="number" value={liqForm.transferir} onChange={e=>setLiqForm(f=>({...f,transferir:e.target.value}))} placeholder="0 = no transferir todavía"/></div>
            <div className="field"><label>Descripción (opcional)</label><textarea value={liqForm.descripcion} onChange={e=>setLiqForm(f=>({...f,descripcion:e.target.value}))} placeholder="Ej: Liquidación quincena 1 de octubre"/></div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={()=>setShowLiqAv(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardarLiqAv}>Registrar</button>
            </div>
          </div>
        </div>
      )}

      {showMovCC&&(
        <div className="modal-overlay open" onClick={e=>e.target===e.currentTarget&&setShowMovCC(false)}>
          <div className="modal" style={{width:420}}>
            <div className="modal-header"><h3>{movCCForm.tipo==='reposicion'?'Reponer caja chica':'Devolver sobrante de caja chica'}</h3><button className="modal-close" onClick={()=>setShowMovCC(false)}>×</button></div>
            <div style={{background:'#f0f4f8',borderRadius:8,padding:14,marginBottom:16,fontSize:13}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}><span style={{color:'var(--text-muted)'}}>Saldo caja chica estimado:</span><strong>{fmt(kpis.saldoCajaChica)}</strong></div>
              <div style={{fontSize:11,color:'var(--text-muted)'}}>Es un movimiento interno: no cuenta como egreso ni cambia el saldo total.</div>
            </div>
            <div className="field"><label>Tipo</label><select value={movCCForm.tipo} onChange={e=>setMovCCForm(f=>({...f,tipo:e.target.value}))}><option value="reposicion">Reposición (entra plata a caja chica)</option><option value="devolucion">Devolución (sale el sobrante de caja chica)</option></select></div>
            <div className="field-row">
              <div className="field"><label>Fecha</label><input type="date" value={movCCForm.fecha} onChange={e=>setMovCCForm(f=>({...f,fecha:e.target.value}))}/></div>
              <div className="field"><label>Monto ($)</label><input type="number" value={movCCForm.monto} onChange={e=>setMovCCForm(f=>({...f,monto:e.target.value}))} placeholder="0"/></div>
            </div>
            <div className="field"><label>{movCCForm.tipo==='reposicion'?'Sale de':'Vuelve a'}</label><select value={movCCForm.medio} onChange={e=>setMovCCForm(f=>({...f,medio:e.target.value}))}>{ORIGENES_CAJA_CHICA.map(id=><option key={id} value={id}>{medioPagoInfo(id).label}</option>)}</select></div>
            <div className="field"><label>Descripción (opcional)</label><textarea value={movCCForm.descripcion} onChange={e=>setMovCCForm(f=>({...f,descripcion:e.target.value}))} placeholder="Ej: Fondo semanal..."/></div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={()=>setShowMovCC(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardarMovCC}>Guardar</button>
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
