from datetime import date
from uuid import uuid4

from app.models.enums import TaskType
from app.schemas.version import TaskSnapshot
from app.services.version_compare import compare_task_snapshots


def test_compare_groups_multiple_changes_for_one_task() -> None:
    source_version_id = uuid4()
    target_version_id = uuid4()
    task_id = uuid4()
    old_parent_id = uuid4()
    new_parent_id = uuid4()

    source = TaskSnapshot(
        original_task_id=task_id,
        parent_original_task_id=old_parent_id,
        task_type=TaskType.TASK,
        name="Design",
        start_date=date(2026, 7, 10),
        end_date=date(2026, 7, 12),
        sort_order=1,
    )
    target = TaskSnapshot(
        original_task_id=task_id,
        parent_original_task_id=new_parent_id,
        task_type=TaskType.TASK,
        name="Design",
        start_date=date(2026, 7, 11),
        end_date=date(2026, 7, 15),
        sort_order=4,
    )

    result = compare_task_snapshots(source_version_id, target_version_id, [source], [target])

    assert len(result.changes) == 1
    assert set(result.changes[0].change_types) == {
        "date_changed",
        "order_changed",
        "parent_changed",
    }

