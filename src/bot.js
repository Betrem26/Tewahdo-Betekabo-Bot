'use strict';
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const storage = require('./storage');
const { isOwner, OWNER_USERNAME, OWNER_CHAT_ID, normalizeUsername } = require('./config');

if (!process.env.BOT_TOKEN) {
  throw new Error('BOT_TOKEN is missing in .env file');
}

const bot = new Telegraf(process.env.BOT_TOKEN);

// In-memory state: owner reply mode
// Map<ownerChatId, { questionId: number }>
const ownerReplyState = new Map();

const WELCOME_MESSAGE =
  '✝️ እንኳን ወደ ተዋሕዶ በተዓቅቦ የጥያቄ መጠየቂያ ቦት በደህና መጡ!\n\n' +
  '📖 የሚፈልጉትን የነገረ ሃይማኖት ጥያቄ መጠየቅ ይችላሉ።\n\n' +
  '📢 ምላሹ የሚሰጠው፡\n' +
  '  • መድረክ ላይ በሚዘጋጅ ጉባኤ ላይ፣ ወይም\n' +
  '  • ዘወትር እሑድ እሑድ በሚካሄደው\n' +
  '    የተዋሕዶ በተዓቅቦ መርሐ ግብር ላይ፣ ወይም\n' +
  '  • በቀጥታ በዚህ ቦት በኩል ይሆናል።\n\n' +
  '✍️ ጥያቄዎን ከዚህ በታች ይጻፉ።';

bot.start(async (ctx) => {
  storage.upsertUser({
    userId: ctx.from.id,
    chatId: ctx.chat.id,
    username: ctx.from.username,
    firstName: ctx.from.first_name,
    lastName: ctx.from.last_name,
  });
  await ctx.reply(WELCOME_MESSAGE, Markup.keyboard([['✍️ ጥያቄ ላክ']]).resize());
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text || '';

  // Ignore commands
  if (text.startsWith('/')) return;

  // Owner in reply state — handle first
  if (isOwner(ctx) && ownerReplyState.has(ctx.chat.id)) {
    const { questionId } = ownerReplyState.get(ctx.chat.id);
    const question = storage.db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId);
    if (!question) {
      ownerReplyState.delete(ctx.chat.id);
      return ctx.reply('⚠️ ጥያቄው አልተገኘም።');
    }
    await ctx.telegram.sendMessage(
      question.user_chat_id,
      '📩 ከተዋሕዶ በተዓቅቦ ቡድን የተላከ መልስ፡\n\n' + text
    );
    storage.updateQuestionStatus({ ownerMessageId: question.owner_message_id, status: 'answered_bot' });
    ownerReplyState.delete(ctx.chat.id);
    return ctx.reply('✅ መልስዎ ለተጠቃሚው ተልኳል።');
  }

  // Non-owner messages
  if (!isOwner(ctx)) {
    // Reply keyboard tap — re-show welcome prompt
    if (text === '✍️ ጥያቄ ላክ') {
      return ctx.reply(WELCOME_MESSAGE, Markup.keyboard([['✍️ ጥያቄ ላክ']]).resize());
    }

    // Record the question
    const questionId = storage.recordQuestion({
      userChatId: ctx.chat.id,
      userId: ctx.from.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
      questionText: text,
      ownerMessageId: null,
    });

    // Build formatted owner message
    const usernameDisplay = ctx.from.username ? `@${ctx.from.username}` : 'የለም';
    const firstName = ctx.from.first_name || '';
    const lastName = ctx.from.last_name || '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ');
    const formattedText =
      '📨 አዲስ የነገረ ሃይማኖት ጥያቄ\n\n' +
      `👤 ስም: ${fullName}\n` +
      `🔗 Username: ${usernameDisplay}\n` +
      `🆔 Telegram ID: ${ctx.from.id}\n\n` +
      `💬 ጥያቄ:\n${text}`;

    // Determine owner chat id
    let ownerChatId = OWNER_CHAT_ID;
    if (!ownerChatId && OWNER_USERNAME) {
      const row = storage.db.prepare('SELECT chat_id FROM users WHERE lower(username) = ? LIMIT 1').get(OWNER_USERNAME);
      if (row) ownerChatId = Number(row.chat_id);
    }

    if (!ownerChatId) {
      return ctx.reply('⚠️ ጥያቄዎ አልተላከም። ባለቤቱ ቦቱን ገና አልጀመሩም።');
    }

    // Send to owner with inline buttons
    const sentMsg = await ctx.telegram.sendMessage(ownerChatId, formattedText, {
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ በቦት መልስ', `reply_bot_${questionId}`),
          Markup.button.callback('📢 በጉባኤ ተመልሷል', `answered_assembly_${questionId}`),
          Markup.button.callback('🗓️ እሑድ ይመለሳል', `answered_sunday_${questionId}`),
        ]
      ]).reply_markup,
    });

    // Update question with the owner message id
    storage.updateOwnerMessageId({ questionId, ownerMessageId: sentMsg.message_id });

    return ctx.reply('🙏 ጥያቄዎ ተልኳል። ምላሹ በቅርቡ በጉባኤ ወይም በቦት በኩል ይደርስዎታል።');
  }
});

// Callback: reply via bot
bot.action(/^reply_bot_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!isOwner(ctx)) return;
  const questionId = Number(ctx.match[1]);
  ownerReplyState.set(ctx.chat.id, { questionId });
  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  } catch (e) { /* ignore */ }
  await ctx.reply('✍️ መልስዎን ይጻፉ። ለተጠቃሚው ይላካል።');
});

