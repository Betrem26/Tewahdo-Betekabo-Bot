'use strict';
require('dotenv').config();

const { Telegraf, Markup } = require('telegraf');
const storage = require('./storage');
const { isOwner, OWNER_USERNAME, OWNER_CHAT_ID, isAdminForRole, isAdminUser, isRepForRole } = require('./config');

// ── Startup guard ────────────────────────────────────────────────────────────
if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is missing in .env');

const bot = new Telegraf(process.env.BOT_TOKEN);

// ── In-memory state ──────────────────────────────────────────────────────────
const ownerReplyState = new Map(); // Map<chatId, { questionId }>
const userCategory    = new Map(); // Map<chatId, 'theology'|'literature'>
const rateLimitMap    = new Map(); // Map<`${chatId}_${category}`, timestamp>
const addRepState     = new Map(); // Map<chatId, { step, role? }>
const addAdminState   = new Map(); // Map<chatId, { step }>

// ── Keyboards ────────────────────────────────────────────────────────────────
const KB_CATEGORY   = Markup.keyboard([['📖 ለነገረ ሃይማኖት', '📚 ለትምሕርታዊ ስነጽሑፍ']]).resize();
const KB_THEOLOGY   = Markup.keyboard([['✍️ ጥያቄ ላክ', '🔙 ወደ ምድብ ምረጫ']]).resize();
const KB_LITERATURE = Markup.keyboard([['✍️ ጥያቄ ላክ', '🔙 ወደ ምድብ ምረጫ']]).resize();
const KB_OWNER      = Markup.keyboard([
  ['/pending',   '/stats'],
  ['/reps',      '/admins'],
  ['/addrep',    '/addadmin'],
  ['/broadcast', '/export'],
  ['/cancel'],
]).resize();

// ── Static messages ──────────────────────────────────────────────────────────
const MSG_CATEGORY_PICK =
  'እንኳን ወደ ተዋሕዶ በተዓቅቦ የቴሌግራም ቦት በደህና መጡ 🙏\n\n' +
  'በዚህ ቦት የሚያገኙት አገልግሎት፡\n\n' +
  '📖 ለነገረ ሃይማኖት ጥያቄዎች\n' +
  '   • የሚጠይቁት ጥያቄ ምላሽ የሚሰጠው በግቢ ጉባኤው በሚዘጋጅ ልዩ\n' +
  '     መርሐ ግብር ወይም ዘወትር እሑድ 4፡00 በሚካሄደው\n' +
  '     የተዋሕዶ በተዓቅቦ መርሐ ግብር ወይም መልሱ ለጠያቂው ብቻ\n' +
  '     ካስፈለገ በቀጥታ በዚህ ቦት በኩል ምላሽ የሚሰጥ ይሆናል ።\n\n' +
  '📚 ለትምሕርታዊ ስነ ጽሑፍ ጥያቄዎች\n' +
  '   • ምላሽ የሚሰጠው ዘወትር ማክሰኞ 11 ሰዓት በሚካሄደው\n' +
  '     የትምህርት ክፍል ትምህርታዊ ስነ ጽሑፍ መርሐ ግብር ላይ ይሆናል። ስለዚህ ጥያቄ ከጠየቁ ምላሽ እንዲያገኙ እነዚህን መርሐ ግብራት መከታተል አይዘንጉ 🙏\n\n' +
  '━━━━━━━━━━━━━━━━━━━━\n' +
  '👇 የጥያቄዎን ምድብ ይምረጡ፡';

const MSG_THEOLOGY_WELCOME =
  '📖 ለነገረ ሃይማኖት ጥያቄ ምድብ ተቀበሉ!\n\n' +
  '📢 ምላሹ የሚሰጠው፡\n' +
  '  • በግቢ ጉባኤው በሚዘጋጅ ልዩ መርሐ ግብር ወይም\n' +
  '  • ዘወትር እሑድ 4፡00 በሚካሄደው\n' +
  '    የተዋሕዶ በተዓቅቦ መርሐ ግብር ወይም\n' +
  '  • መልሱ ለጠያቂው ብቻ ካስፈለገ\n' +
  '    በቀጥታ በዚህ ቦት በኩል ምላሽ ይሰጣል።\n\n' +
  '✍️ የነገረ ሃይማኖት ጥያቄዎን ከዚህ በታች ይጻፉ።';

const MSG_LITERATURE_WELCOME =
  '📚 ለትምሕርታዊ ስነጽሑፍ ጥያቄ ምድብ ተቀበሉ!\n\n' +
  '📅 ምላሹ የሚሰጠው፡\n' +
  '  ✦ ምላሽ የሚሰጠው ዘወትር ማክሰኞ 11 ሰዓት በሚካሄደው\n' +
  '    የትምህርት ክፍል ትምህርታዊ ስነ ጽሑፍ መርሐ ግብር ላይ ይሆናል።\n\n' +
  '✍️ የስነጽሑፍ ጥያቄዎን ከዚህ በታች ይጻፉ።';

const MSG_OWNER_WELCOME =
  '👑 እንኳን ወደ ተዋሕዶ በተዓቅቦ አስተዳዳሪ ፓናል በደህና መጡ !\n\n' +
  'ያሉት ትዕዛዞች፡\n' +
  '  /pending      — ያልተመለሱ ጥያቄዎች\n' +
  '  /stats        — ስታቲስቲክስ\n' +
  '  /reps         — ተወካዮች ዝርዝር\n' +
  '  /admins       — አስተዳዳሪዎች ዝርዝር\n' +
  '  /addrep       — አዲስ ተወካይ ጨምር\n' +
  '  /addadmin     — አዲስ አስተዳዳሪ ጨምር\n' +
  '  /removerep    — ተወካይ አስወግድ\n' +
  '  /removeadmin  — አስተዳዳሪ አስወግድ\n' +
  '  /broadcast    — ለሁሉም ተጠቃሚዎች መልዕክት ላክ\n' +
  '  /export       — ሁሉም ጥያቄዎች ፋይል ወደ ሰድ\n' +
  '  /cancel       — እየተጻፈ ያለ መልስ ሰርዝ';

