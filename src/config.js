'use strict';
require('dotenv').config();

function normalizeUsername(value) {
  if (!value) return '';
  return String(value).replace(/^@/, '').trim().toLowerCase();
}

const OWNER_USERNAME = normalizeUsername(process.env.OWNER_USERNAME || 'Jph2126');
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID ? Number(process.env.OWNER_CHAT_ID) : null;

function isOwner(ctx) {
  if (!ctx || !ctx.from) return false;
  if (OWNER_CHAT_ID && ctx.chat && Number(ctx.chat.id) === OWNER_CHAT_ID) return true;
  if (OWNER_CHAT_ID && Number(ctx.from.id) === OWNER_CHAT_ID) return true;
  const username = normalizeUsername(ctx.from.username);
  return Boolean(username && username === OWNER_USERNAME);
}

module.exports = { OWNER_USERNAME, OWNER_CHAT_ID, isOwner, normalizeUsername };
