import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  updateProfile,
  type User,
} from "firebase/auth";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./client";

const googleProvider = new GoogleAuthProvider();

// ── Sign in ──────────────────────────────────────────────────
export async function signInWithEmail(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}

// ── Sign up ──────────────────────────────────────────────────
export async function signUpWithEmail(email: string, password: string, fullName: string) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(credential.user, { displayName: fullName });
  await createUserProfile(credential.user, fullName);
  return credential;
}

// ── Google OAuth ─────────────────────────────────────────────
export async function signInWithGoogle() {
  const credential = await signInWithPopup(auth, googleProvider);
  // Create profile if first login
  const profileRef = doc(db, "profiles", credential.user.uid);
  const snap = await getDoc(profileRef);
  if (!snap.exists()) {
    await createUserProfile(credential.user, credential.user.displayName ?? "");
  }
  return credential;
}

// ── Sign out ─────────────────────────────────────────────────
export async function logOut() {
  return signOut(auth);
}

// ── Create Firestore profile doc ─────────────────────────────
async function createUserProfile(user: User, fullName: string) {
  await setDoc(doc(db, "profiles", user.uid), {
    uid: user.uid,
    email: user.email,
    fullName: fullName || user.displayName || "",
    avatarUrl: user.photoURL || "",
    plan: "free",
    simulationCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// ── Auth state observer ──────────────────────────────────────
export function onAuthChange(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

// ── Get current user ─────────────────────────────────────────
export function getCurrentUser() {
  return auth.currentUser;
}
