# 자산 조회 라우터 (HTTP 입출력만 담당)
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.asset import Asset
from app.models.rental import Rental

router = APIRouter(prefix="/assets", tags=["assets"])


class AssetOut(BaseModel):
    id: int
    name: str
    asset_type: str
    status: str

    class Config:
        from_attributes = True


class AssetWithAvailability(BaseModel):
    id: int
    name: str
    asset_type: str
    status: str
    is_available_now: bool
    next_available_at: str | None


@router.get("", response_model=list[AssetOut])
def list_assets(db: Session = Depends(get_db)) -> list[Asset]:
    return db.query(Asset).order_by(Asset.id).all()


@router.get("/{asset_id}", response_model=AssetOut)
def get_asset(asset_id: int, db: Session = Depends(get_db)) -> Asset:
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="asset_not_found")
    return asset


@router.get("/availability/all", response_model=list[AssetWithAvailability])
def list_assets_with_availability(db: Session = Depends(get_db)) -> list[AssetWithAvailability]:
    assets = db.query(Asset).order_by(Asset.id).all()
    results: list[AssetWithAvailability] = []
    for asset in assets:
        active_rental = (
            db.query(Rental)
            .filter(Rental.asset_id == asset.id, Rental.returned_at.is_(None))
            .first()
        )
        results.append(
            AssetWithAvailability(
                id=asset.id,
                name=asset.name,
                asset_type=asset.asset_type,
                status=asset.status,
                is_available_now=active_rental is None and asset.status == "available",
                next_available_at=active_rental.due_at.isoformat() if active_rental else None,
            )
        )
    return results
