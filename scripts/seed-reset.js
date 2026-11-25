import { db, hashPin } from '../server/db.js';

const adminCode = (process.env.ADMIN_CODE || 'ZAV-001').trim().toUpperCase();
const adminName = (process.env.ADMIN_NAME || 'Zaviroq Admin').trim();
const adminEmail = (process.env.ADMIN_EMAIL || 'admin@zaviroq.com').trim().toLowerCase();
const initialPin = (process.env.ADMIN_PIN || '849201').trim();

// Remove demo employees
const demoCodes = ['ZAV-001', 'ZAV-002', 'ZAV-003', 'ZAV-004', 'ZAV-005', 'ZAV-006'];
const placeholders = demoCodes.map(() => '?').join(',');
db.prepare(`DELETE FROM employees WHERE emp_code IN (${placeholders})`).run(...demoCodes);

// Create real first admin with forced PIN change on first login
db.prepare(`
  INSERT INTO employees (emp_code, name, email, role, department, designation, shift_start, shift_end, status, avatar_color, pin, must_change_pin, is_active)
  VALUES (?, ?, ?, 'admin', 'Operations', 'System Administrator', '09:30', '17:30', 'offline', '#6366f1', ?, 1, 1)
`).run(adminCode, adminName, adminEmail, hashPin(initialPin));

const created = db.prepare(`SELECT id, emp_code, name, email, role FROM employees WHERE emp_code = ?`).get(adminCode);
db.prepare(`INSERT OR IGNORE INTO salary_structures (employee_id) VALUES (?)`).run(created.id);

console.log('Seed reset complete. Created admin:', created);
