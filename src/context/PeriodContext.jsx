import { createContext, useContext, useState } from 'react'

const PeriodContext = createContext(null)

export const PeriodProvider = ({ children }) => {
  const [period, setPeriod] = useState('month')

  const getPeriodDates = (p = period) => {
    const now = new Date()
    let start, end
    if (p === 'week') {
      const day = now.getDay() || 7
      start = new Date(now); start.setDate(now.getDate() - day + 1); start.setHours(0,0,0,0)
      end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23,59,59,999)
    } else if (p === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
    } else {
      start = new Date(now.getFullYear(), 0, 1)
      end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999)
    }
    return { start, end }
  }

  const periodLabel = () => {
    const { start } = getPeriodDates()
    if (period === 'week') {
      const { end } = getPeriodDates()
      const fmt = d => d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
      return `Semana: ${fmt(start)} — ${fmt(end)}`
    }
    if (period === 'month') return start.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
    return `Año ${start.getFullYear()}`
  }

  return (
    <PeriodContext.Provider value={{ period, setPeriod, getPeriodDates, periodLabel }}>
      {children}
    </PeriodContext.Provider>
  )
}

export const usePeriod = () => useContext(PeriodContext)
