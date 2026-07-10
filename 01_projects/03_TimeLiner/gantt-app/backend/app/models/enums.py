from enum import StrEnum


class ProjectStatus(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    COMPLETED = "completed"
    ARCHIVED = "archived"


class TaskType(StrEnum):
    TASK = "task"
    SUMMARY = "summary"
    MILESTONE = "milestone"


class TaskStatus(StrEnum):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    DONE = "done"
    BLOCKED = "blocked"


class DependencyType(StrEnum):
    FINISH_TO_START = "finish_to_start"


class VersionType(StrEnum):
    MANUAL = "manual"
    AUTOMATIC = "automatic"
    BASELINE = "baseline"
    IMPORTED = "imported"


class AuditAction(StrEnum):
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    RESTORE = "restore"
    IMPORT = "import"
    CREATE_VERSION = "create_version"

