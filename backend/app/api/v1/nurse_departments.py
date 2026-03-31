"""
Nurse-Department Assignments API — hospital_admin assigns nurses to departments.
"""
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, require_role
from app.db.engine import get_session
from app.models.tenant.department import Department
from app.models.tenant.nurse_department import NurseDepartment
from app.schemas.nurse_department import NurseDepartmentAssign, NurseDepartmentRead

router = APIRouter()


@router.get("", response_model=List[NurseDepartmentRead])
async def list_assignments(
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role("hospital_admin", "super_admin", "nurse")),
):
    """List all nurse-department assignments for this tenant."""
    rows = (await session.execute(select(NurseDepartment))).scalars().all()
    items = []
    for nd in rows:
        item = NurseDepartmentRead.model_validate(nd)
        dept = await session.get(Department, nd.department_id)
        item.department_name = dept.name if dept else None
        items.append(item)
    return items


@router.post("", response_model=NurseDepartmentRead, status_code=status.HTTP_201_CREATED)
async def assign_nurse(
    payload: NurseDepartmentAssign,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role("hospital_admin", "super_admin")),
):
    """Assign a nurse to a department (replaces existing assignment)."""
    # Remove any existing assignment for this nurse
    existing = (await session.execute(
        select(NurseDepartment).where(NurseDepartment.user_id == payload.user_id)
    )).scalar_one_or_none()
    if existing:
        await session.delete(existing)

    dept = await session.get(Department, payload.department_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")

    nd = NurseDepartment(
        id=uuid.uuid4(),
        user_id=payload.user_id,
        department_id=payload.department_id,
        assigned_by=uuid.UUID(current_user["sub"]),
    )
    session.add(nd)
    await session.commit()
    await session.refresh(nd)

    item = NurseDepartmentRead.model_validate(nd)
    item.department_name = dept.name
    return item


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unassign_nurse(
    user_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_role("hospital_admin", "super_admin")),
):
    """Remove a nurse's department assignment."""
    nd = (await session.execute(
        select(NurseDepartment).where(NurseDepartment.user_id == user_id)
    )).scalar_one_or_none()
    if not nd:
        raise HTTPException(status_code=404, detail="Assignment not found")
    await session.delete(nd)
    await session.commit()


@router.get("/my", response_model=Optional[NurseDepartmentRead])
async def my_department(
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(require_role("nurse", "hospital_admin", "super_admin")),
):
    """Returns the department assigned to the currently authenticated nurse."""
    user_id = uuid.UUID(current_user["sub"])
    nd = (await session.execute(
        select(NurseDepartment).where(NurseDepartment.user_id == user_id)
    )).scalar_one_or_none()
    if not nd:
        return None
    item = NurseDepartmentRead.model_validate(nd)
    dept = await session.get(Department, nd.department_id)
    item.department_name = dept.name if dept else None
    return item
