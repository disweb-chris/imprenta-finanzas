import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyCW7EMaFN8KpaA4lm2NqSlvgVsRNQvHfrc",
  authDomain: "imprenta-online-finanzas.firebaseapp.com",
  projectId: "imprenta-online-finanzas",
  storageBucket: "imprenta-online-finanzas.firebasestorage.app",
  messagingSenderId: "919246442188",
  appId: "1:919246442188:web:506d4c3ead261dddc27c69"
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
