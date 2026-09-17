
let eventInfo = null;
let applicationToken = null;
let currentCertificate = null;
let currentParticipantName = null;
let currentVerificationUrl = null;
let pendingApplication = null;

/*
 * Canonicalization v1
 *
 * 1. Unicode NFKC
 * 2. trim Unicode whitespace
 * 3. collapse consecutive Unicode whitespace to ASCII U+0020
 * 4. NO case folding
 */
function canonicalize(value) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ");
}

async function sha256(text) {

  const data = new TextEncoder().encode(text);

  const digest = await crypto.subtle.digest(
    "SHA-256",
    data
  );

  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function encodeBase64UrlUtf8(value) {

  const bytes = new TextEncoder().encode(value);

  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildVerificationUrl(certificate) {

  const payload = {
    v: certificate.version,
    cid: certificate.certificate_id,
    eid: certificate.event_id,
    ph: certificate.participant_hash,
    iat: certificate.issued_at,
    kid: certificate.key_id,
    sig: certificate.signature
  };

  const json = JSON.stringify(payload);

  const encoded =
    encodeBase64UrlUtf8(json);

  return (
    window.location.origin +
    "/verify#" +
    encoded
  );
}

let pdfFontBase64Promise = null;

async function loadPdfChineseFontBase64() {
  if (!pdfFontBase64Promise) {
    pdfFontBase64Promise = fetch("/static/fonts/NotoSansTC-Regular.ttf")
      .then(response => {
        if (!response.ok) {
          throw new Error(
            `中文字型載入失敗：HTTP ${response.status}`
          );
        }
        return response.arrayBuffer();
      })
      .then(buffer => {
        const bytes = new Uint8Array(buffer);
        const chunkSize = 0x8000;
        let binary = "";

        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(
            ...bytes.subarray(i, i + chunkSize)
          );
        }

        return btoa(binary);
      });
  }

  return pdfFontBase64Promise;
}


function qrCanvasDataUrl(text, size = 512) {
  const holder = document.createElement("div");
  holder.style.position = "fixed";
  holder.style.left = "-10000px";
  holder.style.top = "0";
  document.body.appendChild(holder);

  new QRCode(holder, {
    text,
    width: size,
    height: size,
    correctLevel: QRCode.CorrectLevel.M
  });

  const canvas = holder.querySelector("canvas");
  const image = holder.querySelector("img");

  let dataUrl = null;

  if (canvas) {
    dataUrl = canvas.toDataURL("image/png");
  }
  else if (image && image.src) {
    dataUrl = image.src;
  }

  holder.remove();

  if (!dataUrl) {
    throw new Error("無法產生驗證 QR Code。");
  }

  return dataUrl;
}


function formatPdfDate(value) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}


function formatPdfDateTime(value) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(value));
}


function pdfCenteredBilingualLabel(
  pdf,
  chinese,
  english,
  x,
  y,
  chineseSize = 10,
  englishSize = 7
) {
  pdf.setFont("NotoSansTC", "normal");
  pdf.setFontSize(chineseSize);
  pdf.text(chinese, x, y, { align: "center" });

  pdf.setFont("times", "normal");
  pdf.setFontSize(englishSize);
  pdf.text(english, x, y + 4, { align: "center" });
}


