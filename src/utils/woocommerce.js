// WooCommerce credentials stored in localStorage only
const getWC = () => ({
  url: localStorage.getItem('wc_url') || 'https://imprentaonline.ar',
  key: localStorage.getItem('wc_key') || 'ck_742b18523bd4381b2b1cf2459bf00f2ebbfa6c4f',
  secret: localStorage.getItem('wc_secret') || 'cs_36d3e9b5a7e5d508cba002746359f465b95dee75',
})

const wcAuth = () => {
  const { key, secret } = getWC()
  return 'Basic ' + btoa(`${key}:${secret}`)
}

export const wcFetch = async (endpoint) => {
  const { url } = getWC()
  const r = await fetch(`${url}/wp-json/wc/v3${endpoint}`, {
    headers: { Authorization: wcAuth() }
  })
  if (!r.ok) throw new Error(`WC API ${r.status}`)
  return r.json()
}

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
