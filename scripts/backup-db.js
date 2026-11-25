import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const rawDbPath = process.env.DATABASE_PATH || process.env.DB_PATH || path.resolve('data/zaviroq.db');
const dbPath = path.resolve(rawDbPath);
const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(path.dirname(dbPath), 'backups'));

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath}`);
  process.exit(1);
}

if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

const now = new Date();
const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const outFile = path.join(backupDir, `zaviroq-${dateStr}.db`);

if (fs.existsSync(outFile)) {
  fs.unlinkSync(outFile);
}

const db = new DatabaseSync(dbPath);
const escaped = outFile.replace(/'/g, "''");
db.exec(`VACUUM INTO '${escaped}';`);
db.close();

// Retain 14 days of backups
const cutoffMs = Date.now() - 14 * 24 * 60 * 60 * 1000;
let pruned = 0;
for (const file of fs.readdirSync(backupDir)) {
  if (!file.startsWith('zaviroq-') || !file.endsWith('.db')) continue;
  const full = path.join(backupDir, file);
  const stat = fs.statSync(full);
  if (stat.mtimeMs < cutoffMs) {
    fs.unlinkSync(full);
    pruned += 1;
  }
}

const sizeBytes = fs.statSync(outFile).size;
console.log(JSON.stringify({ ok: true, backupFile: outFile, sizeBytes, pruned }));
