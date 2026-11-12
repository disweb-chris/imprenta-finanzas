import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'

// Credenciales de WooCommerce. Se guardan en Firestore (config/woocommerce, solo admins) para que
// sirvan en cualquier navegador, y se copian a localStorage para leerlas sin esperar a la red.
const WC_DOC = doc(db, 'config', 'woocommerce')

const getWC = () => ({
  url: localStorage.getItem('wc_url') || '',
  key: localStorage.getItem('wc_key') || '',
  secret: localStorage.getItem('wc_secret') || '',
})

const wcAuth = () => {
  const { key, secret } = getWC()
  return 'Basic ' + btoa(`${key}:${secret}`)
}

// base: 'wc/v3' para la API de WooCommerce, 'io-costos/v1' para la del plugin IO Costos
// (acepta las mismas claves). Los errores traen el mensaje que devuelve la tienda.
const wcRequest = async (endpoint, { method = 'GET', body, base = 'wc/v3' } = {}) => {
  const { url, key, secret } = getWC()
  if (!url || !key || !secret) {
    throw new Error('Configurá la conexión a WooCommerce en Configuración antes de continuar')
  }
  const headers = { Authorization: wcAuth() }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const r = await fetch(`${url}/wp-json/${base}${endpoint}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) {
    let msg = ''
    try { msg = (await r.json()).message || '' } catch { /* respuesta sin JSON */ }
    throw new Error(`WC API ${r.status}${msg ? ` — ${msg}` : ''}`)
  }
  return r.json()
}

export const wcFetch = (endpoint) => wcRequest(endpoint)

// Fetch orders between two Date objects (supports full timestamp for caja logic)
export const fetchOrders = async (startDate, endDate, status = 'completed,processing') => {
  const after = startDate.toISOString()
  const before = endDate.toISOString()
  const statusParam = status === 'any' ? '' : `&status=${status}`
  const orders = []
  let page = 1
  while (true) {
    const batch = await wcFetch(
      `/orders?per_page=100&page=${page}&after=${after}&before=${before}${statusParam}&orderby=date&order=desc`
    )
    if (!batch.length) break
    orders.push(...batch)
    if (batch.length < 100) break
    page++
  }
  return orders
}

const guardarLocal = (url, key, secret) => {
  localStorage.setItem('wc_url', url)
  localStorage.setItem('wc_key', key)
  localStorage.setItem('wc_secret', secret)
}

export const saveWCConfig = async (url, key, secret) => {
  guardarLocal(url, key, secret)
  await setDoc(WC_DOC, { url, key, secret, updatedAt: new Date().toISOString() })
}

// Al iniciar sesión: trae las claves de Firestore. Si todavía no hay nada guardado ahí pero este
// navegador las tiene, las sube, así quedan disponibles en los demás.
export const loadWCConfig = async () => {
  try {
    const snap = await getDoc(WC_DOC)
    const d = snap.exists() ? snap.data() : null
    if (d?.url && d?.key && d?.secret) {
      guardarLocal(d.url, d.key, d.secret)
      return
    }
    const { url, key, secret } = getWC()
    if (url && key && secret) await setDoc(WC_DOC, { url, key, secret, updatedAt: new Date().toISOString() })
  } catch (e) {
    console.warn('No se pudieron leer las claves de WooCommerce de Firestore:', e.message)
  }
}

export const getWCConfig = getWC

