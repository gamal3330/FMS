import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.core.config import get_settings

logger = logging.getLogger("app.performance")


class RequestTimingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        started = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        response.headers["X-Process-Time-Ms"] = str(elapsed_ms)

        settings = get_settings()
        if elapsed_ms >= settings.request_slow_ms:
            logger.warning(
                "slow_request method=%s path=%s status=%s duration_ms=%s",
                request.method,
                request.url.path,
                response.status_code,
                elapsed_ms,
            )
        return response
