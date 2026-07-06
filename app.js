const storageKey = "restaurant-time-clock-v1";
const autoClockStorageKey = "restaurant-time-clock-auto-clock-session";
const dataFunctionUrl = "/.netlify/functions/time-clock-data";
const autoClockOutsideGraceMs = 90 * 1000;
const maxUsefulAccuracyMeters = 250;

let state = loadState();
let selectedEmployeeId = "";
let deferredInstallPrompt = null;
let syncTimer = null;
let managerToken = "";
let autoClockWatchId = null;
let autoClockSession = loadAutoClockSession();
let outsidePremisesSince = 0;
let autoClockOutInFlight = false;

const els = {
  restaurantName: document.querySelector("#restaurantName"),
  currentTime: document.querySelector("#currentTime"),
  activeCount: document.querySelector("#activeCount"),
  employeeSelect: document.querySelector("#employeeSelect"),
  employeePin: document.querySelector("#employeePin"),
  employeeState: document.querySelector("#employeeState"),
  clockAction: document.querySelector("#clockAction"),
  autoClockOutConsent: document.querySelector("#autoClockOutConsent"),
  autoClockOutStatus: document.querySelector("#autoClockOutStatus"),
  message: document.querySelector("#message"),
  todayRows: document.querySelector("#todayRows"),
  exportToday: document.querySelector("#exportToday"),
  adminOpen: document.querySelector("#adminOpen"),
  adminDialog: document.querySelector("#adminDialog"),
  adminClose: document.querySelector("#adminClose"),
  adminLock: document.querySelector("#adminLock"),
  adminPin: document.querySelector("#adminPin"),
  unlockAdmin: document.querySelector("#unlockAdmin"),
  adminContent: document.querySelector("#adminContent"),
  employeeForm: document.querySelector("#employeeForm"),
  employeeId: document.querySelector("#employeeId"),
  employeeName: document.querySelector("#employeeName"),
  employeeWage: document.querySelector("#employeeWage"),
  employeeFormPin: document.querySelector("#employeeFormPin"),
  employeeList: document.querySelector("#employeeList"),
  fromDate: document.querySelector("#fromDate"),
  toDate: document.querySelector("#toDate"),
  payrollSummary: document.querySelector("#payrollSummary"),
  payrollReport: document.querySelector("#payrollReport"),
  correctionList: document.querySelector("#correctionList"),
  exportPayroll: document.querySelector("#exportPayroll"),
  emailPayroll: document.querySelector("#emailPayroll"),
  printPayroll: document.querySelector("#printPayroll"),
  restaurantInput: document.querySelector("#restaurantInput"),
  autoClockOutEnabled: document.querySelector("#autoClockOutEnabled"),
  geofenceLatitude: document.querySelector("#geofenceLatitude"),
  geofenceLongitude: document.querySelector("#geofenceLongitude"),
  geofenceRadiusMeters: document.querySelector("#geofenceRadiusMeters"),
  useCurrentLocation: document.querySelector("#useCurrentLocation"),
  adminPinChange: document.querySelector("#adminPinChange"),
  saveSettings: document.querySelector("#saveSettings"),
  installButton: document.querySelector("#installButton")
};

function newId() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createDefaultState() {
  return {
    settings: {
      restaurantName: "Restaurant Time Clock",
      autoClockOutEnabled: false,
      geofenceLatitude: null,
      geofenceLongitude: null,
      geofenceRadiusMeters: 150
    },
    employees: [],
    shifts: []
  };
}
function canUseCloudData() {
  return Boolean(location.hostname) && location.protocol !== "file:";
}

function loadState() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return createDefaultState();
  try {
    const safeState = safeCachedState(JSON.parse(saved));
    localStorage.setItem(storageKey, JSON.stringify(safeState));
    return safeState;
  } catch {
    return createDefaultState();
  }
}

function safeCachedState(source) {
  return {
    settings: {
      restaurantName: source?.settings?.restaurantName || "Restaurant Time Clock",
      autoClockOutEnabled: Boolean(source?.settings?.autoClockOutEnabled),
      geofenceLatitude: numberOrNull(source?.settings?.geofenceLatitude),
      geofenceLongitude: numberOrNull(source?.settings?.geofenceLongitude),
      geofenceRadiusMeters: Math.max(50, Math.min(5000, Number(source?.settings?.geofenceRadiusMeters) || 150))
    },
    employees: (source?.employees || []).map((employee) => ({
      id: employee.id,
      name: employee.name,
      active: employee.active
    })),
    shifts: []
  };
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(safeCachedState(state)));
}

