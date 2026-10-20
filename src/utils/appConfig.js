import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'

const CONFIG_DOC = doc(db, 'config', 'general')

export const DEFAULT_APP_CONFIG = {
  mp_comision_pct: 5.5,
  monotributo_techo: 0,
  iibb_alicuota_pct: 4,
  iibb_dia_venc: 10,
  // Descuentos que aplica Avealma sobre lo que factura, en % del monto facturado
  avealma_descuentos: [
    { nombre: 'IVA', pct: 0 },
    { nombre: 'IIBB', pct: 0 },
    { nombre: 'Ganancias', pct: 0 },
  ],
  // Comisiones que retiene GetNet sobre cada cobro, en %
  getnet_comisiones: [
    { nombre: 'Arancel', pct: 0 },
    { nombre: 'IVA sobre arancel', pct: 0 },
  ],
}

export async function getAppConfig() {
  const snap = await getDoc(CONFIG_DOC)
  return { ...DEFAULT_APP_CONFIG, ...(snap.exists() ? snap.data() : {}) }
}

export async function saveAppConfig(partial) {
  await setDoc(CONFIG_DOC, partial, { merge: true })
}
