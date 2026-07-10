from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.models.enums import TaskStatus, TaskType


class TaskBase(BaseModel):
    parent_task_id: UUID | None = None
    task_type: TaskType = TaskType.TASK
    name: str = Field(min_length=1, max_length=300)
    description: str | None = None
    start_date: date
    end_date: date
    status: TaskStatus = TaskStatus.TODO
    progress: int = Field(default=0, ge=0, le=100)
    responsible_user_id: UUID | None = None
    sort_order: int = 0
    color: str | None = None
    comment: str | None = None

    @field_validator("end_date")
    @classmethod
    def end_date_must_not_precede_start(cls, end_date: date, info) -> date:
        start_date = info.data.get("start_date")
        if start_date and end_date < start_date:
            raise ValueError("end_date must not be earlier than start_date")
        return end_date


class TaskCreate(TaskBase):
    pass


class TaskUpdate(TaskBase):
    name: str | None = Field(default=None, min_length=1, max_length=300)
    start_date: date | None = None
    end_date: date | None = None


class TaskRead(TaskBase):
    id: UUID
    project_id: UUID
    author_id: UUID
    is_deleted: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