// ── Utility ──────────────────────────────────────────────────────────────────
async function resolveOwnerChatId() {
  if (OWNER_CHAT_ID) return OWNER_CHAT_ID;
  if (OWNER_USERNAME) {
    const result = await storage.db.execute({
      sql: 'SELECT chat_id FROM users WHERE lower(username) = ? LIMIT 1',
      args: [OWNER_USERNAME],
    });
    if (result.rows.length > 0) return Number(result.rows[0].chat_id);
  }
  return null;
}

// ── /start ────────────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  await storage.upsertUser({
    userId: ctx.from.id, chatId: ctx.chat.id,
    username: ctx.from.username, firstName: ctx.from.first_name, lastName: ctx.from.last_name,
  });

  // If this user is a rep or admin, refresh their command list immediately
  const allStaff = await storage.getAllStaff();
  const normalised = (ctx.from.username || '').replace(/^@/, '').toLowerCase();
  const staffRow = allStaff.find(s => s.username === normalised || s.chat_id === ctx.from.id);
  if (staffRow) {
    registerBotCommands().catch(console.error);
  }

  if (isOwner(ctx)) return ctx.reply(MSG_OWNER_WELCOME, KB_OWNER);

  // Rep/admin welcome
  if (staffRow) {
    if (staffRow.type === 'admin') {
      return ctx.reply(MSG_OWNER_WELCOME, KB_OWNER);
    }
    const repWelcome = staffRow.role === 'literature'
      ? '✝️ እንኳን ወደ ተዋሕዶ በተዓቅቦ በደህና መጡ!\n\n' +
        'እርስዎ በዚህ ቦት ላይ የትምህርት ክፍል ትምሕርታዊ ስነ ጽሑፍ ተወካይ ሆነው ተሹመዋል።\n\n' +
        'በመሆኑም በትምህርታዊ ስነ ጽሑፍ በኩል የሚመጡ ጥያቄዎች ለእርስዎ የሚደርሱ ስለሆነ በተገቢው ሁኔታ ተማሪዎችን እንዲያስተናግዱ ስንል እናሳስባለን።\n\n' +
        'ያሉት ትዕዛዞች፡\n' +
        '  /pending      — ያልተመለሱ ጥያቄዎች\n' +
        '  /broadcast    — ለትምሕርታዊ ስነጽሑፍ ተጠቃሚዎች መልዕክት ላክ\n' +
        '  /cancel       — መልስ መጻፍ ሰርዝ'
      : '✝️ እንኳን ወደ ተዋሕዶ በተዓቅቦ በደህና መጡ!\n\n' +
        'እርስዎ የነገረ ሃይማኖት ተወካይ ሆነው ተሹመዋል።\n\n' +
        'ያሉት ትዕዛዞች፡\n' +
        '  /pending      — ያልተመለሱ ጥያቄዎች\n' +
        '  /broadcast    — ለነገረ ሃይማኖት ተጠቃሚዎች መልዕክት ላክ\n' +
        '  /cancel       — መልስ መጻፍ ሰርዝ';
    return ctx.reply(repWelcome,
      Markup.keyboard([['/pending', '/broadcast'], ['/cancel']]).resize()
    );
  }

  userCategory.delete(ctx.chat.id);
  return ctx.reply(MSG_CATEGORY_PICK, KB_CATEGORY);
});

// ── /pending ──────────────────────────────────────────────────────────────────
bot.command('pending', async (ctx) => {
  if (!isOwner(ctx) && !await isRepForRole(ctx, 'theology', storage.db) && !await isRepForRole(ctx, 'literature', storage.db)) {
    return ctx.reply('⛔ ፈቃድ የለዎትም።');
  }

  let rows;
  if (isOwner(ctx) || await isAdminUser(ctx, storage.db)) {
    rows = await storage.getPendingQuestions();
  } else {
    // Rep: determine their role
    const username = (ctx.from.username || '').replace(/^@/, '').toLowerCase();
    const repRows = await storage.getReps();
    const repRow = repRows.find(a => a.username === username || a.chat_id === ctx.from.id);
    const repRole = repRow ? repRow.role : null;
    if (repRole === 'both' || !repRole) {
      rows = await storage.getPendingQuestions();
    } else {
      rows = await storage.getPendingQuestionsByCategory(repRole);
    }
  }

  if (!rows.length) return ctx.reply('📭 በወቅቱ ምንም ያልተመለሰ ጥያቄ የለም።');
  await ctx.reply(`📋 ያልተመለሱ ጥያቄዎች: ${rows.length}`);
  for (const q of rows) {
    const user    = q.username ? `@${q.username}` : (q.first_name || `ID:${q.user_id}`);
    const catIcon = q.category === 'literature' ? '📚' : '📖';
    const msgText = `${catIcon} [#${q.id}] ${user}\n📅 ${q.created_at}\n💬 ${q.question_text}`;
    const buttons = q.category === 'literature'
      ? [[
          Markup.button.callback('✅ በቦት መልስ',      `reply_bot_${q.id}`),
          Markup.button.callback('🗓️ ማክሰኞ ይመለሳል', `answered_tuesday_${q.id}`),
        ]]
      : [[
          Markup.button.callback('✅ በቦት መልስ',     `reply_bot_${q.id}`),
          Markup.button.callback('📢 በጉባኤ ይመለሳል', `answered_assembly_${q.id}`),
          Markup.button.callback('🗓️ እሑድ ይመለሳል',  `answered_sunday_${q.id}`),
        ]];
    await ctx.reply(msgText, Markup.inlineKeyboard(buttons));
  }
});

