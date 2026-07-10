import { forwardRef, useState, type UIEvent, type UIEventHandler } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, Diamond } from "lucide-react";

import { useUiStore } from "../../store/uiStore";
import type { GanttTask } from "../../types/domain";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });

function formatDate(value: string): string {
  return dateFormatter.format(new Date(`${value}T00:00:00Z`));
}

const statusLabels = {
  todo: "Не начата",
  in_progress: "В работе",
  done: "Готово",
  blocked: "Заблокирована",
} as const;

interface TaskTableProps {
  tasks: GanttTask[];
  exitingTaskIds: Set<string>;
  onScroll: UIEventHandler<HTMLDivElement>;
}

export const TaskTable = forwardRef<HTMLDivElement, TaskTableProps>(function TaskTable(
  { tasks, exitingTaskIds, onScroll },
  ref,
) {
  const selectedTaskId = useUiStore((state) => state.selectedTaskId);
  const selectTask = useUiStore((state) => state.selectTask);
  const focusTask = useUiStore((state) => state.focusTask);
  const timelineCenterTime = useUiStore((state) => state.timelineCenterTime);
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const hoveredTaskIndex = hoveredTaskId ? tasks.findIndex((task) => task.id === hoveredTaskId) : -1;
  const focusButtonTop = 58 + hoveredTaskIndex * 36 - scrollTop + 1;
  const hoveredTask = hoveredTaskIndex >= 0 ? tasks[hoveredTaskIndex] : null;
  const focusMovesLeft = Boolean(
    hoveredTask && timelineCenterTime !== null && Date.parse(`${hoveredTask.startDate}T00:00:00Z`) < timelineCenterTime,
  );

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
    onScroll(event);
  };

  return (
    <div className="task-table-shell" onMouseLeave={() => setHoveredTaskId(null)}>
      <div className="task-table" onScroll={handleScroll} ref={ref}>
        <div className="table-header">
          <div>Задача</div>
          <div>Начало</div>
          <div>Окончание</div>
          <div>Статус</div>
          <div>%</div>
        </div>
        <div className="table-body">
          {tasks.map((task) => (
            <button
              className={`table-row ${selectedTaskId === task.id ? "is-selected" : ""} ${
                exitingTaskIds.has(task.id) ? "is-exiting" : ""
              }`}
              key={task.id}
              onClick={() => selectTask(task.id)}
              onMouseEnter={() => setHoveredTaskId(task.id)}
              type="button"
            >
              <div className="task-name" style={{ paddingLeft: `${task.level * 18 + 8}px` }}>
                {task.taskType === "summary" ? (
                  <ChevronDown size={14} />
                ) : task.taskType === "milestone" ? (
                  <Diamond size={12} />
                ) : (
                  <span className="row-spacer" />
                )}
                <span>{task.name}</span>
              </div>
              <div>{formatDate(task.startDate)}</div>
              <div>{formatDate(task.endDate)}</div>
              <div>{statusLabels[task.status]}</div>
              <div>{task.progress}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="table-footer-spacer" aria-hidden="true" />
      {hoveredTask && exitingTaskIds.size === 0 && focusButtonTop >= 58 && (
        <button
          aria-label={`Центрировать начало задачи ${hoveredTask.name}`}
          className="focus-task-button"
          onClick={() => focusTask(hoveredTask.id)}
          style={{ top: `${focusButtonTop}px` }}
          title={`Перейти ${focusMovesLeft ? "влево" : "вправо"} к началу задачи`}
          type="button"
        >
          {focusMovesLeft ? <ArrowLeft size={17} /> : <ArrowRight size={17} />}
        </button>
      )}
    </div>
  );
});
