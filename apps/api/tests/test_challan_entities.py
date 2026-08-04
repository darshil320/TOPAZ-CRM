"""The challan's `documents` keys are duplicated in two modules — pin them together.

`api/documents.py` cannot import `tasks/challan.py` at module scope: that would drag Celery,
Playwright and the Storage client into the web process, which the import-light rule exists to
prevent. The cost of that choice is two copies of three string constants, and a silent
divergence would mean the router looks for a document under a key the worker never writes —
"Challan not generated yet" forever, with a rendered PDF sitting in the bucket.

These tests are the seam. Pure: no DB, no broker.
"""

from src.api import documents
from src.tasks import challan


def test_the_document_entity_key_matches_the_worker():
    assert documents.ENTITY == challan.ENTITY == "delivery_consignment"


def test_the_document_kind_matches_the_worker():
    assert documents.KIND == challan.KIND == "challan_pdf"


def test_the_legacy_pre_0040_key_matches_the_worker():
    """Challans rendered before 0040 were filed against the DELIVERY. The GET route falls
    back to this key so those PDFs stay downloadable."""
    assert documents.LEGACY_ENTITY == challan.LEGACY_ENTITY == "delivery"


def test_the_new_and_legacy_entities_are_different_keys():
    """If these ever collapse, the fallback silently becomes the primary lookup."""
    assert documents.ENTITY != documents.LEGACY_ENTITY