// ── /stats ────────────────────────────────────────────────────────────────────
bot.command('stats', async (ctx) => {
  if (!isOwner(ctx) && !await isAdminUser(ctx, storage.db)) return ctx.reply('⛔ ፈቃድ የለዎትም።');

  const s = await storage.getStats();
  return ctx.reply(
    '📊 አጠቃላይ ስታቲስቲክስ\n\n' +
    `📨 ጠቅላላ ጥያቄዎች:   ${s.total}\n` +
    `⏳ ያልተመለሱ:        ${s.pending}\n` +
    `✅ በቦት የተመለሱ:     ${s.answered_bot}\n` +
    `📢 በጉባኤ የተመለሱ:   ${s.answered_assembly}\n` +
    `🗓️ እሑድ የተመለሱ:    ${s.answered_sunday}\n` +
    `🗓️ ማክሰኞ የተመለሱ:   ${s.answered_tuesday}`
  );
});

// ── /broadcast ────────────────────────────────────────────────────────────────
bot.command('broadcast', async (ctx) => {
  const isAdmin = isOwner(ctx) || await isAdminUser(ctx, storage.db);
  const normalised = (ctx.from.username || '').replace(/^@/, '').toLowerCase();
  const repRow = (await storage.getReps()).find(r => r.username === normalised || r.chat_id === ctx.from.id);

  if (!isAdmin && !repRow) return ctx.reply('⛔ ፈቃድ የለዎትም።');

  const body = (ctx.message.text || '').replace(/^\/broadcast\s*/, '').trim();

  // Rep broadcast — scoped to their category's users
  if (!isAdmin && repRow) {
    if (!body) return ctx.reply('⚠️ አጠቃቀም: /broadcast <መልዕክት>\nምሳሌ: /broadcast ዛሬ ትምህርት አለ!');
    const chatIds = await storage.getUserChatIdsByCategory(repRow.role);
    if (!chatIds.length) return ctx.reply('📭 ምንም ተጠቃሚ የለም።');
    const catLabel = repRow.role === 'theology' ? 'ነገረ ሃይማኖት' : 'ትምሕርታዊ ስነጽሑፍ';
    const msgText = `📢 ከተዋሕዶ በተዓቅቦ ${catLabel} ክፍል ማስታወቂያ፡\n\n${body}`;
    let sent = 0, failed = 0;
    for (const chatId of chatIds) {
      try { await ctx.telegram.sendMessage(chatId, msgText); sent++; }
      catch (_) { failed++; }
    }
    return ctx.reply(`✅ ማስታወቂያ ተልኳል።\n✔ ደርሷቸዋል: ${sent}\n✘ አልደረሰም: ${failed}`);
  }

  // Owner/admin broadcast — all users
  if (!body) return ctx.reply('⚠️ አጠቃቀም: /broadcast <መልዕክት>\nምሳሌ: /broadcast ዛሬ ጉባኤ አለ!');
  const chatIds = await storage.getUniqueUserChatIds();
  if (!chatIds.length) return ctx.reply('📭 ምንም ተጠቃሚ የለም።');
  const msgText = `📢 ከተዋሕዶ በተዓቅቦ ተጠሪ ማስታወቂያ፡\n\n${body}`;
  let sent = 0, failed = 0;
  for (const chatId of chatIds) {
    try { await ctx.telegram.sendMessage(chatId, msgText); sent++; }
    catch (_) { failed++; }
  }
  return ctx.reply(`✅ ማስታወቂያ ተልኳል።\n✔ ደርሷቸዋል: ${sent}\n✘ አልደረሰም: ${failed}`);
});

// ── /cancel ───────────────────────────────────────────────────────────────────
bot.command('cancel', async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply('⛔ ፈቃድ የለዎትም።');
  if (addRepState.has(ctx.chat.id)) {
    addRepState.delete(ctx.chat.id);
    return ctx.reply('❌ ተሰርዟል።');
  }
  if (addAdminState.has(ctx.chat.id)) {
    addAdminState.delete(ctx.chat.id);
    return ctx.reply('❌ ተሰርዟል።');
  }
  if (ownerReplyState.has(ctx.chat.id)) {
    ownerReplyState.delete(ctx.chat.id);
    return ctx.reply('❌ መልስ መጻፍ ተሰርዟል።');
  }
  return ctx.reply('ℹ️ አሁን የሚሰረዝ ምንም የለም።');
});

// ── /reply <id> ───────────────────────────────────────────────────────────────
bot.command('reply', async (ctx) => {
  const arg = ctx.message.text.replace(/^\/reply\s*/, '').trim();
  const questionId = Number(arg);
  if (!arg || isNaN(questionId)) return ctx.reply('⚠️ አጠቃቀም: /reply <id>  ምሳሌ: /reply 5');
  const question = await storage.getQuestionById(questionId);
  if (!question) return ctx.reply(`⚠️ ጥያቄ #${questionId} አልተገኘም።`);
  if (!isOwner(ctx) && !await isAdminUser(ctx, storage.db) && !await isRepForRole(ctx, question.category, storage.db)) {
    return ctx.reply('⛔ ፈቃድ የለዎትም።');
  }
  if (question.status !== 'pending') return ctx.reply(`ℹ️ ጥያቄ #${questionId} አስቀድሞ ተመልሷል።`);
  ownerReplyState.set(ctx.chat.id, { questionId });
  return ctx.reply('✍️ ለጥያቄ #' + questionId + ' መልስዎን ይጻፉ። ለመሰረዝ /cancel ይጠቀሙ።');
});

// ── /export ───────────────────────────────────────────────────────────────────
bot.command('export', async (ctx) => {
  if (!isOwner(ctx) && !await isAdminUser(ctx, storage.db)) return ctx.reply('⛔ ፈቃድ የለዎትም።');
  const all = await storage.getAllQuestions();
  if (!all.length) return ctx.reply('📭 ምንም ጥያቄ የለም።');
  const lines = all.map(q => [
    q.id,
    q.category,
    q.status,
    q.username || '',
    (q.question_text || '').replace(/\n/g, ' '),
    q.created_at,
  ].join(' | '));
  const content = lines.join('\n');
  const d = new Date();
  const fname = 'questions-' + d.toISOString().slice(0, 10) + '.txt';
  await ctx.replyWithDocument({ source: Buffer.from(content, 'utf8'), filename: fname });
});

