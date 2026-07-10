from fastapi import APIRouter


router = APIRouter()


@router.get("")
def list_versions() -> list[dict]:
    return []

