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
      return response(200, state);
    }

    if (event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const nextState = sanitizeState(payload.state);
      nextState.updatedAt = new Date().toISOString();
      await store.setJSON(stateKey, nextState);
      return response(200, nextState);
    }

    return response(405, { error: "Method not allowed" });
  } catch (error) {
    return response(500, { error: error.message || "Could not load restaurant records" });
  }
};

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
