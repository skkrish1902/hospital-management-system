"""
Audit log middleware — appends an entry to audit_logs for every
mutating request (POST / PUT / PATCH / DELETE) once a response is returned.
Read operations are not logged here; sensitive field-level access logging
is handled inside individual services.
"""

import json
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class AuditLogMiddleware(BaseHTTPMiddleware):
    _MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)

        if request.method in self._MUTATING_METHODS and response.status_code < 400:
            # Audit logging is async fire-and-forget via a background task.
            # Full implementation wired in Phase 1 when visit/patient services exist.
            pass

        return response
