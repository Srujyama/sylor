import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getAuth, Auth } from "firebase/auth";
import { getFirestore, Firestore } from "firebase/firestore";
import { getStorage, FirebaseStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim(),
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim(),
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim(),
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim(),
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim(),
};

// Lazy initialization — safe during SSR/build and avoids null casts
let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;
let _db: Firestore | null = null;
let _storage: FirebaseStorage | null = null;

function getFirebaseApp(): FirebaseApp {
  if (_app) return _app;
  if (typeof window === "undefined" && !process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    throw new Error("Firebase cannot be initialized during server-side build without env vars");
  }
  _app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return _app;
}

function getFirebaseAuth(): Auth {
  if (_auth) return _auth;
  _auth = getAuth(getFirebaseApp());
  return _auth;
}

function getFirebaseDb(): Firestore {
  if (_db) return _db;
  _db = getFirestore(getFirebaseApp());
  return _db;
}

function getFirebaseStorage(): FirebaseStorage {
  if (_storage) return _storage;
  _storage = getStorage(getFirebaseApp());
  return _storage;
}

// Proxy objects that lazy-initialize on first property access.
// This avoids crashes during SSR/build while keeping the same import API.
const auth: Auth = new Proxy({} as Auth, {
  get(_, prop) { return (getFirebaseAuth() as any)[prop]; },
  set(_, prop, value) { (getFirebaseAuth() as any)[prop] = value; return true; },
});

const db: Firestore = new Proxy({} as Firestore, {
  get(_, prop) { return (getFirebaseDb() as any)[prop]; },
  set(_, prop, value) { (getFirebaseDb() as any)[prop] = value; return true; },
});

const storage: FirebaseStorage = new Proxy({} as FirebaseStorage, {
  get(_, prop) { return (getFirebaseStorage() as any)[prop]; },
  set(_, prop, value) { (getFirebaseStorage() as any)[prop] = value; return true; },
});

const app: FirebaseApp = new Proxy({} as FirebaseApp, {
  get(_, prop) { return (getFirebaseApp() as any)[prop]; },
});

export { auth, db, storage };
export default app;
