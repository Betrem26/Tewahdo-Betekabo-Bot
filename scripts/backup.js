'use strict';
const fs   = require('fs');
const path = require('path');

if (process.env.TURSO_DATABASE_URL) {
  // When using Turso cloud, backups are managed by Turso.
  // The free plan provides 1-day point-in-time restore automatically.
  // No local backup action is needed.
  console.log('ℹ️  Running with Turso cloud database. Backups are handled by Turso (free plan: 1-day point-in-time restore).');
  console.log('   To restore, visit your Turso dashboard or use: turso db restore <db-name>');
  process.exit(0);
}

// Local development: copy the local bot.db file
const src     = path.join(__dirname, '..', 'data', 'bot.db');
const backDir = path.join(__dirname, '..', 'data', 'backups');

try {
  fs.mkdirSync(backDir, { recursive: true });
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const dest = path.join(backDir, `bot-${stamp}.db`);
  fs.copyFileSync(src, dest);
  console.log(`✅ Backup saved: bot-${stamp}.db`);

  // Keep only the last 7 backups
  const files = fs.readdirSync(backDir)
    .filter(f => f.startsWith('bot-') && f.endsWith('.db'))
    .sort();
  while (files.length > 7) {
    const old = files.shift();
    fs.unlinkSync(path.join(backDir, old));
  }
} catch (e) {
  console.error(`❌ Backup failed: ${e.message}`);
  process.exit(1);
}
