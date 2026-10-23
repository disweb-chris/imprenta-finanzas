// Credenciales de WooCommerce — solo desde localStorage (configurables en Configuración)
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

export const saveWCConfig = (url, key, secret) => {
  localStorage.setItem('wc_url', url)
  localStorage.setItem('wc_key', key)
  localStorage.setItem('wc_secret', secret)
}

export const getWCConfig = getWC

