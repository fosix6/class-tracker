const STORAGE_KEY = "class-tracker-data-v1";
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function taskSlotsForDay(dayName) {
  const sweepCount = dayName === "Monday" ? 4 : 3;
  const slots = [];
  for (let i = 0; i < sweepCount; i++) slots.push({ type: "sweep", label: "Sweep floors" });
  for (let i = 0; i < 2; i++) slots.push({ type: "trash", label: "Clean trash" });
  for (let i = 0; i < 2; i++) slots.push({ type: "mop", label: "Mop" });
  return slots;
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { templates: [], instances: [] };
    return JSON.parse(raw);
  } catch (e) {
    return { templates: [], instances: [] };
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    alert("Could not save — storage may be full (large photos take space). Try removing some photos.");
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

let state = loadData();
let view = { screen: "home", instanceId: null, templateId: null, personName: null, tab: "attendance" };

const app = document.getElementById("app");

function render() {
  if (view.screen === "instance" && view.instanceId) {
    renderInstanceDetail(view.instanceId);
  } else if (view.screen === "analysis" && view.templateId) {
    renderAnalysis(view.templateId);
  } else if (view.screen === "tally" && view.templateId) {
    renderTally(view.templateId);
  } else if (view.screen === "graph" && view.templateId) {
    renderGraph(view.templateId);
  } else {
    renderHome();
  }
}

function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

function formatDate(iso) {
  if (!iso) return "Untitled";
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function weekdayNameFromISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const jsDay = date.getDay();
  if (jsDay === 0) return null;
  return DAYS[jsDay - 1];
}

// ---------- HOME ----------
function renderHome() {
  const templatesHtml = state.templates.length
    ? state.templates.map(t => `
      <div class="card">
        <div class="card-title-row">
          <div>
            <div class="card-title">${escapeHtml(t.name)}</div>
            <div class="card-sub">${t.students.length} students · ${DAYS.filter(d => (t.days[d] || []).length).length} piket days assigned</div>
          </div>
          <div class="row">
            <button class="icon" data-action="analysis" data-id="${t.id}">Analysis</button>
            <button class="icon" data-action="edit-template" data-id="${t.id}">Edit</button>
            <button class="icon danger" data-action="delete-template" data-id="${t.id}">Delete</button>
          </div>
        </div>
      </div>
    `).join("")
    : `<div class="empty-state">No rosters yet. Create one to get started.</div>`;

  const instancesHtml = state.instances.length
    ? state.instances.slice().sort((a, b) => b.date.localeCompare(a.date)).map(inst => {
        const totalTasks = inst.tasks.length;
        const doneTasks = inst.tasks.filter(t => t.done || t.excused).length;
        const absentCount = inst.attendance.filter(a => a.status).length;
        const hasProof = inst.proof && (inst.proof.note || (inst.proof.photos && inst.proof.photos.length));
        return `
      <div class="card" data-action="open-instance" data-id="${inst.id}">
        <div class="card-title-row">
          <div>
            <div class="card-title">${formatDate(inst.date)} <span class="card-sub">(${inst.weekday})</span></div>
            <div class="card-sub">${absentCount} absent · ${doneTasks}/${totalTasks} tasks resolved${hasProof ? " · proof attached" : ""}</div>
          </div>
          <button class="icon danger" data-action="delete-instance" data-id="${inst.id}">Delete</button>
        </div>
      </div>`;
      }).join("")
    : `<div class="empty-state">No days yet. Create one from a roster below.</div>`;

  app.innerHTML = `
    <header>
      <h1>Class Tracker</h1>
    </header>

    <section>
      <div class="card-title-row" style="margin-bottom:0.75rem;">
        <h2>Days</h2>
        <button class="primary" id="newInstanceBtn" ${state.templates.length === 0 ? "disabled" : ""}>+ New day</button>
      </div>
      ${instancesHtml}
    </section>

    <section>
      <div class="card-title-row" style="margin-bottom:0.75rem;">
        <h2>Class rosters</h2>
        <button id="newTemplateBtn">+ New roster</button>
      </div>
      ${templatesHtml}
    </section>
  `;

  document.getElementById("newTemplateBtn").onclick = () => openTemplateDialog();
  document.getElementById("newInstanceBtn").onclick = () => openInstantiateDialog();

  app.querySelectorAll('[data-action="analysis"]').forEach(btn =>
    btn.onclick = (e) => { e.stopPropagation(); view = { screen: "analysis", templateId: btn.dataset.id }; render(); });
  app.querySelectorAll('[data-action="edit-template"]').forEach(btn =>
    btn.onclick = (e) => { e.stopPropagation(); openTemplateDialog(btn.dataset.id); });
  app.querySelectorAll('[data-action="delete-template"]').forEach(btn =>
    btn.onclick = (e) => { e.stopPropagation(); deleteTemplate(btn.dataset.id); });
  app.querySelectorAll('[data-action="delete-instance"]').forEach(btn =>
    btn.onclick = (e) => { e.stopPropagation(); deleteInstance(btn.dataset.id); });
  app.querySelectorAll('[data-action="open-instance"]').forEach(card =>
    card.onclick = () => { view = { screen: "instance", instanceId: card.dataset.id, tab: "attendance" }; render(); });
}

function deleteInstance(id) {
  if (!confirm("Delete this day? Attendance and proof of work will be lost.")) return;
  state.instances = state.instances.filter(i => i.id !== id);
  saveData();
  render();
}

function deleteTemplate(id) {
  if (!confirm("Delete this roster? Existing days created from it are kept.")) return;
  state.templates = state.templates.filter(t => t.id !== id);
  saveData();
  render();
}

// ---------- TEMPLATE DIALOG ----------
const templateDialog = document.getElementById("templateDialog");
const templateForm = document.getElementById("templateForm");
const templateNameInput = document.getElementById("templateNameInput");
const rosterNamesInput = document.getElementById("rosterNamesInput");
const dayInputsContainer = document.getElementById("dayInputsContainer");
let editingTemplateId = null;

function buildDayInputs(existingDays) {
  dayInputsContainer.innerHTML = DAYS.map(day => `
    <div class="day-block">
      <div class="day-block-title">${day}${day === "Monday" ? " (4 sweep slots)" : " (3 sweep slots)"}</div>
      <textarea data-day="${day}" rows="2" placeholder="One name per line">${(existingDays[day] || []).join("\n")}</textarea>
    </div>
  `).join("");
}

function openTemplateDialog(id) {
  editingTemplateId = id || null;
  if (id) {
    const t = state.templates.find(t => t.id === id);
    document.getElementById("templateDialogTitle").textContent = "Edit class roster";
    templateNameInput.value = t.name;
    rosterNamesInput.value = t.students.join("\n");
    buildDayInputs(t.days);
  } else {
    document.getElementById("templateDialogTitle").textContent = "New class roster";
    templateNameInput.value = "";
    rosterNamesInput.value = "";
    buildDayInputs({});
  }
  templateDialog.showModal();
}

document.getElementById("templateCancelBtn").onclick = () => templateDialog.close();

templateForm.addEventListener("submit", () => {
  const name = templateNameInput.value.trim();
  const students = rosterNamesInput.value.split("\n").map(s => s.trim()).filter(Boolean);
  if (!name) return;

  const days = {};
  dayInputsContainer.querySelectorAll("textarea[data-day]").forEach(ta => {
    const names = ta.value.split("\n").map(s => s.trim()).filter(Boolean);
    days[ta.dataset.day] = names;
  });

  if (editingTemplateId) {
    const t = state.templates.find(t => t.id === editingTemplateId);
    t.name = name;
    t.students = students;
    t.days = days;
  } else {
    state.templates.push({ id: uid(), name, students, days });
  }
  saveData();
  render();
});

// ---------- INSTANTIATE DIALOG ----------
const instantiateDialog = document.getElementById("instantiateDialog");
const instantiateForm = document.getElementById("instantiateForm");
const instanceDateInput = document.getElementById("instanceDateInput");
const instanceTemplateSelect = document.getElementById("instanceTemplateSelect");

function openInstantiateDialog() {
  instanceDateInput.value = todayISO();
  instanceTemplateSelect.innerHTML = state.templates
    .map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`)
    .join("");
  instantiateDialog.showModal();
}

document.getElementById("instantiateCancelBtn").onclick = () => instantiateDialog.close();

instantiateForm.addEventListener("submit", () => {
  const date = instanceDateInput.value;
  const templateId = instanceTemplateSelect.value;
  const template = state.templates.find(t => t.id === templateId);
  if (!date || !template) return;

  const weekday = weekdayNameFromISO(date);
  if (!weekday) {
    alert("Selected date is a Sunday — no class day. Pick Monday–Saturday.");
    return;
  }

  const piketNames = template.days[weekday] || [];
  const slots = taskSlotsForDay(weekday);
  const tasks = slots.map(slot => ({
    id: uid(),
    type: slot.type,
    label: slot.label,
    assignedName: "",
    done: false,
    excused: false
  }));

  const attendance = template.students.map(name => ({ id: uid(), name, status: null }));

  const newInstance = {
    id: uid(),
    date,
    weekday,
    templateId,
    piketNames,
    tasks,
    attendance,
    proof: { note: "", photos: [] }
  };
  state.instances.push(newInstance);
  saveData();
  view = { screen: "instance", instanceId: newInstance.id, tab: "attendance" };
  render();
});

// ---------- ABSENCE <-> TASK LINKAGE ----------
// A task's assignee is excused (not required to complete it) if that person
// has any non-null attendance status (sick/alpha/permission) for this day.
function isNameAbsent(inst, name) {
  if (!name) return false;
  const rec = inst.attendance.find(a => a.name === name);
  return !!(rec && rec.status);
}

function syncTaskExcusals(inst) {
  inst.tasks.forEach(t => {
    t.excused = isNameAbsent(inst, t.assignedName);
    if (t.excused) t.done = false; // excused students aren't required to complete tasks
  });
}

// ---------- INSTANCE DETAIL ----------
function renderInstanceDetail(instanceId) {
  const inst = state.instances.find(i => i.id === instanceId);
  if (!inst) { view = { screen: "home" }; return render(); }

  const tab = view.tab || "attendance";

  app.innerHTML = `
    <span class="back-link" id="backBtn">&larr; Back</span>
    <header>
      <h1>${formatDate(inst.date)} <span class="card-sub">(${inst.weekday})</span></h1>
    </header>
    <div class="tab-row">
      <div class="tab-btn ${tab === "attendance" ? "active" : ""}" data-tab="attendance">Attendance</div>
      <div class="tab-btn ${tab === "piket" ? "active" : ""}" data-tab="piket">Piket</div>
      <div class="tab-btn ${tab === "proof" ? "active" : ""}" data-tab="proof">Proof</div>
    </div>
    <div id="tabContent"></div>
  `;

  document.getElementById("backBtn").onclick = () => { view = { screen: "home" }; render(); };
  app.querySelectorAll(".tab-btn").forEach(btn =>
    btn.onclick = () => { view.tab = btn.dataset.tab; render(); });

  const tabContent = document.getElementById("tabContent");
  if (tab === "attendance") {
    renderAttendanceTab(inst, tabContent);
  } else if (tab === "piket") {
    renderPiketTab(inst, tabContent);
  } else {
    renderProofTab(inst, tabContent);
  }
}

function renderAttendanceTab(inst, container) {
  const sickCount = inst.attendance.filter(a => a.status === "sick").length;
  const alphaCount = inst.attendance.filter(a => a.status === "alpha").length;
  const permissionCount = inst.attendance.filter(a => a.status === "permission").length;
  const totalAbsent = sickCount + alphaCount + permissionCount;
  const parts = [];
  if (sickCount) parts.push(`${sickCount} sick`);
  if (alphaCount) parts.push(`${alphaCount} alpha`);
  if (permissionCount) parts.push(`${permissionCount} permission`);
  const summary = totalAbsent ? `${totalAbsent} absent (${parts.join(", ")})` : "0 absent";

  const entriesHtml = inst.attendance.map(e => `
    <li class="entry-item ${e.status ? "crossed" : ""}" data-id="${e.id}">
      <span>${escapeHtml(e.name)}</span>
      <div class="status-btns">
        <button class="status-btn sick ${e.status === "sick" ? "active" : ""}" data-action="status" data-id="${e.id}" data-status="sick">Sick</button>
        <button class="status-btn alpha ${e.status === "alpha" ? "active" : ""}" data-action="status" data-id="${e.id}" data-status="alpha">Alpha</button>
        <button class="status-btn permission ${e.status === "permission" ? "active" : ""}" data-action="status" data-id="${e.id}" data-status="permission">Permission</button>
      </div>
    </li>
  `).join("");

  container.innerHTML = `
    <div class="card-sub" style="margin-bottom:0.75rem;">${summary}</div>
    <ul class="entry-list" style="list-style:none; margin:0; padding:0;">${entriesHtml}</ul>
  `;

  container.querySelectorAll('[data-action="status"]').forEach(btn =>
    btn.onclick = () => {
      const entry = inst.attendance.find(e => e.id === btn.dataset.id);
      entry.status = entry.status === btn.dataset.status ? null : btn.dataset.status;
      syncTaskExcusals(inst);
      saveData();
      render();
    });
}

function renderPiketTab(inst, container) {
  syncTaskExcusals(inst);

  const nameOptions = ['<option value="">-- unassigned --</option>']
    .concat(inst.piketNames.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`))
    .join("");

  const totalTasks = inst.tasks.length;
  const resolvedTasks = inst.tasks.filter(t => t.done || t.excused).length;
  const pct = totalTasks ? Math.round((resolvedTasks / totalTasks) * 100) : 0;

  const grouped = { sweep: [], trash: [], mop: [] };
  inst.tasks.forEach(t => grouped[t.type].push(t));

  const taskGroupHtml = (title, tasks) => tasks.map(t => `
    <div class="task-card ${t.done ? "done" : ""} ${t.excused ? "excused" : ""}" data-task-id="${t.id}">
      <div class="task-top-row">
        <div class="task-label">${title}</div>
        <select class="task-assign-select" data-action="assign" data-task-id="${t.id}" ${t.excused ? "" : ""}>
          ${nameOptions.replace(`value="${escapeHtml(t.assignedName)}"`, `value="${escapeHtml(t.assignedName)}" selected`)}
        </select>
        <button class="task-done-btn" data-action="toggle-done" data-task-id="${t.id}" aria-label="Mark done" ${t.excused ? "disabled" : ""}>${t.excused ? "—" : (t.done ? "✓" : "")}</button>
      </div>
      ${t.excused ? `<div class="excused-tag">Excused — ${escapeHtml(t.assignedName)} is marked absent today</div>` : ""}
    </div>
  `).join("");

  container.innerHTML = `
    <div class="card-sub">${resolvedTasks}/${totalTasks} tasks resolved (done or excused)</div>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>

    <h3>Sweep floors</h3>
    ${taskGroupHtml("Sweep", grouped.sweep)}
    <h3>Clean trash</h3>
    ${taskGroupHtml("Trash", grouped.trash)}
    <h3>Mop</h3>
    ${taskGroupHtml("Mop", grouped.mop)}
  `;

  container.querySelectorAll('[data-action="assign"]').forEach(sel =>
    sel.onchange = () => {
      const task = inst.tasks.find(t => t.id === sel.dataset.taskId);
      task.assignedName = sel.value;
      syncTaskExcusals(inst);
      saveData();
      render();
    });

  container.querySelectorAll('[data-action="toggle-done"]').forEach(btn =>
    btn.onclick = () => {
      const task = inst.tasks.find(t => t.id === btn.dataset.taskId);
      if (task.excused) return;
      task.done = !task.done;
      saveData();
      render();
    });
}

