const crypto = require("crypto");

const storeName = "restaurant-time-clock";
const stateKey = "state";
const adminSessionHours = 8;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return response(204, "");
  }

  try {
    const store = await getStore();

    if (event.httpMethod === "GET") {
      const state = await getState(store);
      return response(200, publicState(state));
    }

    if (event.httpMethod !== "POST") {
      return response(405, { error: "Method not allowed" });
    }

    const payload = JSON.parse(event.body || "{}");
    const action = clean(payload.action, "", 40);

    if (action === "clock") {
      return handleClock(store, payload);
    }

    if (action === "break") {
      return handleBreak(store, payload);
    }

    if (action === "auto-clock-out") {
      return handleAutoClockOut(store, payload);
    }

    if (action === "admin-load") {
      return handleAdminLoad(store, payload);
    }

    if (action === "save-employee") {
      return handleSaveEmployee(store, payload);
    }

    if (action === "toggle-employee") {
      return handleToggleEmployee(store, payload);
    }

    if (action === "delete-employee") {
      return handleDeleteEmployee(store, payload);
    }

    if (action === "save-settings") {
      return handleSaveSettings(store, payload);
    }

    if (action === "update-shift") {
      return handleUpdateShift(store, payload);
    }

    if (action === "delete-shift") {
      return handleDeleteShift(store, payload);
    }

    return response(400, { error: "Unknown action" });
  } catch (error) {
    return response(500, { error: error.message || "Could not load restaurant records" });
  }
};

async function handleAdminLoad(store, payload) {
  const state = await getState(store);
  if (isLoginBlocked(state, "admin")) {
    return response(429, { error: "Too many incorrect attempts. Try again in 15 minutes" });
  }
  if (!validAdminPin(state, payload.adminPin)) {
    await recordLoginFailure(store, state, "admin");
    return response(403, { error: "Manager PIN does not match" });
  }

  clearLoginFailures(state, "admin");
  await store.setJSON(stateKey, state);
  return response(200, adminState(state, createAdminToken()));
}
async function handleClock(store, payload) {
  const state = await getState(store);
  const employeeId = clean(payload.employeeId, "", 80);
  const pin = clean(payload.pin, "", 20);
  const employee = state.employees.find((record) => record.id === employeeId && record.active);

  if (!employee) return response(404, { error: "Employee was not found" });
  const loginKey = `employee:${employee.id}`;
  if (isLoginBlocked(state, loginKey)) {
    return response(429, { error: "Too many incorrect attempts. Try again in 15 minutes" });
  }
  if (!verifyPin(pin, employee.pinHash)) {
    await recordLoginFailure(store, state, loginKey);
    return response(403, { error: "That PIN does not match this employee" });
  }
  clearLoginFailures(state, loginKey);

  const now = new Date().toISOString();
  const openShift = state.shifts.find((shift) => shift.employeeId === employee.id && !shift.clockOut);
  const actionText = openShift ? "clocked out" : "clocked in";
  let autoClockToken = "";
  let shiftId = openShift?.id || "";

  if (openShift) {
    const currentBreak = activeBreak(openShift);
    if (currentBreak) currentBreak.end = now;
    openShift.clockOut = now;
    openShift.clockOutReason = "manual";
    openShift.autoClockTokenHash = "";
  } else {
    autoClockToken = makeSecureToken();
    shiftId = makeId();
    state.shifts.push({
      id: shiftId,
      employeeId: employee.id,
      employeeName: employee.name,
      wageAtClockIn: Number(employee.wage) || 0,
      clockIn: now,
      clockOut: null,
      clockOutReason: "",
      breaks: [],
      autoClockTokenHash: hashAutoClockToken(autoClockToken)
    });
  }

  state.updatedAt = now;
  await store.setJSON(stateKey, state);
  const textResult = await sendShiftText({
    employeeName: employee.name,
    action: actionText,
    timeText: new Date(now).toLocaleString("en-CA", {
      timeZone: "America/Toronto",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }),
    restaurantName: state.settings.restaurantName
  });

  return response(200, {
    state: publicState(state),
    event: {
      employeeName: employee.name,
      action: actionText,
      time: now,
      shiftId,
      autoClockToken,
      textSent: textResult.ok,
      textError: textResult.error || ""
    }
  });
}