// ── /addadmin ─────────────────────────────────────────────────────────────────
bot.command('addadmin', async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply('⛔ ፈቃድ የለዎትም።');
  addAdminState.set(ctx.chat.id, { step: 'enter_username' });
  return ctx.reply(
    '👑 አዲስ አስተዳዳሪ ጨምር\nየአስተዳዳሪውን Telegram username ይጻፉ።\n(ምሳሌ: @username)',
    Markup.inlineKeyboard([[Markup.button.callback('❌ ሰርዝ', 'addadmin_cancel')]])
  );
});

bot.action('addadmin_cancel', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  addAdminState.delete(ctx.chat.id);
  try { await ctx.editMessageText('❌ ተሰርዟል።'); } catch (_) {}
});

// ── /addrep ───────────────────────────────────────────────────────────────────
bot.command('addrep', async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply('⛔ ፈቃድ የለዎትም።');
  addRepState.set(ctx.chat.id, { step: 'choose_category' });
  return ctx.reply(
    '👥 አዲስ ተወካይ ጨምር\nየትኛውን ምድብ ተወካይ ነው?',
    Markup.inlineKeyboard([
      [
        Markup.button.callback('📖 ነገረ ሃይማኖት', 'addrep_cat_theology'),
        Markup.button.callback('📚 ትምሕርታዊ ስነጽሑፍ', 'addrep_cat_literature'),
        Markup.button.callback('❌ ሰርዝ', 'addrep_cancel'),
      ]
    ])
  );
});

bot.action('addrep_cancel', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  addRepState.delete(ctx.chat.id);
  try { await ctx.editMessageText('❌ ተሰርዟል።'); } catch (_) {}
});

bot.action(/^addrep_cat_(theology|literature)$/, async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  if (!isOwner(ctx)) return;
  const role = ctx.match[1];
  addRepState.set(ctx.chat.id, { step: 'enter_username', role });
  const catLabel = role === 'theology' ? '📖 ነገረ ሃይማኖት' : '📚 ትምሕርታዊ ስነጽሑፍ';
  try {
    await ctx.editMessageText(
      `${catLabel} ተወካይ\n\nየተወካዩን Telegram username ይጻፉ።\n(ምሳሌ: @username)`
    );
  } catch (_) {}
});

// ── /removerep ────────────────────────────────────────────────────────────────
bot.command('removerep', async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply('⛔ ፈቃድ የለዎትም።');
  const arg = (ctx.message.text || '').replace(/^\/removerep\s*/, '').trim();
  const username = arg.replace(/^@/, '').toLowerCase();
  if (!username) return ctx.reply('⚠️ አጠቃቀም: /removerep @username');
  const changes = await storage.removeRep(username);
  if (changes === 0) return ctx.reply(`⚠️ @${username} በተወካዮች ዝርዝር ውስጥ አልተገኘም።`);
  return ctx.reply(`✅ @${username} ከተወካዮች ተወግደዋል።`);
});

// ── /removeadmin ──────────────────────────────────────────────────────────────
bot.command('removeadmin', async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply('⛔ ፈቃድ የለዎትም።');
  const arg = (ctx.message.text || '').replace(/^\/removeadmin\s*/, '').trim();
  const username = arg.replace(/^@/, '').toLowerCase();
  if (!username) return ctx.reply('⚠️ አጠቃቀም: /removeadmin @username');
  const changes = await storage.removeAdmin(username);
  if (changes === 0) return ctx.reply(`⚠️ @${username} በአስተዳዳሪዎች ዝርዝር ውስጥ አልተገኘም።`);
  return ctx.reply(`✅ @${username} ከአስተዳዳሪዎች ተወግደዋል።`);
});

// ── /reps ─────────────────────────────────────────────────────────────────────
bot.command('reps', async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply('⛔ ፈቃድ የለዎትም።');
  const reps = await storage.getReps();
  if (!reps.length) return ctx.reply('👥 ምንም ተወካይ አልተመደበም።');
  const theoReps = reps.filter(r => r.role === 'theology' || r.role === 'both');
  const litReps  = reps.filter(r => r.role === 'literature' || r.role === 'both');
  let msg = `👥 ተወካዮች ዝርዝር፡ ${reps.length}\n`;
  if (theoReps.length) {
    msg += '\n📖 ነገረ ሃይማኖት:\n';
    theoReps.forEach((r, i) => {
      const linked = r.chat_id ? '✅' : '⏳ (ቦቱን ገና አልጀመሩም)';
      msg += `  ${i + 1}. @${r.username} ${linked}\n`;
    });
  }
  if (litReps.length) {
    msg += '\n📚 ትምሕርታዊ ስነጽሑፍ:\n';
    litReps.forEach((r, i) => {
      const linked = r.chat_id ? '✅' : '⏳ (ቦቱን ገና አልጀመሩም)';
      msg += `  ${i + 1}. @${r.username} ${linked}\n`;
    });
  }
  return ctx.reply(msg.trim());
});

// ── /admins ───────────────────────────────────────────────────────────────────
bot.command('admins', async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply('⛔ ፈቃድ የለዎትም።');
  const admins = await storage.getAdmins();
  if (!admins.length) return ctx.reply('👑 ምንም አስተዳዳሪ አልተመደበም።');
  let msg = `👑 አስተዳዳሪዎች ዝርዝር፡ ${admins.length}\n\n`;
  admins.forEach((a, i) => {
    const linked = a.chat_id ? '✅' : '⏳ (ቦቱን ገና አልጀመሩም)';
    msg += `${i + 1}. @${a.username} ${linked}\n`;
  });
  return ctx.reply(msg.trim());
});