async function downloadCertificatePdf() {
  if (
    !currentCertificate ||
    !currentVerificationUrl ||
    !currentParticipantName
  ) {
    throw new Error("尚未產生證書。");
  }

  const { jsPDF } = window.jspdf;

  if (!jsPDF) {
    throw new Error("PDF 元件尚未載入。");
  }

  const fontBase64 = await loadPdfChineseFontBase64();

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true
  });

  pdf.addFileToVFS("NotoSansTC-Regular.ttf", fontBase64);
  pdf.addFont(
    "NotoSansTC-Regular.ttf",
    "NotoSansTC",
    "normal"
  );

  const pageWidth = 210;
  const pageHeight = 297;
  const centerX = pageWidth / 2;

  // ------------------------------------------------------------
  // Certificate watermark
  // Visual element only; NOT a security / authenticity control.
  // ------------------------------------------------------------
  pdf.saveGraphicsState();

  const watermarkState = new pdf.GState({
    opacity: 0.055
  });

  pdf.setGState(watermarkState);

  // Keep the text dark and let opacity make it subtle.
  pdf.setTextColor(60, 70, 80);

  // Diagonal: lower-left -> upper-right.
  const watermarkAngle = 38;
  const watermarkX = centerX;
  const watermarkY = 168;

  pdf.setFont("times", "bold");
  pdf.setFontSize(31);

  pdf.text(
    "PARTICIPATION",
    watermarkX,
    watermarkY - 18,
    {
      align: "center",
      angle: watermarkAngle
    }
  );

  pdf.text(
    "CERTIFICATE",
    watermarkX,
    watermarkY,
    {
      align: "center",
      angle: watermarkAngle
    }
  );

  pdf.setFont("NotoSansTC", "normal");
  pdf.setFontSize(24);

  pdf.text(
    "參與證明",
    watermarkX,
    watermarkY + 17,
    {
      align: "center",
      angle: watermarkAngle
    }
  );

  // Issuer is event metadata, not hard-coded.
  if (eventInfo.issuer_name) {
    pdf.setFontSize(12);

    pdf.text(
      eventInfo.issuer_name,
      watermarkX,
      watermarkY + 31,
      {
        align: "center",
        angle: watermarkAngle,
        maxWidth: 105
      }
    );
  }

  pdf.restoreGraphicsState();

  // Outer certificate frame.
  pdf.setLineWidth(0.8);
  pdf.rect(10, 10, 190, 277);
  pdf.setLineWidth(0.25);
  pdf.rect(13, 13, 184, 271);

  // Main title.
  pdf.setFont("NotoSansTC", "normal");
  pdf.setFontSize(25);
  pdf.text("參與證明", centerX, 35, { align: "center" });

  pdf.setFont("times", "bold");
  pdf.setFontSize(14);
  pdf.text(
    "CERTIFICATE OF PARTICIPATION",
    centerX,
    43,
    { align: "center" }
  );

  pdfCenteredBilingualLabel(
    pdf,
    "茲證明",
    "This is to certify that",
    centerX,
    62,
    11,
    8
  );

  // Participant name.
  pdf.setFont("NotoSansTC", "normal");
  pdf.setFontSize(23);
  pdf.text(
    currentParticipantName,
    centerX,
    82,
    { align: "center", maxWidth: 160 }
  );
  pdf.setLineWidth(0.25);
  pdf.line(45, 87, 165, 87);

  pdfCenteredBilingualLabel(
    pdf,
    "已參與下列活動",
    "has participated in",
    centerX,
    101,
    10,
    8
  );

  // Event title.
  pdf.setFont("NotoSansTC", "normal");
  pdf.setFontSize(18);
  const eventTitleLines = pdf.splitTextToSize(
    eventInfo.title || "-",
    160
  );
  pdf.text(eventTitleLines, centerX, 119, {
    align: "center"
  });

  let detailY = 137 + Math.max(0, eventTitleLines.length - 1) * 7;

  if (eventInfo.description) {
    pdf.setFont("NotoSansTC", "normal");
    pdf.setFontSize(9);
    const descLines = pdf.splitTextToSize(
      eventInfo.description,
      155
    );
    pdf.text(descLines, centerX, detailY, {
      align: "center"
    });
    detailY += Math.min(descLines.length, 3) * 5 + 5;
  }

  // Event details.
  const detailTop = Math.max(detailY, 150);
  pdf.setLineWidth(0.2);
  pdf.line(25, detailTop - 7, 185, detailTop - 7);
  pdf.line(25, detailTop + 22, 185, detailTop + 22);

  const columns = [51.5, 105, 158.5];

  pdfCenteredBilingualLabel(
    pdf, "活動日期", "Event Date",
    columns[0], detailTop, 9, 7
  );
  pdfCenteredBilingualLabel(
    pdf, "講師", "Speaker",
    columns[1], detailTop, 9, 7
  );
  pdfCenteredBilingualLabel(
    pdf, "CPE 時數", "CPE Hours",
    columns[2], detailTop, 9, 7
  );

  pdf.setFont("NotoSansTC", "normal");
  pdf.setFontSize(9);
  pdf.text(
    formatPdfDate(eventInfo.starts_at),
    columns[0],
    detailTop + 14,
    { align: "center" }
  );
  pdf.text(
    eventInfo.speaker || "-",
    columns[1],
    detailTop + 14,
    { align: "center", maxWidth: 48 }
  );

  const cpeText = eventInfo.cpe_hours
    ? `${eventInfo.cpe_hours} 小時 / ${eventInfo.cpe_hours} Hours`: "-";
  
  pdf.text(
    cpeText,
    columns[2],
    detailTop + 14,
    { align: "center", maxWidth: 48 }
  );

  // Domain and issuer.
  let metadataY = detailTop + 35;
  if (eventInfo.domain) {
    pdf.setFont("NotoSansTC", "normal");
    pdf.setFontSize(8);

    pdf.text(
      "專業領域 / Domain",
      28,
      metadataY
    );

    pdf.setFontSize(9);
    pdf.text(
      eventInfo.domain,
      70,
      metadataY,
      { maxWidth: 110 }
    );

    metadataY += 10;
  }

  pdf.setFont("NotoSansTC", "normal");
  pdf.setFontSize(8);

  pdf.text(
    "核發單位 / Issuer",
    28,
    metadataY
  );

  pdf.setFontSize(9);
  pdf.text(
    eventInfo.issuer_name || "-",
    70,
    metadataY,
    { maxWidth: 110 }
  );
  
  // Verification QR.
  const qrDataUrl = qrCanvasDataUrl(
    currentVerificationUrl,
    512
  );
  pdf.addImage(
    qrDataUrl,
    "PNG",
    145,
    211,
    35,
    35,
    undefined,
    "FAST"
  );

  pdfCenteredBilingualLabel(
    pdf,
    "掃描 QR Code 驗證此證書",
    "Scan to verify this certificate",
    162.5,
    252,
    7.5,
    6
  );

  // Certificate metadata.
  pdf.setFont("NotoSansTC", "normal");
  pdf.setFontSize(8);
  pdf.text("證書編號", 28, 220);

  pdf.setFont("times", "normal");
  pdf.setFontSize(6.5);
  pdf.text("Certificate ID", 28, 224);

  pdf.setFont("courier", "normal");
  pdf.setFontSize(7);
  pdf.text(
    currentCertificate.certificate_id,
    28,
    230,
    { maxWidth: 105 }
  );

  pdf.setFont("NotoSansTC", "normal");
  pdf.setFontSize(8);
  pdf.text("核發時間", 28, 244);

  pdf.setFont("times", "normal");
  pdf.setFontSize(6.5);
  pdf.text("Issued At", 28, 248);

  pdf.setFont("NotoSansTC", "normal");
  pdf.setFontSize(7.5);
  pdf.text(
    formatPdfDateTime(currentCertificate.issued_at),
    28,
    254
  );

  // Notice.
  const noticeY = 267;

  pdf.setLineWidth(0.2);
  pdf.line(25, noticeY - 7, 185, noticeY - 7);

  pdf.setFont("NotoSansTC", "normal");
  pdf.setFontSize(6.5);

  pdf.text(
    "聲明 / Notice",
    28,
    noticeY
  );

  pdf.setFontSize(5.8);

  const noticeZh =
    "參與者資料由申請人自行提供；本證書僅證明所載活動之參與紀錄，" +
    "不代表核發單位已驗證申請人所提供之身分、資格或其他個人資料。";

  const noticeZhLines =
    pdf.splitTextToSize(noticeZh, 154);

  pdf.text(
    noticeZhLines,
    28,
    noticeY + 5
  );

  pdf.setFont("times", "normal");
  pdf.setFontSize(5);

  const noticeEn =
    "Participant information is self-reported. This certificate confirms " +
    "participation in the stated activity only and does not constitute " +
    "verification by the issuer of the participant's identity, qualifications, " +
    "or other personal information.";

  const noticeEnLines =
    pdf.splitTextToSize(noticeEn, 154);

  pdf.text(
    noticeEnLines,
    28,
    noticeY + 10
  );

  const safeId = currentCertificate.certificate_id
    .replace(/[^A-Za-z0-9_-]/g, "_");

  pdf.save(`${safeId}.pdf`);
}


