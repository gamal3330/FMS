from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import require_roles
from app.models.enums import UserRole

router = APIRouter(prefix="/updates", tags=["System Updates"])
UpdateActor = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.DEPARTMENT_MANAGER))

LEGACY_UPDATE_DETAIL = "مسار التحديث القديم مغلق. استخدم شاشة إدارة التحديثات الجديدة عبر /api/v1/settings/updates."


def legacy_update_closed():
    raise HTTPException(status_code=status.HTTP_410_GONE, detail=LEGACY_UPDATE_DETAIL)


@router.api_route("", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
@router.api_route("/{legacy_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def closed_legacy_updates(_: object = UpdateActor):
    legacy_update_closed()
