const TRUSTED_KEYS = {
  "ed25519-IPAS-2026-09-14":
    "2PPiJ+uv+tHLGi69UlWXPMC1Ox2BCYWjaE+pjAARQKE="
};

function setStatus(text, cssClass) {
  const el = document.getElementById("status");

  el.textContent = text;
  el.className = "status " + cssClass;
}


function decodeBase64Url(value) {

  let base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  while (base64.length % 4) {
    base64 += "=";
  }

  const binary = atob(base64);

  const bytes = Uint8Array.from(
    binary,
    c => c.charCodeAt(0)
  );

  return new TextDecoder().decode(bytes);
}

function decodeBase64(value) {

  const binary = atob(value);

  return Uint8Array.from(
    binary,
    c => c.charCodeAt(0)
  );
}

function decodeBase64UrlToBytes(value) {

  let base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  while (base64.length % 4) {
    base64 += "=";
  }

  const binary = atob(base64);

  return Uint8Array.from(
    binary,
    c => c.charCodeAt(0)
  );
}

function buildSigningMessage(payload) {

  return (
    "PCG-CERTIFICATE-V1\n" +
    "version=1\n" +
    "certificate_id=" + payload.cid + "\n" +
    "event_id=" + payload.eid + "\n" +
    "participant_hash=" + payload.ph + "\n" +
    "issued_at=" + payload.iat + "\n" +
    "key_id=" + payload.kid
  );
}

async function verifySignature(payload) {

  const publicKeyB64 = TRUSTED_KEYS[payload.kid];

  if (!publicKeyB64) {
    throw new Error(
      "Untrusted signing key: " + payload.kid
    );
  }

  const publicKeyBytes =
    decodeBase64(publicKeyB64);

  const signatureBytes =
    decodeBase64UrlToBytes(payload.sig);

  const publicKey =
    await crypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      {
        name: "Ed25519"
      },
      false,
      ["verify"]
    );

  const message =
    buildSigningMessage(payload);

  return await crypto.subtle.verify(
    {
      name: "Ed25519"
    },
    publicKey,
    signatureBytes,
    new TextEncoder().encode(message)
  );
}

function validatePayload(payload) {

  if (payload.v !== 1) {
    throw new Error("Unsupported certificate version");
  }

  const required = [
    "cid",
    "eid",
    "ph",
    "iat",
    "kid",
    "sig"
  ];

  for (const field of required) {
    if (
      typeof payload[field] !== "string" ||
      payload[field].length === 0
    ) {
      throw new Error(
        "Invalid certificate payload: " + field
      );
    }
  }
}


async function verify() {

  try {

    //
    // 1. Read fragment
    //

    const fragment = location.hash.substring(1);

    if (!fragment) {
      setStatus(
        "No certificate data found.",
        "invalid"
      );
      return;
    }


    //
    // 2. Decode payload
    //

    const jsonText = decodeBase64Url(fragment);

    const payload = JSON.parse(jsonText);

    validatePayload(payload);


    //
    // 3. Display signed payload
    //

    document.getElementById("certificateId")
      .textContent = payload.cid;

    document.getElementById("issuedAt")
      .textContent = payload.iat;

    document.getElementById("details")
      .hidden = false;

    const signatureValid = await verifySignature(payload);

    if (!signatureValid) {
        setStatus(
            "Cryptographic Signature: INVALID",
            "invalid"
        );
        return;
    }

    //
    // 4. Query registry
    //

    const response = await fetch(
      "/api/v1/certificates/" +
      encodeURIComponent(payload.cid),
      {
        method: "GET",
        headers: {
          "Accept": "application/json"
        }
      }
    );


    if (response.status === 404) {
      setStatus(
        "Certificate Registry: NOT FOUND",
        "invalid"
      );

      return;
    }


    if (!response.ok) {
      throw new Error(
        "Registry request failed: HTTP " +
        response.status
      );
    }


    const registry = await response.json();


    //
    // 5. Compare QR payload with registry
    //

    const metadataMatches =
      registry.version === payload.v &&
      registry.certificate_id === payload.cid &&
      registry.event_id === payload.eid &&
      registry.participant_hash === payload.ph &&
      registry.issued_at === payload.iat &&
      registry.key_id === payload.kid &&
      registry.signature === payload.sig;


    if (!metadataMatches) {
      setStatus(
        "Certificate Registry: DATA MISMATCH",
        "invalid"
      );

      return;
    }

    //
    // 6. Display certificate and event information
    //

    document.getElementById("courseTitle").textContent =
      registry.event.title || "-";

    document.getElementById("domain").textContent =
      registry.event.domain || "-";

    document.getElementById("speaker").textContent =
      registry.event.speaker || "-";

    const eventStart = new Date(registry.event.starts_at);
    const eventEnd = new Date(registry.event.ends_at);

    document.getElementById("eventDate").textContent =
      eventStart.toLocaleDateString();

    document.getElementById("cpeHours").textContent =
      registry.event.cpe_hours != null
        ? `${registry.event.cpe_hours} 小時 / ${registry.event.cpe_hours} Hours`
        : "-";

    document.getElementById("issuer").textContent =
      registry.event.issuer_name || "-";

    document.getElementById("certificateId").textContent =
      registry.certificate_id;

    document.getElementById("issuedAt").textContent =
      new Date(registry.issued_at).toLocaleString();

    document.getElementById("details").hidden = false;

    //
    // 7. Check registry status
    //

    if (registry.status === "revoked") {
      document.getElementById("revocationDetails").hidden = false;
      document.getElementById("revokedAt").textContent =
        registry.revoked_at ? new Date(registry.revoked_at).toLocaleString(): "-";

      document.getElementById("revocationReason").textContent =
        registry.revocation_reason || "-";
  
      setStatus(
        "此證書已撤銷 / CERTIFICATE REVOKED",
        "invalid"
      );
      return;
    }


    if (registry.status !== "valid") {
      setStatus(
        "Certificate Registry: " +
        registry.status.toUpperCase(),
        "warning"
      );

      return;
    }

    setStatus(
      "Certificate: VALID",
      "valid"
    );

  }
  catch (error) {

    console.error(error);

    setStatus(
      "Invalid certificate data: " +
      error.message,
      "invalid"
    );
  }
}


verify();
