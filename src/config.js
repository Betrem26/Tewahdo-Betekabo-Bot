'use strict';
require('dotenv').config();

function normalizeUsername(value) {
  if (!value) return '';
  return String(value).replace(/^@/, '').trim().toLowerCase();
}

const OWNER_USERNAME = normalizeUsername(process.env.OWNER_USERNAME || '');
const OWNER_CHAT_ID  = process.env.OWNER_CHAT_ID ? Number(process.env.OWNER_CHAT_ID) : null;

function isOwner(ctx) {
  if (!ctx || !ctx.from) return false;
  // Primary check: numeric chat id (most reliable)
  if (OWNER_CHAT_ID) {
    if (Number(ctx.from.id)              === OWNER_CHAT_ID) return true;
    if (ctx.chat && Number(ctx.chat.id)  === OWNER_CHAT_ID) return true;
  }
  // Fallback: username match (case-insensitive)
  if (OWNER_USERNAME) {
    const incoming = normalizeUsername(ctx.from.username);
    if (incoming && incoming === OWNER_USERNAME) return true;
  }
  return false;
}

async function isAdminUser(ctx, db) {
  if (isOwner(ctx)) return true;
  if (!ctx || !ctx.from) return false;
  const username = normalizeUsername(ctx.from.username);
  const chatId = ctx.from.id;
  const result = await db.execute({
    sql: `SELECT * FROM admins WHERE type = 'admin' AND (username = ? OR chat_id = ?)`,
    args: [username || '', chatId],
  });
  return result.rows.length > 0;
}

async function isRepForRole(ctx, role, db) {
  if (isOwner(ctx)) return true;
  if (await isAdminUser(ctx, db)) return true;
  if (!ctx || !ctx.from) return false;
  const username = normalizeUsername(ctx.from.username);
  const chatId = ctx.from.id;
  const result = await db.execute({
    sql: `SELECT * FROM admins WHERE type = 'rep' AND (role = ? OR role = 'both') AND (username = ? OR chat_id = ?)`,
    args: [role, username || '', chatId],
  });
  return result.rows.length > 0;
}

// Keep isAdminForRole as an alias for backward compat
const isAdminForRole = isRepForRole;

module.exports = {
  OWNER_USERNAME,
  OWNER_CHAT_ID,
  isOwner,
  normalizeUsername,
  isAdminForRole,
  isAdminUser,
  isRepForRole,
};
