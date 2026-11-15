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

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Database connection failed. Check your .env settings." });
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

app.get("/api/students", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.*,
        (SELECT COUNT(*) FROM attendance a WHERE a.student_id = s.id) AS attendance_count,
        (SELECT COUNT(*) FROM grades g WHERE g.student_id = s.id) AS grade_count
      FROM students s
      ORDER BY s.id DESC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Could not load students." });
  }
});

app.post("/api/students", async (req, res) => {
  const { roll_no, full_name, email, course, semester } = req.body;
  if (!roll_no?.trim() || !full_name?.trim() || !course?.trim()) {
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
  if (!roll_no?.trim() || !full_name?.trim() || !course?.trim()) {
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