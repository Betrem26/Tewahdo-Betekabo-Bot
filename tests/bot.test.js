'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Use a temp DB file so tests are isolated
const tmpDb = path.join(os.tmpdir(), `tewahdo-bot-test-${Date.now()}.db`).replace(/\\/g, '/');
process.env.TURSO_DATABASE_URL = 'file:' + tmpDb;

const storage = require('../src/storage');
const { isOwner, OWNER_USERNAME } = require('../src/config');

before(async () => {
  await storage.initDb();
});

after(async () => {
  await storage.closeDb();
  try { fs.unlinkSync(tmpDb); } catch (e) {}
  try { fs.unlinkSync(tmpDb + '-wal'); } catch (e) {}
  try { fs.unlinkSync(tmpDb + '-shm'); } catch (e) {}
});

test('upsertUser inserts and retrieves a user', async () => {
  await storage.upsertUser({ userId: 1001, chatId: 2001, username: 'testuser', firstName: 'Test', lastName: 'User' });
  const result = await storage.db.execute({ sql: 'SELECT * FROM users WHERE user_id = ?', args: [1001] });
  const row = result.rows[0];
  assert.equal(row.username, 'testuser');
  assert.equal(Number(row.chat_id), 2001);
  assert.equal(row.first_name, 'Test');
});

test('upsertUser updates existing user', async () => {
  await storage.upsertUser({ userId: 1001, chatId: 2001, username: 'updated', firstName: 'Updated', lastName: 'User' });
  const result = await storage.db.execute({ sql: 'SELECT * FROM users WHERE user_id = ?', args: [1001] });
  const row = result.rows[0];
  assert.equal(row.username, 'updated');
});

test('recordQuestion inserts and returns question id', async () => {
  const id = await storage.recordQuestion({
    userChatId: 2001, userId: 1001, username: 'testuser',
    firstName: 'Test', lastName: 'User',
    questionText: 'ምን ማለት ነው?', ownerMessageId: null
  });
  assert.ok(typeof id === 'number' && id > 0);
});

test('updateOwnerMessageId sets owner_message_id', async () => {
  const id = await storage.recordQuestion({
    userChatId: 2002, userId: 1002, username: 'user2',
    firstName: 'Two', lastName: 'User',
    questionText: 'ሌላ ጥያቄ?', ownerMessageId: null
  });
  await storage.updateOwnerMessageId({ questionId: id, ownerMessageId: 9999 });
  const row = await storage.getQuestionByOwnerMessageId(9999);
  assert.ok(row);
  assert.equal(Number(row.id), id);
  assert.equal(Number(row.owner_message_id), 9999);
});

test('getQuestionByOwnerMessageId returns correct row', async () => {
  await storage.recordQuestion({
    userChatId: 2003, userId: 1003, username: 'user3',
    firstName: 'Three', lastName: 'User',
    questionText: 'ሶስተኛ ጥያቄ?', ownerMessageId: 8888
  });
  const row = await storage.getQuestionByOwnerMessageId(8888);
  assert.ok(row);
  assert.equal(row.question_text, 'ሶስተኛ ጥያቄ?');
});

test('updateQuestionStatus changes status and sets answered_at', async () => {
  await storage.recordQuestion({
    userChatId: 2004, userId: 1004, username: 'user4',
    firstName: 'Four', lastName: 'User',
    questionText: 'አራተኛ ጥያቄ?', ownerMessageId: 7777
  });
  await storage.updateQuestionStatus({ ownerMessageId: 7777, status: 'answered_bot' });
  const row = await storage.getQuestionByOwnerMessageId(7777);
  assert.equal(row.status, 'answered_bot');
  assert.ok(row.answered_at);
});

test('getPendingQuestions returns only pending rows', async () => {
  const id = await storage.recordQuestion({
    userChatId: 2005, userId: 1005, username: 'user5',
    firstName: 'Five', lastName: 'User',
    questionText: 'አምስተኛ ጥያቄ?', ownerMessageId: null
  });
  const pending = await storage.getPendingQuestions();
  assert.ok(pending.every(q => q.status === 'pending'));
  assert.ok(pending.some(q => Number(q.id) === id));
});

