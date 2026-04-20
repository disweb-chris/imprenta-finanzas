import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { CatProvider } from './context/CatContext'
import { PeriodProvider } from './context/PeriodContext'
import { ToastProvider } from './components/Toast'
import App from './App'
import './index.css'

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
