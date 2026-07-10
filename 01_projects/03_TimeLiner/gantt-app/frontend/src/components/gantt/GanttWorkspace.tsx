import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type UIEvent } from "react";
import { Search, SlidersHorizontal, ZoomIn, ZoomOut } from "lucide-react";

import { useUiStore } from "../../store/uiStore";
import type { GanttTask, ProjectData, Scale } from "../../types/domain";
import { TaskTable } from "./TaskTable";
import { TaskDrawer } from "./TaskDrawer";
import { Timeline } from "./Timeline";

const scales: Scale[] = ["day", "week", "month", "quarter", "year"];

export function GanttWorkspace({ projectData }: { projectData: ProjectData }) {
  const scale = useUiStore((state) => state.scale);
  const setScale = useUiStore((state) => state.setScale);
  const tableWidth = useUiStore((state) => state.tableWidth);
  const setTableWidth = useUiStore((state) => state.setTableWidth);
  const [query, setQuery] = useState("");
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [timelineRange, setTimelineRange] = useState({
    start: projectData.project.startDate,
    end: projectData.project.endDate,
  });
  const [renderedTasks, setRenderedTasks] = useState<GanttTask[]>(projectData.tasks);
  const [exitingTaskIds, setExitingTaskIds] = useState<Set<string>>(new Set());
  const tableRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLElement>(null);
  const resizeState = useRef<{ startX: number; startWidth: number } | null>(null);
  const renderedTasksRef = useRef(renderedTasks);
  const desiredTasksRef = useRef(renderedTasks);
  const exitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const resize = (event: globalThis.PointerEvent) => {
      if (!resizeState.current) return;

      const splitWidth = splitRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      const maxWidth = Math.max(360, splitWidth - 328);
      const nextWidth = resizeState.current.startWidth + event.clientX - resizeState.current.startX;
      setTableWidth(Math.min(maxWidth, Math.max(320, nextWidth)));
    };

    const stopResize = () => {
      if (!resizeState.current) return;
      resizeState.current = null;
      document.body.classList.remove("is-resizing-splitter");
    };

    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
    return () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      document.body.classList.remove("is-resizing-splitter");
    };
  }, [setTableWidth]);

  const visibleTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ru");
    return projectData.tasks.filter((task) => {
      const matchesQuery =
        !normalizedQuery ||
        task.name.toLocaleLowerCase("ru").includes(normalizedQuery) ||
        task.outlineNumber.includes(normalizedQuery);
      const intersectsRange = task.startDate <= timelineRange.end && task.endDate >= timelineRange.start;
      return matchesQuery && intersectsRange && (!criticalOnly || task.critical);
    });
  }, [criticalOnly, projectData.tasks, query, timelineRange.end, timelineRange.start]);

  useEffect(() => {
    desiredTasksRef.current = visibleTasks;
    const desiredIds = new Set(visibleTasks.map((task) => task.id));
    const unionIds = new Set([...renderedTasksRef.current.map((task) => task.id), ...desiredIds]);
    const nextRenderedTasks = projectData.tasks.filter((task) => unionIds.has(task.id));
    const nextExitingIds = new Set(nextRenderedTasks.filter((task) => !desiredIds.has(task.id)).map((task) => task.id));

    renderedTasksRef.current = nextRenderedTasks;
    setRenderedTasks(nextRenderedTasks);
    setExitingTaskIds(nextExitingIds);

    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
    if (nextExitingIds.size > 0) {
      exitTimerRef.current = window.setTimeout(() => {
        renderedTasksRef.current = desiredTasksRef.current;
        setRenderedTasks(desiredTasksRef.current);
        setExitingTaskIds(new Set());
        exitTimerRef.current = null;
      }, 240);
    }

    return () => {
      if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
    };
  }, [projectData.tasks, visibleTasks]);

  const changeScale = (direction: -1 | 1) => {
    const currentIndex = scales.indexOf(scale);
    const nextIndex = Math.min(scales.length - 1, Math.max(0, currentIndex + direction));
    setScale(scales[nextIndex]);
  };

  const syncScroll = (source: "table" | "timeline", event: UIEvent<HTMLDivElement>) => {
    const target = source === "table" ? timelineRef.current : tableRef.current;
    if (target && Math.abs(target.scrollTop - event.currentTarget.scrollTop) > 1) {
      target.scrollTop = event.currentTarget.scrollTop;
    }
  };

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeState.current = { startX: event.clientX, startWidth: tableWidth };
    document.body.classList.add("is-resizing-splitter");
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const splitWidth = splitRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    setTableWidth(Math.min(splitWidth - 328, Math.max(320, tableWidth + direction * 20)));
  };

  return (
    <main className="workspace">
      <section className="toolbar" aria-label="Инструменты графика">
        <div className="search-box">
          <Search size={16} />
          <input
            aria-label="Поиск задач"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти задачу или код WBS"
            value={query}
          />
        </div>
        <button
          className={criticalOnly ? "is-active" : ""}
          onClick={() => setCriticalOnly((value) => !value)}
          type="button"
          title="Показать только критические задачи"
          aria-pressed={criticalOnly}
        >
          <SlidersHorizontal size={16} />
          <span>Критические</span>
        </button>
        <div className="task-count">Показано: {visibleTasks.length} из {projectData.project.taskCount}</div>
        <div className="scale-controls">
          <button type="button" title="Уменьшить масштаб" onClick={() => changeScale(1)} disabled={scale === "year"}>
            <ZoomOut size={16} />
          </button>
          <select value={scale} onChange={(event) => setScale(event.target.value as typeof scale)}>
            <option value="day">Дни</option>
            <option value="week">Недели</option>
            <option value="month">Месяцы</option>
            <option value="quarter">Кварталы</option>
            <option value="year">Годы</option>
          </select>
          <button type="button" title="Увеличить масштаб" onClick={() => changeScale(-1)} disabled={scale === "day"}>
            <ZoomIn size={16} />
          </button>
        </div>
        <div className="save-state">XML загружен</div>
      </section>

      <section
        className="gantt-split"
        ref={splitRef}
        style={{ gridTemplateColumns: `${tableWidth}px 10px minmax(320px, 1fr)` }}
      >
        <TaskTable
          ref={tableRef}
          tasks={renderedTasks}
          exitingTaskIds={exitingTaskIds}
          onScroll={(event) => syncScroll("table", event)}
        />
        <div
          aria-label="Изменить ширину таблицы"
          aria-orientation="vertical"
          aria-valuemax={Math.max(360, (splitRef.current?.clientWidth ?? 1120) - 328)}
          aria-valuemin={320}
          aria-valuenow={Math.round(tableWidth)}
          className="splitter"
          onDoubleClick={() => setTableWidth(520)}
          onKeyDown={resizeWithKeyboard}
          onPointerDown={startResize}
          role="separator"
          tabIndex={0}
          title="Потяните, чтобы изменить ширину таблицы"
        >
          <span />
        </div>
        <Timeline
          ref={timelineRef}
          tasks={renderedTasks}
          exitingTaskIds={exitingTaskIds}
          projectStart={projectData.project.startDate}
          projectEnd={projectData.project.endDate}
          range={timelineRange}
          onRangeChange={setTimelineRange}
          onScroll={(event) => syncScroll("timeline", event)}
        />
      </section>
      {visibleTasks.length === 0 && <div className="empty-state">По заданным условиям задачи не найдены</div>}
      <TaskDrawer tasks={projectData.tasks} />
    </main>
  );
}
