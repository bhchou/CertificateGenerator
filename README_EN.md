# Participation Certificate Generator

A privacy-minimizing participation-certificate issuance and verification
service.

## Status

**Certificate Signing Protocol: v1 --- FROZEN**

Protocol v1 was functionally closed after production-path happy-path,
negative-path, revocation, authorization, and security-boundary testing
on 2026-09-17.

Changes to canonicalization, participant-hash construction,
signed-message serialization, signature algorithm, field ordering, or
wire encoding require a new protocol version. They MUST NOT be silently
changed under v1.

## Architecture

``` text
Participant Browser
  │
  ├─ participant_name
  ├─ certification_member_id
  └─ meet_display_name
          │
          ▼
  Canonicalize + SHA-256
          │
          │ event_id + participant_hash only
          ▼
Public HTTPS / Traefik / Coraza WAF
          │
          ▼
FastAPI certificate-generator
          │
          ├─ Ed25519 signing key ← Kubernetes Secret
          │
          └─ PostgreSQL ← ClusterIP only
                              │
                              └─ Adminer access via Tailnet only
```

PDF generation and participant-data processing occur client-side.

## Certificate Signing Protocol v1

### Participant canonicalization

Each participant field is canonicalized independently:

1.  Unicode NFKC normalization.
2.  Trim leading and trailing Unicode whitespace.
3.  Collapse consecutive Unicode whitespace to ASCII space (`U+0020`).
4.  Do not perform lowercase, uppercase, or case folding.

Fields are `participant_name`, `certification_member_id`, and
`meet_display_name`.

### Participant hash

Exact UTF-8 preimage:

``` text
PCG-PARTICIPANT-V1
event_id=<event_id>
participant_name=<canonical participant_name>
certification_member_id=<canonical certification_member_id>
meet_display_name=<canonical meet_display_name>
```

Use UTF-8, LF only, fixed field order, and no trailing LF. Hash with
SHA-256.

Wire representation:

``` text
sha256:<64 lowercase hexadecimal characters>
```

`event_id` is intentionally included so the same participant produces
different identifiers across events, reducing cross-event correlation.

### Signed certificate message

``` text
PCG-CERTIFICATE-V1
version=1
certificate_id=<certificate_id>
event_id=<event_id>
participant_hash=<participant_hash>
issued_at=<issued_at>
key_id=<key_id>
```

Use UTF-8, LF only, fixed field order, and no trailing LF.

Sign the message directly with Ed25519; do not pre-hash it before
Ed25519 signing. Signature encoding is Base64URL without `=` padding.

`key_id` selects a trusted key; it is not itself a trust source.

## Identifiers and timestamps

``` text
event_id:       ^evt_[a-z0-9_-]{3,64}$
certificate_id: ^cert_[0-9A-HJKMNP-TV-Z]{26}$
```

Certificate IDs use CSPRNG-derived 128-bit values encoded with Crockford
Base32.

`issued_at` is UTC RFC3339 with second precision and no milliseconds.

## Issuance API

``` http
POST /api/v1/certificates
Authorization: Bearer <issuance-token>
Content-Type: application/json
```

Request:

``` json
{
  "event_id": "evt_...",
  "participant_hash": "sha256:..."
}
```

The backend does not require participant name, certification member ID,
Meet display name, or email.

Backend authorization enforces token validity/status, token/event
binding, and issuance validity window. Raw issuance tokens are not
stored; only token hashes are retained. Frontend controls are UX
controls, not security boundaries.

## Idempotency

The certificate registry enforces:

``` sql
UNIQUE (event_id, participant_hash)
```

Repeated issuance for the same event and canonical participant identity
returns the same certificate rather than creating duplicates.

## Verification and trust model

Verification has two independent controls.

**Cryptographic verification:** reconstruct the protocol-v1 message,
select a built-in trusted public key using `key_id`, and verify the
Ed25519 signature. The QR payload does not provide an authoritative
public key.

