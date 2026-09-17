from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator, model_validator


class EventCreate(BaseModel):
    title: str = Field(
        min_length=1,
        max_length=255,
    )

    domain: str | None = Field(
        default=None,
        max_length=255,
    )

    issuer_name: str = Field(
        default="iPAS 資安證照討論區",
        min_length=1,
        max_length=255,
    )

    starts_at: datetime
    ends_at: datetime

    speaker: str = Field(
        min_length=1,
        max_length=255,
    )

    description: str | None = None
    location: str | None = Field(
        default=None,
        max_length=255,
    )

    cpe_hours: Decimal | None = Field(
        default=None,
        ge=0,
        le=99,
    )

    issuance_valid_days: int = Field(
        default=7,
        ge=1,
        le=90,
    )

    @field_validator(
        "starts_at",
        "ends_at",
    )
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError(
                "datetime must include timezone information"
            )

        return value

    @model_validator(mode="after")
    def validate_times(self):
        if self.ends_at <= self.starts_at:
            raise ValueError(
                "ends_at must be later than starts_at"
            )

        return self


class EventCreateResponse(BaseModel):
    event_id: str
    title: str
    domain: str | None
    issuer_name: str

    starts_at: datetime
    ends_at: datetime

    issuance_start: datetime
    issuance_end: datetime

    application_url: str


class EventResponse(BaseModel):
    event_id: str
    title: str
    domain: str | None
    issuer_name: str

    starts_at: datetime
    ends_at: datetime

    speaker: str
    description: str | None
    location: str | None
    cpe_hours: Decimal | None

    issuance_start: datetime
    issuance_end: datetime

    status: str
    created_at: datetime
    updated_at: datetime

class ApplyInfoResponse(BaseModel):
    event_id: str
    title: str
    domain: str | None
    issuer_name: str

    starts_at: datetime
    ends_at: datetime
    speaker: str
    description: str | None = None
    location: str | None = None
    cpe_hours: Decimal | None = None
    issuance_end: datetime



class CertificateIssueRequest(BaseModel):
    event_id: str
    participant_hash: str


class CertificateIssueResponse(BaseModel):
    version: int
    certificate_id: str
    event_id: str
    participant_hash: str
    issued_at: datetime
    key_id: str
    signature: str

class CertificateEventInfo(BaseModel):
    title: str
    domain: str | None = None
    speaker: str
    cpe_hours: Decimal | None = None
    issuer_name: str
    starts_at: datetime
    ends_at: datetime

class CertificateRegistryResponse(BaseModel):
    version: int = 1
    certificate_id: str
    event_id: str
    participant_hash: str
    issued_at: datetime
    key_id: str
    signature: str
    status: str
    revoked_at: datetime | None = None
    revocation_reason: str | None = None
    
    event: CertificateEventInfo