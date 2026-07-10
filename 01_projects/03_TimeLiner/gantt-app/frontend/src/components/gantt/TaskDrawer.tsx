import { useEffect, useMemo } from "react";
import { CalendarDays, CircleAlert, Diamond, ListTree, X } from "lucide-react";

import { useUiStore } from "../../store/uiStore";
import type { GanttTask } from "../../types/domain";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric" });

function formatDate(value: string | null): string {
  if (!value) return "Нет";
  return dateFormatter.format(new Date(`${value}T00:00:00Z`));
}

const typeLabels = {
  task: "Задача",
  summary: "Суммарная задача",
  milestone: "Веха",
} as const;

export function TaskDrawer({ tasks }: { tasks: GanttTask[] }) {
  const selectedTaskId = useUiStore((state) => state.selectedTaskId);
  const selectTask = useUiStore((state) => state.selectTask);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const task = selectedTaskId ? taskById.get(selectedTaskId) : undefined;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") selectTask(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectTask]);

  if (!task) return null;

  const parent = task.parentTaskId ? taskById.get(task.parentTaskId) : undefined;
  const predecessors = task.predecessors.map((id) => taskById.get(id)).filter((item): item is GanttTask => Boolean(item));

  return (
    <aside className="task-drawer" aria-label="Параметры задачи">
      <div className="drawer-header">
        <div>
          <div className="drawer-kicker">{typeLabels[task.taskType]} · WBS {task.outlineNumber}</div>
          <h2>{task.name}</h2>
        </div>
        <button className="icon-button" onClick={() => selectTask(null)} title="Закрыть" type="button">
          <X size={18} />
        </button>
      </div>

      <div className="drawer-content">
        <div className="progress-heading">
          <span>Выполнение</span>
          <strong>{task.progress}%</strong>
        </div>
        <div className="progress-track">
          <div className="progress-value" style={{ width: `${task.progress}%` }} />
        </div>

        <section className="drawer-section">
          <h3><CalendarDays size={16} /> Сроки</h3>
          <dl className="detail-list">
            <div><dt>Начало</dt><dd>{formatDate(task.startDate)}</dd></div>
            <div><dt>Окончание</dt><dd>{formatDate(task.endDate)}</dd></div>
            <div><dt>Длительность</dt><dd>{task.duration.replace("d", "дн.")}</dd></div>
            <div><dt>Фактическое начало</dt><dd>{formatDate(task.actualStartDate)}</dd></div>
            <div><dt>Фактическое окончание</dt><dd>{formatDate(task.actualEndDate)}</dd></div>
            {task.deadline && <div><dt>Крайний срок</dt><dd>{formatDate(task.deadline)}</dd></div>}
          </dl>
        </section>

        <section className="drawer-section">
          <h3><ListTree size={16} /> Структура</h3>
          <dl className="detail-list">
            <div><dt>Родительская задача</dt><dd>{parent?.name ?? "Корень проекта"}</dd></div>
            <div><dt>Предшественники</dt><dd>{predecessors.length ? predecessors.map((item) => item.name).join(", ") : "Нет"}</dd></div>
          </dl>
        </section>

        <div className="task-flags">
          {task.taskType === "milestone" && <span><Diamond size={14} /> Веха</span>}
          {task.critical && <span className="is-critical"><CircleAlert size={14} /> Критическая задача</span>}
        </div>
      </div>
    </aside>
  );
}
