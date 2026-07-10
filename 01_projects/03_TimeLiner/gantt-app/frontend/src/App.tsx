import { AppShell } from "./components/layout/AppShell";
import { GanttWorkspace } from "./components/gantt/GanttWorkspace";
import importedProjectData from "./data/projectData.json";
import type { ProjectData } from "./types/domain";

const projectData = importedProjectData as ProjectData;

export function App() {
  return (
    <AppShell projectName={projectData.tasks[0]?.name ?? projectData.project.name}>
      <GanttWorkspace projectData={projectData} />
    </AppShell>
  );
}
