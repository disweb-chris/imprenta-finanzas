import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { CatProvider } from './context/CatContext'
import { PeriodProvider } from './context/PeriodContext'
import { ToastProvider } from './components/Toast'
import App from './App'
import './index.css'

// Después de un deploy, los archivos de la versión anterior ya no existen en el servidor y una pestaña
// abierta falla al entrar a otra sección. Recargar trae la versión nueva. Se recarga como mucho una vez
// cada 10 segundos para no entrar en un bucle si el problema es otro.
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'io_recarga_por_deploy'
  let ultima = 0
  try { ultima = Number(sessionStorage.getItem(KEY) || 0) } catch { /* sin sessionStorage */ }
  if (Date.now() - ultima < 10000) return
  try { sessionStorage.setItem(KEY, String(Date.now())) } catch { /* sin sessionStorage */ }
  event.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <PeriodProvider>
            <CatProvider>
              <App />
            </CatProvider>
          </PeriodProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
)
