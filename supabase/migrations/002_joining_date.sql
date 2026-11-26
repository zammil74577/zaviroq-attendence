-- Additive migration: add joining_date to employees and backfill from created_at (IST)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS joining_date DATE DEFAULT CURRENT_DATE;
UPDATE employees
SET joining_date = (created_at AT TIME ZONE 'Asia/Kolkata')::date
WHERE joining_date IS NULL;
