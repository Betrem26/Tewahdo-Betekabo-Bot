'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDirectory = path.join(__dirname, '..', 'data');
const dbPath = process.env.DB_PATH || path.join(dbDirectory, 'bot.db');

if (!process.env.DB_PATH) {
  fs.mkdirSync(dbDirectory, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    chat_id INTEGER NOT NULL,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_chat_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    question_text TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    owner_message_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    answered_at TEXT
  )
`);

function upsertUser({ userId, chatId, username, firstName, lastName }) {
  db.prepare(`
    INSERT OR REPLACE INTO users (user_id, chat_id, username, first_name, last_name, updated_at)
    VALUES (@userId, @chatId, @username, @firstName, @lastName, CURRENT_TIMESTAMP)
  `).run({ userId, chatId, username: username || null, firstName: firstName || null, lastName: lastName || null });
}

function recordQuestion({ userChatId, userId, username, firstName, lastName, questionText, ownerMessageId }) {
  const result = db.prepare(`
    INSERT INTO questions (user_chat_id, user_id, username, first_name, last_name, question_text, owner_message_id)
    VALUES (@userChatId, @userId, @username, @firstName, @lastName, @questionText, @ownerMessageId)
  `).run({
    userChatId,
    userId,
    username: username || null,
    firstName: firstName || null,
    lastName: lastName || null,
    questionText,
    ownerMessageId: ownerMessageId || null,
  });
  return result.lastInsertRowid;
}

function updateQuestionStatus({ ownerMessageId, status }) {
  db.prepare(`
    UPDATE questions SET status = @status, answered_at = CURRENT_TIMESTAMP
    WHERE owner_message_id = @ownerMessageId
  `).run({ status, ownerMessageId });
}

function getQuestionByOwnerMessageId(ownerMessageId) {
  return db.prepare('SELECT * FROM questions WHERE owner_message_id = ? LIMIT 1').get(ownerMessageId);
}

function getPendingQuestions() {
  return db.prepare("SELECT * FROM questions WHERE status = 'pending' ORDER BY created_at ASC").all();
}

function getStats() {
  const total = db.prepare('SELECT COUNT(*) as count FROM questions').get().count;
  const pending = db.prepare("SELECT COUNT(*) as count FROM questions WHERE status = 'pending'").get().count;
  const answered_bot = db.prepare("SELECT COUNT(*) as count FROM questions WHERE status = 'answered_bot'").get().count;
  const answered_assembly = db.prepare("SELECT COUNT(*) as count FROM questions WHERE status = 'answered_assembly'").get().count;
  const answered_sunday = db.prepare("SELECT COUNT(*) as count FROM questions WHERE status = 'answered_sunday'").get().count;
  return { total, pending, answered_bot, answered_assembly, answered_sunday };
}

function getUniqueUserChatIds() {
  return db.prepare('SELECT DISTINCT user_chat_id FROM questions').all().map(r => r.user_chat_id);
}

function updateOwnerMessageId({ questionId, ownerMessageId }) {
  db.prepare('UPDATE questions SET owner_message_id = @ownerMessageId WHERE id = @questionId')
    .run({ questionId, ownerMessageId });
}

module.exports = {
  db,
  upsertUser,
  recordQuestion,
  updateQuestionStatus,
  getQuestionByOwnerMessageId,
  getPendingQuestions,
  getStats,
  getUniqueUserChatIds,
  updateOwnerMessageId,
};
