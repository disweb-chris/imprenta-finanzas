import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'

const CONFIG_DOC = doc(db, 'config', 'general')

export const DEFAULT_APP_CONFIG = {
  mp_comision_pct: 5.5,
  monotributo_techo: 0,
}

export async function getAppConfig() {
  const snap = await getDoc(CONFIG_DOC)
  return { ...DEFAULT_APP_CONFIG, ...(snap.exists() ? snap.data() : {}) }
}

export async function saveAppConfig(partial) {
  await setDoc(CONFIG_DOC, partial, { merge: true })
}
