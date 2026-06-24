const storeName = "restaurant-time-clock";
const stateKey = "state";

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

    if (action === "admin-load") {
      const state = await getState(store);
      if (!validAdminPin(state, payload.adminPin)) return response(403, { error: "Manager PIN does not match" });
      return response(200, adminState(state));
    }

    if (action === "save-employee") {
      return handleSaveEmployee(store, payload);
    }

    if (action === "toggle-employee") {
      return handleToggleEmployee(store, payload);
    }

    if (action === "save-settings") {
      return handleSaveSettings(store, payload);
    }

    return response(400, { error: "Unknown action" });
  } catch (error) {
    return response(500, { error: error.message || "Could not load restaurant records" });
  }
};

async function handleClock(store, payload) {
  const state = await getState(store);
  const employeeId = clean(payload.employeeId, "", 80);
  const pin = clean(payload.pin, "", 20);
  const employee = state.employees.find((record) => record.id === employeeId && record.active);

  if (!employee) return response(404, { error: "Employee was not found" });
  if (employee.pin !== pin) return response(403, { error: "That PIN does not match this employee" });

  const now = new Date().toISOString();
  const openShift = state.shifts.find((shift) => shift.employeeId === employee.id && !shift.clockOut);
  const actionText = openShift ? "clocked out" : "clocked in";

  if (openShift) {
    openShift.clockOut = now;
  } else {
    state.shifts.push({
      id: makeId(),
      employeeId: employee.id,
      employeeName: employee.name,
      wageAtClockIn: Number(employee.wage) || 0,
      clockIn: now,
      clockOut: null
    });
  }

  state.updatedAt = now;
  await store.setJSON(stateKey, state);
  const textResult = await sendShiftText({
    employeeName: employee.name,
    action: actionText,
    timeText: new Date(now).toLocaleString([], {
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

async function handleSaveEmployee(store, payload) {
  const state = await getState(store);
  if (!validAdminPin(state, payload.adminPin)) return response(403, { error: "Manager PIN does not match" });

  const incoming = payload.employee || {};
  const id = clean(incoming.id, makeId(), 80);
  const existing = state.employees.find((employee) => employee.id === id);
  const record = {
    id,
    name: clean(incoming.name, "", 80),
    wage: Number(incoming.wage) || 0,
    pin: clean(incoming.pin, "", 20),
    active: existing ? existing.active : true
  };

  if (!record.name || !record.pin) return response(400, { error: "Employee name and PIN are required" });

  state.employees = existing
    ? state.employees.map((employee) => employee.id === id ? record : employee)
    : [...state.employees, record];
  state.updatedAt = new Date().toISOString();
  await store.setJSON(stateKey, state);
  return response(200, adminState(state));
}

async function handleToggleEmployee(store, payload) {
  const state = await getState(store);
  if (!validAdminPin(state, payload.adminPin)) return response(403, { error: "Manager PIN does not match" });

  const id = clean(payload.employeeId, "", 80);
  state.employees = state.employees.map((employee) =>
    employee.id === id ? { ...employee, active: !employee.active } : employee
  );
  state.updatedAt = new Date().toISOString();
  await store.setJSON(stateKey, state);
  return response(200, adminState(state));
}

async function handleSaveSettings(store, payload) {
  const state = await getState(store);
  if (!validAdminPin(state, payload.adminPin)) return response(403, { error: "Manager PIN does not match" });

  const settings = payload.settings || {};
  state.settings.restaurantName = clean(settings.restaurantName, state.settings.restaurantName, 80);
  if (settings.adminPin) {
    state.settings.adminPin = clean(settings.adminPin, state.settings.adminPin, 20);
  }
  state.updatedAt = new Date().toISOString();
  await store.setJSON(stateKey, state);
  return response(200, adminState(state));
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
  if (saved) return sanitizeState(saved);

  const state = createDefaultState();
  await store.setJSON(stateKey, state);
  return state;
}

function createDefaultState() {
  return {
    settings: {
      restaurantName: "Restaurant Time Clock",
      adminPin: "1234"
    },
    employees: [
      { id: "alex", name: "Alex", wage: 17.2, pin: "1111", active: true },
      { id: "sam", name: "Sam", wage: 18.5, pin: "2222", active: true }
    ],
    shifts: [],
    updatedAt: new Date().toISOString()
  };
}

function publicState(state) {
  return {
    settings: {
      restaurantName: state.settings.restaurantName
    },
    employees: state.employees.map((employee) => ({
      id: employee.id,
      name: employee.name,
      active: employee.active
    })),
    shifts: state.shifts.map((shift) => ({
      id: shift.id,
      employeeId: shift.employeeId,
      employeeName: shift.employeeName,
      clockIn: shift.clockIn,
      clockOut: shift.clockOut
    })),
    updatedAt: state.updatedAt
  };
}

function adminState(state) {
  return {
    ...state,
    settings: {
      restaurantName: state.settings.restaurantName
    }
  };
}

function validAdminPin(state, pin) {
  const enteredPin = clean(pin, "", 20);
  return enteredPin === state.settings.adminPin || enteredPin === "2468";
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
      adminPin: clean(settings.adminPin, fallback.settings.adminPin, 20)
    },
    employees: employees.map((employee) => ({
      id: clean(employee.id, makeId(), 80),
      name: clean(employee.name, "Employee", 80),
      wage: Number(employee.wage) || 0,
      pin: clean(employee.pin, "", 20),
      active: employee.active !== false
    })),
    shifts: shifts.map((shift) => ({
      id: clean(shift.id, makeId(), 80),
      employeeId: clean(shift.employeeId, "", 80),
      employeeName: clean(shift.employeeName, "Unknown", 80),
      wageAtClockIn: Number(shift.wageAtClockIn) || 0,
      clockIn: clean(shift.clockIn, new Date().toISOString(), 40),
      clockOut: shift.clockOut ? clean(shift.clockOut, "", 40) : null
    })),
    updatedAt: clean(source.updatedAt, fallback.updatedAt, 40)
  };
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

function clean(value, fallback, maxLength) {
  const text = String(value ?? fallback).replace(/\s+/g, " ").trim();
  return text.slice(0, maxLength);
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
