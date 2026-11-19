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

module.exports = { OWNER_USERNAME, OWNER_CHAT_ID, isOwner, normalizeUsername };
