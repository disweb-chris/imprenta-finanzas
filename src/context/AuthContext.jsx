import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../firebase/config'
import { loadWCConfig } from '../utils/woocommerce'

const AuthContext = createContext(null)

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(undefined) // undefined = cargando
  const [role, setRole] = useState(undefined) // undefined = cargando; 'admin' es el default si no hay registro

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u || null)
      if (!u) { setRole(null); return }
      let rol = 'admin'
      try {
        const snap = await getDoc(doc(db, 'roles', u.email.toLowerCase()))
        if (snap.exists()) rol = snap.data().rol
      } catch { /* sin registro de rol: admin */ }
      // Las claves de WooCommerce se cargan antes de mostrar la app, así las vistas ya las tienen
      if (rol !== 'gestor') await loadWCConfig()
      setRole(rol)
    })
    return unsub
  }, [])

  const login = (email, password) => signInWithEmailAndPassword(auth, email, password)
  const logout = () => signOut(auth)

  return (
    <AuthContext.Provider value={{ user, role, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)