// ── /help ─────────────────────────────────────────────────────────────────────
bot.help(async (ctx) => {
  if (isOwner(ctx)) {
    return ctx.reply(
      MSG_OWNER_WELCOME +
      '\n  /reply <id>  — ለተወሰነ ጥያቄ መልስ ላክ\n  /help        — ይህን ዝርዝር አሳይ',
      KB_OWNER
    );
  }
  return ctx.reply(MSG_CATEGORY_PICK + '\nℹ️ ምድብ ምረጡ፣ ከዚያ ጥያቄዎን ይጻፉ።', KB_CATEGORY);
});

// ── Text handler ──────────────────────────────────────────────────────────────
bot.on('text', async (ctx) => {
  const text = (ctx.message.text || '').trim();
  if (!text || text.startsWith('/')) return;

  // Owner/admin in reply-state
  if (isOwner(ctx) && ownerReplyState.has(ctx.chat.id)) {
    const { questionId } = ownerReplyState.get(ctx.chat.id);
    const question = await storage.getQuestionById(questionId);
    if (!question) {
      ownerReplyState.delete(ctx.chat.id);
      return ctx.reply('⚠️ ጥያቄው አልተገኘም።');
    }
    try {
      await ctx.telegram.sendMessage(question.user_chat_id, '📩 ከተዋሕዶ በተዓቅቦ ተጠሪ የተላከ መልስ፡\n\n' + text);
      await storage.updateQuestionStatusById({ questionId: question.id, status: 'answered_bot' });
      ownerReplyState.delete(ctx.chat.id);
      return ctx.reply('✅ መልስዎ ለተጠቃሚው ተልኳል።');
    } catch (e) {
      console.error('Failed to send reply:', e.message);
      return ctx.reply('⚠️ መልሱን መላክ አልተቻለም።');
    }
  }

  // Handle addAdminState
  if (isOwner(ctx) && addAdminState.has(ctx.chat.id)) {
    const state = addAdminState.get(ctx.chat.id);
    if (state.step === 'enter_username') {
      const username = text.replace(/^@/, '').trim().toLowerCase();
      if (!username) return ctx.reply('⚠️ ትክክለኛ username ያስፈልጋል።');
      await storage.addAdmin({ username, addedBy: ctx.from.id });
      addAdminState.delete(ctx.chat.id);
      return ctx.reply(`✅ @${username} አስተዳዳሪ ሆነው ተመድበዋል።\nቦቱን ሲጀምሩ ሙሉ መዳረሻ ይኖራቸዋል።`);
    }
  }

  // Handle addRepState
  if (isOwner(ctx) && addRepState.has(ctx.chat.id)) {
    const state = addRepState.get(ctx.chat.id);
    if (state.step === 'enter_username') {
      const username = text.replace(/^@/, '').trim().toLowerCase();
      if (!username) return ctx.reply('⚠️ ትክክለኛ username ያስፈልጋል።');
      const catLabel = state.role === 'theology' ? 'ነገረ ሃይማኖት' : 'ትምሕርታዊ ስነጽሑፍ';
      await storage.addRep({ username, role: state.role, addedBy: ctx.from.id });
      addRepState.delete(ctx.chat.id);
      return ctx.reply(`✅ @${username} የ${catLabel} ተወካይ ሆነው ተመድበዋል።\nቦቱን ሲጀምሩ ጥያቄዎች ይደርሳቸዋል።`);
    }
  }

  // Owner free text — ignore
  if (isOwner(ctx)) return;

  // User navigation
  if (text === '🔙 ወደ ምድብ ምረጫ') {
    userCategory.delete(ctx.chat.id);
    return ctx.reply(MSG_CATEGORY_PICK, KB_CATEGORY);
  }
  if (text === '📖 ለነገረ ሃይማኖት') {
    userCategory.set(ctx.chat.id, 'theology');
    await storage.setUserCategory(ctx.chat.id, 'theology');
    return ctx.reply(MSG_THEOLOGY_WELCOME, KB_THEOLOGY);
  }
  if (text === '📚 ለትምሕርታዊ ስነጽሑፍ') {
    userCategory.set(ctx.chat.id, 'literature');
    await storage.setUserCategory(ctx.chat.id, 'literature');
    return ctx.reply(MSG_LITERATURE_WELCOME, KB_LITERATURE);
  }
  if (text === '✍️ ጥያቄ ላክ') {
    const cat = userCategory.get(ctx.chat.id);
    if (cat === 'theology')   return ctx.reply(MSG_THEOLOGY_WELCOME,   KB_THEOLOGY);
    if (cat === 'literature') return ctx.reply(MSG_LITERATURE_WELCOME, KB_LITERATURE);
    return ctx.reply(MSG_CATEGORY_PICK, KB_CATEGORY);
  }

  // User question — resolve category (memory first, then DB)
  let cat = userCategory.get(ctx.chat.id);
  if (!cat) {
    const dbCat = await storage.getUserCategory(ctx.chat.id);
    if (dbCat) {
      cat = dbCat;
      userCategory.set(ctx.chat.id, cat);
    }
  }
  if (!cat) return ctx.reply(MSG_CATEGORY_PICK, KB_CATEGORY);

  // Feature #8: question length validation
  if (text.length < 10) return ctx.reply('⚠️ ጥያቄዎ በጣም አጭር ነው። ቢያንስ 10 ፊደላት ያስፈልጋል።');
  if (text.length > 1000) return ctx.reply('⚠️ ጥያቄዎ በጣም ረጅም ነው። እስከ 1000 ፊደላት ብቻ ይፈቀዳል።');

  // Feature #7: duplicate question guard
  const dup = await storage.findDuplicatePendingQuestion(ctx.from.id, text);
  if (dup) return ctx.reply('⚠️ ይህን ጥያቄ አስቀድመው ልከዋል። ምላሹን እባክዎ ይጠብቁ።');

  // Feature #1: rate limiting
  const rlKey = `${ctx.chat.id}_${cat}`;
  const lastSent = rateLimitMap.get(rlKey);
  if (lastSent && Date.now() - lastSent < 2 * 60 * 1000) {
    return ctx.reply('⏳ እባክዎ ጥቂት ቆይተው እንደገና ይሞክሩ። በ2 ደቂቃ ውስጥ አንድ ጥያቄ ብቻ መላክ ይቻላል።');
  }

  const ownerChatId = await resolveOwnerChatId();
  if (!ownerChatId) return ctx.reply('⚠️ ጥያቄዎ አልተላከም። ባለቤቱ ቦቱን ገና አልጀመሩም።');

  const questionId = await storage.recordQuestion({
    userChatId: ctx.chat.id, userId: ctx.from.id,
    username: ctx.from.username, firstName: ctx.from.first_name, lastName: ctx.from.last_name,
    questionText: text, ownerMessageId: null, category: cat,
  });

  // Set rate limit after successful recording
  rateLimitMap.set(rlKey, Date.now());

  const usernameDisplay = ctx.from.username ? `@${ctx.from.username}` : 'የለም';
  const fullName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || 'Unknown';
  const categoryLabel = cat === 'theology' ? '📖 ነገረ ሃይማኖት' : '📚 ትምሕርታዊ ስነጽሑፍ';
  const ownerMsg =
    `📨 አዲስ ጥያቄ — ${categoryLabel}\n\n` +
    `👤 ስም: ${fullName}\n🔗 Username: ${usernameDisplay}\n🆔 ID: ${ctx.from.id}\n\n` +
    `💬 ጥያቄ:\n${text}`;

  try {
    // Build recipient list (owner + admins + reps for category), deduplicated
    const adminChatIds = await storage.getAdminChatIds(); // type='admin', no role filter
    const repChatIds   = await storage.getRepChatIds(cat);
    const recipientSet = new Set([ownerChatId, ...adminChatIds, ...repChatIds].filter(id => id != null));
    const recipients = Array.from(recipientSet);

    if (cat === 'theology') {
      const replyMarkup = Markup.inlineKeyboard([[
        Markup.button.callback('✅ በቦት መልስ',     `reply_bot_${questionId}`),
        Markup.button.callback('📢 በጉባኤ ይመለሳል', `answered_assembly_${questionId}`),
        Markup.button.callback('🗓️ እሑድ ይመለሳል',  `answered_sunday_${questionId}`),
      ]]).reply_markup;
      const allMessageIds = [];
      for (const recipientId of recipients) {
        const sent = await ctx.telegram.sendMessage(recipientId, ownerMsg, { reply_markup: replyMarkup });
        allMessageIds.push(sent.message_id);
      }
      await storage.updateOwnerMessageIds({
        questionId,
        ownerMessageId: allMessageIds[0] ?? null,
        ownerMessageIds: JSON.stringify(allMessageIds),
      });
      return ctx.reply(
        '✝️ ጥያቄ ስለላኩ በእግዚአብሔር ስም እናመሰግናለን። 🙏\n\n' +
        'ጥያቄዎ ለነገረ ሃይማኖት ተጠሪ ደርሷል።\n\n' +
        '📢 ምላሹ የሚሰጠው፡\n' +
        '  • በግቢ ጉባኤው በሚዘጋጅ ልዩ መርሐ ግብር ወይም\n' +
        '  • ዘወትር እሑድ 4፡00 በሚካሄደው\n' +
        '    የተዋሕዶ በተዓቅቦ መርሐ ግብር ወይም\n' +
        '  • ምላሹ ለጠያቂው ብቻ ካስፈለገ\n' +
        '    በቀጥታ በዚህ ቦት በኩል ይሆናል።\n\n' +
        'ለጥያቄዎ ተገቢውን ምላሽ እንዲያገኙ\n' +
        'መርሐ ግብሮችን መከታተል አይዘንጉ። 🙏'
      );
    } else {
      const replyMarkup = Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ በቦት መልስ',      `reply_bot_${questionId}`),
          Markup.button.callback('🗓️ ማክሰኞ ይመለሳል', `answered_tuesday_${questionId}`),
        ],
      ]).reply_markup;
      const allMessageIds = [];
      for (const recipientId of recipients) {
        const sent = await ctx.telegram.sendMessage(recipientId, ownerMsg, { reply_markup: replyMarkup });
        allMessageIds.push(sent.message_id);
      }
      await storage.updateOwnerMessageIds({
        questionId,
        ownerMessageId: allMessageIds[0] ?? null,
        ownerMessageIds: JSON.stringify(allMessageIds),
      });
      return ctx.reply(
        '✝️ ጥያቄ ስለላኩ በእግዚአብሔር ስም እናመሰግናለን። 🙏\n\n' +
        'ጥያቄዎ ለትምህርታዊ ስነ ጽሑፍ ተጠሪ ደርሷል።\n\n' +
        '📅 ምላሹ የሚሰጠው ዘወትር ማክሰኞ 11 ሰዓት\n' +
        '    በሚካሄደው የትምህርት ክፍል\n' +
        '    ትምህርታዊ ስነ ጽሑፍ መርሐ ግብር ላይ ይሆናል።\n\n' +
        'ለጥያቄዎ ተገቢውን ምላሽ እንዲያገኙ\n' +
        'መርሐ ግብሩን መከታተል አይዘንጉ። 🙏'
      );
    }
  } catch (e) {
    console.error('Failed to forward question:', e.message);
    return ctx.reply('⚠️ ጥያቄዎ ለባለቤቱ ለመላክ አልተቻለም። ቆይተው እንደገና ይሞክሩ።');
  }
});

