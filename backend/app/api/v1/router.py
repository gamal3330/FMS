from fastapi import APIRouter

from app.api.v1 import audit, auth, dashboard, health, messages, reports, request_type_management, requests, settings, updates, users

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(users.departments_router)
api_router.include_router(requests.router)
api_router.include_router(messages.router)
api_router.include_router(audit.router)
api_router.include_router(settings.router)
api_router.include_router(updates.router)
api_router.include_router(settings.workflows_router)
api_router.include_router(settings.sla_rules_router)
api_router.include_router(request_type_management.router)
api_router.include_router(request_type_management.requests_router)
api_router.include_router(dashboard.router)
api_router.include_router(reports.router)
api_router.include_router(health.router)