async function handleBreak(store, payload) {
  const state = await getState(store);
  const employeeId = clean(payload.employeeId, "", 80);
  const pin = clean(payload.pin, "", 20);
  const employee = state.employees.find((record) => record.id === employeeId && record.active);

  if (!employee) return response(404, { error: "Employee was not found" });
  const loginKey = `employee:${employee.id}`;
  if (isLoginBlocked(state, loginKey)) {
    return response(429, { error: "Too many incorrect attempts. Try again in 15 minutes" });
  }
  if (!verifyPin(pin, employee.pinHash)) {
    await recordLoginFailure(store, state, loginKey);
    return response(403, { error: "That PIN does not match this employee" });
  }
  clearLoginFailures(state, loginKey);

  const openShift = state.shifts.find((shift) => shift.employeeId === employee.id && !shift.clockOut);
  if (!openShift) return response(409, { error: "Clock in before starting a break" });

  openShift.breaks ||= [];
  const now = new Date().toISOString();
  const currentBreak = activeBreak(openShift);
  const actionText = currentBreak ? "ended break" : "started break";

  if (currentBreak) {
    currentBreak.end = now;
  } else {
    openShift.breaks.push({ start: now, end: null });
  }

  state.updatedAt = now;
  await store.setJSON(stateKey, state);
  const textResult = await sendShiftText({
    employeeName: employee.name,
    action: actionText,
    timeText: new Date(now).toLocaleString("en-CA", {
      timeZone: "America/Toronto",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }),
    restaurantName: state.settings.restaurantName
  });

  return response(200, {
    state: publicState(state),
    event: {
      employeeName: employee.name,
      action: actionText,
      time: now,
      textSent: textResult.ok,
      textError: textResult.error || ""
    }
  });
}

async function handleAutoClockOut(store, payload) {
  const state = await getState(store);
  const employeeId = clean(payload.employeeId, "", 80);
  const shiftId = clean(payload.shiftId, "", 80);
  const token = clean(payload.autoClockToken, "", 160);
  const employee = state.employees.find((record) => record.id === employeeId && record.active);
  const openShift = state.shifts.find((shift) =>
    shift.id === shiftId &&
    shift.employeeId === employeeId &&
    !shift.clockOut
  );

  if (!employee) return response(404, { error: "Employee was not found" });
  if (!openShift) return response(409, { error: "That shift is already clocked out" });
  if (!verifyAutoClockToken(token, openShift.autoClockTokenHash)) {
    return response(403, { error: "Auto clock-out session is not valid" });
  }

  const now = new Date().toISOString();
  const currentBreak = activeBreak(openShift);
  if (currentBreak) currentBreak.end = now;
  openShift.clockOut = now;
  openShift.clockOutReason = "auto-left-premises";
  openShift.autoClockTokenHash = "";
  state.updatedAt = now;
  await store.setJSON(stateKey, state);

  const textResult = await sendShiftText({
    employeeName: employee.name,
    action: "auto clocked out",
    timeText: new Date(now).toLocaleString("en-CA", {
      timeZone: "America/Toronto",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }),
    restaurantName: state.settings.restaurantName
  });

  return response(200, {
    state: publicState(state),
    event: {
      employeeName: employee.name,
      action: "auto clocked out",
      time: now,
      shiftId: openShift.id,
      textSent: textResult.ok,
      textError: textResult.error || ""
    }
  });
}

async function handleSaveEmployee(store, payload) {
  const state = await getState(store);
  if (!validAdminSession(payload.adminToken)) return response(403, { error: "Manager session has expired" });

  const incoming = payload.employee || {};
  const id = clean(incoming.id, makeId(), 80);
  const existing = state.employees.find((employee) => employee.id === id);
  const record = {
    id,
    name: clean(incoming.name, "", 80),
    wage: Number(incoming.wage) || 0,
    pinHash: incoming.pin ? hashPin(clean(incoming.pin, "", 20)) : existing?.pinHash || "",
    active: existing ? existing.active : true
  };

  if (!record.name || !record.pinHash) return response(400, { error: "Employee name and PIN are required" });

  state.employees = existing
    ? state.employees.map((employee) => employee.id === id ? record : employee)
    : [...state.employees, record];
  state.updatedAt = new Date().toISOString();
  await store.setJSON(stateKey, state);
  return response(200, adminState(state, payload.adminToken));
}

