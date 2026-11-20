'use strict';
const { createClient } = require('@libsql/client');
const path = require('path');

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || ('file:' + path.join(__dirname, '..', 'data', 'bot.db').replace(/\\/g, '/')),
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

// ── Schema init ────────────────────────────────────────────────────────────

async function initDb() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      user_id    INTEGER PRIMARY KEY,
      chat_id    INTEGER NOT NULL,
      username   TEXT,
      first_name TEXT,
      last_name  TEXT,
      current_category TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS questions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_chat_id     INTEGER NOT NULL,
      user_id          INTEGER NOT NULL,
      username         TEXT,
      first_name       TEXT,
      last_name        TEXT,
      question_text    TEXT NOT NULL,
      category         TEXT NOT NULL DEFAULT 'theology',
      status           TEXT NOT NULL DEFAULT 'pending',
      owner_message_id INTEGER,
      owner_message_ids TEXT,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
      answered_at      TEXT
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS admins (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id    INTEGER,
      username   TEXT NOT NULL UNIQUE,
      role       TEXT NOT NULL CHECK(role IN ('theology','literature','both')),
      added_by   INTEGER NOT NULL,
      type       TEXT NOT NULL DEFAULT 'rep' CHECK(type IN ('admin','rep')),
      added_at   TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migrations — each wrapped in try/catch so they silently skip on re-run
  try { await client.execute(`ALTER TABLE questions ADD COLUMN category TEXT NOT NULL DEFAULT 'theology'`); } catch (_) {}
  try { await client.execute(`ALTER TABLE users ADD COLUMN current_category TEXT`); } catch (_) {}
  try { await client.execute(`ALTER TABLE questions ADD COLUMN owner_message_ids TEXT`); } catch (_) {}
  try {
    await client.execute(`ALTER TABLE admins ADD COLUMN type TEXT NOT NULL DEFAULT 'rep' CHECK(type IN ('admin','rep'))`);
    // Only backfill on a fresh migration — rows that existed before this column were old-style admins
    await client.execute(`UPDATE admins SET type = 'admin' WHERE type = 'rep'`);
  } catch (_) {
    // Column already exists — skip backfill entirely
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function normalizeUsername(value) {
  if (!value) return '';
  return String(value).replace(/^@/, '').trim().toLowerCase();
}

// ── User functions ─────────────────────────────────────────────────────────

async function upsertUser({ userId, chatId, username, firstName, lastName }) {
  await client.execute({
    sql: `
      INSERT INTO users (user_id, chat_id, username, first_name, last_name, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        chat_id    = excluded.chat_id,
        username   = excluded.username,
        first_name = excluded.first_name,
        last_name  = excluded.last_name,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [userId, chatId, username || null, firstName || null, lastName || null],
  });
  if (username) {
    await updateAdminChatId(normalizeUsername(username), chatId);
  }
}

// ── Question functions ─────────────────────────────────────────────────────

async function recordQuestion({ userChatId, userId, username, firstName, lastName, questionText, ownerMessageId, category }) {
  const result = await client.execute({
    sql: `
      INSERT INTO questions
        (user_chat_id, user_id, username, first_name, last_name, question_text, owner_message_id, category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      userChatId,
      userId,
      username    || null,
      firstName   || null,
      lastName    || null,
      questionText,
      ownerMessageId || null,
      category    || 'theology',
    ],
  });
  return Number(result.lastInsertRowid);
}

async function updateOwnerMessageId({ questionId, ownerMessageId }) {
  await client.execute({
    sql: `UPDATE questions SET owner_message_id = ? WHERE id = ?`,
    args: [ownerMessageId, questionId],
  });
}

async function updateOwnerMessageIds({ questionId, ownerMessageId, ownerMessageIds }) {
  await client.execute({
    sql: `UPDATE questions SET owner_message_id = ?, owner_message_ids = ? WHERE id = ?`,
    args: [ownerMessageId, ownerMessageIds, questionId],
  });
}

async function updateQuestionStatus({ ownerMessageId, status }) {
  await client.execute({
    sql: `UPDATE questions SET status = ?, answered_at = CURRENT_TIMESTAMP WHERE owner_message_id = ?`,
    args: [status, ownerMessageId],
  });
}

async function updateQuestionStatusById({ questionId, status }) {
  await client.execute({
    sql: `UPDATE questions SET status = ?, answered_at = CURRENT_TIMESTAMP WHERE id = ?`,
    args: [status, questionId],
  });
}

async function getQuestionByOwnerMessageId(ownerMessageId) {
  const result = await client.execute({
    sql: `SELECT * FROM questions WHERE owner_message_id = ? LIMIT 1`,
    args: [ownerMessageId],
  });
  return result.rows[0] || null;
}

async function getQuestionById(id) {
  const result = await client.execute({
    sql: `SELECT * FROM questions WHERE id = ? LIMIT 1`,
    args: [id],
  });
  return result.rows[0] || null;
}

async function getPendingQuestions() {
  const result = await client.execute(
    `SELECT * FROM questions WHERE status = 'pending' ORDER BY created_at ASC`
  );
  return Array.from(result.rows);
}

async function getPendingQuestionsByCategory(category) {
  const result = await client.execute({
    sql: `SELECT * FROM questions WHERE status = 'pending' AND category = ? ORDER BY created_at ASC`,
    args: [category],
  });
  return Array.from(result.rows);
}

async function getStats() {
  const total             = (await client.execute(`SELECT COUNT(*) AS c FROM questions`)).rows[0].c;
  const pending           = (await client.execute(`SELECT COUNT(*) AS c FROM questions WHERE status = 'pending'`)).rows[0].c;
  const answered_bot      = (await client.execute(`SELECT COUNT(*) AS c FROM questions WHERE status = 'answered_bot'`)).rows[0].c;
  const answered_assembly = (await client.execute(`SELECT COUNT(*) AS c FROM questions WHERE status = 'answered_assembly'`)).rows[0].c;
  const answered_sunday   = (await client.execute(`SELECT COUNT(*) AS c FROM questions WHERE status = 'answered_sunday'`)).rows[0].c;
  const answered_tuesday  = (await client.execute(`SELECT COUNT(*) AS c FROM questions WHERE status = 'answered_tuesday'`)).rows[0].c;
  return {
    total:             Number(total),
    pending:           Number(pending),
    answered_bot:      Number(answered_bot),
    answered_assembly: Number(answered_assembly),
    answered_sunday:   Number(answered_sunday),
    answered_tuesday:  Number(answered_tuesday),
  };
}

async function getStatsByCategory(category) {
  const total             = (await client.execute({ sql: `SELECT COUNT(*) AS c FROM questions WHERE category = ?`, args: [category] })).rows[0].c;
  const pending           = (await client.execute({ sql: `SELECT COUNT(*) AS c FROM questions WHERE status = 'pending' AND category = ?`, args: [category] })).rows[0].c;
  const answered_bot      = (await client.execute({ sql: `SELECT COUNT(*) AS c FROM questions WHERE status = 'answered_bot' AND category = ?`, args: [category] })).rows[0].c;
  const answered_assembly = (await client.execute({ sql: `SELECT COUNT(*) AS c FROM questions WHERE status = 'answered_assembly' AND category = ?`, args: [category] })).rows[0].c;
  const answered_sunday   = (await client.execute({ sql: `SELECT COUNT(*) AS c FROM questions WHERE status = 'answered_sunday' AND category = ?`, args: [category] })).rows[0].c;
  const answered_tuesday  = (await client.execute({ sql: `SELECT COUNT(*) AS c FROM questions WHERE status = 'answered_tuesday' AND category = ?`, args: [category] })).rows[0].c;
  return {
    total:             Number(total),
    pending:           Number(pending),
    answered_bot:      Number(answered_bot),
    answered_assembly: Number(answered_assembly),
    answered_sunday:   Number(answered_sunday),
    answered_tuesday:  Number(answered_tuesday),
  };
}

async function getAllQuestions() {
  const result = await client.execute('SELECT * FROM questions ORDER BY id ASC');
  return Array.from(result.rows);
}

async function getUniqueUserChatIds() {
  const result = await client.execute(`SELECT DISTINCT chat_id FROM users`);
  return result.rows.map(r => Number(r.chat_id));
}

async function getUserChatIdsByCategory(category) {
  const result = await client.execute({
    sql: `SELECT DISTINCT user_chat_id FROM questions WHERE category = ?`,
    args: [category],
  });
  return result.rows.map(r => Number(r.user_chat_id));
}

async function setUserCategory(chatId, category) {
  await client.execute({
    sql: `UPDATE users SET current_category = ? WHERE chat_id = ?`,
    args: [category, chatId],
  });
}

async function getUserCategory(chatId) {
  const result = await client.execute({
    sql: `SELECT current_category FROM users WHERE chat_id = ? LIMIT 1`,
    args: [chatId],
  });
  return result.rows[0]?.current_category || null;
}

async function findDuplicatePendingQuestion(userId, questionText) {
  const result = await client.execute({
    sql: `SELECT * FROM questions WHERE user_id = ? AND question_text = ? AND status = 'pending' LIMIT 1`,
    args: [userId, questionText],
  });
  return result.rows[0] || null;
}

// ── Admin / Rep management ─────────────────────────────────────────────────

async function addAdmin({ username, addedBy }) {
  const normalised = normalizeUsername(username);
  await client.execute({
    sql: `INSERT OR IGNORE INTO admins (username, role, added_by, type) VALUES (?, 'both', ?, 'admin')`,
    args: [normalised, addedBy],
  });
  const r = await client.execute({
    sql: `SELECT * FROM admins WHERE username = ? AND type = 'admin'`,
    args: [normalised],
  });
  return r.rows[0];
}

async function addRep({ username, role, addedBy }) {
  const normalised = normalizeUsername(username);
  await client.execute({
    sql: `INSERT OR IGNORE INTO admins (username, role, added_by, type) VALUES (?, ?, ?, 'rep')`,
    args: [normalised, role, addedBy],
  });
  const r = await client.execute({
    sql: `SELECT * FROM admins WHERE username = ?`,
    args: [normalised],
  });
  return r.rows[0];
}

async function removeAdmin(username) {
  const normalised = normalizeUsername(username);
  const result = await client.execute({
    sql: `DELETE FROM admins WHERE type = 'admin' AND username = ?`,
    args: [normalised],
  });
  return Number(result.rowsAffected);
}

async function removeRep(username) {
  const normalised = normalizeUsername(username);
  const result = await client.execute({
    sql: `DELETE FROM admins WHERE type = 'rep' AND username = ?`,
    args: [normalised],
  });
  return Number(result.rowsAffected);
}

async function getAdmins() {
  const result = await client.execute(
    `SELECT * FROM admins WHERE type = 'admin' ORDER BY added_at ASC`
  );
  return Array.from(result.rows);
}

async function getReps() {
  const result = await client.execute(
    `SELECT * FROM admins WHERE type = 'rep' ORDER BY role ASC, added_at ASC`
  );
  return Array.from(result.rows);
}

async function getAllStaff() {
  const result = await client.execute(
    `SELECT * FROM admins ORDER BY type ASC, role ASC, added_at ASC`
  );
  return Array.from(result.rows);
}

async function getAdminsByRole(role) {
  const result = await client.execute({
    sql: `SELECT * FROM admins WHERE role = ? OR role = 'both'`,
    args: [role],
  });
  return Array.from(result.rows);
}

async function getAdminChatIds(role) {
  if (role !== undefined) {
    const result = await client.execute({
      sql: `SELECT chat_id FROM admins WHERE (role = ? OR role = 'both') AND chat_id IS NOT NULL`,
      args: [role],
    });
    return result.rows.map(r => Number(r.chat_id));
  }
  const result = await client.execute(
    `SELECT chat_id FROM admins WHERE type = 'admin' AND chat_id IS NOT NULL`
  );
  return result.rows.map(r => Number(r.chat_id));
}

async function getRepChatIds(role) {
  const result = await client.execute({
    sql: `SELECT chat_id FROM admins WHERE type = 'rep' AND (role = ? OR role = 'both') AND chat_id IS NOT NULL`,
    args: [role],
  });
  return result.rows.map(r => Number(r.chat_id));
}

async function updateAdminChatId(username, chatId) {
  const normalised = normalizeUsername(username);
  await client.execute({
    sql: `UPDATE admins SET chat_id = ? WHERE username = ?`,
    args: [chatId, normalised],
  });
}

async function closeDb() {
  client.close();
}

// ── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  db: client,
  initDb,
  closeDb,
  upsertUser,
  recordQuestion,
  updateOwnerMessageId,
  updateOwnerMessageIds,
  updateQuestionStatus,
  updateQuestionStatusById,
  getQuestionByOwnerMessageId,
  getQuestionById,
  getPendingQuestions,
  getPendingQuestionsByCategory,
  getStats,
  getStatsByCategory,
  getAllQuestions,
  getUniqueUserChatIds,
  getUserChatIdsByCategory,
  setUserCategory,
  getUserCategory,
  findDuplicatePendingQuestion,
  addAdmin,
  addRep,
  removeAdmin,
  removeRep,
  getAdmins,
  getReps,
  getAllStaff,
  getAdminsByRole,
  getAdminChatIds,
  getRepChatIds,
  updateAdminChatId,
};