// ── Global error handler ─────────────────────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`Error for update ${ctx.updateType}:`, err.message);
});

// ── Inline action handlers ────────────────────────────────────────────────────
bot.action(/^reply_bot_(\d+)$/, async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  const questionId = Number(ctx.match[1]);
  const question = await storage.getQuestionById(questionId);
  if (!question) return ctx.reply('⚠️ ጥያቄው አልተገኘም።');
  if (!isOwner(ctx) && !await isAdminForRole(ctx, question.category, storage.db)) return;
  if (question.status !== 'pending') return ctx.reply('ℹ️ ይህ ጥያቄ አስቀድሞ ተመልሷል።');
  ownerReplyState.set(ctx.chat.id, { questionId: question.id });
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch (_) {}
  return ctx.reply('✍️ መልስዎን ይጻፉ። ለተጠቃሚው ይላካል። ለመሰረዝ /cancel ይጠቀሙ።');
});

bot.action(/^answered_assembly_(\d+)$/, async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  const question = await storage.getQuestionById(Number(ctx.match[1]));
  if (!question) return ctx.reply('⚠️ ጥያቄው አልተገኘም።');
  if (!isOwner(ctx) && !await isAdminForRole(ctx, question.category, storage.db)) return;
  if (question.status !== 'pending') return ctx.reply('ℹ️ ይህ ጥያቄ አስቀድሞ ተመልሷል።');
  await storage.updateQuestionStatusById({ questionId: question.id, status: 'answered_assembly' });
  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    await ctx.telegram.sendMessage(question.user_chat_id,
      '✝️ ጥያቄዎ ደርሷል።\n\n' +
      'የጠየቁት ጥያቄ በግቢ ጉባኤው በሚዘጋጅ ልዩ መርሐ ግብር ላይ ይመለሳል።\n\n' +
      'ጉባኤውን ይከታተሉ ዘንድ በእግዚአብሔር ስም እናሳስባለን።\n\n' +
      'እግዚአብሔር ኢትዮጵያን እና ሕዝቦቿን ይባርክ 🙏'
    );
  } catch (e) { console.error('Could not notify user:', e.message); }
  return ctx.reply('✅ ምልክት ተደርጓል — በጉባኤ ይመለሳል።');
});

