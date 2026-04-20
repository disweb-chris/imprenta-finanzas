import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e) => {
    e?.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, pass)
    } catch {
      setError('Email o contraseña incorrectos.')
    }
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #111827 0%, #1e3a7a 50%, #2e509e 100%)'
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '48px 40px',
        width: 380, boxShadow: '0 20px 60px rgba(0,0,0,.3)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            background: 'linear-gradient(135deg, #111827, #1e3a7a)', borderRadius: 14,
            padding: '18px 24px', display: 'inline-block', marginBottom: 14
          }}>
            <img
              src="https://imprentaonline.ar/wp-content/uploads/2026/02/logo-blanco.webp"
              alt="Imprenta Online" style={{ height: 48, display: 'block' }}
            />
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Panel de Finanzas</p>
        </div>

        <form onSubmit={handleLogin}>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="tu@email.com" autoComplete="username" />
          </div>
          <div className="field">
            <label>Contraseña</label>
            <input type="password" value={pass} onChange={e => setPass(e.target.value)}
              placeholder="••••••••" autoComplete="current-password" />
          </div>
          <button type="submit" disabled={loading} style={{
            width: '100%', padding: 13, background: 'var(--blue)', color: '#fff',
            border: 'none', borderRadius: 8, fontFamily: 'var(--font-head)',
            fontWeight: 700, fontSize: 14, cursor: 'pointer', marginTop: 8,
            opacity: loading ? .7 : 1
          }}>
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
          {error && <p style={{ color: 'var(--danger)', fontSize: 12, textAlign: 'center', marginTop: 10 }}>{error}</p>}
        </form>
      </div>
    </div>
  )
}
