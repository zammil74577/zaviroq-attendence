/**
 * Migrate Base64 or local /uploads/* chat images from Postgres chat_messages
 * into the private Supabase Storage bucket "chat-images".
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." SUPABASE_URL="https://..." SUPABASE_SERVICE_ROLE_KEY="..." npm run migrate:chat-images
 */
import fs from 'node:fs';
import path from 'node:path';
import { getPool } from '../server/pg.js';
import { uploadChatImage } from '../server/storage.js';

const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

async function main() {
  if (!process.env.DATABASE_URL || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ DATABASE_URL, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY are required.');
    process.exit(1);
  }

  const pool = getPool();
  try {
    const { rows } = await pool.query(
      `SELECT id, image_data FROM chat_messages
       WHERE image_data IS NOT NULL
         AND (image_data LIKE 'data:image/%' OR image_data LIKE '/uploads/%')`
    );

    console.log(`Found ${rows.length} chat_messages with inline/local images.`);
    let migrated = 0;

    for (const row of rows) {
      let dataUrl = row.image_data;

      if (dataUrl.startsWith('/uploads/')) {
        const localFile = path.resolve(process.cwd(), dataUrl.replace(/^\//, ''));
        if (!fs.existsSync(localFile)) {
          console.warn(`⚠️  Skipping id=${row.id}: local file not found (${localFile})`);
          continue;
        }
        const ext = path.extname(localFile).slice(1).toLowerCase() || 'png';
        const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
        const buf = fs.readFileSync(localFile);
        dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
      }

      const storagePath = await uploadChatImage(dataUrl);
      await pool.query('UPDATE chat_messages SET image_data = $1 WHERE id = $2', [storagePath, row.id]);
      migrated++;
    }

    console.log(`✅ Migrated ${migrated}/${rows.length} chat images to Supabase Storage bucket "chat-images".`);
  } catch (err) {
    console.error('❌ Chat image migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
