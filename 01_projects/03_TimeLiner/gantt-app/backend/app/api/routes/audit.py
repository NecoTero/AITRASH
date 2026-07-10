from fastapi import APIRouter


router = APIRouter()


@router.get("")
def list_audit_entries() -> list[dict]:
    return []