document.getElementById("download-pdf")
  .addEventListener("click", async () => {
    const button = document.getElementById("download-pdf");
    const oldText = button.textContent;

    try {
      button.disabled = true;
      button.textContent = "產生 PDF 中… / Generating…";
      document.getElementById("error").textContent = "";
      await downloadCertificatePdf();
    }
    catch (error) {
      console.error(error);
      document.getElementById("error").textContent =
        "PDF 產生失敗：" + error.message;
    }
    finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  });


async function loadEvent() {

  const params = new URLSearchParams(window.location.search);
  applicationToken = params.get("token");
  if (!applicationToken) {
    throw new Error("Missing application token.");
  }
  const response = await fetch(
    `/api/v1/apply?token=${encodeURIComponent(applicationToken)}`
  );
  if (!response.ok) {
    let message = "Unable to load event.";
    try {
      const body = await response.json();

      if (body.detail) {
        message = body.detail;
      }
    } catch (_) {
    }
    throw new Error(message);
  }
  eventInfo = await response.json();

  document.getElementById("title").textContent =
    eventInfo.title;

  const start =
    new Date(eventInfo.starts_at).toLocaleString();

  const end =
    new Date(eventInfo.ends_at).toLocaleString();

  document.getElementById("event-info").innerHTML = `
    ${eventInfo.domain ? `
      <div>
        <strong>專業領域 / Domain：</strong>
        ${escapeHtml(eventInfo.domain)}
      </div>
    ` : ""}

    <div>
      <strong>講師 / Speaker：</strong>
      ${escapeHtml(eventInfo.speaker)}
    </div>

    <div>
      <strong>活動時間 / Time：</strong>
      ${escapeHtml(start)} – ${escapeHtml(end)}
    </div>

    ${eventInfo.location ? `
      <div>
        <strong>地點 / Location：</strong>
        ${escapeHtml(eventInfo.location)}
      </div>
    ` : ""}

    ${eventInfo.cpe_hours ? `
      <div>
        <strong>CPE 時數 / CPE Hours：</strong>
        ${escapeHtml(eventInfo.cpe_hours)}
      </div>
    ` : ""}

    <div>
      <strong>核發單位 / Issuer：</strong>
      ${escapeHtml(eventInfo.issuer_name)}
    </div>
  `;

  document.getElementById("loading").style.display = "none";
  document.getElementById("content").style.display = "block";
}