async function handleToggleEmployee(store, payload) {
  const state = await getState(store);
  if (!validAdminSession(payload.adminToken)) return response(403, { error: "Manager session has expired" });

  const id = clean(payload.employeeId, "", 80);
  state.employees = state.employees.map((employee) =>
    employee.id === id ? { ...employee, active: !employee.active } : employee
  );
  state.updatedAt = new Date().toISOString();
  await store.setJSON(stateKey, state);
  return response(200, adminState(state, payload.adminToken));
}

async function handleDeleteEmployee(store, payload) {
  const state = await getState(store);
  if (!validAdminSession(payload.adminToken)) return response(403, { error: "Manager session has expired" });

  const id = clean(payload.employeeId, "", 80);
  const employee = state.employees.find((record) => record.id === id);
  if (!employee) return response(404, { error: "Employee was not found" });
  if (state.shifts.some((shift) => shift.employeeId === id && !shift.clockOut)) {
    return response(409, { error: "Clock this employee out before deleting them" });
  }

  state.employees = state.employees.filter((record) => record.id !== id);
  if (state.loginFailures) delete state.loginFailures[`employee:${id}`];
  state.updatedAt = new Date().toISOString();
  await store.setJSON(stateKey, state);
  return response(200, adminState(state, payload.adminToken));
}

async function handleSaveSettings(store, payload) {
  const state = await getState(store);
  if (!validAdminSession(payload.adminToken)) return response(403, { error: "Manager session has expired" });

  const settings = payload.settings || {};
  state.settings.restaurantName = clean(settings.restaurantName, state.settings.restaurantName, 80);
  state.settings.autoClockOutEnabled = Boolean(settings.autoClockOutEnabled);
  state.settings.geofenceLatitude = parseCoordinate(settings.geofenceLatitude, -90, 90);
  state.settings.geofenceLongitude = parseCoordinate(settings.geofenceLongitude, -180, 180);
  state.settings.geofenceRadiusMeters = Math.max(50, Math.min(5000, Number(settings.geofenceRadiusMeters) || 150));
  if (settings.adminPin) {
    state.settings.adminPinHash = hashPin(clean(settings.adminPin, "", 20));
  }
  state.updatedAt = new Date().toISOString();
  await store.setJSON(stateKey, state);
  return response(200, adminState(state, payload.adminToken));
}

async function handleUpdateShift(store, payload) {
  const state = await getState(store);
  if (!validAdminSession(payload.adminToken)) return response(403, { error: "Manager session has expired" });

  const incoming = payload.shift || {};
  const id = clean(incoming.id, "", 80);
  const shift = state.shifts.find((record) => record.id === id);
  if (!shift) return response(404, { error: "Shift was not found" });

  const clockIn = clean(incoming.clockIn, "", 40);
  const clockOut = incoming.clockOut ? clean(incoming.clockOut, "", 40) : null;
  if (!isValidDate(clockIn)) return response(400, { error: "Clock-in time is not valid" });
  if (clockOut && !isValidDate(clockOut)) return response(400, { error: "Clock-out time is not valid" });
  if (clockOut && new Date(clockOut) < new Date(clockIn)) {
    return response(400, { error: "Clock-out cannot be before clock-in" });
  }

  shift.clockIn = new Date(clockIn).toISOString();
  shift.clockOut = clockOut ? new Date(clockOut).toISOString() : null;
  state.updatedAt = new Date().toISOString();
  await store.setJSON(stateKey, state);
  return response(200, adminState(state, payload.adminToken));
}

async function handleDeleteShift(store, payload) {
  const state = await getState(store);
  if (!validAdminSession(payload.adminToken)) return response(403, { error: "Manager session has expired" });

  const id = clean(payload.shiftId, "", 80);
  state.shifts = state.shifts.filter((shift) => shift.id !== id);
  state.updatedAt = new Date().toISOString();
  await store.setJSON(stateKey, state);
  return response(200, adminState(state, payload.adminToken));
}

async function getStore() {
  const blobs = await import("@netlify/blobs");
  return blobs.getStore({
    name: storeName,
    siteID: process.env.NETLIFY_BLOBS_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN
  });
}

async function getState(store) {
  const saved = await store.get(stateKey, { type: "json" });
  if (saved) {
    const state = sanitizeState(saved);
    if (containsLegacyPins(saved)) await store.setJSON(stateKey, state);
    return state;
  }

  const state = createDefaultState();
  await store.setJSON(stateKey, state);
  return state;
}

