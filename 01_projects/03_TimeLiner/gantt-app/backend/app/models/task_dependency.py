import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.enums import DependencyType


class TaskDependency(Base):
    __tablename__ = "task_dependencies"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), index=True)
    source_task_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tasks.id"))
    target_task_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tasks.id"))
    dependency_type: Mapped[DependencyType] = mapped_column(
        Enum(DependencyType),
        default=DependencyType.FINISH_TO_START,
    )
    lag_days: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    project = relationship("Project")
    source_task = relationship("Task", foreign_keys=[source_task_id])
    target_task = relationship("Task", foreign_keys=[target_task_id])

