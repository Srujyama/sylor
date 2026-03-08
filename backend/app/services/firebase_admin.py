"""
Firebase Admin SDK initialisation and Firestore helpers.
Replaces the former Supabase client.
"""
import json
import os
import firebase_admin
from firebase_admin import credentials, firestore, auth
from google.cloud.firestore_v1 import AsyncClient

from app.config import settings

# ── Singleton initialisation ─────────────────────────────────────────────────

def _init_firebase() -> None:
    if firebase_admin._apps:
        return  # already initialised

    # Option A: path to serviceAccountKey.json on disk
    if settings.firebase_service_account_path and os.path.exists(settings.firebase_service_account_path):
        cred = credentials.Certificate(settings.firebase_service_account_path)

    # Option B: inline JSON string (Fly.io secret)
    elif settings.firebase_service_account_json:
        sa_dict = json.loads(settings.firebase_service_account_json)
        cred = credentials.Certificate(sa_dict)

    # Option C: Application Default Credentials (Cloud Run / GCE)
    else:
        cred = credentials.ApplicationDefault()

    firebase_admin.initialize_app(cred, {
        "projectId": settings.firebase_project_id or None,
    })


_init_firebase()


# ── Firestore client ─────────────────────────────────────────────────────────

def get_db() -> firestore.AsyncClient:
    """Return the async Firestore client."""
    return firestore.AsyncClient()


# ── Auth helpers ─────────────────────────────────────────────────────────────

async def verify_id_token(token: str) -> dict:
    """Verify a Firebase ID token and return its decoded claims."""
    return auth.verify_id_token(token)


async def get_user(uid: str):
    """Fetch a Firebase Auth user record."""
    return auth.get_user(uid)


# ── Firestore CRUD helpers ───────────────────────────────────────────────────

async def create_document(collection: str, data: dict) -> str:
    """Add a document and return its auto-generated ID."""
    db = get_db()
    doc_ref = await db.collection(collection).add(data)
    return doc_ref[1].id


async def get_document(collection: str, doc_id: str) -> dict | None:
    db = get_db()
    snap = await db.collection(collection).document(doc_id).get()
    if not snap.exists:
        return None
    return {"id": snap.id, **snap.to_dict()}


async def update_document(collection: str, doc_id: str, data: dict) -> None:
    db = get_db()
    await db.collection(collection).document(doc_id).update(data)


async def delete_document(collection: str, doc_id: str) -> None:
    db = get_db()
    await db.collection(collection).document(doc_id).delete()


async def query_collection(collection: str, filters: list[tuple]) -> list[dict]:
    """
    Query a collection with (field, op, value) filter tuples.
    Example: [("userId", "==", uid), ("status", "==", "completed")]
    """
    db = get_db()
    ref = db.collection(collection)
    for field, op, value in filters:
        ref = ref.where(field, op, value)
    docs = await ref.stream()
    results = []
    async for doc in docs:
        results.append({"id": doc.id, **doc.to_dict()})
    return results