function createDefaultState() {
  return {
    settings: {
      restaurantName: "Restaurant Time Clock",
      adminPinHash: hashPin("1234"),
      autoClockOutEnabled: false,
      geofenceLatitude: null,
      geofenceLongitude: null,
      geofenceRadiusMeters: 150
    },
    employees: [
      { id: "alex", name: "Alex", wage: 17.2, pinHash: hashPin("1111"), active: true },
      { id: "sam", name: "Sam", wage: 18.5, pinHash: hashPin("2222"), active: true }
    ],
    shifts: [],
    security: { loginFailures: {} },
    updatedAt: new Date().toISOString()
  };
}

function publicState(state) {
  return {
    settings: {
      restaurantName: state.settings.restaurantName,
      autoClockOutEnabled: Boolean(state.settings.autoClockOutEnabled),
      geofenceLatitude: state.settings.geofenceLatitude,
      geofenceLongitude: state.settings.geofenceLongitude,
      geofenceRadiusMeters: state.settings.geofenceRadiusMeters
    },
    employees: state.employees.map((employee) => ({
      id: employee.id,
      name: employee.name,
      active: employee.active,
      clockedIn: state.shifts.some((shift) => shift.employeeId === employee.id && !shift.clockOut),
      onBreak: state.shifts.some((shift) => shift.employeeId === employee.id && !shift.clockOut && activeBreak(shift))
    })),
    shifts: [],
    updatedAt: state.updatedAt
  };
}

function adminState(state, adminToken) {
  return {
    settings: {
      restaurantName: state.settings.restaurantName,
      autoClockOutEnabled: Boolean(state.settings.autoClockOutEnabled),
      geofenceLatitude: state.settings.geofenceLatitude,
      geofenceLongitude: state.settings.geofenceLongitude,
      geofenceRadiusMeters: state.settings.geofenceRadiusMeters
    },
    employees: state.employees.map((employee) => ({
      id: employee.id,
      name: employee.name,
      wage: employee.wage,
      active: employee.active,
      pinConfigured: Boolean(employee.pinHash),
      clockedIn: state.shifts.some((shift) => shift.employeeId === employee.id && !shift.clockOut),
      onBreak: state.shifts.some((shift) => shift.employeeId === employee.id && !shift.clockOut && activeBreak(shift))
    })),
    shifts: state.shifts.map(publicShiftRecord),
    updatedAt: state.updatedAt,
    adminToken
  };
}

function validAdminPin(state, pin) {
  return verifyPin(clean(pin, "", 20), state.settings.adminPinHash);
}

function publicShiftRecord(shift) {
  const { autoClockTokenHash, ...record } = shift;
  return record;
}

function activeBreak(shift) {
  return (shift.breaks || []).find((record) => record.start && !record.end) || null;
}

function sanitizeState(input) {
  const fallback = createDefaultState();
  const source = input && typeof input === "object" ? input : fallback;
  const settings = source.settings && typeof source.settings === "object" ? source.settings : fallback.settings;
  const employees = Array.isArray(source.employees) ? source.employees : fallback.employees;
  const shifts = Array.isArray(source.shifts) ? source.shifts : [];

  return {
    settings: {
      restaurantName: clean(settings.restaurantName, fallback.settings.restaurantName, 80),
      adminPinHash: normalizePinHash(settings.adminPinHash, settings.adminPin, "1234"),
      autoClockOutEnabled: Boolean(settings.autoClockOutEnabled),
      geofenceLatitude: parseCoordinate(settings.geofenceLatitude, -90, 90),
      geofenceLongitude: parseCoordinate(settings.geofenceLongitude, -180, 180),
      geofenceRadiusMeters: Math.max(50, Math.min(5000, Number(settings.geofenceRadiusMeters) || 150))
    },
    employees: employees.map((employee) => ({
      id: clean(employee.id, makeId(), 80),
      name: clean(employee.name, "Employee", 80),
      wage: Number(employee.wage) || 0,
      pinHash: normalizePinHash(employee.pinHash, employee.pin, ""),
      active: employee.active !== false
    })),
    shifts: shifts.map((shift) => ({
      id: clean(shift.id, makeId(), 80),
      employeeId: clean(shift.employeeId, "", 80),
      employeeName: clean(shift.employeeName, "Unknown", 80),
      wageAtClockIn: Number(shift.wageAtClockIn) || 0,
      clockIn: clean(shift.clockIn, new Date().toISOString(), 40),
      clockOut: shift.clockOut ? clean(shift.clockOut, "", 40) : null,
      clockOutReason: clean(shift.clockOutReason, "", 40),
      breaks: sanitizeBreaks(shift.breaks),
      autoClockTokenHash: shift.clockOut ? "" : clean(shift.autoClockTokenHash, "", 160)
    })),
    security: sanitizeSecurity(source.security),
    updatedAt: clean(source.updatedAt, fallback.updatedAt, 40)
  };
}

