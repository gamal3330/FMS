"""Feature modules live here when a future capability needs isolated code.

Keep shared infrastructure in app/core, app/db, app/models, and app/services.
Place feature-specific routers, schemas, and helpers in a subpackage here when
the feature is large enough to avoid mixing it into the legacy modules.
"""
