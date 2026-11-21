# StudentTrack — DBMS final evaluation version

## What is real?
MySQL is the actual relational database. Sample CSV records are demonstration data only; they are saved in MySQL.

## Run on Windows / VS Code
1. Back up the existing MySQL database. Do **not** drop it.
2. Open this folder in VS Code. Copy `.env.example` to `.env`, and put your existing MySQL password in `DB_PASSWORD` (or reuse your existing `.env`). **Never submit `.env` publicly.**
3. If the database does not exist yet, execute `database.sql` in MySQL Workbench. If it already exists, **do not recreate or delete tables**.
4. Execute `upgrade_indexes.sql` in MySQL Workbench (optional but useful for evaluation).
5. Run `npm install` and `npm start`; open http://localhost:3000.
6. Open http://localhost:3000/api/health to check actual MySQL connectivity.

## New features
- **Server-side SQL search:** `GET /api/students?search=...&page=1&pageSize=10`; prevents fetching the full student table into the browser.
- **Pagination:** uses SQL `LIMIT` and `OFFSET` (10 rows per page); useful for growing student tables. For extremely large tables, cursor/keyset pagination would be a further upgrade.
- **Transactional CSV import:** select `sample_students.csv` in the Students section. Every file has a maximum 500 rows; a duplicate or invalid record rolls back the whole batch. Do not import the same sample twice.
- **Reports:** student-wise attendance and grade summaries using `LEFT JOIN`, `GROUP BY`, `COUNT` and `AVG`.
- **Indexes:** existing unique roll number plus optional date and course indexes. Normal indexes do not speed up `LIKE '%term%'`; advanced search could use FULLTEXT or prefix queries.

## DBMS viva points
- Tables: `students` (PK `id`), `attendance` (PK `id`, FK `student_id`), `grades` (PK `id`, FK `student_id`).
- Relationships: one student can have many attendance rows and many grade rows.
- Attendance enforces unique (`student_id`, `attendance_date`) and uses UPSERT to update attendance on the same day.
- Grades have a check constraint enforcing `0 <= marks_obtained <= total_marks`, `total_marks > 0`.
- Transactions: `BEGIN`, repeated `INSERT`, `COMMIT`; on error `ROLLBACK`.
- Prepared queries use placeholders; Express creates a MySQL connection pool (up to 10 connections).

## Limitations (answer honestly if asked)
- This is a local academic prototype, not a deployed production app. It does **not** include logins / role-based authorization or load-test evidence for 1,000 simultaneous users.
- Student selector is currently limited to 5,000 options; a searchable async selector would improve usability at larger scales.
- Attendance and grade tables still show latest 200 records. Their own server-side pagination can be a later phase.
- Reports use a simple average of percentage values across a student's assessments; a weighted average may be different.
- Reports count only 'Present' as present (not 'Late').

## Evaluation demo
1. Show `/api/health` returning connected.
2. Add a student in the UI; verify the row in MySQL Workbench: `SELECT * FROM students ORDER BY id DESC;`.
3. Search a student in UI. Click Next/Previous after importing test records.
4. Import sample CSV (once) and verify MySQL student count.
5. Mark attendance and add grade; open Reports.
6. Show `SHOW INDEX FROM students;` and `SHOW INDEX FROM attendance;` in Workbench.

**Warning:** Do not share `.env` or real student personal data in submissions. This ZIP does not contain credentials.
