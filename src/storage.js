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

// Migrate: add category column to databases created before this column existed
try { db.exec(`ALTER TABLE questions ADD COLUMN category TEXT NOT NULL DEFAULT 'theology'`); } catch (_) {}

// Migrate: add current_category column to users table (feature #4)
try { db.exec('ALTER TABLE users ADD COLUMN current_category TEXT'); } catch (_) {}

// ── Helpers ────────────────────────────────────────────────────────────────

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

function updateQuestionStatus({ ownerMessageId, status }) {
  db.prepare(`
    UPDATE questions SET status = @status, answered_at = CURRENT_TIMESTAMP
    WHERE owner_message_id = @ownerMessageId
  `).run({ status, ownerMessageId });
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

function getStats() {
  const total             = db.prepare(`SELECT COUNT(*) AS c FROM questions`).get().c;
  const pending           = db.prepare(`SELECT COUNT(*) AS c FROM questions WHERE status = 'pending'`).get().c;
  const answered_bot      = db.prepare(`SELECT COUNT(*) AS c FROM questions WHERE status = 'answered_bot'`).get().c;
  const answered_assembly = db.prepare(`SELECT COUNT(*) AS c FROM questions WHERE status = 'answered_assembly'`).get().c;
  const answered_sunday   = db.prepare(`SELECT COUNT(*) AS c FROM questions WHERE status = 'answered_sunday'`).get().c;
  const answered_tuesday  = db.prepare(`SELECT COUNT(*) AS c FROM questions WHERE status = 'answered_tuesday'`).get().c;
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

module.exports = {
  db,
  upsertUser,
  recordQuestion,
  updateOwnerMessageId,
  updateQuestionStatus,
  getQuestionByOwnerMessageId,
  getQuestionById,
  getPendingQuestions,
  getStats,
  getUniqueUserChatIds,
  setUserCategory,
  getUserCategory,
  findDuplicatePendingQuestion,
};
