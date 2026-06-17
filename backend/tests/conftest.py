"""Shared test fixtures."""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.fixture(autouse=True)
def _reset_rate_limit_state():
    """Clear rate-limiter buckets and token cache around every test.

    Rate-limit state is module-level and would otherwise leak between
    tests (e.g. expensive-endpoint buckets filling up across a module).
    """
    from app.middleware import rate_limit as rl
    rl._buckets.clear()
    rl._token_cache.clear()
    rl._last_cleanup = 0.0
    yield
    rl._buckets.clear()
    rl._token_cache.clear()
    rl._last_cleanup = 0.0


@pytest.fixture
def mock_firebase():
    """Mock all Firebase operations for tests that hit API endpoints."""
    store = {}

    async def mock_get_document(collection, doc_id):
        key = f"{collection}/{doc_id}"
        doc = store.get(key)
        if doc:
            return {"id": doc_id, **doc}
        return None

    async def mock_update_document(collection, doc_id, data):
        key = f"{collection}/{doc_id}"
        if key in store:
            store[key].update(data)

    async def mock_delete_document(collection, doc_id):
        key = f"{collection}/{doc_id}"
        store.pop(key, None)

    async def mock_query_collection(collection, filters):
        results = []
        for key, doc in store.items():
            if not key.startswith(f"{collection}/"):
                continue
            match = True
            for field, op, value in filters:
                doc_val = doc.get(field)
                if op == "==" and doc_val != value:
                    match = False
                    break
            if match:
                doc_id = key.split("/", 1)[1]
                results.append({"id": doc_id, **doc})
        return results

    async def mock_verify_id_token(token):
        if token == "valid-token":
            return {"uid": "test-user-123", "email": "test@example.com", "name": "Test User"}
        if token == "user2-token":
            return {"uid": "user-2", "email": "user2@example.com", "name": "User 2"}
        raise Exception("Invalid token")

    # Mock Firestore db
    mock_db = MagicMock()
    mock_collection = MagicMock()

    def _current_key():
        return f"{mock_collection._collection_name}/{mock_doc_ref._doc_id}"

    async def mock_set(data):
        store[_current_key()] = data

    async def mock_doc_get():
        key = _current_key()
        data = store.get(key)
        snap = MagicMock()
        snap.exists = data is not None
        snap.id = mock_doc_ref._doc_id
        snap.to_dict = MagicMock(return_value=dict(data) if data is not None else None)
        return snap

    async def mock_doc_delete():
        store.pop(_current_key(), None)

    mock_doc_ref = MagicMock()
    mock_doc_ref.set = AsyncMock(side_effect=mock_set)
    mock_doc_ref.get = AsyncMock(side_effect=mock_doc_get)
    mock_doc_ref.delete = AsyncMock(side_effect=mock_doc_delete)

    def mock_document(doc_id):
        mock_doc_ref._doc_id = doc_id
        return mock_doc_ref

    def mock_collection_fn(name):
        mock_collection._collection_name = name
        mock_collection.document = mock_document
        return mock_collection

    mock_db.collection = mock_collection_fn

    patches = [
        patch("app.routers.simulations.get_document", side_effect=mock_get_document),
        patch("app.routers.simulations.update_document", side_effect=mock_update_document),
        patch("app.routers.simulations.delete_document", side_effect=mock_delete_document),
        patch("app.routers.simulations.query_collection", side_effect=mock_query_collection),
        patch("app.routers.simulations.get_db", return_value=mock_db),
        patch("app.routers.users.get_document", side_effect=mock_get_document),
        patch("app.routers.users.update_document", side_effect=mock_update_document),
        patch("app.routers.users.delete_document", side_effect=mock_delete_document),
        patch("app.routers.users.query_collection", side_effect=mock_query_collection),
        patch("app.routers.users.get_db", return_value=mock_db),
        patch("app.routers.export.query_collection", side_effect=mock_query_collection),
        patch("app.routers.export.get_document", side_effect=mock_get_document),
        patch("app.routers.shares.get_document", side_effect=mock_get_document),
        patch("app.routers.shares.delete_document", side_effect=mock_delete_document),
        patch("app.routers.shares.query_collection", side_effect=mock_query_collection),
        patch("app.routers.shares.get_db", return_value=mock_db),
        patch("app.routers.analytics.query_collection", side_effect=mock_query_collection),
        patch("app.routers.public.query_collection", side_effect=mock_query_collection),
        # Insights router (narrative dashboard digest) reads sims via query_collection.
        patch("app.routers.insights.query_collection", side_effect=mock_query_collection),
        # Demo router: claim persists an owner-scoped simulation via get_db
        # and dedupes by demo_id via query_collection.
        patch("app.routers.demo.get_db", return_value=mock_db),
        patch("app.routers.demo.query_collection", side_effect=mock_query_collection),
        # Services behind projects/graphs/reports routers import Firestore
        # helpers from app.services.firebase_admin at call time, so patch
        # them at the source module.
        patch("app.services.firebase_admin.get_document", side_effect=mock_get_document),
        patch("app.services.firebase_admin.update_document", side_effect=mock_update_document),
        patch("app.services.firebase_admin.delete_document", side_effect=mock_delete_document),
        patch("app.services.firebase_admin.query_collection", side_effect=mock_query_collection),
        patch("app.services.firebase_admin.get_db", return_value=mock_db),
        # Token verification: auth dependency and rate limiter both consume it.
        patch("app.middleware.auth.verify_id_token", side_effect=mock_verify_id_token),
        patch("app.middleware.rate_limit.verify_id_token", side_effect=mock_verify_id_token),
    ]

    for p in patches:
        p.start()

    yield store

    for p in patches:
        p.stop()
