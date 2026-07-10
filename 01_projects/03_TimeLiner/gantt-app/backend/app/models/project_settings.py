import uuid

from sqlalchemy import ForeignKey, Integer, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class ProjectSettings(Base):
    __tablename__ = "project_settings"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id"),
        primary_key=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    table_width: Mapped[int] = mapped_column(Integer, default=520)
    column_widths: Mapped[dict] = mapped_column(JSON, default=dict)
    active_filters: Mapped[dict] = mapped_column(JSON, default=dict)
    timeline_state: Mapped[dict] = mapped_column(JSON, default=dict)

    project = relationship("Project")
    user = relationship("User")

