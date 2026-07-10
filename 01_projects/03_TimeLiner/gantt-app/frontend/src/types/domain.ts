export type TaskType = "task" | "summary" | "milestone";
export type TaskStatus = "todo" | "in_progress" | "done" | "blocked";
export type Scale = "day" | "week" | "month" | "quarter" | "year";

export interface GanttTask {
  id: string;
  parentTaskId: string | null;
  taskType: TaskType;
  name: string;
  startDate: string;
  endDate: string;
  actualStartDate: string | null;
  actualEndDate: string | null;
  deadline: string | null;
  status: TaskStatus;
  progress: number;
  sortOrder: number;
  level: number;
  outlineNumber: string;
  duration: string;
  critical: boolean;
  predecessors: string[];
  color: string;
}

export interface GanttProject {
  name: string;
  startDate: string;
  endDate: string;
  taskCount: number;
}

export interface ProjectData {
  project: GanttProject;
  tasks: GanttTask[];
}

export interface VisibleRow {
  task: GanttTask;
  top: number;
  height: number;
}