**Registry verification:** check certificate existence, matching
registry metadata, certificate status, and revocation state.

A cryptographically valid certificate may still be operationally invalid
if revoked.

The verification URL carries signed certificate data in the URL
fragment.

## Revocation

Registry status supports at least `valid` and `revoked`, with optional
`revoked_at` and revocation reason.

An original PDF/QR for a subsequently revoked certificate retains its
historical valid signature, while online verification reports the
certificate as revoked.

## Event metadata

Event metadata is authoritative from the event registry referenced by
signed `event_id`.

Typical metadata includes title, description, start/end time, speaker,
domain, issuer, CPE hours, issuance start/end, and status.

Use a short stable **Title** and an optional subtitle/course
**Description**.

## Privacy design

Participant PII is processed in the participant's browser.

The backend/database does not intentionally store participant name,
certification member ID, Meet display name, or participant email. The
registry stores an event-scoped SHA-256 `participant_hash`.

`participant_hash` MUST be treated as **pseudonymised data**, not
assumed to be anonymous data.

The design applies data minimisation by avoiding transmission and
storage of original participant identity fields. Event scoping reduces
cross-event correlation.

This document describes technical controls and design considerations. It
does **not** claim third-party certification or legal certification of
compliance with Taiwan's Personal Data Protection Act, GDPR, or other
laws.

## Signing-key security

The Ed25519 signing private key:

-   is not stored in tracked Git files;
-   is not stored in the application filesystem;
-   is injected at runtime from Kubernetes Secret
    `certificate-signing-key`;
-   is referenced through `secretKeyRef`;
-   is not readable through the workload ServiceAccount's Kubernetes API
    permissions.

The workload sets:

``` yaml
automountServiceAccountToken: false
```

The signing Secret contains `KEY_ID`, `PRIVATE_KEY_B64`, and
`PUBLIC_KEY_B64`. Only the private key is confidential.

### Residual risk

A sufficiently privileged Kubernetes administrator or principal with
Secret/workload/exec access may obtain runtime secret material. If
higher assurance is required, move signing-key custody/signing to OCI
Vault/KMS or an equivalent managed signing facility.

## Database credential security

Database credentials are supplied through the separate Kubernetes Secret
`certificate-db`. Git contains only the Secret reference, not credential
material. Signing-key material and DB credentials are separated.

## Network exposure

``` text
Internet
   │
   ▼
Traefik + Coraza WAF
   │
   ▼
certificate-generator
   │
   └─ PostgreSQL
        Service type: ClusterIP
        External IP: none
```

Administrative DB access through Adminer is private via
Tailscale/Tailnet rather than public application ingress.

## API documentation

`ENABLE_API_DOCS` is disabled/unset by default. When disabled:

``` text
/docs         → HTTP 404
/openapi.json → HTTP 404
```

It must be explicitly enabled when API documentation is required. This
is attack-surface reduction, not authorization.

## Error handling

Production negative-path testing found no Python stack traces,
filesystem paths, SQL statements, DB implementation details, environment
variables, or secret values in tested error responses.

FastAPI/Pydantic validation responses may echo invalid request values.
This is accepted for v1 because the issuance API is intentionally
limited to `event_id` and `participant_hash`; reassess if future APIs
accept sensitive fields.

## Security and functional closing evidence

  -----------------------------------------------------------------------
  Test                                Result
  ----------------------------------- -----------------------------------
  Issuance before validity window     PASS --- HTTP 403

  Invalid issuance token              PASS --- HTTP 403

  Valid token used for another event  PASS --- HTTP 403

  Issuance after window opens         PASS

  PDF generation                      PASS

  Original QR verification            PASS

  Malformed verification fragment     PASS --- rejected

  Signed payload modified, signature  PASS --- signature INVALID
  unchanged                           

  Unknown certificate ID              PASS --- HTTP 404

  Revoked certificate                 PASS --- REVOKED

  Same event + same participant hash  PASS --- same certificate

  Workload SA reads signing Secret    PASS --- RBAC denied

  ServiceAccount token automount      PASS --- disabled

  `/health` after hardening           PASS --- HTTP 200

  `/health/db` after hardening        PASS --- HTTP 200

  `/docs` disabled                    PASS --- HTTP 404

  `/openapi.json` disabled            PASS --- HTTP 404

  PostgreSQL public exposure          PASS --- ClusterIP only
  -----------------------------------------------------------------------

