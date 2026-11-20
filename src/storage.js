'use strict';
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const dbDirectory = path.join(__dirname, '..', 'data');
const dbPath      = process.env.DB_PATH || path.join(dbDirectory, 'bot.db');

if (!process.env.DB_PATH) {
  fs.mkdirSync(dbDirectory, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// ── Schema ─────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id    INTEGER PRIMARY KEY,
    chat_id    INTEGER NOT NULL,
    username   TEXT,
    first_name TEXT,
    last_name  TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
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
    created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
    answered_at      TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id    INTEGER,
    username   TEXT NOT NULL UNIQUE,
    role       TEXT NOT NULL CHECK(role IN ('theology','literature','both')),
    added_by   INTEGER NOT NULL,
    added_at   TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Migrate: add category column to databases created before this column existed
try { db.exec(`ALTER TABLE questions ADD COLUMN category TEXT NOT NULL DEFAULT 'theology'`); } catch (_) {}

// Migrate: add current_category column to users table (feature #4)
try { db.exec('ALTER TABLE users ADD COLUMN current_category TEXT'); } catch (_) {}

// Migrate: add owner_message_ids column to questions table
try { db.exec("ALTER TABLE questions ADD COLUMN owner_message_ids TEXT"); } catch (_) {}

// Migrate: add type column to admins table
try { db.exec(`ALTER TABLE admins ADD COLUMN type TEXT NOT NULL DEFAULT 'rep' CHECK(type IN ('admin','rep'))`); } catch (_) {}

// ── Helpers ────────────────────────────────────────────────────────────────

function normalizeUsername(value) {
  if (!value) return '';
  return String(value).replace(/^@/, '').trim().toLowerCase();
}

function upsertUser({ userId, chatId, username, firstName, lastName }) {
  db.prepare(`
    INSERT INTO users (user_id, chat_id, username, first_name, last_name, updated_at)
    VALUES (@userId, @chatId, @username, @firstName, @lastName, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      chat_id    = excluded.chat_id,
      username   = excluded.username,
      first_name = excluded.first_name,
      last_name  = excluded.last_name,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    userId,
    chatId,
    username:   username   || null,
    firstName:  firstName  || null,
    lastName:   lastName   || null,
  });
  if (username) {
    updateAdminChatId(normalizeUsername(username), chatId);
  }
}

function recordQuestion({ userChatId, userId, username, firstName, lastName, questionText, ownerMessageId, category }) {
  const result = db.prepare(`
    INSERT INTO questions
      (user_chat_id, user_id, username, first_name, last_name, question_text, owner_message_id, category)
    VALUES
      (@userChatId, @userId, @username, @firstName, @lastName, @questionText, @ownerMessageId, @category)
  `).run({
    userChatId,
    userId,
    username:        username        || null,
    firstName:       firstName       || null,
    lastName:        lastName        || null,
    questionText,
    ownerMessageId:  ownerMessageId  || null,
    category:        category        || 'theology',
  });
  return result.lastInsertRowid;
}

function updateOwnerMessageId({ questionId, ownerMessageId }) {
  db.prepare(`UPDATE questions SET owner_message_id = @ownerMessageId WHERE id = @questionId`)
    .run({ questionId, ownerMessageId });
}

function updateOwnerMessageIds({ questionId, ownerMessageId, ownerMessageIds }) {
  db.prepare(`UPDATE questions SET owner_message_id = @ownerMessageId, owner_message_ids = @ownerMessageIds WHERE id = @questionId`)
    .run({ questionId, ownerMessageId, ownerMessageIds });
}

function updateQuestionStatus({ ownerMessageId, status }) {
  db.prepare(`
    UPDATE questions SET status = @status, answered_at = CURRENT_TIMESTAMP
    WHERE owner_message_id = @ownerMessageId
  `).run({ status, ownerMessageId });
}

function updateQuestionStatusById({ questionId, status }) {
  db.prepare(`UPDATE questions SET status = @status, answered_at = CURRENT_TIMESTAMP WHERE id = @questionId`)
    .run({ questionId, status });
}

function getQuestionByOwnerMessageId(ownerMessageId) {
  return db.prepare(`SELECT * FROM questions WHERE owner_message_id = ? LIMIT 1`).get(ownerMessageId);
}

function getQuestionById(id) {
  return db.prepare(`SELECT * FROM questions WHERE id = ? LIMIT 1`).get(id);
}

function getPendingQuestions() {
  return db.prepare(`SELECT * FROM questions WHERE status = 'pending' ORDER BY created_at ASC`).all();
}

function getPendingQuestionsByCategory(category) {
  return db.prepare(`SELECT * FROM questions WHERE status = 'pending' AND category = ? ORDER BY created_at ASC`).all(category);
}

function getStats() {
  const total             = db.prepare(`SELECT COUNT(*) AS c FROM questions`).get().c;
  const pending           = db.prepare(`SELECT COUNT(*) AS c FROM questions WHERE status = 'pending'`).get().c;
  const answered_bot      = db.prepare(`SELECT COUNT(*) AS c FROM questions WHERE status = 'answered_bot'`).get().c;
  const answered_assembly = db.prepare(`SELECT COUNT(*) AS c FROM questions WHERE status = 'answered_assembly'`).get().c;
  const answered_sunday   = db.prepare(`SELECT COUNT(*) AS c FROM questions WHERE status = 'answered_sunday'`).get().c;
  const answered_tuesday  = db.prepare(`SELECT COUNT(*) AS c FROM questions WHERE status = 'answered_tuesday'`).get().c;
  return { total, pending, answered_bot, answered_assembly, answered_sunday, answered_tuesday };
}

function getStatsByCategory(category) {
  const total             = db.prepare(`SELECT COUNT(*) AS c FROM questions WHERE category = ?`).get(category).c;
  const pending           = db.prepare(`SELECT COUNT(*) AS c FROM questions WHERE category = ? AND status = 'pending'`).get(category).c;
  const answered_bot      = db.prepare(`SELECT COUNT(*) AS c FROM questions WHERE category = ? AND status = 'answered_bot'`).get(category).c;
  const answered_assembly = db.prepare(`SELECT COUNT(*) AS c FROM questions WHERE category = ? AND status = 'answered_assembly'`).get(category).c;
  const answered_sunday   = db.prepare(`SELECT COUNT(*) AS c FROM questions WHERE category = ? AND status = 'answered_sunday'`).get(category).c;
  const answered_tuesday  = db.prepare(`SELECT COUNT(*) AS c FROM questions WHERE category = ? AND status = 'answered_tuesday'`).get(category).c;
  return { total, pending, answered_bot, answered_assembly, answered_sunday, answered_tuesday };
}

// Feature #3: broadcast uses users table
function getUniqueUserChatIds() {
  return db.prepare(`SELECT DISTINCT chat_id FROM users`).all().map(r => r.chat_id);
}

// Feature #4: persist category in DB
function setUserCategory(chatId, category) {
  db.prepare('UPDATE users SET current_category = ? WHERE chat_id = ?').run(category, chatId);
}

function getUserCategory(chatId) {
  return db.prepare('SELECT current_category FROM users WHERE chat_id = ? LIMIT 1').get(chatId)?.current_category || null;
}

// Feature #7: duplicate question guard
function findDuplicatePendingQuestion(userId, questionText) {
  return db.prepare(`SELECT * FROM questions WHERE user_id = ? AND question_text = ? AND status = 'pending' LIMIT 1`).get(userId, questionText) || null;
}

// ── Admin / Rep management ─────────────────────────────────────────────────

/**
 * addAdmin — dual signature for backward compat:
 *   addAdmin({ username, role, addedBy })  → old behavior: upsert with given role, type='rep'
 *   addAdmin({ username, addedBy })        → new behavior: type='admin', role='both'
 */
function addAdmin({ username, role, addedBy }) {
  const normalised = normalizeUsername(username);
  if (role !== undefined && role !== null) {
    // Old behavior: upsert with the provided role; type defaults to 'rep'
    db.prepare(`
      INSERT INTO admins (username, role, added_by, type)
      VALUES (?, ?, ?, 'rep')
      ON CONFLICT(username) DO UPDATE SET role = excluded.role, added_by = excluded.added_by
    `).run(normalised, role, addedBy);
  } else {
    // New behavior: type='admin', role='both'
    db.prepare(`
      INSERT OR IGNORE INTO admins (username, role, added_by, type)
      VALUES (?, 'both', ?, 'admin')
    `).run(normalised, addedBy);
  }
  return db.prepare(`SELECT * FROM admins WHERE username = ?`).get(normalised);
}

/**
 * addRep — inserts a rep (type='rep') with a specific role ('theology' or 'literature').
 * Uses INSERT OR IGNORE so duplicate username+role combinations are silently skipped.
 */
function addRep({ username, role, addedBy }) {
  const normalised = normalizeUsername(username);
  db.prepare(`
    INSERT OR IGNORE INTO admins (username, role, added_by, type)
    VALUES (?, ?, ?, 'rep')
  `).run(normalised, role, addedBy);
  return db.prepare(`SELECT * FROM admins WHERE username = ?`).get(normalised);
}

/**
 * removeAdmin — deletes type='admin' rows; falls back to any row for backward compat.
 */
function removeAdmin(username) {
  const normalised = normalizeUsername(username);
  const result = db.prepare(`DELETE FROM admins WHERE type = 'admin' AND username = ?`).run(normalised);
  if (result.changes > 0) return result.changes;
  // Fallback: old data without type column
  const fallback = db.prepare(`DELETE FROM admins WHERE username = ?`).run(normalised);
  return fallback.changes;
}

/**
 * removeRep — deletes type='rep' rows only.
 */
function removeRep(username) {
  const normalised = normalizeUsername(username);
  const result = db.prepare(`DELETE FROM admins WHERE type = 'rep' AND username = ?`).run(normalised);
  return result.changes;
}

/**
 * getAdmins — returns only type='admin' rows (new behavior).
 */
function getAdmins() {
  return db.prepare(`SELECT * FROM admins WHERE type = 'admin' ORDER BY added_at ASC`).all();
}

/**
 * getReps — returns all type='rep' rows.
 */
function getReps() {
  return db.prepare(`SELECT * FROM admins WHERE type = 'rep' ORDER BY role ASC, added_at ASC`).all();
}

/**
 * getAllStaff — returns every row.
 */
function getAllStaff() {
  return db.prepare(`SELECT * FROM admins ORDER BY type ASC, role ASC, added_at ASC`).all();
}

function getAdminsByRole(role) {
  return db.prepare(`SELECT * FROM admins WHERE role = ? OR role = 'both'`).all(role);
}

/**
 * getAdminChatIds — dual signature:
 *   getAdminChatIds(role) → old behavior: WHERE (role=? OR role='both') AND chat_id IS NOT NULL
 *   getAdminChatIds()     → new behavior: WHERE type='admin' AND chat_id IS NOT NULL
 */
function getAdminChatIds(role) {
  if (role !== undefined) {
    // Old behavior — used by question routing before the new code path
    return db.prepare(
      `SELECT chat_id FROM admins WHERE (role = ? OR role = 'both') AND chat_id IS NOT NULL`
    ).all(role).map(r => Number(r.chat_id));
  }
  // New behavior — only type='admin'
  return db.prepare(
    `SELECT chat_id FROM admins WHERE type = 'admin' AND chat_id IS NOT NULL`
  ).all().map(r => Number(r.chat_id));
}

/**
 * getRepChatIds — returns non-null chat_ids where type='rep' AND (role=given OR role='both').
 */
function getRepChatIds(role) {
  return db.prepare(
    `SELECT chat_id FROM admins WHERE type = 'rep' AND (role = ? OR role = 'both') AND chat_id IS NOT NULL`
  ).all(role).map(r => Number(r.chat_id));
}

function updateAdminChatId(username, chatId) {
  const normalised = normalizeUsername(username);
  db.prepare(`UPDATE admins SET chat_id = ? WHERE username = ?`).run(chatId, normalised);
}

module.exports = {
  db,
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
  getUniqueUserChatIds,
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
