import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePeriod } from '../context/PeriodContext'

const NAV = [
  { to: '', label: 'Dashboard', icon: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
  { to: 'ingresos', label: 'Ingresos', icon: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg> },
  { to: 'egresos', label: 'Egresos', icon: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg> },
  { to: 'compromisos', label: 'Compromisos', icon: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg> },
]
const NAV2 = [
  { to: 'liquidacion', label: 'Liquidación', icon: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> },
  { to: 'caja', label: 'Caja', icon: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg> },
  { to: 'profit', label: 'Profit', icon: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> },
  { to: 'reportes', label: 'Reportes', icon: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
  { to: 'config', label: 'Configuración', icon: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
  { to: 'pagos-variables', label: 'Pagos Variables', icon: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> },
]

const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

const navStyle = ({ isActive }) => ({
  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px',
  borderRadius: 7, color: isActive ? '#fff' : '#9ca3af',
  background: isActive ? 'var(--sidebar-active)' : 'transparent',
  fontSize: 13, fontWeight: 500, transition: 'all .15s',
  textDecoration: 'none',
})

export default function Sidebar({ open, onClose }) {
  const { user, logout } = useAuth()
  const { period, setPeriod, customMonth, customYear, setCustomPeriod } = usePeriod()
  const now = new Date()

  const isMobile = window.innerWidth <= 768

  // Navigate months for custom picker
  const prevMonth = () => {
    if (customMonth === 0) setCustomPeriod(11, customYear - 1)
    else setCustomPeriod(customMonth - 1, customYear)
  }
  const nextMonth = () => {
    const nm = customMonth === 11 ? 0 : customMonth + 1
    const ny = customMonth === 11 ? customYear + 1 : customYear
    // Don't go beyond current month
    if (ny > now.getFullYear() || (ny === now.getFullYear() && nm > now.getMonth())) return
    setCustomPeriod(nm, ny)
  }
  const isCurrentMonth = customMonth === now.getMonth() && customYear === now.getFullYear()

  return (
    <>
      {open && <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 250 }} />}

      <aside style={{
        width: 220, minWidth: 220, background: 'var(--sidebar-bg)',
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
        position: isMobile ? 'fixed' : 'relative',
        left: isMobile ? (open ? 0 : -240) : 0,
        top: 0, bottom: 0, zIndex: 300,
        transition: 'left .25s ease',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 18px 16px', borderBottom: '1px solid #1f2d40' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="https://imprentaonline.ar/wp-content/uploads/2026/02/logo-blanco.webp"
              alt="IO" style={{ height: 30 }} />
            <span style={{ color: '#6b7280', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>
              Finanzas
            </span>
          </div>
        </div>

        {/* Period selector */}
        <div style={{ padding: '14px 12px', borderBottom: '1px solid #1f2d40' }}>
          <div style={{ color: '#6b7280', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
            Período
          </div>

          {/* Quick buttons: Sem / Mes / Año */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
            {[['week','Sem'],['month','Mes'],['year','Año']].map(([p, label]) => (
              <button key={p} onClick={() => setPeriod(p)} style={{
                flex: 1, padding: '6px 4px',
                border: `1.5px solid ${period === p ? 'var(--blue)' : '#2d3748'}`,
                background: period === p ? 'var(--blue)' : 'transparent',
                color: period === p ? '#fff' : '#9ca3af',
                borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}>
                {label}
              </button>
            ))}
          </div>

          {/* Month navigator */}
          <div style={{ background: '#1f2d40', borderRadius: 8, padding: '8px 10px' }}>
            <div style={{ color: '#6b7280', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>
              Mes específico
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button onClick={prevMonth} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '2px 6px', fontSize: 16, lineHeight: 1 }}>
                ‹
              </button>
              <button
                onClick={() => setCustomPeriod(customMonth, customYear)}
                style={{
                  background: period === 'custom' ? 'var(--blue)' : 'transparent',
                  border: `1px solid ${period === 'custom' ? 'var(--blue)' : '#374151'}`,
                  color: period === 'custom' ? '#fff' : '#d1d5db',
                  borderRadius: 6, padding: '4px 8px', cursor: 'pointer',
                  fontSize: 12, fontWeight: 600, transition: 'all .15s',
                  whiteSpace: 'nowrap',
                }}
              >
                {MONTHS[customMonth]} {customYear}
              </button>
              <button
                onClick={nextMonth}
                disabled={isCurrentMonth}
                style={{ background: 'none', border: 'none', color: isCurrentMonth ? '#374151' : '#9ca3af', cursor: isCurrentMonth ? 'default' : 'pointer', padding: '2px 6px', fontSize: 16, lineHeight: 1 }}
              >
                ›
              </button>
            </div>
            {/* Quick: mes anterior */}
            <button
              onClick={() => {
                const pm = now.getMonth() === 0 ? 11 : now.getMonth() - 1
                const py = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
                setCustomPeriod(pm, py)
              }}
              style={{
                width: '100%', marginTop: 6, padding: '5px', background: 'transparent',
                border: '1px solid #374151', color: '#6b7280', borderRadius: 6,
                fontSize: 11, cursor: 'pointer', transition: 'all .15s',
              }}
              onMouseEnter={e => { e.target.style.borderColor = '#4b5563'; e.target.style.color = '#9ca3af' }}
              onMouseLeave={e => { e.target.style.borderColor = '#374151'; e.target.style.color = '#6b7280' }}
            >
              ← Mes anterior
            </button>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '10px 8px' }}>
          <div style={{ color: '#4b5563', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', padding: '8px 10px 4px' }}>
            Principal
          </div>
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to === '' ? '/finanzas/' : `/finanzas/${n.to}`}
              end={n.to === ''} style={navStyle} onClick={onClose}>
              {n.icon}{n.label}
            </NavLink>
          ))}
          <div style={{ color: '#4b5563', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', padding: '12px 10px 4px' }}>
            Análisis
          </div>
          {NAV2.map(n => (
            <NavLink key={n.to} to={`/finanzas/${n.to}`} style={navStyle} onClick={onClose}>
              {n.icon}{n.label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div style={{ padding: '12px 8px', borderTop: '1px solid #1f2d40' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
            <div style={{ width: 30, height: 30, background: 'var(--blue)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700 }}>
              {user?.email?.[0]?.toUpperCase()}
            </div>
            <div style={{ color: '#9ca3af', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {user?.email}
            </div>
          </div>
          <button onClick={logout} style={{ width: '100%', marginTop: 6, padding: 8, background: '#1f2a3d', border: 'none', color: '#9ca3af', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
            Cerrar sesión
          </button>
        </div>
      </aside>
    </>
  )
}
