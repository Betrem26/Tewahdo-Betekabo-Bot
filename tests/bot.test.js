'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Use a temp DB file so tests are isolated
const tmpDb = path.join(os.tmpdir(), `tewahdo-bot-test-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;

const storage = require('../src/storage');
const { isOwner, OWNER_USERNAME } = require('../src/config');

after(() => {
  storage.db.close();
  try { fs.unlinkSync(tmpDb); } catch (e) {}
  try { fs.unlinkSync(tmpDb + '-wal'); } catch (e) {}
  try { fs.unlinkSync(tmpDb + '-shm'); } catch (e) {}
});

test('upsertUser inserts and retrieves a user', () => {
  storage.upsertUser({ userId: 1001, chatId: 2001, username: 'testuser', firstName: 'Test', lastName: 'User' });
  const row = storage.db.prepare('SELECT * FROM users WHERE user_id = ?').get(1001);
  assert.equal(row.username, 'testuser');
  assert.equal(row.chat_id, 2001);
  assert.equal(row.first_name, 'Test');
});

test('upsertUser updates existing user', () => {
  storage.upsertUser({ userId: 1001, chatId: 2001, username: 'updated', firstName: 'Updated', lastName: 'User' });
  const row = storage.db.prepare('SELECT * FROM users WHERE user_id = ?').get(1001);
  assert.equal(row.username, 'updated');
});

test('recordQuestion inserts and returns question id', () => {
  const id = storage.recordQuestion({
    userChatId: 2001, userId: 1001, username: 'testuser',
    firstName: 'Test', lastName: 'User',
    questionText: 'ምን ማለት ነው?', ownerMessageId: null
  });
  assert.ok(typeof id === 'number' && id > 0);
});

test('updateOwnerMessageId sets owner_message_id', () => {
  const id = storage.recordQuestion({
    userChatId: 2002, userId: 1002, username: 'user2',
    firstName: 'Two', lastName: 'User',
    questionText: 'ሌላ ጥያቄ?', ownerMessageId: null
  });
  storage.updateOwnerMessageId({ questionId: id, ownerMessageId: 9999 });
  const row = storage.getQuestionByOwnerMessageId(9999);
  assert.ok(row);
  assert.equal(row.id, id);
  assert.equal(row.owner_message_id, 9999);
});

test('getQuestionByOwnerMessageId returns correct row', () => {
  const id = storage.recordQuestion({
    userChatId: 2003, userId: 1003, username: 'user3',
    firstName: 'Three', lastName: 'User',
    questionText: 'ሶስተኛ ጥያቄ?', ownerMessageId: 8888
  });
  const row = storage.getQuestionByOwnerMessageId(8888);
  assert.ok(row);
  assert.equal(row.question_text, 'ሶስተኛ ጥያቄ?');
});

test('updateQuestionStatus changes status and sets answered_at', () => {
  const id = storage.recordQuestion({
    userChatId: 2004, userId: 1004, username: 'user4',
    firstName: 'Four', lastName: 'User',
    questionText: 'አራተኛ ጥያቄ?', ownerMessageId: 7777
  });
  storage.updateQuestionStatus({ ownerMessageId: 7777, status: 'answered_bot' });
  const row = storage.getQuestionByOwnerMessageId(7777);
  assert.equal(row.status, 'answered_bot');
  assert.ok(row.answered_at);
});

test('getPendingQuestions returns only pending rows', () => {
  const id = storage.recordQuestion({
    userChatId: 2005, userId: 1005, username: 'user5',
    firstName: 'Five', lastName: 'User',
    questionText: 'አምስተኛ ጥያቄ?', ownerMessageId: null
  });
  const pending = storage.getPendingQuestions();
  assert.ok(pending.every(q => q.status === 'pending'));
  assert.ok(pending.some(q => q.id === id));
});

test('getStats returns correct counts', () => {
  const stats = storage.getStats();
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

test('findDuplicatePendingQuestion returns existing row for duplicate', () => {
  storage.upsertUser({ userId: 2001, chatId: 3001, username: 'dupuser', firstName: 'Dup', lastName: 'User' });
  storage.recordQuestion({
    userChatId: 3001, userId: 2001, username: 'dupuser',
    firstName: 'Dup', lastName: 'User',
    questionText: 'ተባዕታይ ጥያቄ ምንድን ነው?', ownerMessageId: null, category: 'theology'
  });
  const row = storage.findDuplicatePendingQuestion(2001, 'ተባዕታይ ጥያቄ ምንድን ነው?');
  assert.ok(row, 'should find the duplicate row');
  assert.equal(row.question_text, 'ተባዕታይ ጥያቄ ምንድን ነው?');
});

test('findDuplicatePendingQuestion returns null for non-duplicate', () => {
  const row = storage.findDuplicatePendingQuestion(2001, 'ፍጹም ያልተደጋገመ ጥያቄ');
  assert.equal(row, null);
});

test('getStats includes answered_tuesday', () => {
  const stats = storage.getStats();
  assert.ok('answered_tuesday' in stats, 'getStats should include answered_tuesday');
  assert.ok(typeof stats.answered_tuesday === 'number');
});

test('setUserCategory and getUserCategory roundtrip', () => {
  storage.upsertUser({ userId: 3001, chatId: 4001, username: 'catuser', firstName: 'Cat', lastName: 'User' });
  storage.setUserCategory(4001, 'literature');
  const cat = storage.getUserCategory(4001);
  assert.equal(cat, 'literature');
  storage.setUserCategory(4001, 'theology');
  assert.equal(storage.getUserCategory(4001), 'theology');
});

test('getUniqueUserChatIds returns from users table (registered but no question)', () => {
  storage.upsertUser({ userId: 9999, chatId: 8888, username: 'newuser', firstName: 'New', lastName: 'User' });
  const ids = storage.getUniqueUserChatIds();
  assert.ok(ids.includes(8888), 'should include user who registered but never asked a question');
});

test('addAdmin inserts and getAdmins returns it', () => {
  storage.addAdmin({ username: 'admin1', role: 'theology', addedBy: 1 });
  // addAdmin with role provided uses old behavior → type='rep'; check via getAllStaff
  const staff = storage.getAllStaff();
  assert.ok(staff.some(a => a.username === 'admin1' && a.role === 'theology'));
});

test('removeAdmin removes correctly', () => {
  storage.addAdmin({ username: 'admin_to_remove', role: 'literature', addedBy: 1 });
  const changes = storage.removeAdmin('admin_to_remove');
  assert.ok(changes >= 1);
  const staff = storage.getAllStaff();
  assert.ok(!staff.some(a => a.username === 'admin_to_remove'));
});

test('getAdminsByRole returns correct role matches including both', () => {
  storage.addAdmin({ username: 'admin_both', role: 'both', addedBy: 1 });
  storage.addAdmin({ username: 'admin_theo', role: 'theology', addedBy: 1 });
  const results = storage.getAdminsByRole('theology');
  assert.ok(results.some(a => a.username === 'admin_both'));
  assert.ok(results.some(a => a.username === 'admin_theo'));
  const litResults = storage.getAdminsByRole('literature');
  assert.ok(litResults.some(a => a.username === 'admin_both'));
  assert.ok(!litResults.some(a => a.username === 'admin_theo'));
});

test('getAdminChatIds returns only non-null chat_ids', () => {
  storage.addAdmin({ username: 'admin_linked', role: 'literature', addedBy: 1 });
  storage.updateAdminChatId('admin_linked', 55555);
  storage.addAdmin({ username: 'admin_unlinked', role: 'literature', addedBy: 1 });
  const ids = storage.getAdminChatIds('literature');
  assert.ok(ids.includes(55555));
  assert.ok(typeof ids[0] === 'number');
});

test('updateAdminChatId sets chat_id on matching username', () => {
  storage.addAdmin({ username: 'admin_chatid', role: 'both', addedBy: 1 });
  storage.updateAdminChatId('admin_chatid', 99999);
  // addAdmin with role='both' → type='rep'; use getAllStaff to find the row
  const staff = storage.getAllStaff();
  const row = staff.find(a => a.username === 'admin_chatid');
  assert.ok(row);
  assert.equal(row.chat_id, 99999);
});

test('getPendingQuestionsByCategory filters correctly', () => {
  storage.recordQuestion({
    userChatId: 5001, userId: 6001, username: 'cattest', firstName: 'Cat', lastName: 'Test',
    questionText: 'ሥነ ጽሑፍ ጥያቄ ምሳሌ ነው?', ownerMessageId: null, category: 'literature'
  });
  storage.recordQuestion({
    userChatId: 5002, userId: 6002, username: 'cattest2', firstName: 'Cat2', lastName: 'Test',
    questionText: 'ነገረ ሃይማኖት ጥያቄ ምሳሌ ነው?', ownerMessageId: null, category: 'theology'
  });
  const litPending = storage.getPendingQuestionsByCategory('literature');
  assert.ok(litPending.every(q => q.category === 'literature'));
  assert.ok(litPending.some(q => q.question_text === 'ሥነ ጽሑፍ ጥያቄ ምሳሌ ነው?'));
  const theoPending = storage.getPendingQuestionsByCategory('theology');
  assert.ok(theoPending.every(q => q.category === 'theology'));
});

test('addRep inserts with type=rep and getReps returns it', () => {
  storage.addRep({ username: 'rep1', role: 'theology', addedBy: 1 });
  const reps = storage.getReps();
  assert.ok(reps.some(r => r.username === 'rep1' && r.role === 'theology' && r.type === 'rep'));
});

test('addAdmin (new signature, no role) inserts with type=admin and getAdmins returns it', () => {
  storage.addAdmin({ username: 'admin_new', addedBy: 1 });
  const admins = storage.getAdmins();
  assert.ok(admins.some(a => a.username === 'admin_new' && a.type === 'admin'));
});

test('getRepChatIds returns only reps with non-null chat_id for role', () => {
  storage.addRep({ username: 'rep_linked', role: 'literature', addedBy: 1 });
  storage.updateAdminChatId('rep_linked', 77777);
  storage.addRep({ username: 'rep_unlinked', role: 'literature', addedBy: 1 });
  const ids = storage.getRepChatIds('literature');
  assert.ok(ids.includes(77777));
  assert.ok(ids.every(id => typeof id === 'number'));
});

test('getAdminChatIds (no role) returns admin chat_ids', () => {
  storage.addAdmin({ username: 'admin_linked2', addedBy: 1 });
  storage.updateAdminChatId('admin_linked2', 88888);
  const ids = storage.getAdminChatIds();
  assert.ok(ids.includes(88888));
});

test('removeRep removes correctly', () => {
  storage.addRep({ username: 'rep_to_remove', role: 'theology', addedBy: 1 });
  const changes = storage.removeRep('rep_to_remove');
  assert.equal(changes, 1);
  const reps = storage.getReps();
  assert.ok(!reps.some(r => r.username === 'rep_to_remove'));
});

test('removeAdmin removes correctly (new type=admin)', () => {
  storage.addAdmin({ username: 'admin_remove2', addedBy: 1 });
  const changes = storage.removeAdmin('admin_remove2');
  assert.ok(changes >= 1);
  const admins = storage.getAdmins();
  assert.ok(!admins.some(a => a.username === 'admin_remove2'));
});
