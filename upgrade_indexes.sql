-- Run this only once in MySQL Workbench after selecting your existing database.
-- The original tables and records remain unchanged.
 USE student_tracker_db;

 -- Indexes on student_id are normally created automatically for the foreign keys.
 -- Add composite index for attendance by date, useful for reports and filtering.
 SET @sql = (SELECT IF(COUNT(*) = 0,
   'CREATE INDEX idx_attendance_date_status ON attendance (attendance_date, status)',
   'SELECT ''Attendance index already exists''')
   FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'attendance' AND index_name = 'idx_attendance_date_status');
 PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

 SET @sql = (SELECT IF(COUNT(*) = 0,
   'CREATE INDEX idx_students_course ON students (course)',
   'SELECT ''Course index already exists''')
   FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'students' AND index_name = 'idx_students_course');
 PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

 -- Existing UNIQUE(roll_no) already provides an index for exact roll-number lookups.
 -- LIKE searches containing a leading wildcard do not benefit from ordinary B-tree indexes.
