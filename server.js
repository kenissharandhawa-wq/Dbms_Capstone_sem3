require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "student_tracker_db",
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true
});

function validId(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}


function pagination(req) {
  const page = Math.max(1, Math.min(1000000, Number.parseInt(req.query.page, 10) || 1));
  const pageSize = Math.max(1, Math.min(50, Number.parseInt(req.query.pageSize, 10) || 10));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function validStudent(entry) {
  if (!entry || typeof entry !== "object") return false;
  const { roll_no, full_name, course, email, semester } = entry;
  return typeof roll_no === "string" && roll_no.trim().length > 0 && roll_no.trim().length <= 30 &&
    typeof full_name === "string" && full_name.trim().length > 0 && full_name.trim().length <= 100 &&
    typeof course === "string" && course.trim().length > 0 && course.trim().length <= 100 &&
    (email == null || (typeof email === "string" && email.length <= 120)) &&
    (semester == null || semester === "" || (Number.isInteger(Number(semester)) && Number(semester) >= 1 && Number(semester) <= 20));
}

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    console.error("MySQL Connection Error:", error.code, error.message);
    res.status(500).json({
      status: "error",
      message: "Database connection failed."
    });
  }
});

app.get("/api/dashboard", async (req, res) => {
  try {
    const [[studentRow]] = await pool.query("SELECT COUNT(*) AS totalStudents FROM students");
    const [[attendanceRow]] = await pool.query(
      "SELECT COUNT(*) AS totalRecords, SUM(status = 'Present') AS presentRecords FROM attendance"
    );
    const [[gradeRow]] = await pool.query("SELECT COUNT(*) AS totalGrades FROM grades");
    const totalRecords = Number(attendanceRow.totalRecords || 0);
    const presentRecords = Number(attendanceRow.presentRecords || 0);
    res.json({
      totalStudents: Number(studentRow.totalStudents),
      attendanceRecords: totalRecords,
      presentRecords,
      attendanceRate: totalRecords ? Math.round((presentRecords / totalRecords) * 100) : 0,
      gradeRecords: Number(gradeRow.totalGrades)
    });
  } catch (error) {
    res.status(500).json({ message: "Could not load dashboard." });
  }
});

// Database-side search and pagination: only the requested page is sent to the browser.
app.get("/api/students", async (req, res) => {
  try {
    const { page, pageSize, offset } = pagination(req);
    const search = String(req.query.search || "").trim().slice(0, 100);
    const where = search ? "WHERE s.roll_no LIKE ? OR s.full_name LIKE ? OR s.course LIKE ? OR s.email LIKE ?" : "";
    const escaped = search.replace(/[\\%_]/g, "\\$&");
    const params = search ? Array(4).fill(`%${escaped}%`) : [];
    const [counts] = await pool.query(`SELECT COUNT(*) AS total FROM students s ${where}`, params);
    const [rows] = await pool.query(`
      SELECT s.*,
        (SELECT COUNT(*) FROM attendance a WHERE a.student_id = s.id) AS attendance_count,
        (SELECT COUNT(*) FROM grades g WHERE g.student_id = s.id) AS grade_count
      FROM students s ${where}
      ORDER BY s.id DESC LIMIT ? OFFSET ?
    `, [...params, pageSize, offset]);
    res.json({ rows, total: Number(counts[0].total), page, pageSize,
      totalPages: Math.max(1, Math.ceil(Number(counts[0].total) / pageSize)) });
  } catch (error) {
    console.error("Student listing error:", error.message);
    res.status(500).json({ message: "Could not load students." });
  }
});

// Dedicated lightweight selector endpoint avoids sending all student records in table views.
app.get("/api/student-options", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, roll_no, full_name FROM students ORDER BY roll_no LIMIT 5000");
    res.json(rows);
  } catch (error) { res.status(500).json({ message: "Could not load student options." }); }
});

// Bulk import in a transaction: invalid or duplicate entries roll back the whole batch.
app.post("/api/students/bulk", async (req, res) => {
  const rows = req.body?.students;
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 500 || !rows.every(validStudent)) {
    return res.status(400).json({ message: "Upload 1 to 500 valid students (roll_no, full_name, course required)." });
  }
  const rolls = rows.map(r => r.roll_no.trim().toLowerCase());
  if (new Set(rolls).size !== rolls.length) return res.status(409).json({ message: "Duplicate roll numbers in the CSV." });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const r of rows) {
      await conn.execute("INSERT INTO students (roll_no, full_name, email, course, semester) VALUES (?, ?, ?, ?, ?)",
        [r.roll_no.trim(), r.full_name.trim(), r.email?.trim() || null, r.course.trim(), r.semester ? Number(r.semester) : null]);
    }
    await conn.commit();
    res.status(201).json({ message: `${rows.length} students imported successfully.` });
  } catch (error) {
    await conn.rollback();
    res.status(error.code === "ER_DUP_ENTRY" ? 409 : 500).json({
      message: error.code === "ER_DUP_ENTRY" ? "A roll number already exists. No students were imported." : "Import failed; no students were imported."
    });
  } finally { conn.release(); }
});

