/**
 * Firebase Realtime Database client (waterMonitoring/*).
 *
 * Config is read from VITE_FIREBASE_* environment variables (paste into
 * .env — see .env.example). Until credentials are supplied, the app runs in
 * DEMO MODE; REAL DATA mode becomes available when initialize() succeeds.
 *
 * The client is optional at runtime: every page degrades gracefully to a
 * "Not Connected" state when Firebase has not been configured.
 */
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { get, getDatabase, onValue, push, ref, set, update, off, type Database } from 'firebase/database'

export interface FirebaseConfig {
  apiKey: string
  authDomain: string
  databaseURL: string
  projectId: string
}

/** RTDB node paths defined by the PDF. */
export const PATHS = {
  current: 'waterMonitoring/current',
  history: 'waterMonitoring/history',
  pump: 'waterMonitoring/pump',
  alerts: 'waterMonitoring/alerts',
  ai: 'waterMonitoring/ai',
}

export function readConfig(): FirebaseConfig | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN
  const databaseURL = import.meta.env.VITE_FIREBASE_DATABASE_URL
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
  if (!apiKey || !databaseURL) return null
  return { apiKey, authDomain: authDomain || projectId || '', databaseURL, projectId: projectId || '' }
}

let app: FirebaseApp | null = null
let db: Database | null = null
let lastError = ''

/** Initialise Firebase once. Returns true when RTDB is ready. */
export function initializeFirebase(): boolean {
  if (db) return true
  if (getApps().length) {
    app = getApps()[0]
  } else {
    const config = readConfig()
    if (!config) {
      lastError = 'Firebase is not configured. Add VITE_FIREBASE_* variables and restart the dev server.'
      return false
    }
    try {
      app = initializeApp(config)
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Firebase initialisation failed.'
      return false
    }
  }
  try {
    db = getDatabase(app)
    return true
  } catch (error) {
    lastError = error instanceof Error ? error.message : 'Could not open the Realtime Database.'
    return false
  }
}

export function getLastFirebaseError(): string {
  return lastError
}

export function database(): Database | null {
  return db
}

/* ------------------------------ low-level RTDB helpers (typed) --------- */

export function readOnce<T>(path: string): Promise<T | null> {
  const d = database()
  if (!d) return Promise.reject(new Error('Firebase not initialised.'))
  return get(ref(d, path)).then((snap) => (snap.exists() ? (snap.val() as T) : null))
}

export function writeAt(path: string, value: unknown): Promise<void> {
  const d = database()
  if (!d) return Promise.reject(new Error('Firebase not initialised.'))
  return set(ref(d, path), value)
}

export function updateAt(path: string, value: Record<string, unknown>): Promise<void> {
  const d = database()
  if (!d) return Promise.reject(new Error('Firebase not initialised.'))
  return update(ref(d, path), value)
}

export function pushAt(path: string, value: unknown): Promise<string> {
  const d = database()
  if (!d) return Promise.reject(new Error('Firebase not initialised.'))
  const newRef = push(ref(d, path))
  return set(newRef, value).then(() => newRef.key ?? '')
}

// Re-exported RTDB core so consumers can subscribe.
export { get, onValue, push, ref, set, update, off, getDatabase }