function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

async function issueCertificate() {
  if (!eventInfo) {
    console.error("issueCertificate called without eventInfo");
    document.getElementById("error").textContent =
      "目前無法核發證書，請重新開啟申請連結。" +
      " / Certificate cannot be issued at this time.";
    return;
  }
  if (!pendingApplication) {
    document.getElementById("error").textContent =
      "找不到待核發的申請資料，請重新填寫。";
    return;
  }

  const button = document.getElementById("confirm-issue");
  const oldText = button.textContent;

  document.getElementById("error").textContent = "";

  try {
    button.disabled = true;
    button.textContent = "核發中… / Issuing…";

    const {
      participantName,
      certificationMemberId,
      meetDisplayName
    } = pendingApplication;

    const preimage =
      "PCG-PARTICIPANT-V1\n" +
      `event_id=${eventInfo.event_id}\n` +
      `participant_name=${participantName}\n` +
      `certification_member_id=${certificationMemberId}\n` +
      `meet_display_name=${meetDisplayName}`;

    const digest = await sha256(preimage);

    const participantHash =
      `sha256:${digest}`;

    const response = await fetch("/api/v1/certificates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${applicationToken}`
      },
      body: JSON.stringify({
        event_id: eventInfo.event_id,
        participant_hash: participantHash
      })
    });

    if (!response.ok) {
      let message = "證書核發失敗 / Certificate issuance failed.";

      try {
        const body = await response.json();

        if (body.detail) {
          message = body.detail;
        }
      }
      catch (_) {
      }

      throw new Error(message);
    }

    const certificate = await response.json();

    const verificationUrl =
      buildVerificationUrl(certificate);

    currentCertificate = certificate;
    currentParticipantName = participantName;
    currentVerificationUrl = verificationUrl;

    document.getElementById(
      "success-course-title"
    ).textContent = eventInfo.title;

    document.getElementById(
      "success-participant-name"
    ).textContent = participantName;

    document.getElementById(
      "success-certificate-id"
    ).textContent = certificate.certificate_id;

    document.getElementById(
      "success-issued-at"
    ).textContent = new Date(certificate.issued_at).toLocaleString();

    const verificationLink =
      document.getElementById("verificationLink");

    verificationLink.href = verificationUrl;

    const qrContainer =
      document.getElementById("verificationQr");

    qrContainer.innerHTML = "";

    new QRCode(qrContainer, {
      text: verificationUrl,
      width: 160,
      height: 160,
      correctLevel: QRCode.CorrectLevel.M
    });

    document.getElementById(
      "confirm-section"
    ).style.display = "none";

    const successSection =
      document.getElementById("success-section");

    successSection.style.display = "block";

    successSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

    pendingApplication = null;
  }
  catch (error) {
    console.error(error);

    document.getElementById("error").textContent =
      error.message;
  }
  finally {
    button.disabled = false;
    button.textContent = oldText;
  }
}


