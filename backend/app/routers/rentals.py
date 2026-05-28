# 대여 라우터 (HTTP 입출력만; 비즈니스 로직은 services로 위임)
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import current_user
from app.db import get_db
from app.models.asset import Asset
from app.models.rental import Rental
from app.services import rental_service

router = APIRouter(prefix="/rentals", tags=["rentals"])

MAX_EXTEND_DAYS = 14


class RentalCreate(BaseModel):
    asset_id: int


class RentalExtend(BaseModel):
    extra_days: int = 7


class RentalOut(BaseModel):
    id: int
    asset_id: int
    user_id: str
    started_at: datetime
    due_at: datetime
    returned_at: datetime | None

    class Config:
        from_attributes = True


@router.post("", response_model=RentalOut, status_code=status.HTTP_201_CREATED)
def create_rental(
    payload: RentalCreate,
    db: Session = Depends(get_db),
    user_id: str = Depends(current_user),
) -> RentalOut:
    try:
        rental = rental_service.create_rental(db, payload.asset_id, user_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return rental  # type: ignore[return-value]


@router.get("/mine", response_model=list[RentalOut])
def list_my_rentals(
    db: Session = Depends(get_db),
    user_id: str = Depends(current_user),
) -> list[RentalOut]:
    return rental_service.list_user_rentals(db, user_id)  # type: ignore[return-value]


@router.patch("/{rental_id}/return", response_model=RentalOut)
def return_rental(
    rental_id: int,
    db: Session = Depends(get_db),
    user_id: str = Depends(current_user),
) -> RentalOut:
    rental = db.get(Rental, rental_id)
    if rental is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="rental_not_found")
    if rental.returned_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="already_returned")

    rental.returned_at = datetime.now(UTC)
    asset = db.get(Asset, rental.asset_id)
    if asset is not None:
        asset.status = "available"
    db.commit()
    db.refresh(rental)
    return rental  # type: ignore[return-value]


@router.patch("/{rental_id}/extend", response_model=RentalOut)
def extend_rental(
    rental_id: int,
    payload: RentalExtend,
    db: Session = Depends(get_db),
    user_id: str = Depends(current_user),
) -> RentalOut:
    rental = db.get(Rental, rental_id)
    if rental is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="rental_not_found")
    if rental.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not_your_rental")
    if rental.returned_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="already_returned")

    extended_days = (rental.due_at - rental.started_at).days + payload.extra_days
    if extended_days > MAX_EXTEND_DAYS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="extend_limit_exceeded")

    rental.due_at = rental.due_at + timedelta(days=payload.extra_days)
    db.commit()
    db.refresh(rental)
    return rental  # type: ignore[return-value]