## Certificate notice

Certificates state that participant information is self-reported and
that the certificate confirms participation only; it does not represent
issuer verification of participant identity, qualifications, or other
personal data.

## Event creation authorization --- planned

Preferred minimal-entropy design: a short-lived opaque **Create Token**
rather than a maintained login/account system.

Proposed properties:

-   256-bit CSPRNG opaque bearer token
-   default validity: 7 days
-   reusable during validity period
-   may create multiple events
-   server stores only SHA-256 token hash
-   revocable
-   separate capability from certificate issuance tokens
-   server-side authorization on event creation
-   optional non-security label for operational attribution

Possession grants event-creation capability during validity. A web
account/password/session system remains out of scope unless requirements
change.

## Event application QR --- planned

Event creation should provide the application URL, copy-URL action, QR
containing the same application URL, and downloadable QR PNG for
insertion into slides.

The QR represents the issuance bearer URL; practical exposure is bounded
by server-side event binding and issuance validity.

## Deployment

Current stack:

-   FastAPI
-   PostgreSQL
-   Alembic
-   Kubernetes / OCI OKE
-   Traefik
-   Coraza WAF
-   Argo CD / GitOps
-   GitLab CI
-   Ed25519 via Python `cryptography`

Production application images use explicit version tags rather than
`latest`.

## Operational handover

When taking over or restoring this service, verify at minimum:

1.  PostgreSQL is healthy and not publicly exposed.
2.  `certificate-db` exists outside Git with valid DB credentials.
3.  `certificate-signing-key` exists outside Git with the expected
    `KEY_ID`.
4.  The private signing key is not committed to source control or baked
    into the image.
5.  The verifier trusts the public key corresponding to the active
    `key_id`.
6.  `automountServiceAccountToken` remains `false`.
7.  `/docs` and `/openapi.json` remain disabled unless explicitly
    required.
8.  Issuance-token expiry and event binding remain backend-enforced.
9.  Revocation remains part of online verification.
10. Backup/restoration procedures are maintained for registry/event
    data.

## Protocol freeze rule

**Certificate Signing Protocol v1 is frozen.**

The following require protocol-version review and normally a version
increment:

-   canonicalization changes
-   participant-hash preimage changes
-   signed-message field changes
-   signed-message field-order changes
-   serialization/newline changes
-   signature algorithm changes
-   signature encoding changes
-   trust-model changes that alter verification semantics

UI styling, PDF layout, event metadata presentation, deployment
hardening, and operational tooling may evolve without changing protocol
v1 provided they do not alter signed semantics.

## TODO

-   Implement short-lived reusable Event Create Token authorization.
-   Add downloadable application QR PNG on event creation.
-   Add SAST to the GitLab CI loop.
-   Define/automate production vs test signing-key separation if a
    persistent test environment is introduced.
-   Define backup/restore runbook and periodically test restoration.
-   Consider OCI Vault/KMS if signing-key assurance requirements
    increase.

PDF visual refinements are optional and are not a protocol-v1 closing
requirement.

------------------------------------------------------------------------

**Protocol:** PCG Certificate Signing Protocol v1\
**State:** FROZEN\
**Freeze date:** 2026-09-17

## License

Source code in this repository is licensed under the [MIT License](LICENSE).
Unless explicitly stated otherwise, this license does not cover course materials,
presentation slides, trademarks, logos, or other content outside this repository.