// Reports use SQL aggregations and left joins so students without records appear too.
app.get("/api/reports", async (req, res) => {
  try {
    const { page, pageSize, offset } = pagination(req);
    const [[countRow]] = await pool.query("SELECT COUNT(*) AS total FROM students");
    const [rows] = await pool.query(`
      SELECT s.id, s.roll_no, s.full_name, s.course,
        COUNT(DISTINCT a.id) AS total_attendance,
        COUNT(DISTINCT CASE WHEN a.status = 'Present' THEN a.id END) AS present_days,
        COUNT(DISTINCT g.id) AS grade_count,
        ROUND((SELECT AVG(g2.marks_obtained / g2.total_marks * 100)
               FROM grades g2 WHERE g2.student_id = s.id), 2) AS average_percentage
      FROM students s
      LEFT JOIN attendance a ON a.student_id = s.id
      LEFT JOIN grades g ON g.student_id = s.id
      GROUP BY s.id, s.roll_no, s.full_name, s.course
      ORDER BY s.id DESC LIMIT ? OFFSET ?
    `, [pageSize, offset]);
    res.json({ rows, total: Number(countRow.total), page, pageSize,
      totalPages: Math.max(1, Math.ceil(Number(countRow.total) / pageSize)) });
  } catch (error) {
    console.error("Report error:", error.message);
    res.status(500).json({ message: "Could not load reports." });
  }
});

app.post("/api/students", async (req, res) => {
  const { roll_no, full_name, email, course, semester } = req.body;
  if (!validStudent(req.body)) {
    return res.status(400).json({ message: "Roll number, student name and course are required." });
  }
  try {
    const [result] = await pool.query(
      "INSERT INTO students (roll_no, full_name, email, course, semester) VALUES (?, ?, ?, ?, ?)",
      [roll_no.trim(), full_name.trim(), email?.trim() || null, course.trim(), semester || null]
    );
    res.status(201).json({ message: "Student added successfully.", id: result.insertId });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "That roll number already exists." });
    res.status(500).json({ message: "Could not add student." });
  }
});

app.put("/api/students/:id", async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid student ID." });
  const { roll_no, full_name, email, course, semester } = req.body;
  if (!validStudent(req.body)) {
    return res.status(400).json({ message: "Roll number, student name and course are required." });
  }
  try {
    const [result] = await pool.query(
      "UPDATE students SET roll_no = ?, full_name = ?, email = ?, course = ?, semester = ? WHERE id = ?",
      [roll_no.trim(), full_name.trim(), email?.trim() || null, course.trim(), semester || null, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ message: "Student not found." });
    res.json({ message: "Student updated successfully." });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "That roll number already exists." });
    res.status(500).json({ message: "Could not update student." });
  }
});

app.delete("/api/students/:id", async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid student ID." });
  try {
    const [result] = await pool.query("DELETE FROM students WHERE id = ?", [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ message: "Student not found." });
    res.json({ message: "Student and linked attendance/grades deleted." });
  } catch (error) {
    res.status(500).json({ message: "Could not delete student." });
  }
});

app.get("/api/attendance", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT a.id, a.student_id, s.roll_no, s.full_name, a.attendance_date, a.status
      FROM attendance a JOIN students s ON s.id = a.student_id
      ORDER BY a.attendance_date DESC, s.full_name
      LIMIT 200
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Could not load attendance." });
  }
});

app.post("/api/attendance", async (req, res) => {
  const { student_id, attendance_date, status } = req.body;
  if (!validId(student_id) || !attendance_date || !["Present", "Absent", "Late"].includes(status)) {
    return res.status(400).json({ message: "Choose a student, date and valid attendance status." });
  }
  try {
    await pool.query(`
      INSERT INTO attendance (student_id, attendance_date, status)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE status = VALUES(status)
    `, [student_id, attendance_date, status]);
    res.json({ message: "Attendance saved successfully." });
  } catch (error) {
    if (error.code === "ER_NO_REFERENCED_ROW_2") return res.status(404).json({ message: "Student not found." });
    res.status(500).json({ message: "Could not save attendance." });
  }
});

app.get("/api/grades", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT g.id, g.student_id, s.roll_no, s.full_name, g.subject, g.assessment,
        g.marks_obtained, g.total_marks,
        ROUND((g.marks_obtained / g.total_marks) * 100, 2) AS percentage
      FROM grades g JOIN students s ON s.id = g.student_id
      ORDER BY g.id DESC
      LIMIT 200
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Could not load grades." });
  }
});

app.post("/api/grades", async (req, res) => {
  const { student_id, subject, assessment, marks_obtained, total_marks } = req.body;
  const marks = Number(marks_obtained);
  const total = Number(total_marks);
  if (!validId(student_id) || !subject?.trim() || !assessment?.trim() ||
      !Number.isFinite(marks) || !Number.isFinite(total) || total <= 0 || marks < 0 || marks > total) {
    return res.status(400).json({ message: "Enter a student, subject, assessment and valid marks (0 to total)." });
  }
  try {
    await pool.query(
      "INSERT INTO grades (student_id, subject, assessment, marks_obtained, total_marks) VALUES (?, ?, ?, ?, ?)",
      [student_id, subject.trim(), assessment.trim(), marks, total]
    );
    res.status(201).json({ message: "Grade saved successfully." });
  } catch (error) {
    if (error.code === "ER_NO_REFERENCED_ROW_2") return res.status(404).json({ message: "Student not found." });
    res.status(500).json({ message: "Could not save grade." });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;