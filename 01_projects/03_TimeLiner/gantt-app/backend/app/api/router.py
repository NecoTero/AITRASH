from fastapi import APIRouter

from app.api.routes import audit, compare, drafts, health, projects, settings, tasks, users, versions


api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(projects.router, prefix="/projects", tags=["projects"])
api_router.include_router(tasks.router, prefix="/tasks", tags=["tasks"])
api_router.include_router(drafts.router, prefix="/drafts", tags=["drafts"])
api_router.include_router(versions.router, prefix="/versions", tags=["versions"])
api_router.include_router(compare.router, prefix="/compare", tags=["compare"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(settings.router, prefix="/settings", tags=["settings"])
api_router.include_router(audit.router, prefix="/audit", tags=["audit"])
