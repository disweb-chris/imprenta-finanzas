// Lógica pura de la calculadora de pliegos — sin DOM, sin React.
// Reemplaza al widget que vivía pegado directo en el HTML de WordPress.

function parseNum(v) {
  const n = parseFloat(String(v).trim().replace(',', '.'))
  return isFinite(n) ? n : NaN
}

function fitCount(sheet, piece, gutter) {
  if (piece <= 0) return 0
  return Math.max(0, Math.floor((sheet + gutter) / (piece + gutter)))
}

function layout(sheetW, sheetH, pieceW, pieceH, gutter) {
  const cols = fitCount(sheetW, pieceW, gutter)
  const rows = fitCount(sheetH, pieceH, gutter)
  const count = cols * rows
  const usedW = cols > 0 ? cols * pieceW + (cols - 1) * gutter : 0
  const usedH = rows > 0 ? rows * pieceH + (rows - 1) * gutter : 0
  return { cols, rows, count, leftoverW: sheetW - usedW, leftoverH: sheetH - usedH }
}

export const PROD_MODES = { PORCENTAJE: 'pct', MONTO: 'monto' }

// input: { sheetW, sheetH, itemW, itemH, bleedMM, gutterMM, extraSheets, qty, doubleFace,
//          costPaper, costPrint, costSetup, prodMode, prodValor, profitPct, iibbPct }
// Devuelve el desglose completo o lanza Error con un mensaje para mostrar al usuario.
export function calcularPresupuesto(input) {
  const sheetW = parseNum(input.sheetW)
  const sheetH = parseNum(input.sheetH)
  const itemW = parseNum(input.itemW)
  const itemH = parseNum(input.itemH)
  const bleedMM = parseNum(input.bleedMM)
  const gutterMM = parseNum(input.gutterMM)
  const extraSheets = Math.max(0, Math.floor(parseNum(input.extraSheets)))
  const qty = Math.ceil(parseNum(input.qty))
  const costPaper = parseNum(input.costPaper)
  const costPrint = parseNum(input.costPrint)
  const costSetup = parseNum(input.costSetup)
  const prodValor = parseNum(input.prodValor)
  const profitPct = parseNum(input.profitPct)
  const iibbPct = parseNum(input.iibbPct)

  const nums = [sheetW, sheetH, itemW, itemH, bleedMM, gutterMM, extraSheets, qty, costPaper, costPrint, costSetup, prodValor, profitPct, iibbPct]
  if (nums.some(x => isNaN(x))) {
    throw new Error('Revisá los valores: deben ser números válidos (podés usar coma o punto).')
  }
  if (sheetW <= 0 || sheetH <= 0 || itemW <= 0 || itemH <= 0 || bleedMM < 0 || gutterMM < 0 || qty <= 0) {
    throw new Error('Revisá los valores: pliego/pieza/cantidad deben ser > 0. Demasía/separación pueden ser 0.')
  }

  const bleedCM = bleedMM / 10
  const gutterCM = gutterMM / 10
  const effW = itemW + 2 * bleedCM
  const effH = itemH + 2 * bleedCM

  const normal = layout(sheetW, sheetH, effW, effH, gutterCM)
  const rotada = layout(sheetW, sheetH, effH, effW, gutterCM)

  let best = normal, orientacion = 'Normal'
  if (rotada.count > normal.count) {
    best = rotada; orientacion = 'Rotada (90°)'
  } else if (rotada.count === normal.count && rotada.count > 0) {
    const wasteNormal = normal.leftoverW + normal.leftoverH
    const wasteRotada = rotada.leftoverW + rotada.leftoverH
    if (wasteRotada < wasteNormal) { best = rotada; orientacion = 'Rotada (90°)' }
  }

  if (best.count <= 0) {
    throw new Error('Con estas medidas no entra ninguna unidad en el pliego (revisá demasía/separación/medidas).')
  }

  const pliegosBase = Math.ceil(qty / best.count)
  const pliegosTotales = pliegosBase + extraSheets
  const caras = input.doubleFace ? 2 : 1
  const impresionesTotales = pliegosTotales * caras

  const costoPapel = pliegosTotales * costPaper
  const costoImpresion = impresionesTotales * costPrint
  const costoFijo = costSetup
  const costoBase = costoPapel + costoImpresion + costoFijo

  const produccionMonto = input.prodMode === PROD_MODES.MONTO
    ? Math.max(0, prodValor)
    : costoBase * (Math.max(0, prodValor) / 100)
  const costoConProduccion = costoBase + produccionMonto

  const gananciaMonto = costoConProduccion * (Math.max(0, profitPct) / 100)
  const costoConGanancia = costoConProduccion + gananciaMonto

  const iibbMonto = costoConGanancia * (Math.max(0, iibbPct) / 100)
  const precioFinalBase = costoConGanancia + iibbMonto

  return {
    orientacion,
    piezaEfectiva: { ancho: effW, alto: effH },
    entranPorPliego: { cantidad: best.count, columnas: best.cols, filas: best.rows },
    alternativas: { normal, rotada },
    pliegos: { base: pliegosBase, merma: extraSheets, total: pliegosTotales },
    impresionesTotales,
    qty,
    costos: {
      papel: costoPapel, impresion: costoImpresion, fijo: costoFijo, base: costoBase,
      produccion: produccionMonto, ganancia: gananciaMonto, iibb: iibbMonto,
    },
    precioFinalBase,
    unitPriceBase: precioFinalBase / qty,
  }
}