function loadAutoClockSession() {
  try {
    const session = JSON.parse(localStorage.getItem(autoClockStorageKey) || "null");
    return session?.employeeId && session?.shiftId && session?.autoClockToken ? session : null;
  } catch {
    return null;
  }
}

function saveAutoClockSession(session) {
  autoClockSession = session;
  if (session) {
    localStorage.setItem(autoClockStorageKey, JSON.stringify(session));
  } else {
    localStorage.removeItem(autoClockStorageKey);
  }
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function loadSharedState(showMessage = false) {
  if (!canUseCloudData()) return false;

  try {
    const response = await fetch(dataFunctionUrl, { headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    state = await response.json();
    saveState();
    if (!getEmployee(selectedEmployeeId)) {
      selectedEmployeeId = state.employees.find((employee) => employee.active)?.id || "";
    }
    render();
    if (autoClockSession && autoClockWatchId === null) startAutoClockWatcher();
    if (showMessage) setMessage("Shared restaurant records loaded.", "ok");
    return true;
  } catch {
    if (showMessage) setMessage("Could not load shared records. This phone is showing its saved copy.", "error");
    return false;
  }
}

async function postData(payload) {
  if (!canUseCloudData()) return true;

  try {
    const response = await fetch(dataFunctionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return { ...result, status: response.status };
    return result;
  } catch {
    return { error: "The shared service could not be reached" };
  }
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0);
}

function displayTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function clockOutLabel(shift) {
  if (!shift.clockOut) return "";
  const label = displayTime(shift.clockOut);
  return shift.clockOutReason === "auto-left-premises" ? `${label} (auto)` : label;
}

function displayHours(hours) {
  return Number(hours || 0).toFixed(2);
}

function sameDay(a, b) {
  const first = new Date(a);
  const second = new Date(b);
  return first.toDateString() === second.toDateString();
}

function getEmployee(id) {
  return state.employees.find((employee) => employee.id === id);
}

function getOpenShift(employeeId) {
  return state.shifts.find((shift) => shift.employeeId === employeeId && !shift.clockOut) || (getEmployee(employeeId)?.clockedIn ? { employeeId } : null);
}

function shiftHours(shift) {
  const start = new Date(shift.clockIn).getTime();
  const end = shift.clockOut ? new Date(shift.clockOut).getTime() : Date.now();
  return Math.max(0, (end - start) / 36e5);
}

function shiftPay(shift) {
  return shiftHours(shift) * Number(shift.wageAtClockIn || 0);
}

function setMessage(text, type = "") {
  els.message.textContent = text;
  els.message.className = `message ${type}`.trim();
}

function render() {
  els.restaurantName.textContent = state.settings.restaurantName;
  document.title = state.settings.restaurantName;
  selectedEmployeeId = selectedEmployeeId || state.employees.find((employee) => employee.active)?.id || "";

  els.employeeSelect.innerHTML = state.employees
    .filter((employee) => employee.active)
    .map((employee) => `<option value="${employee.id}">${escapeHtml(employee.name)}</option>`)
    .join("");
  els.employeeSelect.value = selectedEmployeeId;

  const employee = getEmployee(selectedEmployeeId);
  const openShift = employee ? getOpenShift(employee.id) : null;
  const managerView = Boolean(managerToken);
  els.employeeState.textContent = !employee ? "No employees available" : managerView ? (openShift ? "Clocked in" : "Clocked out") : "Enter PIN to continue";
  els.clockAction.textContent = managerView ? (openShift ? "Clock out" : "Clock in") : "Clock in / out";
  els.activeCount.textContent = managerView ? state.shifts.filter((shift) => !shift.clockOut).length : "-";
  renderAutoClockStatus();

  renderToday();
  renderEmployees();
  renderPayroll();
}

function geofenceConfigured() {
  return Boolean(
    state.settings.autoClockOutEnabled &&
    Number.isFinite(Number(state.settings.geofenceLatitude)) &&
    Number.isFinite(Number(state.settings.geofenceLongitude)) &&
    Number(state.settings.geofenceRadiusMeters) >= 50
  );
}

function renderAutoClockStatus() {
  if (!els.autoClockOutConsent || !els.autoClockOutStatus) return;
  const configured = geofenceConfigured();
  els.autoClockOutConsent.disabled = !configured || !("geolocation" in navigator);

  if (!("geolocation" in navigator)) {
    els.autoClockOutStatus.textContent = "Auto clock-out is not available on this device.";
    return;
  }

  if (!configured) {
    els.autoClockOutStatus.textContent = "Auto clock-out is off until a manager sets the restaurant location.";
    return;
  }

  if (autoClockSession) {
    els.autoClockOutStatus.textContent = "Auto clock-out is watching this phone's location for the current shift.";
    return;
  }

  els.autoClockOutStatus.textContent = "Check the box before clocking in to auto clock out when this phone leaves the restaurant.";
}

function renderToday() {
  const rows = state.shifts
    .filter((shift) => sameDay(shift.clockIn, new Date()))
    .sort((a, b) => new Date(b.clockIn) - new Date(a.clockIn));

  els.todayRows.innerHTML = rows.length
    ? rows.map((shift) => {
      const employee = getEmployee(shift.employeeId);
      return `
        <tr>
          <td>${escapeHtml(employee?.name || shift.employeeName || "Unknown")}</td>
          <td>${displayTime(shift.clockIn)}</td>
          <td>${clockOutLabel(shift) || "Working"}</td>
          <td>${displayHours(shiftHours(shift))}</td>
          <td>${money(shiftPay(shift))}</td>
        </tr>
      `;
    }).join("")
    : `<tr><td colspan="5">No shifts yet today.</td></tr>`;
}

function renderEmployees() {
  els.employeeList.innerHTML = state.employees.map((employee) => `
    <div class="employee-item">
      <div>
        <strong>${escapeHtml(employee.name)}</strong>
        <div class="hint">${money(employee.wage)} per hour${employee.active ? "" : " - inactive"}</div>
      </div>
      <div class="employee-actions">
        <button class="secondary" type="button" data-edit="${employee.id}">Edit</button>
        <button class="secondary danger" type="button" data-toggle="${employee.id}">
          ${employee.active ? "Disable" : "Enable"}
        </button>
        <button class="secondary danger" type="button" data-delete-employee="${employee.id}">Delete</button>
      </div>
    </div>
  `).join("");
}

function buildPayrollReport() {
  const from = els.fromDate.value ? new Date(`${els.fromDate.value}T00:00:00`) : startOfToday();
  const to = els.toDate.value ? new Date(`${els.toDate.value}T23:59:59`) : endOfToday();
  const shifts = state.shifts
    .filter((shift) => {
      const clockIn = new Date(shift.clockIn);
      return clockIn >= from && clockIn <= to;
    })
    .sort((a, b) => new Date(a.clockIn) - new Date(b.clockIn));
  const totals = new Map();

  shifts.forEach((shift) => {
    const employee = getEmployee(shift.employeeId);
    const key = shift.employeeId;
    const current = totals.get(key) || {
      name: employee?.name || shift.employeeName || "Unknown",
      hours: 0,
      pay: 0
    };
    current.hours += shiftHours(shift);
    current.pay += shiftPay(shift);
    totals.set(key, current);
  });

  return {
    from,
    to,
    shifts,
    rows: Array.from(totals.values()).sort((a, b) => a.name.localeCompare(b.name)),
    totalHours: Array.from(totals.values()).reduce((sum, row) => sum + row.hours, 0),
    totalPay: Array.from(totals.values()).reduce((sum, row) => sum + row.pay, 0)
  };
}

function renderPayroll() {
  const report = buildPayrollReport();
  const rows = report.rows;

  els.payrollSummary.innerHTML = rows.length
    ? rows.map((row) => `
      <div class="summary-item">
        <div>
          <strong>${escapeHtml(row.name)}</strong>
          <div class="hint">${displayHours(row.hours)} hours</div>
        </div>
        <strong>${money(row.pay)}</strong>
      </div>
    `).join("")
    : `<p class="hint">No shifts in this date range.</p>`;

  renderPayrollReport(report);
  renderShiftCorrections(report);
}

function renderShiftCorrections(report) {
  if (!els.correctionList) return;

  els.correctionList.innerHTML = report.shifts.length
    ? report.shifts.map((shift) => `
      <div class="correction-item" data-shift-id="${escapeHtml(shift.id)}">
        <div>
          <strong>${escapeHtml(shift.employeeName || getEmployee(shift.employeeId)?.name || "Unknown")}</strong>
          <div class="hint">${displayHours(shiftHours(shift))} hours</div>
        </div>
        <div class="correction-fields">
          <label>
            In
            <input type="datetime-local" data-correction-in value="${toDateTimeLocal(shift.clockIn)}">
          </label>
          <label>
            Out
            <input type="datetime-local" data-correction-out value="${shift.clockOut ? toDateTimeLocal(shift.clockOut) : ""}">
          </label>
        </div>
        <div class="employee-actions correction-actions">
          <button class="secondary" type="button" data-save-shift="${escapeHtml(shift.id)}">Save</button>
          <button class="secondary danger" type="button" data-delete-shift="${escapeHtml(shift.id)}">Delete</button>
        </div>
      </div>
    `).join("")
    : `<p class="hint">No shifts to correct in this date range.</p>`;
}
function renderPayrollReport(report) {
  const range = `${formatDate(report.from)} to ${formatDate(report.to)}`;
  const summaryRows = report.rows.length
    ? report.rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td>${displayHours(row.hours)}</td>
        <td>${money(row.pay)}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="3">No shifts in this date range.</td></tr>`;
  const shiftRows = report.shifts.length
    ? report.shifts.map((shift) => `
      <tr>
        <td>${escapeHtml(shift.employeeName || getEmployee(shift.employeeId)?.name || "Unknown")}</td>
        <td>${new Date(shift.clockIn).toLocaleString()}</td>
        <td>${shift.clockOut ? `${new Date(shift.clockOut).toLocaleString()}${shift.clockOutReason === "auto-left-premises" ? " (auto)" : ""}` : "Still working"}</td>
        <td>${displayHours(shiftHours(shift))}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="4">No shift details in this date range.</td></tr>`;

  els.payrollReport.innerHTML = `
    <div class="report-title">
      <div>
        <p class="eyebrow">Payroll report</p>
        <h3>${escapeHtml(state.settings.restaurantName)}</h3>
        <p class="hint">${escapeHtml(range)}</p>
      </div>
      <div class="report-total">
        <strong>${displayHours(report.totalHours)}</strong>
        <span>Total hours</span>
      </div>
      <div class="report-total">
        <strong>${money(report.totalPay)}</strong>
        <span>Estimated pay</span>
      </div>
    </div>
    <h4>Summary</h4>
    <div class="table-wrap report-table-wrap">
      <table>
        <thead><tr><th>Employee</th><th>Hours</th><th>Pay</th></tr></thead>
        <tbody>${summaryRows}</tbody>
      </table>
    </div>
    <h4>Shift details</h4>
    <div class="table-wrap report-table-wrap">
      <table>
        <thead><tr><th>Employee</th><th>Clock in</th><th>Clock out</th><th>Hours</th></tr></thead>
        <tbody>${shiftRows}</tbody>
      </table>
    </div>
  `;
}

async function clockAction() {
  await loadSharedState();

  const employee = getEmployee(selectedEmployeeId);
  if (!employee) {
    setMessage("Add an employee first.", "error");
    return;
  }
  if (!els.employeePin.value.trim()) {
    setMessage("Enter your PIN first.", "error");
    return;
  }
  setMessage("Checking PIN...", "ok");

  if (!canUseCloudData()) {
    setMessage("Shared records are only available on the live Netlify app.", "error");
    return;
  }

  const result = await postData({
    action: "clock",
    employeeId: employee.id,
    pin: els.employeePin.value.trim()
  });

  if (!result?.state || !result?.event) {
    setMessage(result?.error || "Clock action failed. Please check the PIN and try again.", "error");
    return;
  }

  state = result.state;
  selectedEmployeeId = employee.id;
  els.employeePin.value = "";
  saveState();

  if (result.event.action === "clocked in" && els.autoClockOutConsent?.checked && result.event.autoClockToken) {
    saveAutoClockSession({
      employeeId: employee.id,
      employeeName: result.event.employeeName,
      shiftId: result.event.shiftId,
      autoClockToken: result.event.autoClockToken
    });
    startAutoClockWatcher();
  } else if (result.event.action === "clocked out" && autoClockSession?.employeeId === employee.id) {
    stopAutoClockWatcher();
    saveAutoClockSession(null);
  }

  render();

  const textStatus = result.event.textSent ? " Text sent." : result.event.textError ? ` Text alert failed. ${result.event.textError}.` : "";
  setMessage(`${result.event.employeeName} ${result.event.action} at ${displayTime(result.event.time)}.${textStatus}`, result.event.textSent ? "ok" : "error");
}

function startAutoClockWatcher() {
  if (!autoClockSession || !geofenceConfigured() || !("geolocation" in navigator)) return;
  if (autoClockWatchId !== null) navigator.geolocation.clearWatch(autoClockWatchId);

  outsidePremisesSince = 0;
  autoClockWatchId = navigator.geolocation.watchPosition(
    handleAutoClockPosition,
    handleAutoClockLocationError,
    {
      enableHighAccuracy: true,
      maximumAge: 30 * 1000,
      timeout: 60 * 1000
    }
  );
  renderAutoClockStatus();
}

function stopAutoClockWatcher() {
  if (autoClockWatchId !== null && "geolocation" in navigator) {
    navigator.geolocation.clearWatch(autoClockWatchId);
  }
  autoClockWatchId = null;
  outsidePremisesSince = 0;
  autoClockOutInFlight = false;
  renderAutoClockStatus();
}

function handleAutoClockLocationError() {
  if (!autoClockSession) return;
  els.autoClockOutStatus.textContent = "Auto clock-out needs location permission to keep watching this shift.";
}

function handleAutoClockPosition(position) {
  if (!autoClockSession || autoClockOutInFlight || !geofenceConfigured()) return;

  const { latitude, longitude, accuracy } = position.coords;
  if (Number(accuracy) > maxUsefulAccuracyMeters) {
    els.autoClockOutStatus.textContent = "Auto clock-out is waiting for a more accurate location reading.";
    return;
  }

  const distance = distanceMeters(
    latitude,
    longitude,
    Number(state.settings.geofenceLatitude),
    Number(state.settings.geofenceLongitude)
  );
  const radius = Number(state.settings.geofenceRadiusMeters) || 150;
  const outside = distance > radius + Math.min(Number(accuracy) || 0, radius);

  if (!outside) {
    outsidePremisesSince = 0;
    els.autoClockOutStatus.textContent = `Auto clock-out active. This phone is about ${Math.round(distance)} m from the restaurant.`;
    return;
  }

  if (!outsidePremisesSince) outsidePremisesSince = Date.now();
  const remainingMs = autoClockOutsideGraceMs - (Date.now() - outsidePremisesSince);
  if (remainingMs > 0) {
    els.autoClockOutStatus.textContent = `Outside the restaurant area. Auto clock-out in ${Math.ceil(remainingMs / 1000)} seconds if still outside.`;
    return;
  }

  autoClockOut();
}

async function autoClockOut() {
  if (!autoClockSession || autoClockOutInFlight) return;
  autoClockOutInFlight = true;
  setMessage("Auto clocking out because this phone left the restaurant area...", "ok");

  const result = await postData({
    action: "auto-clock-out",
    employeeId: autoClockSession.employeeId,
    shiftId: autoClockSession.shiftId,
    autoClockToken: autoClockSession.autoClockToken
  });

  if (!result?.state || !result?.event) {
    const alreadyClockedOut = result?.status === 409;
    if (alreadyClockedOut) {
      stopAutoClockWatcher();
      saveAutoClockSession(null);
      await loadSharedState();
      setMessage("Auto clock-out stopped because this shift is already clocked out.", "ok");
      return;
    }

    autoClockOutInFlight = false;
    setMessage(result?.error || "Auto clock-out could not be saved. Please clock out manually.", "error");
    return;
  }

  state = result.state;
  saveState();
  stopAutoClockWatcher();
  saveAutoClockSession(null);
  render();

  const textStatus = result.event.textSent ? " Text sent." : result.event.textError ? ` Text alert failed. ${result.event.textError}.` : "";
  setMessage(`${result.event.employeeName} ${result.event.action} at ${displayTime(result.event.time)}.${textStatus}`, result.event.textSent ? "ok" : "error");
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const earthRadiusMeters = 6371e3;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function loadAdminState(pin) {
  if (!canUseCloudData()) return false;
  const result = await postData({ action: "admin-load", adminPin: pin });
  if (!result?.employees || !result?.adminToken) {
    setMessage("Manager PIN does not match.", "error");
    return false;
  }
  applyAdminState(result);
  render();
  return true;
}

function applyAdminState(result) {
  managerToken = result.adminToken || managerToken;
  const { adminToken, ...adminState } = result;
  state = adminState;
  saveState();
}

function managerSessionFailed(message) {
  managerToken = "";
  els.adminLock.hidden = false;
  els.adminContent.hidden = true;
  setMessage(message, "error");
}

async function saveEmployeeToCloud(record) {
  const result = await postData({ action: "save-employee", adminToken: managerToken, employee: record });
  if (!result?.employees) {
    managerSessionFailed("Employee was not saved. Please unlock admin again.");
    return;
  }
  applyAdminState(result);
  render();
  setMessage("Employee saved.", "ok");
}

async function toggleEmployeeInCloud(employeeId) {
  const result = await postData({ action: "toggle-employee", adminToken: managerToken, employeeId });
  if (!result?.employees) {
    managerSessionFailed("Employee status was not saved. Please unlock admin again.");
    return;
  }
  applyAdminState(result);
  render();
}

async function deleteEmployeeInCloud(employeeId) {
  const result = await postData({ action: "delete-employee", adminToken: managerToken, employeeId });
  if (!result?.employees) {
    setMessage(result?.error || "Employee was not deleted.", "error");
    return;
  }
  if (selectedEmployeeId === employeeId) selectedEmployeeId = "";
  applyAdminState(result);
  els.employeeForm.reset();
  els.employeeId.value = "";
  els.employeeFormPin.placeholder = "Required for new employees";
  render();
  setMessage("Employee deleted. Existing shift records were preserved.", "ok");
}

async function updateShiftInCloud(shift) {
  const result = await postData({ action: "update-shift", adminToken: managerToken, shift });
  if (!result?.employees) {
    managerSessionFailed("Shift correction was not saved. Please unlock admin again.");
    return;
  }
  applyAdminState(result);
  render();
  setMessage("Shift correction saved.", "ok");
}

async function deleteShiftInCloud(shiftId) {
  const result = await postData({ action: "delete-shift", adminToken: managerToken, shiftId });
  if (!result?.employees) {
    managerSessionFailed("Shift was not deleted. Please unlock admin again.");
    return;
  }
  applyAdminState(result);
  render();
  setMessage("Shift deleted.", "ok");
}

async function saveSettingsToCloud(settings) {
  const result = await postData({ action: "save-settings", adminToken: managerToken, settings });
  if (!result?.employees) {
    managerSessionFailed("Settings were not saved. Please unlock admin again.");
    return false;
  }
  applyAdminState(result);
  render();
  return true;
}
async function sendShiftText(event) {
  if (!location.hostname || location.protocol === "file:") return;

  try {
    const response = await fetch("/.netlify/functions/send-shift-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event)
    });

    if (response.ok) {
      setMessage(`${event.employeeName} ${event.action} at ${displayTime(event.time)}. Text sent.`, "ok");
      return;
    }

    const result = await response.json().catch(() => ({}));
    const detail = result.error ? ` ${result.error}.` : ` HTTP ${response.status}.`;
    setMessage(`${event.employeeName} ${event.action} at ${displayTime(event.time)}. Text alert failed.${detail}`, "error");
  } catch {
    setMessage(`${event.employeeName} ${event.action} at ${displayTime(event.time)}. Text alert could not be sent.`, "ok");
  }
}

async function saveEmployee(event) {
  event.preventDefault();
  const id = els.employeeId.value || newId();
  const existing = getEmployee(id);
  const record = {
    id,
    name: els.employeeName.value.trim(),
    wage: Number(els.employeeWage.value),
    pin: els.employeeFormPin.value.trim(),
    active: existing ? existing.active : true
  };

  if (!record.name || Number.isNaN(record.wage) || (!existing && !record.pin)) {
    setMessage("Name, wage, and a PIN are required for a new employee.", "error");
    return;
  }
  els.employeeForm.reset();
  els.employeeFormPin.placeholder = "Required for new employees";
  els.employeeId.value = "";
  selectedEmployeeId = selectedEmployeeId || id;
  await saveEmployeeToCloud(record);
}

function exportCsv(shifts, fileName) {
  const header = ["Employee", "Clock In", "Clock Out", "Hours", "Wage", "Pay"];
  const rows = shifts.map((shift) => {
    const employee = getEmployee(shift.employeeId);
    return [
      employee?.name || shift.employeeName || "Unknown",
      new Date(shift.clockIn).toLocaleString(),
      shift.clockOut ? new Date(shift.clockOut).toLocaleString() : "",
      displayHours(shiftHours(shift)),
      Number(shift.wageAtClockIn || 0).toFixed(2),
      shiftPay(shift).toFixed(2)
    ];
  });
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfToday() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatDate(date) {
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function toDateTimeLocal(value) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function fromDateTimeLocal(value) {
  return value ? new Date(value).toISOString() : null;
}

function buildPayrollEmail(report) {
  const lines = [
    `${state.settings.restaurantName} payroll report`,
    `${formatDate(report.from)} to ${formatDate(report.to)}`,
    "",
    `Total hours: ${displayHours(report.totalHours)}`,
    `Estimated pay: ${money(report.totalPay)}`,
    "",
    "Employee summary:"
  ];

  if (report.rows.length) {
    report.rows.forEach((row) => {
      lines.push(`${row.name}: ${displayHours(row.hours)} hours, ${money(row.pay)}`);
    });
  } else {
    lines.push("No shifts in this date range.");
  }

  lines.push("", "Shift details:");
  if (report.shifts.length) {
    report.shifts.forEach((shift) => {
      const name = shift.employeeName || getEmployee(shift.employeeId)?.name || "Unknown";
      const clockIn = new Date(shift.clockIn).toLocaleString();
      const clockOut = shift.clockOut ? `${new Date(shift.clockOut).toLocaleString()}${shift.clockOutReason === "auto-left-premises" ? " (auto)" : ""}` : "Still working";
      lines.push(`${name}: ${clockIn} to ${clockOut}, ${displayHours(shiftHours(shift))} hours`);
    });
  } else {
    lines.push("No shift details in this date range.");
  }

  return lines.join("\n");
}

function shiftsInRange(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(`${toDate}T23:59:59`);
  return state.shifts.filter((shift) => {
    const clockIn = new Date(shift.clockIn);
    return clockIn >= from && clockIn <= to;
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.employeeSelect.addEventListener("change", () => {
  selectedEmployeeId = els.employeeSelect.value;
  els.employeePin.value = "";
  setMessage("");
  render();
});

els.clockAction.addEventListener("click", clockAction);
els.employeeForm.addEventListener("submit", saveEmployee);

els.employeeList.addEventListener("click", (event) => {
  const editId = event.target.dataset.edit;
  const toggleId = event.target.dataset.toggle;
  const deleteId = event.target.dataset.deleteEmployee;

  if (editId) {
    const employee = getEmployee(editId);
    els.employeeId.value = employee.id;
    els.employeeName.value = employee.name;
    els.employeeWage.value = employee.wage;
    els.employeeFormPin.value = "";
    els.employeeFormPin.placeholder = "Leave blank to keep current PIN";
  }

  if (toggleId) {
    toggleEmployeeInCloud(toggleId);
  }

  if (deleteId) {
    const employee = getEmployee(deleteId);
    const confirmed = confirm(`Permanently delete ${employee?.name || "this employee"}? Existing shift records will be kept.`);
    if (!confirmed) return;
    deleteEmployeeInCloud(deleteId);
  }
});

els.adminOpen.addEventListener("click", () => {
  managerToken = "";
  els.adminDialog.showModal();
  els.adminLock.hidden = false;
  els.adminContent.hidden = true;
  els.adminPin.value = "";
});

els.adminDialog.addEventListener("close", () => {
  managerToken = "";
  els.adminLock.hidden = false;
  els.adminContent.hidden = true;
  loadSharedState();
});
els.adminClose.addEventListener("click", () => {
  els.adminDialog.close();
});

els.unlockAdmin.addEventListener("click", async () => {
  const unlocked = await loadAdminState(els.adminPin.value);
  if (!unlocked) return;
  els.adminLock.hidden = true;
  els.adminContent.hidden = false;
  els.restaurantInput.value = state.settings.restaurantName;
  els.autoClockOutEnabled.checked = Boolean(state.settings.autoClockOutEnabled);
  els.geofenceLatitude.value = state.settings.geofenceLatitude ?? "";
  els.geofenceLongitude.value = state.settings.geofenceLongitude ?? "";
  els.geofenceRadiusMeters.value = state.settings.geofenceRadiusMeters || 150;
  els.fromDate.value = els.fromDate.value || isoDate(startOfToday());
  els.toDate.value = els.toDate.value || isoDate(endOfToday());
  renderPayroll();
});

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.hidden = true);
    button.classList.add("active");
    document.querySelector(`#${button.dataset.tab}Panel`).hidden = false;
    renderPayroll();
  });
});