function renderProofTab(inst, container) {
  const hasProof = inst.proof && (inst.proof.note || (inst.proof.photos && inst.proof.photos.length));
  const proofPhotosHtml = (inst.proof.photos || []).map(p => `<img src="${p}" alt="proof photo" />`).join("");

  container.innerHTML = `
    <div class="proof-section" style="margin-top:0;">
      <div class="card-title-row" style="margin-bottom:0.5rem;">
        <h3 style="margin:0;">Proof of work</h3>
        <button class="icon" id="editProofBtn">${hasProof ? "Edit" : "Add"}</button>
      </div>
      ${hasProof ? `
        ${inst.proof.note ? `<div class="proof-note">${escapeHtml(inst.proof.note)}</div>` : ""}
        ${inst.proof.photos && inst.proof.photos.length ? `<div class="proof-photos">${proofPhotosHtml}</div>` : ""}
      ` : `<div class="card-sub">No proof attached yet.</div>`}
    </div>
  `;
  document.getElementById("editProofBtn").onclick = () => openProofDialog(inst.id);
}

// ---------- PROOF DIALOG ----------
const proofDialog = document.getElementById("proofDialog");
const proofForm = document.getElementById("proofForm");
const proofNoteInput = document.getElementById("proofNoteInput");
const proofPhotoInput = document.getElementById("proofPhotoInput");
const proofPhotoPreview = document.getElementById("proofPhotoPreview");
let editingProofInstanceId = null;
let pendingPhotos = [];

