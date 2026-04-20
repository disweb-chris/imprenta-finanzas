import { createContext, useContext, useEffect, useState } from 'react'
import { collection, getDocs, addDoc, deleteDoc, doc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { DEFAULT_CATS } from '../utils/helpers'

const CatContext = createContext(null)

export const CatProvider = ({ children }) => {
  const [categorias, setCategorias] = useState(DEFAULT_CATS)

  useEffect(() => {
    loadCats()
  }, [])

  const loadCats = async () => {
    const snap = await getDocs(collection(db, 'categorias'))
    const extra = []
    snap.forEach(d => {
      if (!DEFAULT_CATS.find(c => c.id === d.id)) {
        extra.push({ id: d.id, ...d.data() })
      }
    })
    setCategorias([...DEFAULT_CATS, ...extra])
  }

  const addCat = async (nombre, color) => {
    const id = nombre.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    await addDoc(collection(db, 'categorias'), { nombre, color })
    await loadCats()
    return id
  }

  const deleteCat = async (id) => {
    await deleteDoc(doc(db, 'categorias', id))
    await loadCats()
  }

  const getCat = (id) => categorias.find(c => c.id === id) || { nombre: id, color: '#94a3b8' }

  return (
    <CatContext.Provider value={{ categorias, getCat, addCat, deleteCat, isDefault: (id) => !!DEFAULT_CATS.find(c => c.id === id) }}>
      {children}
    </CatContext.Provider>
  )
}

export const useCats = () => useContext(CatContext)