els.fromDate.addEventListener("change", renderPayroll);
els.toDate.addEventListener("change", renderPayroll);

els.correctionList?.addEventListener("click", async (event) => {
  const saveId = event.target.dataset.saveShift;
  const deleteId = event.target.dataset.deleteShift;

  if (saveId) {
    const item = event.target.closest(".correction-item");
    const clockIn = fromDateTimeLocal(item.querySelector("[data-correction-in]").value);
    const clockOut = fromDateTimeLocal(item.querySelector("[data-correction-out]").value);

    if (!clockIn) {
      setMessage("Clock-in time is required.", "error");
      return;
    }
    if (clockOut && new Date(clockOut) < new Date(clockIn)) {
      setMessage("Clock-out cannot be before clock-in.", "error");
      return;
    }

    await updateShiftInCloud({ id: saveId, clockIn, clockOut });
  }

  if (deleteId) {
    const confirmed = confirm("Delete this shift record? This cannot be undone.");
    if (!confirmed) return;
    await deleteShiftInCloud(deleteId);
  }
});
els.exportToday.addEventListener("click", () => {
  const today = isoDate(startOfToday());
  exportCsv(shiftsInRange(today, today), `time-clock-${today}.csv`);
});

els.exportPayroll.addEventListener("click", () => {
  const from = els.fromDate.value || isoDate(startOfToday());
  const to = els.toDate.value || isoDate(endOfToday());
  exportCsv(shiftsInRange(from, to), `payroll-${from}-to-${to}.csv`);
});