bot.action(/^answered_sunday_(\d+)$/, async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  const question = await storage.getQuestionById(Number(ctx.match[1]));
  if (!question) return ctx.reply('⚠️ ጥያቄው አልተገኘም።');
  if (!isOwner(ctx) && !await isAdminForRole(ctx, question.category, storage.db)) return;
  if (question.status !== 'pending') return ctx.reply('ℹ️ ይህ ጥያቄ አስቀድሞ ተመልሷል።');
  await storage.updateQuestionStatusById({ questionId: question.id, status: 'answered_sunday' });
  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    await ctx.telegram.sendMessage(question.user_chat_id,
      '✝️ ጥያቄዎ ደርሷል።\n\n' +
      'የጠየቁት ጥያቄ እሑድ 4፡00 ሰዓት በሚካሄደው የተዋሕዶ በተዓቅቦ መርሐ ግብር ላይ ይመለሳል።\n\n' +
      'ጉባኤውን ይከታተሉ ዘንድ በእግዚአብሔር ስም እናሳስባለን።\n\n' +
      'እግዚአብሔር ኢትዮጵያን እና ሕዝቦቿን ይባርክ 🙏'
    );
  } catch (e) { console.error('Could not notify user:', e.message); }
  return ctx.reply('✅ ምልክት ተደርጓል — እሑድ ይመለሳል።');
});

bot.action(/^answered_tuesday_(\d+)$/, async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  const question = await storage.getQuestionById(Number(ctx.match[1]));
  if (!question) return ctx.reply('⚠️ ጥያቄው አልተገኘም።');
  if (!isOwner(ctx) && !await isAdminForRole(ctx, question.category, storage.db)) return;
  if (question.status !== 'pending') return ctx.reply('ℹ️ ይህ ጥያቄ አስቀድሞ ተመልሷል።');
  await storage.updateQuestionStatusById({ questionId: question.id, status: 'answered_tuesday' });
  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    await ctx.telegram.sendMessage(question.user_chat_id,
      '✝️ ጥያቄዎ ደርሷል።\n\n' +
      'የጠየቁት ጥያቄ ዘወትር ማክሰኞ 11 ሰዓት በሚካሄደው\n' +
      'የትምህርት ክፍል ትምህርታዊ ስነ ጽሑፍ መርሐ ግብር ላይ ይመለሳል።\n\n' +
      'መርሐ ግብሩን ይከታተሉ ዘንድ በእግዚአብሔር ስም እናሳስባለን።\n\n' +
      'እግዚአብሔር ኢትዮጵያን እና ሕዝቦቿን ይባርክ 🙏'
    );
  } catch (e) { console.error('Could not notify user:', e.message); }
  return ctx.reply('✅ ምልክት ተደርጓል — ማክሰኞ ይመለሳል።');
});