function containsLegacyPins(input) {
  return Boolean(
    input?.settings?.adminPin ||
    input?.employees?.some((employee) => employee?.pin)
  );
}

function sanitizeBreaks(breaks) {
  return Array.isArray(breaks)
    ? breaks.map((record) => ({
      start: clean(record?.start, "", 40),
      end: record?.end ? clean(record.end, "", 40) : null
    })).filter((record) => isValidDate(record.start) && (!record.end || isValidDate(record.end)))
    : [];
}

function normalizePinHash(hash, legacyPin, fallbackPin) {
  const existing = clean(hash, "", 256);
  if (existing.startsWith("scrypt$")) return existing;
  const pin = clean(legacyPin, fallbackPin, 20);
  return pin ? hashPin(pin) : "";
}

function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(pin, salt, 32);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function verifyPin(pin, storedHash) {
  const parts = String(storedHash || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  try {
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const actual = crypto.scryptSync(pin, salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function sanitizeSecurity(security) {
  const failures = security?.loginFailures && typeof security.loginFailures === "object"
    ? security.loginFailures
    : {};
  const loginFailures = {};

  Object.entries(failures).forEach(([key, values]) => {
    if (!Array.isArray(values)) return;
    loginFailures[clean(key, "", 100)] = values
      .map(Number)
      .filter(Number.isFinite)
      .slice(-10);
  });

  return { loginFailures };
}

function recentLoginFailures(state, key) {
  const cutoff = Date.now() - 15 * 60 * 1000;
  return (state.security?.loginFailures?.[key] || []).filter((time) => time >= cutoff);
}

function isLoginBlocked(state, key) {
  return recentLoginFailures(state, key).length >= 5;
}

async function recordLoginFailure(store, state, key) {
  state.security ||= { loginFailures: {} };
  state.security.loginFailures ||= {};
  state.security.loginFailures[key] = [...recentLoginFailures(state, key), Date.now()].slice(-5);
  await store.setJSON(stateKey, state);
}

function clearLoginFailures(state, key) {
  if (state.security?.loginFailures) delete state.security.loginFailures[key];
}
function createAdminToken() {
  const payload = Buffer.from(JSON.stringify({
    scope: "admin",
    expiresAt: Date.now() + adminSessionHours * 60 * 60 * 1000
  })).toString("base64url");
  return `${payload}.${signToken(payload)}`;
}

function validAdminSession(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return false;

  const expected = Buffer.from(signToken(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return false;

  try {
    const details = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return details.scope === "admin" && Number(details.expiresAt) > Date.now();
  } catch {
    return false;
  }
}

function signToken(payload) {
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.NETLIFY_BLOBS_TOKEN;
  if (!secret) throw new Error("Manager session secret is not configured");
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function makeSecureToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashAutoClockToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function verifyAutoClockToken(token, storedHash) {
  const expected = Buffer.from(clean(storedHash, "", 160));
  const actual = Buffer.from(hashAutoClockToken(token));
  return Boolean(token) && expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function sendShiftText(event) {
  const {
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_FROM_NUMBER,
    NOTIFY_TO_NUMBER
  } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !NOTIFY_TO_NUMBER) {
    return { ok: false, error: "Text alert is not configured" };
  }

  const body = `${event.restaurantName}: ${event.employeeName} ${event.action} at ${event.timeText}.`;
  const params = new URLSearchParams({
    To: NOTIFY_TO_NUMBER,
    From: TWILIO_FROM_NUMBER,
    Body: body
  });

  const twilioResponse = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params
    }
  );

  if (twilioResponse.ok) return { ok: true };

  const details = await twilioResponse.json().catch(() => ({}));
  const code = details.code ? ` ${details.code}` : "";
  const message = details.message ? `: ${details.message}` : "";
  return { ok: false, error: `Twilio rejected the message${code}${message}` };
}

function isValidDate(value) {
  return value && !Number.isNaN(new Date(value).getTime());
}

function clean(value, fallback, maxLength) {
  const text = String(value ?? fallback).replace(/\s+/g, " ").trim();
  return text.slice(0, maxLength);
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Content-Type": "application/json"
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  };
}