els.emailPayroll.addEventListener("click", () => {
  const report = buildPayrollReport();
  const subject = `${state.settings.restaurantName} payroll report ${formatDate(report.from)} to ${formatDate(report.to)}`;
  const body = buildPayrollEmail(report);
  location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
});

els.printPayroll.addEventListener("click", () => {
  renderPayroll();
  document.body.classList.add("printing-report");
  window.print();
});

window.addEventListener("afterprint", () => {
  document.body.classList.remove("printing-report");
});

els.useCurrentLocation.addEventListener("click", () => {
  if (!("geolocation" in navigator)) {
    setMessage("This device does not support location.", "error");
    return;
  }

  setMessage("Getting this phone's current location...", "ok");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      els.geofenceLatitude.value = position.coords.latitude.toFixed(6);
      els.geofenceLongitude.value = position.coords.longitude.toFixed(6);
      els.geofenceRadiusMeters.value = els.geofenceRadiusMeters.value || 150;
      setMessage(`Restaurant location filled in. Accuracy: about ${Math.round(position.coords.accuracy)} meters.`, "ok");
    },
    () => {
      setMessage("Location permission was denied or unavailable.", "error");
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
});

els.saveSettings.addEventListener("click", async () => {
  const settings = {
    restaurantName: els.restaurantInput.value.trim() || "Restaurant Time Clock",
    autoClockOutEnabled: els.autoClockOutEnabled.checked,
    geofenceLatitude: els.geofenceLatitude.value.trim(),
    geofenceLongitude: els.geofenceLongitude.value.trim(),
    geofenceRadiusMeters: els.geofenceRadiusMeters.value.trim() || 150
  };

  if (settings.autoClockOutEnabled && (!settings.geofenceLatitude || !settings.geofenceLongitude)) {
    setMessage("Add the restaurant latitude and longitude before enabling auto clock-out.", "error");
    return;
  }
  if (settings.autoClockOutEnabled && (
    !Number.isFinite(Number(settings.geofenceLatitude)) ||
    !Number.isFinite(Number(settings.geofenceLongitude)) ||
    !Number.isFinite(Number(settings.geofenceRadiusMeters))
  )) {
    setMessage("Restaurant location and radius must be valid numbers.", "error");
    return;
  }
  if (settings.autoClockOutEnabled && (
    Number(settings.geofenceLatitude) < -90 ||
    Number(settings.geofenceLatitude) > 90 ||
    Number(settings.geofenceLongitude) < -180 ||
    Number(settings.geofenceLongitude) > 180 ||
    Number(settings.geofenceRadiusMeters) < 50
  )) {
    setMessage("Use a valid latitude, longitude, and radius of at least 50 meters.", "error");
    return;
  }

  if (els.adminPinChange.value.trim()) {
    settings.adminPin = els.adminPinChange.value.trim();
    els.adminPinChange.value = "";
  }
  const savedShared = await saveSettingsToCloud(settings);
  setMessage(savedShared ? "Settings saved to shared records." : "Settings were not saved.", savedShared ? "ok" : "error");
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  els.installButton.hidden = false;
});

els.installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  els.installButton.hidden = true;
});

setInterval(() => {
  els.currentTime.textContent = new Date().toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  });
  renderToday();
}, 1000);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js").catch(() => {});
}

els.fromDate.value = isoDate(startOfToday());
els.toDate.value = isoDate(endOfToday());
render();
if (autoClockSession) startAutoClockWatcher();
loadSharedState(true);
if (canUseCloudData()) {
  syncTimer = setInterval(() => {
    if (!els.adminDialog.open) loadSharedState();
  }, 15000);
}
