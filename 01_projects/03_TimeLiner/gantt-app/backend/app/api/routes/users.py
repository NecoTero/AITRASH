from fastapi import APIRouter


router = APIRouter()


@router.get("/current")
def get_current_user() -> dict[str, str]:
    return {
        "id": "system",
        "display_name": "System User",
        "email": "system@local",
    }

