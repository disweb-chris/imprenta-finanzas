import { useState } from 'react'
import { collection, addDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { fmt, fmtDate, todayStr } from '../utils/helpers'
import { useToast } from './Toast'
import { useAuth } from '../context/AuthContext'

// Tarjeta del anticipo mensual de AGIP — Ingresos Brutos (ver calcAgip en utils/impuestos.js)
export default function AgipCard({ agip, onPagado }) {
  const toast = useToast()
  const { user } = useAuth()
  const [medio, setMedio] = useState('banco')
  const [guardando, setGuardando] = useState(false)

  const pagar = async () => {
    if (agip.pagado || guardando) return
    setGuardando(true)
    await addDoc(collection(db, 'egresos'), {
      fecha: todayStr(), monto: Math.round(agip.monto), categoria: 'impuestos', subcategoria: 'AGIP',
      descripcion: `AGIP — Ingresos Brutos ${agip.mesLabel} (${agip.alicuotaPct}%)`, medio_pago: medio,
      origen_agip_venc: agip.venc,
      usuario: user.email, createdAt: new Date().toISOString(),
    })
    setGuardando(false)
    toast('Pago AGIP registrado como egreso', 'success')
    onPagado?.()
  }

  const vencido = !agip.pagado && agip.days < 0
  const badgeBg = agip.days <= 0 ? '#ef4444' : agip.days <= 5 ? '#f59e0b' : 'rgba(255,255,255,.2)'
  const badgeTxt = vencido ? `Vencido hace ${Math.abs(agip.days)}d`
    : agip.days === 0 ? 'Vence hoy'
    : agip.days <= 5 ? `Vence en ${agip.days}d`
    : `Vence ${fmtDate(agip.venc)}`

  return (
    <div style={{ background: 'linear-gradient(135deg,#1e3a7a,#2e509e)', borderRadius: 12, padding: '18px 20px', marginBottom: 16, color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 42, height: 42, background: 'rgba(255,255,255,.15)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 13 }}>AGIP</div>
          <div>
            <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 15 }}>AGIP — Ingresos Brutos</div>
            <div style={{ fontSize: 12, opacity: .75 }}>{agip.alicuotaPct}% sobre ventas de {agip.mesLabel} · vence {fmtDate(agip.venc)}</div>
            <div style={{ fontSize: 11, opacity: .6, marginTop: 4 }}>Base: {fmt(agip.base)}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 800 }}>{fmt(agip.pagado && agip.pago ? agip.pago.monto : agip.monto)}</div>
          <div style={{ marginTop: 4 }}>
            {agip.pagado
              ? <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 20, fontWeight: 600, background: 'rgba(255,255,255,.2)', color: '#fff' }}>
                  ✓ Pagado{agip.pago?.fecha ? ` el ${fmtDate(agip.pago.fecha)}` : ''}
                </span>
              : <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 20, fontWeight: 600, background: badgeBg, color: '#fff' }}>{badgeTxt}</span>
            }
          </div>
          {!agip.pagado && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
              <select value={medio} onChange={e => setMedio(e.target.value)}
                style={{ padding: '7px 8px', borderRadius: 7, border: 'none', fontSize: 12 }}>
                <option value="banco">Banco</option>
                <option value="efectivo">Efectivo</option>
                <option value="caja_chica">Caja chica</option>
                <option value="avealma">Avealma</option>
                <option value="getnet">GetNet</option>
                <option value="tarjeta">Tarjeta</option>
              </select>
              <button onClick={pagar} disabled={guardando} style={{ padding: '8px 16px', background: 'var(--orange)', border: 'none', borderRadius: 7, color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                {guardando ? 'Guardando...' : 'Registrar pago'}
              </button>
            </div>
          )}
        </div>
      </div>
      {!agip.pagado && (
        <div style={{ fontSize: 11, opacity: .6, marginTop: 10 }}>
          Si ya lo pagaste y lo cargaste a mano en Egresos (categoría impuestos, mencionando AGIP o IIBB), se detecta solo.
        </div>
      )}
    </div>
  )
}