// Callback: answered at assembly
bot.action(/^answered_assembly_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!isOwner(ctx)) return;
  const questionId = Number(ctx.match[1]);
  const question = storage.db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId);
  if (question) {
    storage.updateQuestionStatus({ ownerMessageId: question.owner_message_id, status: 'answered_assembly' });
    try {
      await ctx.telegram.sendMessage(
        question.user_chat_id,
        '📢 ጥያቄዎ በተዋሕዶ በተዓቅቦ ጉባኤ ላይ ተመልሷል። ለጉባኤው በመገኘትዎ ምስጋና።'
      );
    } catch (e) { console.error('Could not notify user:', e.message); }
  }
  await ctx.reply('✅ ምልክት ተደርጓል — በጉባኤ ተመልሷል።');
});

// Callback: answered on Sunday
bot.action(/^answered_sunday_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!isOwner(ctx)) return;
  const questionId = Number(ctx.match[1]);
  const question = storage.db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId);
  if (question) {
    storage.updateQuestionStatus({ ownerMessageId: question.owner_message_id, status: 'answered_sunday' });
    try {
      await ctx.telegram.sendMessage(
        question.user_chat_id,
        '🗓️ ጥያቄዎ ዘወትር እሑድ በሚካሄደው የተዋሕዶ በተዓቅቦ መርሐ ግብር ላይ ይመለሳል። እሑድ እሑድ ይከታተሉ!'
      );
    } catch (e) { console.error('Could not notify user:', e.message); }
  }
  await ctx.reply('✅ ምልክት ተደርጓል — እሑድ ይመለሳል።');
});

// Owner commands

bot.command('pending', async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply('⚠️ እርስዎ ይህን ትዕዛዝ ለማሳካት ፈቃድ የለዎትም።');
  const rows = storage.getPendingQuestions();
  if (!rows.length) return ctx.reply('📭 በወቅቱ ምንም ያልተመለሰ ጥያቄ የለም።');
  const lines = [`📋 ያልተመለሱ ጥያቄዎች፡ ${rows.length}\n`];
  rows.forEach((q, i) => {
    const username = q.username ? `@${q.username}` : 'የለም';
    const preview = q.question_text.length > 60 ? q.question_text.slice(0, 60) + '...' : q.question_text;
    lines.push(`${i + 1}. [ID: ${q.id}] ${username} — ${preview}`);
    lines.push(`   📅 ${q.created_at}`);
  });
  await ctx.reply(lines.join('\n'));
});

bot.command('stats', async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply('⚠️ እርስዎ ይህን ትዕዛዝ ለማሳካት ፈቃድ የለዎትም።');
  const s = storage.getStats();
  await ctx.reply(
    '📊 አጠቃላይ ስታቲስቲክስ\n\n' +
    `📨 ጠቅላላ ጥያቄዎች: ${s.total}\n` +
    `⏳ ያልተመለሱ: ${s.pending}\n` +
    `✅ በቦት የተመለሱ: ${s.answered_bot}\n` +
    `📢 በጉባኤ የተመለሱ: ${s.answered_assembly}\n` +
    `🗓️ እሑድ የተመለሱ: ${s.answered_sunday}`
  );
});

bot.command('broadcast', async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply('⚠️ እርስዎ ይህን ትዕዛዝ ለማሳካት ፈቃድ የለዎትም።');
  const body = (ctx.message.text || '').replace(/^\/broadcast\s*/, '').trim();
  if (!body) return ctx.reply('⚠️ አጠቃቀም: /broadcast <መልዕክት>');
  const chatIds = storage.getUniqueUserChatIds();
  const text = `📢 ከተዋሕዶ በተዓቅቦ ቡድን ማስታወቂያ፡\n\n${body}`;
  let sent = 0, failed = 0;
  for (const chatId of chatIds) {
    try { await ctx.telegram.sendMessage(chatId, text); sent++; }
    catch (e) { failed++; }
  }
  await ctx.reply(`✅ ማስታወቂያ ተልኳል። ደርሷቸዋል: ${sent} | አልደረሰም: ${failed}`);
});

bot.command('cancel', async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply('⚠️ እርስዎ ይህን ትዕዛዝ ለማሳካት ፈቃድ የለዎትም።');
  ownerReplyState.delete(ctx.chat.id);
  await ctx.reply('❌ መልስ መጻፍ ተሰርዟል።');
});

async function registerBotCommands() {
  // Default scope: /start only
  await bot.telegram.setMyCommands(
    [{ command: 'start', description: 'ቦቱን ጀምር' }],
    { scope: { type: 'default' } }
  );

  // Owner scope: all commands
  const ownerCommands = [
    { command: 'start', description: 'ቦቱን ጀምር' },
    { command: 'pending', description: 'ያልተመለሱ ጥያቄዎች' },
    { command: 'stats', description: 'ስታቲስቲክስ' },
    { command: 'broadcast', description: 'ማስታወቂያ ላክ' },
    { command: 'cancel', description: 'መልስ መጻፍ ሰርዝ' },
  ];

  const ownerChatIds = [];
  if (OWNER_CHAT_ID) ownerChatIds.push(OWNER_CHAT_ID);
  if (OWNER_USERNAME) {
    const row = storage.db.prepare('SELECT chat_id FROM users WHERE lower(username) = ? LIMIT 1').get(OWNER_USERNAME);
    if (row && row.chat_id) ownerChatIds.push(Number(row.chat_id));
  }

  for (const chatId of [...new Set(ownerChatIds)]) {
    try {
      await bot.telegram.setMyCommands(ownerCommands, { scope: { type: 'chat', chat_id: chatId } });
    } catch (e) {
      console.error(`Failed to set commands for owner chatId ${chatId}:`, e.description || e.message);
    }
  }
}

bot.launch();
registerBotCommands().catch(console.error);
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
