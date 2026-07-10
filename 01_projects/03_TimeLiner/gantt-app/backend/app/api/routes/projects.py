from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter

from app.models.enums import ProjectStatus
from app.schemas.project import ProjectCreate, ProjectRead


router = APIRouter()


@router.get("", response_model=list[ProjectRead])
def list_projects() -> list[ProjectRead]:
    return []


@router.post("", response_model=ProjectRead, status_code=201)
def create_project(payload: ProjectCreate) -> ProjectRead:
    now = datetime.now(UTC)
    return ProjectRead(
        id=uuid4(),
        name=payload.name,
        description=payload.description,
        status=ProjectStatus.DRAFT,
        min_date=payload.min_date,
        max_date=payload.max_date,
        main_version_id=None,
        created_at=now,
        updated_at=now,
    )