// ── Register commands ─────────────────────────────────────────────────────────
async function registerBotCommands() {
  // Default: regular users see only /start and /help
  await bot.telegram.setMyCommands(
    [
      { command: 'start', description: 'ቦቱን ጀምር' },
      { command: 'help',  description: 'እርዳታ' },
    ],
    { scope: { type: 'default' } }
  );

  // Rep commands: /pending (own category) + /cancel + /help
  const repCommands = [
    { command: 'start',     description: 'ቦቱን ጀምር' },
    { command: 'pending',   description: 'ያልተመለሱ ጥያቄዎች' },
    { command: 'broadcast', description: 'ለተጠቃሚዎች መልዕክት ላክ' },
    { command: 'cancel',    description: 'መልስ መጻፍ ሰርዝ' },
    { command: 'help',      description: 'ትዕዛዞች ዝርዝር' },
  ];

  // Admin commands: everything except owner management commands
  const adminCommands = [
    { command: 'start',    description: 'ቦቱን ጀምር' },
    { command: 'pending',  description: 'ያልተመለሱ ጥያቄዎች' },
    { command: 'stats',    description: 'ስታቲስቲክስ' },
    { command: 'broadcast',description: 'ማስታወቂያ ላክ' },
    { command: 'reply',    description: 'ለተወሰነ ጥያቄ መልስ ላክ' },
    { command: 'export',   description: 'ሁሉም ጥያቄዎች ፋይል' },
    { command: 'cancel',   description: 'መልስ መጻፍ ሰርዝ' },
    { command: 'help',     description: 'ትዕዛዞች ዝርዝር' },
  ];

  // Owner commands: full access
  const ownerCommands = [
    { command: 'start',        description: 'ቦቱን ጀምር' },
    { command: 'pending',      description: 'ያልተመለሱ ጥያቄዎች' },
    { command: 'stats',        description: 'ስታቲስቲክስ' },
    { command: 'reps',         description: 'ተወካዮች ዝርዝር' },
    { command: 'admins',       description: 'አስተዳዳሪዎች ዝርዝር' },
    { command: 'addrep',       description: 'አዲስ ተወካይ ጨምር' },
    { command: 'addadmin',     description: 'አዲስ አስተዳዳሪ ጨምር' },
    { command: 'removerep',    description: 'ተወካይ አስወግድ' },
    { command: 'removeadmin',  description: 'አስተዳዳሪ አስወግድ' },
    { command: 'broadcast',    description: 'ማስታወቂያ ላክ' },
    { command: 'reply',        description: 'ለተወሰነ ጥያቄ መልስ ላክ' },
    { command: 'export',       description: 'ሁሉም ጥያቄዎች ፋይል' },
    { command: 'cancel',       description: 'መልስ መጻፍ ሰርዝ' },
    { command: 'help',         description: 'ትዕዛዞች ዝርዝር' },
  ];

  // Set owner commands
  const ownerIds = new Set();
  if (OWNER_CHAT_ID) ownerIds.add(OWNER_CHAT_ID);
  for (const chatId of ownerIds) {
    try {
      await bot.telegram.setMyCommands(ownerCommands, { scope: { type: 'chat', chat_id: chatId } });
      console.log(`Owner commands registered for chat_id ${chatId}`);
    } catch (e) {
      console.error(`setMyCommands failed for owner ${chatId}:`, e.description || e.message);
    }
  }

  // Set rep commands for all reps with a known chat_id
  const reps = await storage.getReps();
  for (const rep of reps) {
    if (!rep.chat_id) continue;
    try {
      await bot.telegram.setMyCommands(repCommands, { scope: { type: 'chat', chat_id: rep.chat_id } });
      console.log(`Rep commands registered for @${rep.username} (${rep.chat_id})`);
    } catch (e) {
      console.error(`setMyCommands failed for rep ${rep.chat_id}:`, e.description || e.message);
    }
  }

  // Set admin commands for all admins with a known chat_id
  const admins = await storage.getAdmins();
  for (const admin of admins) {
    if (!admin.chat_id) continue;
    try {
      await bot.telegram.setMyCommands(adminCommands, { scope: { type: 'chat', chat_id: admin.chat_id } });
      console.log(`Admin commands registered for @${admin.username} (${admin.chat_id})`);
    } catch (e) {
      console.error(`setMyCommands failed for admin ${admin.chat_id}:`, e.description || e.message);
    }
  }
}

// ── Launch ────────────────────────────────────────────────────────────────────
storage.initDb()
  .then(async () => {
    // Seed first rep after DB is ready
    try {
      await storage.addRep({ username: 'ctc_1559_26', role: 'literature', addedBy: 5586249161 });
    } catch (_) {}
    return bot.launch();
  })
  .then(async () => {
    console.log('✅ Bot launched');

    // Set bot description shown to new users before they press Start
    try {
      await bot.telegram.setMyDescription(
        'እንኳን ወደ ተዋሕዶ በተዓቅቦ የቴሌግራም ቦት በደህና መጡ 🙏\n\n' +
        'በዚህ ቦት የሚያገኙት አገልግሎት፡\n\n' +
        '📖 ለነገረ ሃይማኖት ጥያቄዎች\n' +
        '   • የሚጠይቁት ጥያቄ ምላሽ የሚሰጠው በግቢ ጉባኤው በሚዘጋጅ ልዩ\n' +
        '     መርሐ ግብር ወይም ዘወትር እሑድ 4፡00 በሚካሄደው\n' +
        '     የተዋሕዶ በተዓቅቦ መርሐ ግብር ወይም በቀጥታ በዚህ ቦት ይሰጣል።\n\n' +
        '📚 ለትምሕርታዊ ስነ ጽሑፍ ጥያቄዎች\n' +
        '   • ምላሽ የሚሰጠው ዘወትር ማክሰኞ 11 ሰዓት በሚካሄደው\n' +
        '     የትምህርት ክፍል ትምህርታዊ ስነ ጽሑፍ መርሐ ግብር ላይ ይሆናል።\n\n' +
        'ይሄንን አገልግሎት ለማግኘት ከታች ያለውን Start የሚለውን ይጫኑ።',
        { language_code: 'am' }
      );
      await bot.telegram.setMyDescription(
        'Welcome to Tewahdo Betekabo Bot 🙏\n\n' +
        'Ask theology or literature questions and get answers through our programs.\n\n' +
        'Press Start to begin.',
        { language_code: 'en' }
      );
      await bot.telegram.setMyShortDescription(
        'ጥያቄዎን ይጠይቁ — ምላሹ በጉባኤ ወይም በቦት ይደርስዎታል።',
        { language_code: 'am' }
      );
    } catch (e) {
      console.error('setMyDescription failed:', e.message);
    }

    registerBotCommands().catch(console.error);
  })
  .catch((err) => {
    console.error('❌ Launch failed:', err.message);
    process.exit(1);
  });

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