test('getStats returns correct counts', async () => {
  const stats = await storage.getStats();
  assert.ok(typeof stats.total === 'number');
  assert.ok(typeof stats.pending === 'number');
  assert.ok(typeof stats.answered_bot === 'number');
  assert.ok(typeof stats.answered_assembly === 'number');
  assert.ok(typeof stats.answered_sunday === 'number');
  assert.ok(stats.answered_bot >= 1);
  assert.ok(stats.total >= stats.pending + stats.answered_bot);
});

test('isOwner returns true for matching username', () => {
  const fakeCtx = { from: { id: 999, username: OWNER_USERNAME }, chat: { id: 999 } };
  assert.equal(isOwner(fakeCtx), true);
});

test('isOwner returns false for non-owner username', () => {
  const fakeCtx = { from: { id: 888, username: 'randomuser' }, chat: { id: 888 } };
  assert.equal(isOwner(fakeCtx), false);
});

test('isOwner returns true for OWNER_CHAT_ID when set', () => {
  const { OWNER_CHAT_ID } = require('../src/config');
  if (!OWNER_CHAT_ID) return; // skip if not configured
  const fakeCtx = { from: { id: OWNER_CHAT_ID, username: 'anyuser' }, chat: { id: OWNER_CHAT_ID } };
  assert.equal(isOwner(fakeCtx), true);
});

test('findDuplicatePendingQuestion returns existing row for duplicate', async () => {
  await storage.upsertUser({ userId: 2001, chatId: 3001, username: 'dupuser', firstName: 'Dup', lastName: 'User' });
  await storage.recordQuestion({
    userChatId: 3001, userId: 2001, username: 'dupuser',
    firstName: 'Dup', lastName: 'User',
    questionText: 'ተባዕታይ ጥያቄ ምንድን ነው?', ownerMessageId: null, category: 'theology'
  });
  const row = await storage.findDuplicatePendingQuestion(2001, 'ተባዕታይ ጥያቄ ምንድን ነው?');
  assert.ok(row, 'should find the duplicate row');
  assert.equal(row.question_text, 'ተባዕታይ ጥያቄ ምንድን ነው?');
});

test('findDuplicatePendingQuestion returns null for non-duplicate', async () => {
  const row = await storage.findDuplicatePendingQuestion(2001, 'ፍጹም ያልተደጋገመ ጥያቄ');
  assert.equal(row, null);
});

test('getStats includes answered_tuesday', async () => {
  const stats = await storage.getStats();
  assert.ok('answered_tuesday' in stats, 'getStats should include answered_tuesday');
  assert.ok(typeof stats.answered_tuesday === 'number');
});

test('setUserCategory and getUserCategory roundtrip', async () => {
  await storage.upsertUser({ userId: 3001, chatId: 4001, username: 'catuser', firstName: 'Cat', lastName: 'User' });
  await storage.setUserCategory(4001, 'literature');
  const cat = await storage.getUserCategory(4001);
  assert.equal(cat, 'literature');
  await storage.setUserCategory(4001, 'theology');
  assert.equal(await storage.getUserCategory(4001), 'theology');
});

test('getUniqueUserChatIds returns from users table (registered but no question)', async () => {
  await storage.upsertUser({ userId: 9999, chatId: 8888, username: 'newuser', firstName: 'New', lastName: 'User' });
  const ids = await storage.getUniqueUserChatIds();
  assert.ok(ids.includes(8888), 'should include user who registered but never asked a question');
});

test('addAdmin inserts and getAdmins returns it', async () => {
  await storage.addRep({ username: 'admin1', role: 'theology', addedBy: 1 });
  const staff = await storage.getAllStaff();
  assert.ok(staff.some(a => a.username === 'admin1' && a.role === 'theology'));
});

test('removeAdmin removes correctly', async () => {
  await storage.addRep({ username: 'admin_to_remove', role: 'literature', addedBy: 1 });
  const changes = await storage.removeRep('admin_to_remove');
  assert.ok(changes >= 1);
  const staff = await storage.getAllStaff();
  assert.ok(!staff.some(a => a.username === 'admin_to_remove'));
});

test('getAdminsByRole returns correct role matches including both', async () => {
  await storage.addRep({ username: 'admin_both', role: 'both', addedBy: 1 });
  await storage.addRep({ username: 'admin_theo', role: 'theology', addedBy: 1 });
  const results = await storage.getAdminsByRole('theology');
  assert.ok(results.some(a => a.username === 'admin_both'));
  assert.ok(results.some(a => a.username === 'admin_theo'));
  const litResults = await storage.getAdminsByRole('literature');
  assert.ok(litResults.some(a => a.username === 'admin_both'));
  assert.ok(!litResults.some(a => a.username === 'admin_theo'));
});

