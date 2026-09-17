import hashlib
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Event, IssuanceLink
from app.schemas import ApplyInfoResponse


router = APIRouter(
    prefix="/api/v1/apply",
    tags=["apply"],
)


def hash_token(token: str) -> str:
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


@router.get("", response_model=ApplyInfoResponse)
def get_apply_info(
    token: str = Query(..., min_length=16),
    db: Session = Depends(get_db),
) -> ApplyInfoResponse:

    token_hash = hash_token(token)

    stmt = (
        select(IssuanceLink, Event)
        .join(Event, Event.event_id == IssuanceLink.event_id)
        .where(IssuanceLink.token_hash == token_hash)
    )

    row = db.execute(stmt).first()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invalid application link",
        )

    link, event = row

    now = datetime.now(timezone.utc)

    if event.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Event is not active",
        )

    if link.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Application link is not active",
        )

    if now < link.valid_from:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Application period has not started",
        )

    if now > link.valid_until:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Application link has expired",
        )

    if now < event.issuance_start:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Certificate issuance has not started",
        )

    if now > event.issuance_end:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Certificate issuance period has ended",
        )

    return ApplyInfoResponse(
        event_id=event.event_id,
        title=event.title,
        domain=event.domain,
        issuer_name=event.issuer_name,
        starts_at=event.starts_at,
        ends_at=event.ends_at,
        speaker=event.speaker,
        description=event.description,
        location=event.location,
        cpe_hours=event.cpe_hours,
        issuance_end=event.issuance_end,
    )