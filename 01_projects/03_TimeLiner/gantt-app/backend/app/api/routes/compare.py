from fastapi import APIRouter


router = APIRouter()


@router.get("")
def compare_versions() -> dict[str, list]:
    return {"changes": []}

