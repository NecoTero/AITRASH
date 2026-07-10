import type { ReactNode } from "react";
import { GitCompareArrows, History, Save } from "lucide-react";

export function AppShell({ children, projectName }: { children: ReactNode; projectName: string }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="product-name">TimeLiner</div>
          <div className="project-name" title={projectName}>{projectName}</div>
        </div>
        <nav className="topbar-actions" aria-label="Primary actions">
          <button type="button" title="Сохранение версий будет подключено к API" disabled>
            <Save size={16} />
            <span>Сохранить версию</span>
          </button>
          <button type="button" title="История версий будет подключена к API" disabled>
            <History size={16} />
            <span>Версии</span>
          </button>
          <button type="button" title="Сравнение версий будет подключено к API" disabled>
            <GitCompareArrows size={16} />
            <span>Сравнить</span>
          </button>
        </nav>
      </header>
      {children}
    </div>
  );
}
