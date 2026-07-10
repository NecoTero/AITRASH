import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.enums import DependencyType, TaskStatus, TaskType, VersionType


class ProjectVersion(Base):
    __tablename__ = "project_versions"
    __table_args__ = (UniqueConstraint("project_id", "version_number", name="uq_project_version_number"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), index=True)
    version_number: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(240))
    description: Mapped[str | None] = mapped_column(Text)
    version_type: Mapped[VersionType] = mapped_column(Enum(VersionType), default=VersionType.MANUAL)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    is_locked: Mapped[bool] = mapped_column(Boolean, default=True)
    is_main: Mapped[bool] = mapped_column(Boolean, default=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    purge_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    project = relationship("Project", foreign_keys=[project_id])
    creator = relationship("User", foreign_keys=[created_by])


class VersionTask(Base):
    __tablename__ = "version_tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    version_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("project_versions.id"), index=True)
    original_task_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True)
    parent_original_task_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    task_type: Mapped[TaskType] = mapped_column(Enum(TaskType), default=TaskType.TASK)
    name: Mapped[str] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    status: Mapped[TaskStatus] = mapped_column(Enum(TaskStatus), default=TaskStatus.TODO)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    author_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    responsible_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    color: Mapped[str | None] = mapped_column(String(40))

    version = relationship("ProjectVersion")


class VersionDependency(Base):
    __tablename__ = "version_dependencies"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    version_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("project_versions.id"), index=True)
    original_dependency_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True)
    source_original_task_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    target_original_task_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    dependency_type: Mapped[DependencyType] = mapped_column(
        Enum(DependencyType),
        default=DependencyType.FINISH_TO_START,
    )
    lag_days: Mapped[int] = mapped_column(Integer, default=0)

    version = relationship("ProjectVersion")

