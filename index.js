const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const pdfParse = require('pdf-parse');
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN || 'AAHewuZVB2XV84vRzhd0xDvBmQ96hfkPsj4';
const CHAT_ID = process.env.CHAT_ID || '945549076';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// In-memory store (persists as long as server is running)
// For permanent storage, Railway provides a volume or you can use a free DB
let earningsHistory = [];

console.log('🟢 GrabBot is running...');

// ── /start ──────────────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
`🟢 *GrabTrack Bot*

Hey Jerome! Send me your Grab monthly statement PDF and I'll extract your earnings automatically.

*Commands:*
/summary — View all-time summary
/monthly — View by month
/clear — Clear all stored data
/help — Show this message

Just send a PDF anytime to log it! 📄`,
    { parse_mode: 'Markdown' }
  );
});

// ── /help ────────────────────────────────────────────────────────────────────
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
`*How to use GrabTrack Bot:*

1️⃣ Download your monthly statement from the Grab Driver app
2️⃣ Send the PDF file here
3️⃣ I'll read it and save your earnings automatically

*Commands:*
/summary — All-time totals
/monthly — Month-by-month breakdown
/clear — Clear stored data`,
    { parse_mode: 'Markdown' }
  );
});

// ── /summary ─────────────────────────────────────────────────────────────────
bot.onText(/\/summary/, (msg) => {
  if (earningsHistory.length === 0) {
    return bot.sendMessage(msg.chat.id, '📭 No data yet. Send me a Grab statement PDF!');
  }

  const totals = earningsHistory.reduce((acc, m) => {
    acc.transport += m.transportEarnings;
    acc.deliveries += m.deliveriesEarnings;
    acc.incentives += m.incentives;
    acc.tips += m.tips;
    acc.deductions += m.totalDeductions;
    acc.cpf += m.cpfContribution;
    acc.net += m.monthlyTotal;
    return acc;
  }, { transport: 0, deliveries: 0, incentives: 0, tips: 0, deductions: 0, cpf: 0, net: 0 });

  const months = earningsHistory.length;
  const avg = totals.net / months;

  bot.sendMessage(msg.chat.id,
`📊 *All-Time Summary (${months} month${months > 1 ? 's' : ''})*

💰 *Gross Earnings: $${(totals.transport + totals.deliveries + totals.incentives + totals.tips).toFixed(2)}*
  🚗 Transport: $${totals.transport.toFixed(2)}
  📦 Deliveries: $${totals.deliveries.toFixed(2)}
  🎯 Incentives: $${totals.incentives.toFixed(2)}
  🙏 Tips: $${totals.tips.toFixed(2)}

➖ *Deductions: -$${Math.abs(totals.deductions).toFixed(2)}*
🏦 *CPF: -$${totals.cpf.toFixed(2)}*

✅ *Net Take-Home: $${totals.net.toFixed(2)}*
📈 Monthly Avg: $${avg.toFixed(2)}`,
    { parse_mode: 'Markdown' }
  );
});

