import { getIngresoReal } from './pedidos'
import { medioPagoInfo } from './helpers'

// CSV pensado para Excel en español: separador ';', coma decimal y BOM para que respete los acentos
const celda = (v) => {
  if (v == null) return ''
  if (typeof v === 'number') return String(Math.round(v * 100) / 100).replace('.', ',')
  const s = String(v)
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function descargarCSV(nombre, encabezados, filas) {
  const lineas = [encabezados, ...filas].map(f => f.map(celda).join(';'))
  const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const fechaAR = (iso) => {
  if (!iso) return ''
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function exportarVentas(nombre, orders) {
  descargarCSV(nombre,
    ['Fecha', 'Pedido', 'Estado', 'Cliente', 'Email', 'Medio de pago', 'Total', 'Cobrado', 'Saldo'],
    orders.map(o => {
      const total = parseFloat(o.total || 0)
      const cobrado = getIngresoReal(o)
      return [
        fechaAR(o.date_created), o.number, o.status,
        `${o.billing?.first_name || ''} ${o.billing?.last_name || ''}`.trim(), o.billing?.email || '',
        o.payment_method_title || o.payment_method || '', total, cobrado, total - cobrado,
      ]
    }))
}

export function exportarEgresos(nombre, egresos, getCat) {
  descargarCSV(nombre,
    ['Fecha', 'Mes imputación', 'Categoría', 'Subcategoría', 'Descripción', 'Medio de pago', 'Monto'],
    [...egresos].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))).map(e => [
      fechaAR(e.fecha), e.mes_imputacion || String(e.fecha || '').slice(0, 7), getCat(e.categoria).nombre,
      e.subcategoria || '', e.descripcion || '', medioPagoInfo(e.medio_pago).label, parseFloat(e.monto || 0),
    ]))
}
