# TimeLiner Gantt MVP

Current Russian technical documentation: [docs/TECHNICAL_DOCUMENTATION.md](docs/TECHNICAL_DOCUMENTATION.md).

Internal server web app for project schedules with a task table, Gantt timeline,
drafts, immutable versions, and static version comparison.

## Stack

- Frontend: React, TypeScript, Vite, TanStack Query, Zustand.
- Backend: Python, FastAPI, SQLAlchemy, Alembic, Pydantic.
- Database: PostgreSQL.
- Local orchestration: Docker Compose.

## Local Ports

- Frontend: http://localhost:5173
- Backend: http://localhost:8000
- PostgreSQL: localhost:5432

## Quick Start

Start the complete local stand from this directory:

```powershell
docker compose up -d --build
```

Open http://127.0.0.1:5173. Stop the stand with:

```powershell
docker compose down
```

## Local Commands

Backend on PowerShell:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
alembic revision --autogenerate -m "initial schema"
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

Backend on bash:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
alembic revision --autogenerate -m "initial schema"
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## MVP Scope

- Create and edit projects.
- Create, edit, delete, nest, and reorder tasks.
- Display a synchronized task table and Gantt timeline.
- Store an autosaved user draft separately from immutable versions.
- Save draft as a new main version.
- View version history, soft-delete, and restore versions.
- Compare two versions on the backend.
- Show static visual comparison for added, deleted, moved, and rescheduled tasks.

## MS Project Import

The current stand is populated from the Microsoft Project XML export stored next
to this app. To regenerate the frontend fixture from another XML export, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\import-msproject.ps1 `
  -InputPath "C:\path\schedule.xml" `
  -OutputPath ".\frontend\src\data\projectData.json"
```

The importer preserves task hierarchy, dates, duration, progress, milestones,
critical flags, actual dates, deadlines, and predecessor links.

## Current State

The stand renders the imported M. Tulskaya schedule with 528 tasks. Table rows,
timeline bars, and milestones open a task detail drawer. Search, critical-task
filtering, zoom levels, and synchronized vertical scrolling are available.
Version controls remain disabled until the frontend is connected to the existing
version API.
