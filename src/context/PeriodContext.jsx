import { createContext, useContext, useState } from 'react'

const PeriodContext = createContext(null)

export const PeriodProvider = ({ children }) => {
  const now = new Date()
  // mode: 'week' | 'month' | 'year' | 'custom'
  // customMonth/customYear: for custom month picker
  const [period, setPeriod] = useState('month')
  const [customMonth, setCustomMonth] = useState(now.getMonth())
  const [customYear, setCustomYear] = useState(now.getFullYear())

  const getPeriodDates = (p = period) => {
    const d = new Date()
    let start, end

    if (p === 'week') {
      const day = d.getDay() || 7
      start = new Date(d); start.setDate(d.getDate() - day + 1); start.setHours(0,0,0,0)
      end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23,59,59,999)
    } else if (p === 'month') {
      start = new Date(d.getFullYear(), d.getMonth(), 1)
      end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
    } else if (p === 'year') {
      start = new Date(d.getFullYear(), 0, 1)
      end = new Date(d.getFullYear(), 11, 31, 23, 59, 59, 999)
    } else if (p === 'custom') {
      start = new Date(customYear, customMonth, 1)
      end = new Date(customYear, customMonth + 1, 0, 23, 59, 59, 999)
    }
    return { start, end }
  }

  const periodLabel = () => {
    if (period === 'week') {
      const { start, end } = getPeriodDates()
      const fmt = d => d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
      return `Semana: ${fmt(start)} — ${fmt(end)}`
    }
    if (period === 'month') {
      const { start } = getPeriodDates()
      return start.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
    }
    if (period === 'year') {
      return `Año ${new Date().getFullYear()}`
    }
    if (period === 'custom') {
      const d = new Date(customYear, customMonth, 1)
      return d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
    }
  }

  const setCustomPeriod = (month, year) => {
    setCustomMonth(month)
    setCustomYear(year)
    setPeriod('custom')
  }

  return (
    <PeriodContext.Provider value={{
      period, setPeriod,
      customMonth, customYear, setCustomPeriod,
      getPeriodDates, periodLabel
    }}>
      {children}
    </PeriodContext.Provider>
  )
}

export const usePeriod = () => useContext(PeriodContext)
