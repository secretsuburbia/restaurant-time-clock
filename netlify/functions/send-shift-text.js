const twilioUrl = (accountSid) =>
  `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return response(204, "");
  }

  if (event.httpMethod !== "POST") {
    return response(405, { error: "Method not allowed" });
  }

  const {
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_FROM_NUMBER,
    NOTIFY_TO_NUMBER
  } = process.env;

  const missing = [
    ["TWILIO_ACCOUNT_SID", TWILIO_ACCOUNT_SID],
    ["TWILIO_AUTH_TOKEN", TWILIO_AUTH_TOKEN],
    ["TWILIO_FROM_NUMBER", TWILIO_FROM_NUMBER],
    ["NOTIFY_TO_NUMBER", NOTIFY_TO_NUMBER]
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length) {
    return response(503, { error: `Missing ${missing.join(", ")}` });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return response(400, { error: "Invalid JSON" });
  }

  const employeeName = clean(payload.employeeName, "Employee");
  const action = clean(payload.action, "clocked in");
  const restaurantName = clean(payload.restaurantName, "Restaurant Time Clock");
  const clientTimeText = payload.timeText ? clean(payload.timeText, "") : "";
  const time = payload.time ? new Date(payload.time) : new Date();
  const timeText = clientTimeText || (Number.isNaN(time.getTime())
    ? "now"
    : time.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }));

  const body = `${restaurantName}: ${employeeName} ${action} at ${timeText}.`;
  const params = new URLSearchParams({
    To: NOTIFY_TO_NUMBER,
    From: TWILIO_FROM_NUMBER,
    Body: body
  });

  const twilioResponse = await fetch(twilioUrl(TWILIO_ACCOUNT_SID), {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
  });

  if (!twilioResponse.ok) {
    const details = await twilioResponse.json().catch(() => ({}));
    const code = details.code ? ` ${details.code}` : "";
    const message = details.message ? `: ${details.message}` : "";
    return response(502, { error: `Twilio rejected the message${code}${message}` });
  }

  return response(200, { ok: true });
};

function clean(value, fallback) {
  return String(value || fallback).replace(/\s+/g, " ").trim().slice(0, 80);
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json"
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  };
}
