'use strict';
const fs   = require('fs');
const path = require('path');

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
