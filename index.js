const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const pdfParse = require('pdf-parse');

const BOT_TOKEN = process.env.BOT_TOKEN || '8645716659:AAHewuZVB2XV84vRzhd0xDvBmQ96hfkPsj4';
const CHAT_ID = process.env.CHAT_ID || '945549076';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

let earningsHistory = [];

console.log('🟢 GrabBot is running...');

// ── /start ────────────────────────────────────────────────────────────────────
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

// ── /help ─────────────────────────────────────────────────────────────────────
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

// ── /summary ──────────────────────────────────────────────────────────────────
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
  const gross = totals.transport + totals.deliveries + totals.incentives + totals.tips;

  bot.sendMessage(msg.chat.id,
`📊 *All-Time Summary (${months} month${months > 1 ? 's' : ''})*

💰 *Gross Earnings: $${gross.toFixed(2)}*
  🚗 Transport: $${totals.transport.toFixed(2)}
  📦 Deliveries: $${totals.deliveries.toFixed(2)}
  🎯 Incentives: $${totals.incentives.toFixed(2)}
  🙏 Tips: $${totals.tips.toFixed(2)}

➖ *Deductions: -$${totals.deductions.toFixed(2)}*
🏦 *CPF: -$${totals.cpf.toFixed(2)}*

✅ *Net Take-Home: $${totals.net.toFixed(2)}*
📈 Monthly Avg: $${avg.toFixed(2)}`,
    { parse_mode: 'Markdown' }
  );
});

// ── /monthly ──────────────────────────────────────────────────────────────────
bot.onText(/\/monthly/, (msg) => {
  if (earningsHistory.length === 0) {
    return bot.sendMessage(msg.chat.id, '📭 No data yet. Send me a Grab statement PDF!');
  }

  const sorted = [...earningsHistory].sort((a, b) => new Date(a.period) - new Date(b.period));
  let text = `📅 *Monthly Breakdown*\n\n`;
  sorted.forEach(m => {
    const gross = (m.transportEarnings + m.deliveriesEarnings + m.incentives + m.tips).toFixed(2);
    text += `*${m.period}*\n  Gross: $${gross} | Net: $${m.monthlyTotal.toFixed(2)}\n\n`;
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
    const fileInfo = await bot.getFile(doc.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    const pdfBuffer = Buffer.from(response.data);

    const data = await pdfParse(pdfBuffer);
    const text = data.text;

    console.log('=== PDF TEXT ===');
    console.log(text);
    console.log('=== END ===');

    const parsed = parseGrabStatement(text);

    if (!parsed) {
      return bot.sendMessage(chatId, "❌ Couldn't read this PDF. Make sure it's a Grab Driver Monthly Statement.");
    }

    const existingIndex = earningsHistory.findIndex(e => e.period === parsed.period);
    if (existingIndex >= 0) {
      earningsHistory[existingIndex] = parsed;
      bot.sendMessage(chatId, `🔄 Updated data for *${parsed.period}*`, { parse_mode: 'Markdown' });
    } else {
      earningsHistory.push(parsed);
    }

    sendStatementSummary(chatId, parsed);

  } catch (err) {
    console.error('PDF error:', err);
    bot.sendMessage(chatId, '❌ Error reading PDF. Please try again.');
  }
});

// ── Parse Grab Statement ──────────────────────────────────────────────────────
function parseGrabStatement(text) {
  try {
    // Extract period e.g. "1 January, 2026 - 31 January, 2026"
    const periodMatch = text.match(/\d{1,2}\s+(\w+),?\s+(\d{4})/);
    const period = periodMatch ? `${periodMatch[1]} ${periodMatch[2]}` : 'Unknown';

    // Helper: find a number that appears after a label (on same or next line)
    const grab = (label) => {
      const regex = new RegExp(label + '[^\\d\\n]*\\n?[^\\d\\n]*([\\d,]+\\.\\d{2})');
      const m = text.match(regex);
      return m ? parseFloat(m[1].replace(/,/g, '')) : 0;
    };

    // The PDF has amounts listed at top in order before labels appear
    // Pull ALL numbers from text in sequence
    const allNums = [];
    const numRegex = /-?[\d,]+\.\d{2}/g;
    let nm;
    while ((nm = numRegex.exec(text)) !== null) {
      allNums.push(parseFloat(nm[0].replace(/,/g, '')));
    }
    console.log('All numbers found:', allNums);

    // From your PDF, the order of amounts at the top is:
    // 9486.67, 8473.70, 939.97, 73.00, -45.00, -45.00, 9486.67, -45.00
    // = totalEarnings, transport, incentives, tips, totalDeductions, adjustments, ...
    let transportEarnings = 0, deliveriesEarnings = 0, incentives = 0, tips = 0;
    let totalDeductions = 0, cpfContribution = 0, monthlyTotal = 0;

    // Find Monthly Total first — most reliable anchor
    const mtMatch = text.match(/Monthly Total\s+S\$?([\d,]+\.?\d{0,2})/);
    if (mtMatch) monthlyTotal = parseFloat(mtMatch[1].replace(/,/g, ''));

    // Transport Earnings
    const teMatch = text.match(/Transport Earnings\s+([\d,]+\.\d{2})/);
    if (teMatch) transportEarnings = parseFloat(teMatch[1].replace(/,/g, ''));

    // Deliveries Earnings
    const deMatch = text.match(/Deliveries Earnings\s+([\d,]+\.\d{2})/);
    if (deMatch) deliveriesEarnings = parseFloat(deMatch[1].replace(/,/g, ''));

    // Incentives
    const incMatch = text.match(/Incentives\s+([\d,]+\.\d{2})/);
    if (incMatch) incentives = parseFloat(incMatch[1].replace(/,/g, ''));

    // Tips
    const tipsMatch = text.match(/Tips\s+([\d,]+\.\d{2})/);
    if (tipsMatch) tips = parseFloat(tipsMatch[1].replace(/,/g, ''));

    // Total Deductions
    const dedMatch = text.match(/Total Deductions\s+-?([\d,]+\.\d{2})/);
    if (dedMatch) totalDeductions = parseFloat(dedMatch[1].replace(/,/g, ''));

    // CPF your contribution
    const cpfMatch = text.match(/Your contribution[\s\S]{0,200}?(\d{3,4}\.\d{2})/);
    if (cpfMatch) cpfContribution = parseFloat(cpfMatch[1].replace(/,/g, ''));

    // If labels not found, fall back to positional numbers from top of PDF
    if (transportEarnings === 0 && allNums.length >= 2) transportEarnings = allNums[1];
    if (incentives === 0 && allNums.length >= 3) incentives = allNums[2];
    if (tips === 0 && allNums.length >= 4) tips = allNums[3];
    if (totalDeductions === 0 && allNums.length >= 5) totalDeductions = Math.abs(allNums[4]);
    if (monthlyTotal === 0 && allNums.length >= 1) monthlyTotal = allNums[0];

    const weeks = extractWeeklyBreakdown(text);

    const result = { period, transportEarnings, deliveriesEarnings, incentives, tips, totalDeductions, cpfContribution, monthlyTotal, weeks };
    console.log('Parsed result:', result);
    return result;

  } catch (e) {
    console.error('Parse error:', e);
    return null;
  }
}

// ── Weekly Breakdown ──────────────────────────────────────────────────────────
function extractWeeklyBreakdown(text) {
  const weeks = [];
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

// ── Send Summary to Telegram ──────────────────────────────────────────────────
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
