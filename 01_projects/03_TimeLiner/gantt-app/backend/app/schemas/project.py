from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.models.enums import ProjectStatus


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=240)
    description: str | None = None
    min_date: date
    max_date: date

    @field_validator("max_date")
    @classmethod
    def max_date_must_not_precede_min(cls, max_date: date, info) -> date:
        min_date = info.data.get("min_date")
        if min_date and max_date < min_date:
            raise ValueError("max_date must not be earlier than min_date")
        return max_date


class ProjectRead(BaseModel):
    id: UUID
    name: str
    description: str | None
    status: ProjectStatus
    min_date: date
    max_date: date
    main_version_id: UUID | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

