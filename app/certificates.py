import base64
import hashlib
import os
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from .db import get_db
from .models import Certificate, Event, IssuanceLink
from .schemas import CertificateIssueRequest, CertificateIssueResponse, CertificateRegistryResponse, CertificateEventInfo


router = APIRouter(
    prefix="/api/v1/certificates",
    tags=["certificates"],
)


SIGNING_KEY_ID = os.environ["SIGNING_KEY_ID"]
SIGNING_PRIVATE_KEY_B64 = os.environ["SIGNING_PRIVATE_KEY_B64"]

_private_key = Ed25519PrivateKey.from_private_bytes(
    base64.b64decode(SIGNING_PRIVATE_KEY_B64)
)


def hash_token(token: str) -> str:
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def base64url_no_padding(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def generate_certificate_id() -> str:
    # 128-bit random value
    raw = secrets.token_bytes(16)
    alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    value = int.from_bytes(raw, "big")
    chars = []

    # 128 bits → 26 Crockford Base32 chars
    for _ in range(26):
        chars.append(alphabet[value & 31])
        value >>= 5

    return "cert_" + "".join(reversed(chars))


def build_signing_message(
    certificate_id: str,
    event_id: str,
    participant_hash: str,
    issued_at: str,
    key_id: str,
) -> str:

    return (
        "PCG-CERTIFICATE-V1\n"
        "version=1\n"
        f"certificate_id={certificate_id}\n"
        f"event_id={event_id}\n"
        f"participant_hash={participant_hash}\n"
        f"issued_at={issued_at}\n"
        f"key_id={key_id}"
    )


@router.post("", response_model=CertificateIssueResponse)
def issue_certificate(
    body: CertificateIssueRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):

    #
    # 1. Bearer token
    #
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing bearer token",
        )

    token = authorization.removeprefix("Bearer ").strip()

    if not token:
        raise HTTPException(
            status_code=401,
            detail="Invalid bearer token",
        )

    token_hash = hash_token(token)

    #
    # 2. Validate issuance link + event
    #
    stmt = (
        select(IssuanceLink, Event)
        .join(Event, IssuanceLink.event_id == Event.event_id)
        .where(IssuanceLink.token_hash == token_hash)
    )

    result = db.execute(stmt).first()

    if not result:
        raise HTTPException(
            status_code=403,
            detail="Invalid application token",
        )

    link, event = result

    now = datetime.now(timezone.utc)

    if link.event_id != body.event_id:
        raise HTTPException(
            status_code=403,
            detail="Token does not belong to this event",
        )

    if event.status != "active":
        raise HTTPException(
            status_code=403,
            detail="Event is not active",
        )

    if link.status != "active":
        raise HTTPException(
            status_code=403,
            detail="Application link is not active",
        )

    if now < link.valid_from or now > link.valid_until:
        raise HTTPException(
            status_code=403,
            detail="Application link is outside its validity period",
        )

    if now < event.issuance_start or now > event.issuance_end:
        raise HTTPException(
            status_code=403,
            detail="Certificate issuance period is closed",
        )

    #
    # 3. Validate participant_hash
    #
    if (
        not body.participant_hash.startswith("sha256:")
        or len(body.participant_hash) != 71
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid participant_hash",
        )

    hex_part = body.participant_hash[7:]

    if any(c not in "0123456789abcdef" for c in hex_part):
        raise HTTPException(
            status_code=400,
            detail="Invalid participant_hash",
        )

    #
    # 4. Idempotency
    #
    existing = db.execute(
        select(Certificate).where(
            Certificate.event_id == body.event_id,
            Certificate.participant_hash == body.participant_hash,
        )
    ).scalar_one_or_none()

    if existing:
        return CertificateIssueResponse(
            version=1,
            certificate_id=existing.certificate_id,
            event_id=existing.event_id,
            participant_hash=existing.participant_hash,
            issued_at=existing.issued_at,
            key_id=existing.key_id,
            signature=existing.signature,
        )

    #
    # 5. Generate certificate
    #
    certificate_id = generate_certificate_id()

    issued_at_dt = datetime.now(timezone.utc).replace(microsecond=0)

    issued_at_text = (
        issued_at_dt
        .isoformat()
        .replace("+00:00", "Z")
    )

    message = build_signing_message(
        certificate_id=certificate_id,
        event_id=body.event_id,
        participant_hash=body.participant_hash,
        issued_at=issued_at_text,
        key_id=SIGNING_KEY_ID,
    )

    signature_bytes = _private_key.sign(
        message.encode("utf-8")
    )

    signature = base64url_no_padding(signature_bytes)

    #
    # 6. Store registry record
    #
    certificate = Certificate(
        certificate_id=certificate_id,
        event_id=body.event_id,
        participant_hash=body.participant_hash,
        issued_at=issued_at_dt,
        key_id=SIGNING_KEY_ID,
        signature=signature,
        status="valid",
    )

    db.add(certificate)
    db.commit()
    db.refresh(certificate)

    return CertificateIssueResponse(
        version=1,
        certificate_id=certificate.certificate_id,
        event_id=certificate.event_id,
        participant_hash=certificate.participant_hash,
        issued_at=certificate.issued_at,
        key_id=certificate.key_id,
        signature=certificate.signature,
    )

@router.get(
    "/{certificate_id}",
    response_model=CertificateRegistryResponse,
)

def get_certificate(
    certificate_id: str,
    db: Session = Depends(get_db),
):
    result = db.execute(
        select(Certificate, Event)
        .join(
            Event,
            Event.event_id == Certificate.event_id,
        )
        .where(
            Certificate.certificate_id == certificate_id
        )
    ).one_or_none()

    if result is None:
        raise HTTPException(
            status_code=404,
            detail="Certificate not found",
        )

    certificate, event = result

    return CertificateRegistryResponse(
        version=1,
        certificate_id=certificate.certificate_id,
        event_id=certificate.event_id,
        participant_hash=certificate.participant_hash,
        issued_at=certificate.issued_at,
        key_id=certificate.key_id,
        signature=certificate.signature,
        status=certificate.status,
        revoked_at=certificate.revoked_at,
        revocation_reason=certificate.revocation_reason,
        event=CertificateEventInfo(
            title=event.title,
            domain=event.domain,
            speaker=event.speaker,
            cpe_hours=event.cpe_hours,
            issuer_name=event.issuer_name,
            starts_at=event.starts_at,
            ends_at=event.ends_at,
        ),
    )