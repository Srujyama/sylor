import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  onSnapshot,
  type DocumentData,
  type QueryConstraint,
} from "firebase/firestore";
import { db } from "./client";

// ── Generic helpers ───────────────────────────────────────────

export async function addDocument(collectionPath: string, data: DocumentData) {
  const ref = await addDoc(collection(db, collectionPath), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function getDocument(collectionPath: string, id: string) {
  const snap = await getDoc(doc(db, collectionPath, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function updateDocument(collectionPath: string, id: string, data: DocumentData) {
  await updateDoc(doc(db, collectionPath, id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteDocument(collectionPath: string, id: string) {
  await deleteDoc(doc(db, collectionPath, id));
}

export async function queryDocuments(
  collectionPath: string,
  constraints: QueryConstraint[]
) {
  const q = query(collection(db, collectionPath), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ── Simulation-specific helpers ───────────────────────────────

export async function getUserSimulations(userId: string) {
  return queryDocuments("simulations", [
    where("userId", "==", userId),
    orderBy("updatedAt", "desc"),
  ]);
}

export async function getSimulation(id: string) {
  return getDocument("simulations", id);
}

export async function createSimulation(userId: string, data: DocumentData) {
  return addDocument("simulations", { ...data, userId, status: "draft", runCount: 0 });
}

export async function updateSimulationStatus(
  id: string,
  status: string,
  results?: DocumentData
) {
  await updateDocument("simulations", id, { status, ...(results ? { results } : {}) });
}

// ── Real-time subscription ───────────────────────────────────

export function subscribeToSimulation(
  id: string,
  callback: (data: DocumentData | null) => void
) {
  return onSnapshot(doc(db, "simulations", id), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

// ── Re-export Firestore query helpers for convenience ─────────
export { where, orderBy, limit };
