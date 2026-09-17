import hashlib
import secrets
from datetime import timedelta
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import Event, IssuanceLink
from app.schemas import (
    EventCreate,
    EventCreateResponse,
    EventResponse,
)


router = APIRouter(
    prefix="/api/v1/events",
    tags=["events"],
)


def generate_event_id() -> str:
    return f"evt_{secrets.token_hex(8)}"


def generate_link_id() -> str:
    return f"link_{secrets.token_hex(8)}"


def hash_token(token: str) -> str:
    digest = hashlib.sha256(
        token.encode("utf-8")
    ).hexdigest()

    return f"sha256:{digest}"


@router.post(
    "",
    response_model=EventCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_event(
    request: EventCreate,
    db: Session = Depends(get_db),
):
    event_id = generate_event_id()

    issuance_start = request.ends_at

    issuance_end = (
        issuance_start
        + timedelta(days=request.issuance_valid_days)
    )

    event = Event(
        event_id=event_id,
        title=request.title,
        domain=request.domain,
        issuer_name=request.issuer_name,
        starts_at=request.starts_at,
        ends_at=request.ends_at,
        speaker=request.speaker,
        description=request.description,
        location=request.location,
        cpe_hours=request.cpe_hours,
        issuance_start=issuance_start,
        issuance_end=issuance_end,
        status="active",
    )

    raw_token = secrets.token_urlsafe(32)

    issuance_link = IssuanceLink(
        link_id=generate_link_id(),
        event_id=event_id,
        token_hash=hash_token(raw_token),
        valid_from=issuance_start,
        valid_until=issuance_end,
        status="active",
    )

    try:
        db.add(event)
        db.add(issuance_link)

        db.commit()

        db.refresh(event)

    except Exception:
        db.rollback()
        raise

    base_url = settings.public_base_url.rstrip("/")

    application_url = (
        f"{base_url}/apply"
        f"?token={quote(raw_token, safe='')}"
    )

    return EventCreateResponse(
        event_id=event.event_id,
        title=event.title,
        domain=event.domain,
        issuer_name=event.issuer_name,
        starts_at=event.starts_at,
        ends_at=event.ends_at,
        issuance_start=event.issuance_start,
        issuance_end=event.issuance_end,
        application_url=application_url,
    )


@router.get(
    "/{event_id}",
    response_model=EventResponse,
)
def get_event(
    event_id: str,
    db: Session = Depends(get_db),
):
    event = db.get(
        Event,
        event_id,
    )

    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Event not found",
        )

    return event