test('getAdminChatIds returns only non-null chat_ids', async () => {
  await storage.addAdmin({ username: 'admin_linked', addedBy: 1 });
  await storage.updateAdminChatId('admin_linked', 55555);
  await storage.addAdmin({ username: 'admin_unlinked', addedBy: 1 });
  const ids = await storage.getAdminChatIds('literature');
  assert.ok(ids.includes(55555));
  assert.ok(typeof ids[0] === 'number');
});

test('updateAdminChatId sets chat_id on matching username', async () => {
  await storage.addAdmin({ username: 'admin_chatid', addedBy: 1 });
  await storage.updateAdminChatId('admin_chatid', 99999);
  const staff = await storage.getAllStaff();
  const row = staff.find(a => a.username === 'admin_chatid');
  assert.ok(row);
  assert.equal(Number(row.chat_id), 99999);
});

test('getPendingQuestionsByCategory filters correctly', async () => {
  await storage.recordQuestion({
    userChatId: 5001, userId: 6001, username: 'cattest', firstName: 'Cat', lastName: 'Test',
    questionText: 'ሥነ ጽሑፍ ጥያቄ ምሳሌ ነው?', ownerMessageId: null, category: 'literature'
  });
  await storage.recordQuestion({
    userChatId: 5002, userId: 6002, username: 'cattest2', firstName: 'Cat2', lastName: 'Test',
    questionText: 'ነገረ ሃይማኖት ጥያቄ ምሳሌ ነው?', ownerMessageId: null, category: 'theology'
  });
  const litPending = await storage.getPendingQuestionsByCategory('literature');
  assert.ok(litPending.every(q => q.category === 'literature'));
  assert.ok(litPending.some(q => q.question_text === 'ሥነ ጽሑፍ ጥያቄ ምሳሌ ነው?'));
  const theoPending = await storage.getPendingQuestionsByCategory('theology');
  assert.ok(theoPending.every(q => q.category === 'theology'));
});

test('addRep inserts with type=rep and getReps returns it', async () => {
  await storage.addRep({ username: 'rep1', role: 'theology', addedBy: 1 });
  const reps = await storage.getReps();
  assert.ok(reps.some(r => r.username === 'rep1' && r.role === 'theology' && r.type === 'rep'));
});

test('addAdmin (new signature, no role) inserts with type=admin and getAdmins returns it', async () => {
  await storage.addAdmin({ username: 'admin_new', addedBy: 1 });
  const admins = await storage.getAdmins();
  assert.ok(admins.some(a => a.username === 'admin_new' && a.type === 'admin'));
});

test('getRepChatIds returns only reps with non-null chat_id for role', async () => {
  await storage.addRep({ username: 'rep_linked', role: 'literature', addedBy: 1 });
  await storage.updateAdminChatId('rep_linked', 77777);
  await storage.addRep({ username: 'rep_unlinked', role: 'literature', addedBy: 1 });
  const ids = await storage.getRepChatIds('literature');
  assert.ok(ids.includes(77777));
  assert.ok(ids.every(id => typeof id === 'number'));
});

test('getAdminChatIds (no role) returns admin chat_ids', async () => {
  await storage.addAdmin({ username: 'admin_linked2', addedBy: 1 });
  await storage.updateAdminChatId('admin_linked2', 88888);
  const ids = await storage.getAdminChatIds();
  assert.ok(ids.includes(88888));
});

test('removeRep removes correctly', async () => {
  await storage.addRep({ username: 'rep_to_remove', role: 'theology', addedBy: 1 });
  const changes = await storage.removeRep('rep_to_remove');
  assert.equal(changes, 1);
  const reps = await storage.getReps();
  assert.ok(!reps.some(r => r.username === 'rep_to_remove'));
});

test('removeAdmin removes correctly (new type=admin)', async () => {
  await storage.addAdmin({ username: 'admin_remove2', addedBy: 1 });
  const changes = await storage.removeAdmin('admin_remove2');
  assert.ok(changes >= 1);
  const admins = await storage.getAdmins();
  assert.ok(!admins.some(a => a.username === 'admin_remove2'));
});