function openProofDialog(instanceId) {
  editingProofInstanceId = instanceId;
  const inst = state.instances.find(i => i.id === instanceId);
  proofNoteInput.value = inst.proof.note || "";
  pendingPhotos = (inst.proof.photos || []).slice();
  renderProofPreview();
  proofPhotoInput.value = "";
  proofDialog.showModal();
}

function renderProofPreview() {
  proofPhotoPreview.innerHTML = pendingPhotos.map((src, idx) => `
    <div class="photo-thumb-wrap">
      <img src="${src}" alt="photo" />
      <button type="button" class="photo-remove-btn" data-idx="${idx}">&times;</button>
    </div>
  `).join("");
  proofPhotoPreview.querySelectorAll(".photo-remove-btn").forEach(btn =>
    btn.onclick = () => {
      pendingPhotos.splice(Number(btn.dataset.idx), 1);
      renderProofPreview();
    });
}

proofPhotoInput.addEventListener("change", async () => {
  const files = Array.from(proofPhotoInput.files || []);
  for (const file of files) {
    const dataUrl = await fileToResizedDataUrl(file);
    pendingPhotos.push(dataUrl);
  }
  proofPhotoInput.value = "";
  renderProofPreview();
});

function fileToResizedDataUrl(file, maxDim = 1000, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

document.getElementById("proofCancelBtn").onclick = () => proofDialog.close();

proofForm.addEventListener("submit", () => {
  const inst = state.instances.find(i => i.id === editingProofInstanceId);
  inst.proof = { note: proofNoteInput.value.trim(), photos: pendingPhotos.slice() };
  saveData();
  render();
});

// ---------- ANALYSIS ----------
function renderAnalysis(templateId) {
  const template = state.templates.find(t => t.id === templateId);
  if (!template) { view = { screen: "home" }; return render(); }

  app.innerHTML = `
    <span class="back-link" id="backBtn">&larr; Back</span>
    <header><h1>Analysis: ${escapeHtml(template.name)}</h1></header>
    <div class="card" data-action="open-tally">
      <div class="card-title">Tally</div>
      <div class="card-sub">Attendance + piket totals per student, across all days</div>
    </div>
    <div class="card" data-action="open-graph">
      <div class="card-title">Graph</div>
      <div class="card-sub">Pick a student and see their attendance/piket breakdown</div>
    </div>
    <div class="card" data-action="export-csv">
      <div class="card-title">Export CSV</div>
      <div class="card-sub">Download attendance and piket task logs as CSV files</div>
    </div>
  `;
  document.getElementById("backBtn").onclick = () => { view = { screen: "home" }; render(); };
  app.querySelector('[data-action="open-tally"]').onclick = () => { view = { screen: "tally", templateId }; render(); };
  app.querySelector('[data-action="open-graph"]').onclick = () => { view = { screen: "graph", templateId }; render(); };
  app.querySelector('[data-action="export-csv"]').onclick = () => exportCsvForTemplate(templateId);
}

function getInstancesForTemplate(templateId) {
  return state.instances.filter(i => i.templateId === templateId);
}

function renderTally(templateId) {
  const template = state.templates.find(t => t.id === templateId);
  if (!template) { view = { screen: "home" }; return render(); }

  const instances = getInstancesForTemplate(templateId);

  const rows = template.students.map(name => {
    let sick = 0, alpha = 0, permission = 0, assigned = 0, completed = 0, excused = 0;
    instances.forEach(inst => {
      const att = inst.attendance.find(a => a.name === name);
      if (att) {
        if (att.status === "sick") sick++;
        else if (att.status === "alpha") alpha++;
        else if (att.status === "permission") permission++;
      }
      inst.tasks.forEach(t => {
        if (t.assignedName === name) {
          assigned++;
          if (t.done) completed++;
          if (t.excused) excused++;
        }
      });
    });
    return { name, sick, alpha, permission, assigned, completed, excused };
  });

  const rowsHtml = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td>${r.sick}</td>
      <td>${r.alpha}</td>
      <td>${r.permission}</td>
      <td>${r.assigned}</td>
      <td>${r.completed}</td>
      <td>${r.excused}</td>
    </tr>
  `).join("");

  app.innerHTML = `
    <span class="back-link" id="backBtn">&larr; Back</span>
    <header><h1>Tally: ${escapeHtml(template.name)}</h1></header>
    <div class="card-sub" style="margin-bottom:1rem;">Across ${instances.length} day${instances.length === 1 ? "" : "s"}</div>
    ${rows.length ? `
    <table class="tally-table">
      <thead><tr><th>Name</th><th>Sick</th><th>Alpha</th><th>Perm.</th><th>Tasks assigned</th><th>Tasks done</th><th>Excused</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>` : `<div class="empty-state">No students in this roster.</div>`}
  `;
  document.getElementById("backBtn").onclick = () => { view = { screen: "analysis", templateId }; render(); };
}

function renderGraph(templateId) {
  const template = state.templates.find(t => t.id === templateId);
  if (!template) { view = { screen: "home" }; return render(); }

  const instances = getInstancesForTemplate(templateId);
  const names = template.students;
  const selectedName = view.personName || names[0] || "";

  const optionsHtml = names
    .map(n => `<option value="${escapeHtml(n)}" ${n === selectedName ? "selected" : ""}>${escapeHtml(n)}</option>`)
    .join("");

  let sick = 0, alpha = 0, permission = 0, completed = 0, missed = 0, excused = 0;
  instances.forEach(inst => {
    const att = inst.attendance.find(a => a.name === selectedName);
    if (att) {
      if (att.status === "sick") sick++;
      else if (att.status === "alpha") alpha++;
      else if (att.status === "permission") permission++;
    }
    inst.tasks.forEach(t => {
      if (t.assignedName === selectedName) {
        if (t.excused) excused++;
        else if (t.done) completed++;
        else missed++;
      }
    });
  });

  const maxAttendance = Math.max(sick, alpha, permission, 1);
  const maxTasks = Math.max(completed, missed, excused, 1);
  const barHtml = (label, value, cls, max) => `
    <div class="bar-row">
      <div class="bar-label">${label}</div>
      <div class="bar-track"><div class="bar-fill ${cls}" style="width:${(value / max) * 100}%"></div></div>
      <div class="bar-value">${value}</div>
    </div>
  `;

  app.innerHTML = `
    <span class="back-link" id="backBtn">&larr; Back</span>
    <header><h1>Graph: ${escapeHtml(template.name)}</h1></header>
    <label>Student
      <select id="personSelect">${optionsHtml}</select>
    </label>
    <div class="card" style="margin-top:1rem;">
      <h3 style="margin-top:0;">Attendance</h3>
      ${names.length ? `
        ${barHtml("Sick", sick, "sick", maxAttendance)}
        ${barHtml("Alpha", alpha, "alpha", maxAttendance)}
        ${barHtml("Permission", permission, "permission", maxAttendance)}
      ` : `<div class="empty-state">No students in this roster.</div>`}
    </div>
    <div class="card">
      <h3 style="margin-top:0;">Piket tasks</h3>
      ${names.length ? `
        ${barHtml("Completed", completed, "", maxTasks)}
        ${barHtml("Missed", missed, "missed", maxTasks)}
        ${barHtml("Excused", excused, "excused", maxTasks)}
      ` : ""}
    </div>
  `;
  document.getElementById("backBtn").onclick = () => { view = { screen: "analysis", templateId }; render(); };
  const select = document.getElementById("personSelect");
  if (select) {
    select.onchange = () => { view = { screen: "graph", templateId, personName: select.value }; render(); };
  }
}

// ---------- CSV EXPORT ----------
function csvEscape(val) {
  const s = val == null ? "" : String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(rows) {
  return rows.map(row => row.map(csvEscape).join(",")).join("\r\n");
}

function downloadCsv(filename, csvContent) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportCsvForTemplate(templateId) {
  const template = state.templates.find(t => t.id === templateId);
  if (!template) return;
  const instances = getInstancesForTemplate(templateId).slice().sort((a, b) => a.date.localeCompare(b.date));

  // Attendance CSV: one row per student per day
  const attendanceRows = [["Date", "Weekday", "Name", "Status"]];
  instances.forEach(inst => {
    inst.attendance.forEach(a => {
      attendanceRows.push([inst.date, inst.weekday, a.name, a.status || "present"]);
    });
  });
  downloadCsv(
    `${sanitizeFilename(template.name)}_attendance.csv`,
    rowsToCsv(attendanceRows)
  );

  // Piket/task CSV: one row per task per day
  const taskRows = [["Date", "Weekday", "Task type", "Assigned to", "Completed", "Excused"]];
  instances.forEach(inst => {
    inst.tasks.forEach(t => {
      taskRows.push([
        inst.date,
        inst.weekday,
        t.label,
        t.assignedName || "(unassigned)",
        t.done ? "yes" : "no",
        t.excused ? "yes" : "no"
      ]);
    });
  });
  downloadCsv(
    `${sanitizeFilename(template.name)}_piket_tasks.csv`,
    rowsToCsv(taskRows)
  );
}

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9_\-]+/gi, "_");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}

render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
