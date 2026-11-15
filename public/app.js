const $ = (id) => document.getElementById(id);
let students = [];
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
    select.innerHTML = '<option value="">Select student</option>' + students.map((student) =>
      `<option value="${student.id}">${escapeHTML(student.roll_no)} — ${escapeHTML(student.full_name)}</option>`
    ).join("");
    if (students.some((student) => String(student.id) === current)) select.value = current;
  });
}

function renderStudents() {
  const query = $("studentSearch").value.trim().toLowerCase();
  const filtered = students.filter((s) =>
    [s.roll_no, s.full_name, s.course, s.email].some((value) => String(value || "").toLowerCase().includes(query))
  );
  $("studentCount").textContent = `${filtered.length} student${filtered.length === 1 ? "" : "s"}`;
  $("studentsTable").innerHTML = filtered.length ? filtered.map((s) => `
    <tr>
      <td><div class="student-name">${escapeHTML(s.full_name)}</div><div class="student-email">${escapeHTML(s.email || "No email added")}</div></td>
      <td>${escapeHTML(s.roll_no)}</td><td>${escapeHTML(s.course)}</td><td>${escapeHTML(s.semester || "—")}</td>
      <td><button class="action-btn" data-edit="${s.id}">Edit</button><button class="action-btn delete" data-delete="${s.id}">Delete</button></td>
    </tr>`).join("") : '<tr><td colspan="5" class="empty">No students found. Add a student above to get started.</td></tr>';
}

async function loadStudents() {
  students = await api("/api/students");
  renderStudents();
  fillStudentSelects();
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
  await Promise.all([loadDashboard(), loadStudents(), loadAttendance(), loadGrades()]);
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
$("studentSearch").addEventListener("input", renderStudents);

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