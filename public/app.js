const $ = (id) => document.getElementById(id);
let students = [];
let studentOptions = [];
let currentStudentPage = 1;
let currentReportPage = 1;
let searchDelay;
let toastTimer;

function showToast(message, isError = false) {
  const toast = $("toast");
  toast.textContent = message;
  toast.className = `toast show${isError ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = "toast"; }, 3200);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Something went wrong.");
  return data;
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function formatDate(dateString) {
  if (!dateString) return "";
  const date = new Date(`${dateString}T00:00:00`);
  return Number.isNaN(date.getTime()) ? dateString : date.toLocaleDateString();
}

async function loadDashboard() {
  const data = await api("/api/dashboard");
  $("totalStudents").textContent = data.totalStudents;
  $("attendanceRecords").textContent = data.attendanceRecords;
  $("attendanceRate").textContent = `${data.attendanceRate}%`;
  $("gradeRecords").textContent = data.gradeRecords;
}

function fillStudentSelects() {
  ["attendanceStudent", "gradeStudent"].forEach((id) => {
    const select = $(id);
    const current = select.value;
    select.innerHTML = '<option value="">Select student</option>' + studentOptions.map((student) =>
      `<option value="${student.id}">${escapeHTML(student.roll_no)} — ${escapeHTML(student.full_name)}</option>`
    ).join("");
    if (studentOptions.some((student) => String(student.id) === current)) select.value = current;
  });
}

function renderStudents() {
  $("studentsTable").innerHTML = students.length ? students.map((s) => `
    <tr>
      <td><div class="student-name">${escapeHTML(s.full_name)}</div><div class="student-email">${escapeHTML(s.email || "No email added")}</div></td>
      <td>${escapeHTML(s.roll_no)}</td><td>${escapeHTML(s.course)}</td><td>${escapeHTML(s.semester || "—")}</td>
      <td><button class="action-btn" data-edit="${s.id}">Edit</button><button class="action-btn delete" data-delete="${s.id}">Delete</button></td>
    </tr>`).join("") : '<tr><td colspan="5" class="empty">No students found.</td></tr>';
}

async function loadStudentOptions() {
  studentOptions = await api("/api/student-options");
  fillStudentSelects();
}

function updatePager(prefix, data) {
  $(`${prefix}PageInfo`).textContent = `Page ${data.page} of ${data.totalPages} · ${data.total} total`;
  $(`${prefix}Prev`).disabled = data.page <= 1;
  $(`${prefix}Next`).disabled = data.page >= data.totalPages;
}

async function loadStudents() {
  const query = encodeURIComponent($("studentSearch").value.trim());
  const data = await api(`/api/students?page=${currentStudentPage}&pageSize=10&search=${query}`);
  students = data.rows;
  currentStudentPage = data.page;
  $("studentCount").textContent = `${data.total} matching student${data.total === 1 ? "" : "s"}`;
  updatePager("students", data);
  renderStudents();
}

async function loadReports() {
  const data = await api(`/api/reports?page=${currentReportPage}&pageSize=10`);
  currentReportPage = data.page;
  updatePager("reports", data);
  $("reportsTable").innerHTML = data.rows.length ? data.rows.map((r) => `
    <tr><td>${escapeHTML(r.roll_no)} — ${escapeHTML(r.full_name)}</td>
      <td>${escapeHTML(r.course)}</td>
      <td>${escapeHTML(r.total_attendance)}</td>
      <td>${Number(r.total_attendance) ? Math.round(Number(r.present_days) / Number(r.total_attendance) * 100) + "%" : "—"}</td>
      <td>${escapeHTML(r.grade_count)}</td><td>${r.average_percentage == null ? "—" : escapeHTML(r.average_percentage) + "%"}</td></tr>
  `).join("") : '<tr><td colspan="6" class="empty">No report data yet.</td></tr>';
}

async function loadAttendance() {
  const rows = await api("/api/attendance");
  $("attendanceTable").innerHTML = rows.length ? rows.map((r) => `
    <tr><td>${escapeHTML(formatDate(r.attendance_date))}</td><td>${escapeHTML(r.full_name)}</td>
    <td>${escapeHTML(r.roll_no)}</td><td><span class="badge ${escapeHTML(r.status)}">${escapeHTML(r.status)}</span></td></tr>
  `).join("") : '<tr><td colspan="4" class="empty">No attendance records yet.</td></tr>';
}

async function loadGrades() {
  const rows = await api("/api/grades");
  $("gradesTable").innerHTML = rows.length ? rows.map((r) => `
    <tr><td><div class="student-name">${escapeHTML(r.full_name)}</div><div class="student-email">${escapeHTML(r.roll_no)}</div></td>
    <td>${escapeHTML(r.subject)}</td><td>${escapeHTML(r.assessment)}</td>
    <td>${escapeHTML(r.marks_obtained)} / ${escapeHTML(r.total_marks)}</td><td><strong>${escapeHTML(r.percentage)}%</strong></td></tr>
  `).join("") : '<tr><td colspan="5" class="empty">No grades recorded yet.</td></tr>';
}

async function refreshAll() {
  await Promise.all([loadDashboard(), loadStudents(), loadStudentOptions(), loadAttendance(), loadGrades(), loadReports()]);
}

function resetStudentForm() {
  $("studentForm").reset();
  $("studentId").value = "";
  $("studentSubmit").textContent = "Add student";
  $("cancelEdit").classList.add("hidden");
}

$("studentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("studentId").value;
  const payload = {
    roll_no: $("rollNo").value,
    full_name: $("fullName").value,
    email: $("email").value,
    course: $("course").value,
    semester: $("semester").value || null
  };
  try {
    const result = await api(id ? `/api/students/${id}` : "/api/students", {
      method: id ? "PUT" : "POST", body: JSON.stringify(payload)
    });
    showToast(result.message);
    resetStudentForm();
    await refreshAll();
  } catch (error) { showToast(error.message, true); }
});

$("cancelEdit").addEventListener("click", resetStudentForm);
$("studentSearch").addEventListener("input", () => {
  currentStudentPage = 1;
  clearTimeout(searchDelay);
  searchDelay = setTimeout(() => loadStudents().catch(e => showToast(e.message, true)), 250);
});
$("studentsPrev").addEventListener("click", () => { currentStudentPage--; loadStudents().catch(e => showToast(e.message, true)); });
$("studentsNext").addEventListener("click", () => { currentStudentPage++; loadStudents().catch(e => showToast(e.message, true)); });
$("reportsPrev").addEventListener("click", () => { currentReportPage--; loadReports().catch(e => showToast(e.message, true)); });
$("reportsNext").addEventListener("click", () => { currentReportPage++; loadReports().catch(e => showToast(e.message, true)); });

// Basic CSV parser supports quoted commas, double quotes and line breaks.
function parseCSV(text) {
  const rows = []; let row = []; let field = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(field); field = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); if (row.some(v => v.trim())) rows.push(row);
      row = []; field = "";
    } else field += c;
  }
  if (quoted) throw new Error("CSV has unclosed quotes.");
  row.push(field); if (row.some(v => v.trim())) rows.push(row);
  return rows;
}

$("csvImport").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 100000) throw new Error("CSV exceeds 100 KB. Import up to 500 students per batch.");
    const lines = parseCSV((await file.text()).replace(/^\uFEFF/, ""));
    const headers = lines.shift()?.map(x => x.trim().toLowerCase());
    if (!headers || !["roll_no", "full_name", "course"].every(x => headers.includes(x))) {
      throw new Error("CSV header must include roll_no, full_name, course.");
    }
    if (!lines.length || lines.length > 500) throw new Error("Import 1 to 500 students at a time.");
    const studentsToImport = lines.map(line => Object.fromEntries(headers.map((header, i) => [header, line[i] || ""])));
    const result = await api("/api/students/bulk", { method: "POST", body: JSON.stringify({ students: studentsToImport }) });
    showToast(result.message);
    currentStudentPage = 1;
    await refreshAll();
  } catch (error) { showToast(error.message, true); }
  event.target.value = "";
});

$("studentsTable").addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit]");
  const deleteButton = event.target.closest("[data-delete]");
  if (editButton) {
    const student = students.find((s) => String(s.id) === editButton.dataset.edit);
    if (!student) return;
    $("studentId").value = student.id;
    $("rollNo").value = student.roll_no;
    $("fullName").value = student.full_name;
    $("email").value = student.email || "";
    $("course").value = student.course;
    $("semester").value = student.semester || "";
    $("studentSubmit").textContent = "Update student";
    $("cancelEdit").classList.remove("hidden");
    $("students").scrollIntoView({ behavior: "smooth" });
  }
  if (deleteButton) {
    const student = students.find((s) => String(s.id) === deleteButton.dataset.delete);
    if (!student || !confirm(`Delete ${student.full_name}? Their attendance and grade records will also be deleted.`)) return;
    try {
      const result = await api(`/api/students/${student.id}`, { method: "DELETE" });
      showToast(result.message);
      await refreshAll();
    } catch (error) { showToast(error.message, true); }
  }
});

$("attendanceForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const result = await api("/api/attendance", {
      method: "POST",
      body: JSON.stringify({
        student_id: $("attendanceStudent").value,
        attendance_date: $("attendanceDate").value,
        status: $("attendanceStatus").value
      })
    });
    showToast(result.message);
    await Promise.all([loadDashboard(), loadAttendance()]);
  } catch (error) { showToast(error.message, true); }
});

$("gradeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const result = await api("/api/grades", {
      method: "POST",
      body: JSON.stringify({
        student_id: $("gradeStudent").value,
        subject: $("subject").value,
        assessment: $("assessment").value,
        marks_obtained: $("marksObtained").value,
        total_marks: $("totalMarks").value
      })
    });
    showToast(result.message);
    $("gradeForm").reset();
    await Promise.all([loadDashboard(), loadGrades()]);
  } catch (error) { showToast(error.message, true); }
});

document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
  });
});

$("attendanceDate").value = new Date().toLocaleDateString("en-CA");

refreshAll().catch((error) => {
  showToast(`${error.message} Check that the server and MySQL are running.`, true);
});