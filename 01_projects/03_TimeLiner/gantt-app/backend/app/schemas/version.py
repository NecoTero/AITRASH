from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel

from app.models.enums import TaskType, VersionType


class VersionRead(BaseModel):
    id: UUID
    project_id: UUID
    version_number: int
    name: str
    description: str | None
    version_type: VersionType
    is_locked: bool
    is_main: bool
    is_deleted: bool
    purge_after: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class TaskSnapshot(BaseModel):
    original_task_id: UUID
    parent_original_task_id: UUID | None = None
    task_type: TaskType
    name: str
    start_date: date
    end_date: date
    sort_order: int


class TaskComparison(BaseModel):
    original_task_id: UUID
    change_types: list[str]
    source: TaskSnapshot | None
    target: TaskSnapshot | None


class VersionComparison(BaseModel):
    source_version_id: UUID
    target_version_id: UUID
    changes: list[TaskComparison]

