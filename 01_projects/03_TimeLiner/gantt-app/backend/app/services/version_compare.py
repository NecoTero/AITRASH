from uuid import UUID

from app.schemas.version import TaskComparison, TaskSnapshot, VersionComparison


def compare_task_snapshots(
    source_version_id: UUID,
    target_version_id: UUID,
    source_tasks: list[TaskSnapshot],
    target_tasks: list[TaskSnapshot],
) -> VersionComparison:
    source_by_id = {task.original_task_id: task for task in source_tasks}
    target_by_id = {task.original_task_id: task for task in target_tasks}
    all_task_ids = sorted(source_by_id.keys() | target_by_id.keys(), key=str)
    changes: list[TaskComparison] = []

    for task_id in all_task_ids:
        source = source_by_id.get(task_id)
        target = target_by_id.get(task_id)
        change_types: list[str] = []

        if source is None and target is not None:
            change_types.append("added")
        elif source is not None and target is None:
            change_types.append("deleted")
        elif source is not None and target is not None:
            if source.start_date != target.start_date or source.end_date != target.end_date:
                change_types.append("date_changed")
            if source.sort_order != target.sort_order:
                change_types.append("order_changed")
            if source.parent_original_task_id != target.parent_original_task_id:
                change_types.append("parent_changed")
            if source.name != target.name:
                change_types.append("name_changed")

        if change_types:
            changes.append(
                TaskComparison(
                    original_task_id=task_id,
                    change_types=change_types,
                    source=source,
                    target=target,
                )
            )

    return VersionComparison(
        source_version_id=source_version_id,
        target_version_id=target_version_id,
        changes=changes,
    )

