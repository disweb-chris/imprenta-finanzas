import { useState, Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Sidebar from './components/Sidebar'
import Login from './views/Login'

const Dashboard    = lazy(() => import('./views/Dashboard'))
const Ingresos     = lazy(() => import('./views/Ingresos'))
const Egresos      = lazy(() => import('./views/Egresos'))
const Compromisos  = lazy(() => import('./views/Compromisos'))
const Caja         = lazy(() => import('./views/Caja'))
const Profit       = lazy(() => import('./views/Profit'))
const Reportes     = lazy(() => import('./views/Reportes'))
const Config       = lazy(() => import('./views/Config'))
const Liquidacion  = lazy(() => import('./views/Liquidacion'))
const Presupuesto  = lazy(() => import('./views/Presupuesto'))

const NAV_BOTTOM = [
  { to: '/finanzas/', label: 'Inicio', icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
  { to: '/finanzas/ingresos', label: 'Ventas', icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/></svg> },
  { to: '/finanzas/egresos', label: 'Egresos', icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/></svg> },
  { to: '/finanzas/caja', label: 'Caja', icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg> },
  { to: '/finanzas/compromisos', label: 'Pagos', icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg> },
]

const Loader = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
    <div className="spinner" />
  </div>
)

export default function App() {
  const { user } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = window.location.pathname

  if (user === undefined) return <Loader />
  if (!user) return <Login />

  return (
    <div className="app-layout">
      <div className="mobile-header">
        <button onClick={() => setSidebarOpen(o => !o)} style={{ background: 'none', border: 'none', color: '#fff', padding: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ display: 'block', width: 20, height: 2, background: '#fff', borderRadius: 2 }} />
          <span style={{ display: 'block', width: 20, height: 2, background: '#fff', borderRadius: 2 }} />
          <span style={{ display: 'block', width: 20, height: 2, background: '#fff', borderRadius: 2 }} />
        </button>
        <img src="https://imprentaonline.ar/wp-content/uploads/2026/02/logo-blanco.webp" alt="IO" style={{ height: 26 }} />
        <span style={{ flex: 1, color: '#fff', fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 700 }}>Finanzas</span>
      </div>

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main id="main">
        <Suspense fallback={<Loader />}>
          <Routes>
            <Route path="/finanzas/"            element={<Dashboard />} />
            <Route path="/finanzas/ingresos"    element={<Ingresos />} />
            <Route path="/finanzas/egresos"     element={<Egresos />} />
            <Route path="/finanzas/compromisos" element={<Compromisos />} />
            <Route path="/finanzas/caja"        element={<Caja />} />
            <Route path="/finanzas/profit"      element={<Profit />} />
            <Route path="/finanzas/reportes"    element={<Reportes />} />
            <Route path="/finanzas/config"      element={<Config />} />
            <Route path="/finanzas/liquidacion" element={<Liquidacion />} />
            <Route path="/finanzas/presupuesto" element={<Presupuesto />} />
            <Route path="*"                     element={<Navigate to="/finanzas/" />} />
          </Routes>
        </Suspense>
      </main>

      <nav className="bottom-nav">
        {NAV_BOTTOM.map(n => (
          <a key={n.to} href={n.to} className={`bnav-item ${location === n.to || (n.to !== '/finanzas/' && location.startsWith(n.to)) ? 'active' : ''}`}>
            {n.icon}
            <span>{n.label}</span>
          </a>
        ))}
      </nav>
    </div>
  )
}
