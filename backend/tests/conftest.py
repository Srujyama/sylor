"""Shared test fixtures."""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock


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

    async def mock_set(data):
        # Extract doc_id from the mock chain
        doc_id = mock_doc_ref._doc_id
        collection_name = mock_collection._collection_name
        store[f"{collection_name}/{doc_id}"] = data

    mock_doc_ref = MagicMock()
    mock_doc_ref.set = AsyncMock(side_effect=mock_set)

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
        patch("app.middleware.auth.verify_id_token", side_effect=mock_verify_id_token),
    ]

    for p in patches:
        p.start()

    yield store

    for p in patches:
        p.stop()
