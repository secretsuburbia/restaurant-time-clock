const storageKey = "restaurant-time-clock-v1";
const dataFunctionUrl = "/.netlify/functions/time-clock-data";

let state = loadState();
let selectedEmployeeId = "";
let deferredInstallPrompt = null;
let syncTimer = null;
let managerPin = "";

const els = {
  restaurantName: document.querySelector("#restaurantName"),
  currentTime: document.querySelector("#currentTime"),
  activeCount: document.querySelector("#activeCount"),
  employeeSelect: document.querySelector("#employeeSelect"),
  employeePin: document.querySelector("#employeePin"),
  employeeState: document.querySelector("#employeeState"),
  clockAction: document.querySelector("#clockAction"),
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
  exportPayroll: document.querySelector("#exportPayroll"),
  restaurantInput: document.querySelector("#restaurantInput"),
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
      adminPin: "1234"
    },
    employees: [
      { id: newId(), name: "Alex", wage: 17.2, pin: "1111", active: true },
      { id: newId(), name: "Sam", wage: 18.5, pin: "2222", active: true }
    ],
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
    return JSON.parse(saved);
  } catch {
    return createDefaultState();
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
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
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch {
    return null;
  }
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0);
}

function displayTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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
  return state.shifts.find((shift) => shift.employeeId === employeeId && !shift.clockOut);
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
  els.employeeState.textContent = !employee ? "Add employees" : openShift ? "Clocked in" : "Clocked out";
  els.clockAction.textContent = openShift ? "Clock out" : "Clock in";
  els.activeCount.textContent = state.shifts.filter((shift) => !shift.clockOut).length;

  renderToday();
  renderEmployees();
  renderPayroll();
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
          <td>${displayTime(shift.clockOut) || "Working"}</td>
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
      </div>
    </div>
  `).join("");
}

function renderPayroll() {
  const from = els.fromDate.value ? new Date(`${els.fromDate.value}T00:00:00`) : startOfToday();
  const to = els.toDate.value ? new Date(`${els.toDate.value}T23:59:59`) : endOfToday();
  const totals = new Map();

  state.shifts
    .filter((shift) => {
      const clockIn = new Date(shift.clockIn);
      return clockIn >= from && clockIn <= to;
    })
    .forEach((shift) => {
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

  const rows = Array.from(totals.values()).sort((a, b) => a.name.localeCompare(b.name));
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
    setMessage("Clock action failed. Please check the PIN and try again.", "error");
    return;
  }

  state = result.state;
  selectedEmployeeId = employee.id;
  els.employeePin.value = "";
  saveState();
  render();

  const textStatus = result.event.textSent ? " Text sent." : result.event.textError ? ` Text alert failed. ${result.event.textError}.` : "";
  setMessage(`${result.event.employeeName} ${result.event.action} at ${displayTime(result.event.time)}.${textStatus}`, result.event.textSent ? "ok" : "error");
}

async function loadAdminState(pin) {
  if (!canUseCloudData()) return false;
  const result = await postData({ action: "admin-load", adminPin: pin });
  if (!result?.employees) {
    setMessage("Manager PIN does not match.", "error");
    return false;
  }
  managerPin = pin;
  state = result;
  saveState();
  render();
  return true;
}

async function saveEmployeeToCloud(record) {
  const result = await postData({ action: "save-employee", adminPin: managerPin, employee: record });
  if (!result?.employees) {
    setMessage("Employee was not saved. Please unlock admin again.", "error");
    return;
  }
  state = result;
  saveState();
  render();
}

async function toggleEmployeeInCloud(employeeId) {
  const result = await postData({ action: "toggle-employee", adminPin: managerPin, employeeId });
  if (!result?.employees) {
    setMessage("Employee status was not saved. Please unlock admin again.", "error");
    return;
  }
  state = result;
  saveState();
  render();
}

async function saveSettingsToCloud(settings) {
  const result = await postData({ action: "save-settings", adminPin: managerPin, settings });
  if (!result?.employees) {
    setMessage("Settings were not saved. Please unlock admin again.", "error");
    return false;
  }
  state = result;
  saveState();
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

  if (!record.name || Number.isNaN(record.wage) || !record.pin) return;
  els.employeeForm.reset();
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

  if (editId) {
    const employee = getEmployee(editId);
    els.employeeId.value = employee.id;
    els.employeeName.value = employee.name;
    els.employeeWage.value = employee.wage;
    els.employeeFormPin.value = employee.pin;
  }

  if (toggleId) {
    toggleEmployeeInCloud(toggleId);
  }
});

els.adminOpen.addEventListener("click", () => {
  els.adminDialog.showModal();
  els.adminLock.hidden = false;
  els.adminContent.hidden = true;
  els.adminPin.value = "";
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

els.exportToday.addEventListener("click", () => {
  const today = isoDate(startOfToday());
  exportCsv(shiftsInRange(today, today), `time-clock-${today}.csv`);
});

els.exportPayroll.addEventListener("click", () => {
  const from = els.fromDate.value || isoDate(startOfToday());
  const to = els.toDate.value || isoDate(endOfToday());
  exportCsv(shiftsInRange(from, to), `payroll-${from}-to-${to}.csv`);
});

els.saveSettings.addEventListener("click", async () => {
  const settings = {
    restaurantName: els.restaurantInput.value.trim() || "Restaurant Time Clock"
  };
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
loadSharedState(true);
if (canUseCloudData()) {
  syncTimer = setInterval(() => {
    if (!els.adminDialog.open) loadSharedState();
  }, 15000);
}
