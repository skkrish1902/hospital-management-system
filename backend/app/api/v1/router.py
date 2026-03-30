from fastapi import APIRouter

from app.api.v1.appointments import router as appointments_router
from app.api.v1.auth import router as auth_router
from app.api.v1.billing import router as billing_router
from app.api.v1.consultations import router as consultations_router
from app.api.v1.departments import router as departments_router
from app.api.v1.doctors import router as doctors_router
from app.api.v1.patients import router as patients_router
from app.api.v1.prescriptions import router as prescriptions_router
from app.api.v1.queue import router as queue_router
from app.api.v1.tenants import router as tenants_router
from app.api.v1.users import router as users_router
from app.api.v1.visits import router as visits_router
from app.api.v1.vitals import router as vitals_router

api_router = APIRouter()

api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(tenants_router, prefix="/tenants", tags=["tenants"])
api_router.include_router(users_router, prefix="/users", tags=["users"])
api_router.include_router(patients_router, prefix="/patients", tags=["patients"])
api_router.include_router(departments_router, prefix="/departments", tags=["departments"])
api_router.include_router(doctors_router, prefix="/doctors", tags=["doctors"])
api_router.include_router(appointments_router, prefix="/appointments", tags=["appointments"])
api_router.include_router(queue_router, prefix="/queue", tags=["queue"])
api_router.include_router(visits_router, prefix="/visits", tags=["visits"])
api_router.include_router(vitals_router, prefix="/vitals", tags=["vitals"])
api_router.include_router(consultations_router, prefix="/consultations", tags=["consultations"])
api_router.include_router(prescriptions_router, prefix="/prescriptions", tags=["prescriptions"])
api_router.include_router(billing_router, prefix="/billing", tags=["billing"])