document.getElementById("apply-form")
  .addEventListener("submit", async (event) => {
    
    event.preventDefault();
    document.getElementById("error").textContent = "";
    const participantName = canonicalize(
      document.getElementById("participant-name").value
    );

    const certificationMemberId = canonicalize(
      document.getElementById("certification-member-id").value
    );

    const meetDisplayName = canonicalize(
      document.getElementById("meet-display-name").value
    );

    pendingApplication = {
      participantName,
      certificationMemberId,
      meetDisplayName
    };

    document.getElementById(
      "confirm-participant-name"
    ).textContent = participantName;

    document.getElementById(
      "confirm-member-id"
    ).textContent = certificationMemberId;

    document.getElementById(
      "confirm-meet-name"
    ).textContent = meetDisplayName;

    document.getElementById(
      "apply-form"
    ).style.display = "none";

    const confirmSection =
      document.getElementById("confirm-section");

    confirmSection.style.display = "block";

    confirmSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  });

document.getElementById("edit-application")
  .addEventListener("click", () => {
    document.getElementById(
      "confirm-section"
    ).style.display = "none";

    const form =
      document.getElementById("apply-form");

    form.style.display = "block";
    form.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  });

loadEvent().catch(error => {
  document.getElementById("loading").style.display = "none";
  // Event 無法載入時，不得開放申請表單。
  document.getElementById("content").style.display = "none";
  document.getElementById("load-error").textContent =
    "目前無法申請參與證明，可能尚未開放、申請期間已結束，或申請連結無效。" +
    " / Certificate application is currently unavailable.";
});

document.getElementById("confirm-issue")
  .addEventListener("click", issueCertificate);
