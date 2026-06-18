const storageKey = "restaurant-time-clock-v1";

let state = loadState();
let selectedEmployeeId = "";
let deferredInstallPrompt = null;
let hasSignature = false;
let drawing = false;

const els = {
  restaurantName: document.querySelector("#restaurantName"),
  currentTime: document.querySelector("#currentTime"),
  activeCount: document.querySelector("#activeCount"),
  employeeSelect: document.querySelector("#employeeSelect"),
  employeePin: document.querySelector("#employeePin"),
  employeeState: document.querySelector("#employeeState"),
  signaturePad: document.querySelector("#signaturePad"),
  clearSignature: document.querySelector("#clearSignature"),
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
  const employee = getEmployee(selectedEmployeeId);
  if (!employee) {
    setMessage("Add an employee first.", "error");
    return;
  }
  if (els.employeePin.value.trim() !== employee.pin) {
    setMessage("That PIN does not match this employee.", "error");
    return;
  }
  if (!hasSignature) {
    setMessage("Please sign before clocking in or out.", "error");
    return;
  }

  const now = new Date().toISOString();
  const signature = els.signaturePad.toDataURL("image/png");
  const openShift = getOpenShift(employee.id);
  const action = openShift ? "clocked out" : "clocked in";

  if (openShift) {
    openShift.clockOut = now;
    openShift.clockOutSignature = signature;
    setMessage(`${employee.name} clocked out at ${displayTime(now)}.`, "ok");
  } else {
    state.shifts.push({
      id: newId(),
      employeeId: employee.id,
      employeeName: employee.name,
      wageAtClockIn: Number(employee.wage),
      clockIn: now,
      clockInSignature: signature,
      clockOut: null,
      clockOutSignature: null
    });
    setMessage(`${employee.name} clocked in at ${displayTime(now)}.`, "ok");
  }

  els.employeePin.value = "";
  clearSignature();
  saveState();
  render();
  await sendShiftText({
    employeeName: employee.name,
    action,
    time: now,
    timeText: new Date(now).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }),
    restaurantName: state.settings.restaurantName
  });
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

function saveEmployee(event) {
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
  state.employees = existing
    ? state.employees.map((employee) => employee.id === id ? record : employee)
    : [...state.employees, record];

  els.employeeForm.reset();
  els.employeeId.value = "";
  selectedEmployeeId = selectedEmployeeId || id;
  saveState();
  render();
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

function clearSignature() {
  const context = els.signaturePad.getContext("2d");
  context.clearRect(0, 0, els.signaturePad.width, els.signaturePad.height);
  hasSignature = false;
}

function canvasPoint(event) {
  const rect = els.signaturePad.getBoundingClientRect();
  const touch = event.touches?.[0] || event;
  return {
    x: (touch.clientX - rect.left) * (els.signaturePad.width / rect.width),
    y: (touch.clientY - rect.top) * (els.signaturePad.height / rect.height)
  };
}

function startDrawing(event) {
  drawing = true;
  hasSignature = true;
  const point = canvasPoint(event);
  const context = els.signaturePad.getContext("2d");
  context.beginPath();
  context.moveTo(point.x, point.y);
}

function draw(event) {
  if (!drawing) return;
  event.preventDefault();
  const point = canvasPoint(event);
  const context = els.signaturePad.getContext("2d");
  context.lineWidth = 4;
  context.lineCap = "round";
  context.strokeStyle = "#17211f";
  context.lineTo(point.x, point.y);
  context.stroke();
}

function stopDrawing() {
  drawing = false;
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
  clearSignature();
  setMessage("");
  render();
});

els.clockAction.addEventListener("click", clockAction);
els.clearSignature.addEventListener("click", clearSignature);
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
    state.employees = state.employees.map((employee) =>
      employee.id === toggleId ? { ...employee, active: !employee.active } : employee
    );
    saveState();
    render();
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

els.unlockAdmin.addEventListener("click", () => {
  if (els.adminPin.value !== state.settings.adminPin) return;
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

els.saveSettings.addEventListener("click", () => {
  state.settings.restaurantName = els.restaurantInput.value.trim() || "Restaurant Time Clock";
  if (els.adminPinChange.value.trim()) {
    state.settings.adminPin = els.adminPinChange.value.trim();
    els.adminPinChange.value = "";
  }
  saveState();
  render();
});

["mousedown", "touchstart"].forEach((name) => els.signaturePad.addEventListener(name, startDrawing));
["mousemove", "touchmove"].forEach((name) => els.signaturePad.addEventListener(name, draw, { passive: false }));
["mouseup", "mouseleave", "touchend", "touchcancel"].forEach((name) => els.signaturePad.addEventListener(name, stopDrawing));

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
clearSignature();
