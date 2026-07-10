import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type UIEvent,
  type UIEventHandler,
} from "react";
import { Maximize2 } from "lucide-react";

import { useUiStore } from "../../store/uiStore";
import type { GanttTask, Scale } from "../../types/domain";

const dayMs = 86_400_000;

interface Period {
  start: number;
  end: number;
  label: string;
}

interface HeaderGroup {
  key: string;
  label: string;
  periodCount: number;
}

interface AxisRange {
  start: string;
  end: string;
}

interface FocusAnimation {
  requestId: number;
  phase: "prepare" | "animate" | "finalize";
  oldCenterTime: number;
  targetTime: number;
  finalRange: AxisRange;
}

const periodWidths: Record<Scale, number> = {
  day: 34,
  week: 62,
  month: 92,
  quarter: 152,
  year: 240,
};

const monthFormatter = new Intl.DateTimeFormat("ru-RU", {
  month: "short",
  timeZone: "UTC",
});

const monthYearFormatter = new Intl.DateTimeFormat("ru-RU", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function parseDate(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}

function dateFromOffset(projectStart: string, offset: number): string {
  return new Date(parseDate(projectStart) + offset * dayMs).toISOString().slice(0, 10);
}

function dateFromTime(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function alignStart(value: string, scale: Scale): Date {
  const date = new Date(parseDate(value));
  if (scale === "week") {
    const weekday = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - weekday + 1);
  } else if (scale === "month") {
    date.setUTCDate(1);
  } else if (scale === "quarter") {
    date.setUTCMonth(Math.floor(date.getUTCMonth() / 3) * 3, 1);
  } else if (scale === "year") {
    date.setUTCMonth(0, 1);
  }
  return date;
}

function nextPeriod(date: Date, scale: Scale): Date {
  const next = new Date(date.getTime());
  if (scale === "day") next.setUTCDate(next.getUTCDate() + 1);
  if (scale === "week") next.setUTCDate(next.getUTCDate() + 7);
  if (scale === "month") next.setUTCMonth(next.getUTCMonth() + 1);
  if (scale === "quarter") next.setUTCMonth(next.getUTCMonth() + 3);
  if (scale === "year") next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
}

function periodLabel(date: Date, scale: Scale): string {
  if (scale === "day") return String(date.getUTCDate());
  if (scale === "week") {
    const end = nextPeriod(date, scale);
    end.setUTCDate(end.getUTCDate() - 1);
    return `${date.getUTCDate()}–${end.getUTCDate()}`;
  }
  if (scale === "month") return monthFormatter.format(date);
  if (scale === "quarter") {
    const end = new Date(date.getTime());
    end.setUTCMonth(end.getUTCMonth() + 2);
    return `${monthFormatter.format(date)}–${monthFormatter.format(end)}`;
  }
  return `${date.getUTCFullYear()} г.`;
}

function createPeriods(start: string, end: string, scale: Scale): Period[] {
  const periods: Period[] = [];
  let cursor = alignStart(start, scale);
  const endTime = parseDate(end);

  while (cursor.getTime() <= endTime) {
    const next = nextPeriod(cursor, scale);
    periods.push({ start: cursor.getTime(), end: next.getTime(), label: periodLabel(cursor, scale) });
    cursor = next;
  }
  return periods;
}

function createHeaderGroups(periods: Period[], scale: Scale): HeaderGroup[] {
  return periods.reduce<HeaderGroup[]>((groups, period) => {
    const date = new Date(period.start);
    const isMonthGroup = scale === "day" || scale === "week";
    const key = isMonthGroup
      ? `${date.getUTCFullYear()}-${date.getUTCMonth()}`
      : String(date.getUTCFullYear());
    const label = isMonthGroup ? monthYearFormatter.format(date) : `${date.getUTCFullYear()} г.`;
    const previous = groups[groups.length - 1];

    if (previous?.key === key) {
      previous.periodCount += 1;
    } else {
      groups.push({ key, label, periodCount: 1 });
    }
    return groups;
  }, []);
}

function isWeekend(period: Period): boolean {
  const weekday = new Date(period.start).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function positionForTime(time: number, periods: Period[], periodWidth: number): number {
  const lastPeriod = periods[periods.length - 1];
  if (lastPeriod && time === lastPeriod.end) return periods.length * periodWidth;

  const index = periods.findIndex((period) => time >= period.start && time < period.end);
  if (index < 0) return time < (periods[0]?.start ?? 0) ? 0 : periods.length * periodWidth;
  const period = periods[index];
  const fraction = (time - period.start) / (period.end - period.start);
  return (index + fraction) * periodWidth;
}

function timeForPosition(position: number, periods: Period[], periodWidth: number): number {
  if (!periods.length) return 0;
  const rawIndex = Math.floor(position / periodWidth);
  const index = Math.min(periods.length - 1, Math.max(0, rawIndex));
  const period = periods[index];
  const fraction = Math.min(1, Math.max(0, (position - index * periodWidth) / periodWidth));
  return period.start + fraction * (period.end - period.start);
}

function taskOverlapsRange(task: GanttTask, rangeStart: string, rangeEnd: string): boolean {
  return parseDate(task.startDate) <= parseDate(rangeEnd) && parseDate(task.endDate) >= parseDate(rangeStart);
}

function barStyle(
  task: GanttTask,
  periods: Period[],
  periodWidth: number,
  rangeStart: string,
  rangeEnd: string,
): CSSProperties {
  const start = Math.max(parseDate(task.startDate), parseDate(rangeStart));
  const end = Math.min(parseDate(task.endDate) + dayMs, parseDate(rangeEnd) + dayMs);
  const left = positionForTime(start, periods, periodWidth);
  const right = positionForTime(end, periods, periodWidth);

  return {
    left: `${left}px`,
    width: `${Math.max(12, right - left)}px`,
    backgroundColor: task.color,
  };
}

interface TimelineProps {
  tasks: GanttTask[];
  exitingTaskIds: Set<string>;
  projectStart: string;
  projectEnd: string;
  range: AxisRange;
  onRangeChange: (range: AxisRange) => void;
  onScroll: UIEventHandler<HTMLDivElement>;
}

export const Timeline = forwardRef<HTMLDivElement, TimelineProps>(function Timeline(
  { tasks, exitingTaskIds, projectStart, projectEnd, range, onRangeChange, onScroll },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const focusAnimation = useRef<FocusAnimation | null>(null);
  const animationFrame = useRef<number | null>(null);
  const centerUpdateTimer = useRef<number | null>(null);
  const [axisRange, setAxisRange] = useState<AxisRange>({ start: projectStart, end: projectEnd });
  const rangeStart = range.start;
  const rangeEnd = range.end;
  const scale = useUiStore((state) => state.scale);
  const selectedTaskId = useUiStore((state) => state.selectedTaskId);
  const selectTask = useUiStore((state) => state.selectTask);
  const focusRequest = useUiStore((state) => state.focusRequest);
  const setTimelineCenterTime = useUiStore((state) => state.setTimelineCenterTime);
  const periods = createPeriods(axisRange.start, axisRange.end, scale);
  const hasTwoTierHeader = scale !== "year";
  const headerGroups = hasTwoTierHeader ? createHeaderGroups(periods, scale) : [];
  const periodWidth = periodWidths[scale];
  const timelineWidth = periods.length * periodWidth;
  const domainStart = dateFromTime(Math.min(parseDate(projectStart), parseDate(rangeStart)));
  const domainEnd = dateFromTime(Math.max(parseDate(projectEnd), parseDate(rangeEnd)));
  const totalDays = Math.max(1, Math.round((parseDate(domainEnd) - parseDate(domainStart)) / dayMs));
  const startOffset = Math.round((parseDate(rangeStart) - parseDate(domainStart)) / dayMs);
  const endOffset = Math.round((parseDate(rangeEnd) - parseDate(domainStart)) / dayMs);
  const selectionLeft = (startOffset / totalDays) * 100;
  const selectionWidth = ((endOffset - startOffset) / totalDays) * 100;
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

  useImperativeHandle(ref, () => containerRef.current as HTMLDivElement);

  const visibleTimelineWidth = (container: HTMLDivElement): number => {
    const drawerWidth = selectedTaskId ? Math.min(400, Math.max(0, container.clientWidth - 160)) : 0;
    return container.clientWidth - drawerWidth;
  };

  const cancelFocusAnimation = () => {
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
    animationFrame.current = null;
    focusAnimation.current = null;
  };

  useEffect(() => {
    if (!focusRequest || !containerRef.current) return;

    const task = tasks.find((item) => item.id === focusRequest.taskId);
    if (!task) return;

    cancelFocusAnimation();
    const container = containerRef.current;
    const visibleWidth = visibleTimelineWidth(container);
    const oldCenterTime = timeForPosition(container.scrollLeft + visibleWidth / 2, periods, periodWidth);
    const rangeDays = Math.max(1, Math.round((parseDate(rangeEnd) - parseDate(rangeStart)) / dayMs));
    const nextStart = parseDate(task.startDate) - Math.floor(rangeDays / 2) * dayMs;
    const nextEnd = nextStart + rangeDays * dayMs;
    const nextRangeStart = dateFromTime(nextStart);
    const nextRangeEnd = dateFromTime(nextEnd);

    focusAnimation.current = {
      requestId: focusRequest.requestId,
      phase: "prepare",
      oldCenterTime,
      targetTime: parseDate(task.startDate),
      finalRange: { start: nextRangeStart, end: nextRangeEnd },
    };
    onRangeChange({ start: nextRangeStart, end: nextRangeEnd });
    setAxisRange({
      start: dateFromTime(Math.min(parseDate(axisRange.start), nextStart)),
      end: dateFromTime(Math.max(parseDate(axisRange.end), nextEnd)),
    });
  }, [focusRequest?.requestId]);

  useLayoutEffect(() => {
    const request = focusAnimation.current;
    if (!request || !containerRef.current) return;
    const container = containerRef.current;
    const visibleWidth = visibleTimelineWidth(container);

    if (request.phase === "prepare") {
      const preservedCenter = positionForTime(request.oldCenterTime, periods, periodWidth);
      container.scrollLeft = Math.max(0, preservedCenter - visibleWidth / 2);
      setTimelineCenterTime(request.oldCenterTime);
      request.phase = "animate";

      const startLeft = container.scrollLeft;
      const targetPosition = positionForTime(request.targetTime, periods, periodWidth) - visibleWidth / 2;
      const targetLeft = Math.max(0, Math.min(container.scrollWidth - visibleWidth, targetPosition));
      const duration = 700;
      let startedAt: number | null = null;

      const animate = (timestamp: number) => {
        if (!focusAnimation.current || focusAnimation.current.requestId !== request.requestId) return;
        if (startedAt === null) startedAt = timestamp;
        const progress = Math.min(1, (timestamp - startedAt) / duration);
        const easedProgress = 1 - Math.pow(1 - progress, 3);
        container.scrollLeft = startLeft + (targetLeft - startLeft) * easedProgress;

        if (progress < 1) {
          animationFrame.current = requestAnimationFrame(animate);
        } else {
          animationFrame.current = null;
          request.phase = "finalize";
          setAxisRange({ ...request.finalRange });
        }
      };

      animationFrame.current = requestAnimationFrame(animate);
      return;
    }

    if (request.phase === "finalize") {
      const targetPosition = positionForTime(request.targetTime, periods, periodWidth) - visibleWidth / 2;
      container.scrollLeft = Math.max(0, Math.min(container.scrollWidth - visibleWidth, targetPosition));
      setTimelineCenterTime(request.targetTime);
      focusAnimation.current = null;
    }
  }, [axisRange.end, axisRange.start, periodWidth, timelineWidth]);

  useLayoutEffect(() => {
    if (focusAnimation.current || !containerRef.current) return;
    const container = containerRef.current;
    const centerPosition = container.scrollLeft + visibleTimelineWidth(container) / 2;
    setTimelineCenterTime(timeForPosition(centerPosition, periods, periodWidth));
  }, [axisRange.end, axisRange.start, periodWidth, timelineWidth]);

  useEffect(
    () => () => {
      if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
      if (centerUpdateTimer.current !== null) window.clearTimeout(centerUpdateTimer.current);
    },
    [],
  );

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    onScroll(event);
    if (centerUpdateTimer.current !== null) window.clearTimeout(centerUpdateTimer.current);
    const container = event.currentTarget;
    centerUpdateTimer.current = window.setTimeout(() => {
      const centerPosition = container.scrollLeft + visibleTimelineWidth(container) / 2;
      setTimelineCenterTime(timeForPosition(centerPosition, periods, periodWidth));
    }, 80);
  };

  const changeMinimum = (event: ChangeEvent<HTMLInputElement>) => {
    const nextOffset = Math.min(Number(event.target.value), endOffset);
    const nextStart = dateFromOffset(domainStart, nextOffset);
    cancelFocusAnimation();
    onRangeChange({ start: nextStart, end: rangeEnd });
    setAxisRange({ start: nextStart, end: rangeEnd });
  };

  const changeMaximum = (event: ChangeEvent<HTMLInputElement>) => {
    const nextOffset = Math.max(Number(event.target.value), startOffset);
    const nextEnd = dateFromOffset(domainStart, nextOffset);
    cancelFocusAnimation();
    onRangeChange({ start: rangeStart, end: nextEnd });
    setAxisRange({ start: rangeStart, end: nextEnd });
  };

  const changeStartDate = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.value) {
      cancelFocusAnimation();
      onRangeChange({ start: event.target.value, end: rangeEnd });
      setAxisRange({ start: event.target.value, end: rangeEnd });
    }
  };

  const changeEndDate = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.value) {
      cancelFocusAnimation();
      onRangeChange({ start: rangeStart, end: event.target.value });
      setAxisRange({ start: rangeStart, end: event.target.value });
    }
  };

  const resetRange = () => {
    cancelFocusAnimation();
    onRangeChange({ start: projectStart, end: projectEnd });
    setAxisRange({ start: projectStart, end: projectEnd });
  };

  return (
    <div className="timeline-shell">
      <div className="timeline" onScroll={handleScroll} ref={containerRef}>
        <div
          className={`timeline-header ${hasTwoTierHeader ? "is-two-tier" : ""}`}
          style={{ width: `${timelineWidth}px` }}
        >
          {hasTwoTierHeader ? (
            <>
              <div className="timeline-upper-row">
                {headerGroups.map((group) => (
                  <div className="timeline-upper-cell" key={group.key} style={{ width: `${group.periodCount * periodWidth}px` }}>
                    {group.label}
                  </div>
                ))}
              </div>
              <div className="timeline-lower-row">
                {periods.map((period) => (
                  <div
                    className={`timeline-lower-cell ${scale === "day" && isWeekend(period) ? "is-weekend" : ""}`}
                    key={period.start}
                    style={{ width: `${periodWidth}px` }}
                  >
                    <span className={scale === "day" && period.start === today ? "is-today" : ""}>{period.label}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            periods.map((period) => (
              <div className="timeline-period" key={period.start} style={{ width: `${periodWidth}px` }}>
                {period.label}
              </div>
            ))
          )}
        </div>

        <div className="timeline-body" style={{ width: `${timelineWidth}px` }}>
          {periods.map((period, index) => (
            <div
              className={`timeline-gridline ${scale === "day" && isWeekend(period) ? "is-weekend" : ""}`}
              key={period.start}
              style={{ left: `${index * periodWidth}px`, width: `${periodWidth}px` }}
            />
          ))}
          {tasks.map((task) => {
            const isInAxisRange = taskOverlapsRange(task, axisRange.start, axisRange.end);
            const style = isInAxisRange
              ? barStyle(task, periods, periodWidth, axisRange.start, axisRange.end)
              : undefined;

            return (
              <div
                className={`timeline-task-row ${exitingTaskIds.has(task.id) ? "is-exiting" : ""}`}
                key={task.id}
              >
                {isInAxisRange &&
                  (task.taskType === "milestone" ? (
                    <button
                      aria-label={`Открыть задачу ${task.name}`}
                      className={`milestone ${selectedTaskId === task.id ? "is-selected" : ""}`}
                      data-task-id={task.id}
                      onClick={() => selectTask(task.id)}
                      style={style}
                      title={task.name}
                      type="button"
                    />
                  ) : (
                    <button
                      aria-label={`Открыть задачу ${task.name}`}
                      className={`task-bar ${task.taskType === "summary" ? "is-summary" : ""} ${
                        selectedTaskId === task.id ? "is-selected" : ""
                      }`}
                      data-task-id={task.id}
                      onClick={() => selectTask(task.id)}
                      style={style}
                      title={task.name}
                      type="button"
                    >
                      {task.taskType !== "summary" && <span>{task.progress}%</span>}
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="range-selector">
        <div className="range-slider">
          <div className="range-slider-track" />
          <div className="range-slider-selection" style={{ left: `${selectionLeft}%`, width: `${selectionWidth}%` }} />
          <input
            aria-label="Минимальная дата графика"
            className="range-min"
            max={totalDays}
            min="0"
            onChange={changeMinimum}
            type="range"
            value={startOffset}
          />
          <input
            aria-label="Максимальная дата графика"
            className="range-max"
            max={totalDays}
            min="0"
            onChange={changeMaximum}
            type="range"
            value={endOffset}
          />
        </div>
        <div className="range-values">
          <label>
            <span>MIN</span>
            <input
              max={rangeEnd}
              onChange={changeStartDate}
              type="date"
              value={rangeStart}
            />
          </label>
          <button className="icon-button" onClick={resetRange} title="Показать весь график" type="button">
            <Maximize2 size={15} />
          </button>
          <label>
            <span>MAX</span>
            <input
              min={rangeStart}
              onChange={changeEndDate}
              type="date"
              value={rangeEnd}
            />
          </label>
        </div>
      </div>
    </div>
  );
});