// ── /monthly ─────────────────────────────────────────────────────────────────
bot.onText(/\/monthly/, (msg) => {
  if (earningsHistory.length === 0) {
    return bot.sendMessage(msg.chat.id, '📭 No data yet. Send me a Grab statement PDF!');
  }

  const sorted = [...earningsHistory].sort((a, b) => new Date(a.period) - new Date(b.period));
  let text = `📅 *Monthly Breakdown*\n\n`;

  sorted.forEach(m => {
    text += `*${m.period}*\n`;
    text += `  Gross: $${(m.transportEarnings + m.deliveriesEarnings + m.incentives + m.tips).toFixed(2)} | Net: $${m.monthlyTotal.toFixed(2)}\n\n`;
  });

  bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

// ── /clear ────────────────────────────────────────────────────────────────────
bot.onText(/\/clear/, (msg) => {
  earningsHistory = [];
  bot.sendMessage(msg.chat.id, '🗑️ All data cleared.');
});

// ── PDF Handler ───────────────────────────────────────────────────────────────
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const doc = msg.document;

  if (doc.mime_type !== 'application/pdf') {
    return bot.sendMessage(chatId, '⚠️ Please send a PDF file.');
  }

  bot.sendMessage(chatId, '📄 Got your statement! Reading it now...');

  try {
    // Download the PDF
    const fileInfo = await bot.getFile(doc.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    const pdfBuffer = Buffer.from(response.data);

    // Parse PDF text
    const data = await pdfParse(pdfBuffer);
    const text = data.text;

    // Extract data
    const parsed = parseGrabStatement(text);

    if (!parsed) {
      return bot.sendMessage(chatId, '❌ Couldn\'t read this PDF. Make sure it\'s a Grab Driver Monthly Statement.');
    }

    // Check if month already exists
    const existingIndex = earningsHistory.findIndex(e => e.period === parsed.period);
    if (existingIndex >= 0) {
      earningsHistory[existingIndex] = parsed;
      bot.sendMessage(chatId, `🔄 Updated existing data for *${parsed.period}*`, { parse_mode: 'Markdown' });
    } else {
      earningsHistory.push(parsed);
    }

    // Send summary
    sendStatementSummary(chatId, parsed);

  } catch (err) {
    console.error('PDF error:', err);
    bot.sendMessage(chatId, '❌ Error reading PDF. Please try again.');
  }
});

// ── Parse Grab Statement ──────────────────────────────────────────────────────
function parseGrabStatement(text) {
  try {
    // Extract period
    const periodMatch = text.match(/(\d{1,2}\s+\w+,?\s+\d{4})\s*[-–]\s*(\d{1,2}\s+\w+,?\s+\d{4})/);
    const period = periodMatch
      ? formatPeriod(periodMatch[2])
      : extractFallbackPeriod(text);

    // Extract numbers using known labels
    const extract = (label, fallback = 0) => {
      const regex = new RegExp(label + '[\\s\\S]{0,60}?([\\d,]+\\.\\d{2})');
      const match = text.match(regex);
      return match ? parseFloat(match[1].replace(/,/g, '')) : fallback;
    };

    const totalEarnings = extract('Total Earnings');
    const transportEarnings = extract('Transport Earnings');
    const deliveriesEarnings = extract('Deliveries Earnings');
    const incentives = extract('Incentives');
    const tips = extract('Tips');
    const totalDeductions = extract('Total Deductions');
    const cpfContribution = extract('Your contribution');
    const monthlyTotalMatch = text.match(/Monthly Total\s+S\$?([\d,]+\.?\d{0,2})/);
    const monthlyTotal = monthlyTotalMatch ? parseFloat(monthlyTotalMatch[1].replace(/,/g, '')) : 0;

    // Weekly breakdown
    const weeks = extractWeeklyBreakdown(text);

    return {
      period,
      totalEarnings,
      transportEarnings,
      deliveriesEarnings,
      incentives,
      tips,
      totalDeductions: Math.abs(totalDeductions),
      cpfContribution,
      monthlyTotal,
      weeks
    };
  } catch (e) {
    console.error('Parse error:', e);
    return null;
  }
}

function extractWeeklyBreakdown(text) {
  const weeks = [];
  // Match rows like: "1 - 7 Jan  1706.30  0.00  112.48  18.00 ..."
  const rowRegex = /(\d{1,2}\s*-\s*\d{1,2}\s+\w+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/g;
  let match;
  while ((match = rowRegex.exec(text)) !== null) {
    weeks.push({
      period: match[1].trim(),
      transport: parseFloat(match[2]),
      deliveries: parseFloat(match[3]),
      incentives: parseFloat(match[4]),
      tips: parseFloat(match[5])
    });
  }
  return weeks;
}

function formatPeriod(dateStr) {
  // "31 January, 2026" → "January 2026"
  const m = dateStr.match(/(\w+),?\s+(\d{4})/);
  return m ? `${m[1]} ${m[2]}` : dateStr.trim();
}

function extractFallbackPeriod(text) {
  const m = text.match(/(\w+\s+\d{4})/);
  return m ? m[1] : 'Unknown';
}

// ── Send formatted summary to Telegram ───────────────────────────────────────
function sendStatementSummary(chatId, d) {
  const gross = (d.transportEarnings + d.deliveriesEarnings + d.incentives + d.tips).toFixed(2);

  let weeksText = '';
  if (d.weeks && d.weeks.length > 0) {
    weeksText = '\n📅 *Weekly Breakdown*\n';
    d.weeks.forEach(w => {
      const wTotal = (w.transport + w.deliveries + w.incentives + w.tips).toFixed(2);
      weeksText += `  ${w.period}: *$${wTotal}*\n`;
    });
  }

  const msg =
`✅ *Statement Processed: ${d.period}*

💰 *Gross Earnings: $${gross}*
  🚗 Transport: $${d.transportEarnings.toFixed(2)}
  📦 Deliveries: $${d.deliveriesEarnings.toFixed(2)}
  🎯 Incentives: $${d.incentives.toFixed(2)}
  🙏 Tips: $${d.tips.toFixed(2)}

➖ Deductions: -$${d.totalDeductions.toFixed(2)}
🏦 Your CPF: -$${d.cpfContribution.toFixed(2)}

✅ *Monthly Take-Home: $${d.monthlyTotal.toFixed(2)}*
${weeksText}
Use /summary for all-time totals or /monthly for history.`;

  bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
}
