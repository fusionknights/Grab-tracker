const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const pdfParse = require('pdf-parse');

const BOT_TOKEN = process.env.BOT_TOKEN || '8645716659:AAHewuZVB2XV84vRzhd0xDvBmQ96hfkPsj4';
const CHAT_ID = process.env.CHAT_ID || '945549076';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
let earningsHistory = [];

console.log('GrabBot is running...');

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
`*GrabTrack Bot*

Hey Jerome! Send me your Grab monthly statement PDF and I will extract your earnings automatically.

*Commands:*
/summary - View all-time summary
/monthly - View by month
/clear - Clear all stored data
/help - Show this message

Just send a PDF anytime to log it!`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
`*How to use GrabTrack Bot:*

1. Download your monthly statement from the Grab Driver app
2. Send the PDF file here
3. I will read it and save your earnings automatically

*Commands:*
/summary - All-time totals
/monthly - Month-by-month breakdown
/clear - Clear stored data`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/summary/, (msg) => {
  if (earningsHistory.length === 0) {
    return bot.sendMessage(msg.chat.id, 'No data yet. Send me a Grab statement PDF!');
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
  const gross = totals.transport + totals.deliveries + totals.incentives + totals.tips;

  bot.sendMessage(msg.chat.id,
`All-Time Summary (${months} month${months > 1 ? 's' : ''})

Gross Earnings: $${gross.toFixed(2)}
  Transport: $${totals.transport.toFixed(2)}
  Deliveries: $${totals.deliveries.toFixed(2)}
  Incentives: $${totals.incentives.toFixed(2)}
  Tips: $${totals.tips.toFixed(2)}

Deductions: -$${totals.deductions.toFixed(2)}
CPF: -$${totals.cpf.toFixed(2)}

Net Take-Home: $${totals.net.toFixed(2)}
Monthly Avg: $${(totals.net / months).toFixed(2)}`
  );
});

bot.onText(/\/monthly/, (msg) => {
  if (earningsHistory.length === 0) {
    return bot.sendMessage(msg.chat.id, 'No data yet. Send me a Grab statement PDF!');
  }
  const sorted = [...earningsHistory].sort((a, b) => new Date(a.period) - new Date(b.period));
  let text = 'Monthly Breakdown\n\n';
  sorted.forEach(m => {
    const gross = (m.transportEarnings + m.deliveriesEarnings + m.incentives + m.tips).toFixed(2);
    text += `${m.period}\n  Gross: $${gross} | Net: $${m.monthlyTotal.toFixed(2)}\n\n`;
  });
  bot.sendMessage(msg.chat.id, text);
});

bot.onText(/\/clear/, (msg) => {
  earningsHistory = [];
  bot.sendMessage(msg.chat.id, 'All data cleared.');
});

bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const doc = msg.document;

  if (doc.mime_type !== 'application/pdf') {
    return bot.sendMessage(chatId, 'Please send a PDF file.');
  }

  bot.sendMessage(chatId, 'Got your statement! Reading it now...');

  try {
    const fileInfo = await bot.getFile(doc.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    const pdfBuffer = Buffer.from(response.data);
    const data = await pdfParse(pdfBuffer);
    const text = data.text;

    console.log('PDF TEXT:', text.substring(0, 2000));

    const parsed = parseGrabStatement(text);
    console.log('PARSED:', JSON.stringify(parsed));

    if (!parsed) {
      return bot.sendMessage(chatId, "Could not read this PDF. Make sure it's a Grab Driver Monthly Statement.");
    }

    const existingIndex = earningsHistory.findIndex(e => e.period === parsed.period);
    if (existingIndex >= 0) {
      earningsHistory[existingIndex] = parsed;
    } else {
      earningsHistory.push(parsed);
    }

    sendStatementSummary(chatId, parsed);

  } catch (err) {
    console.error('PDF error:', err);
    bot.sendMessage(chatId, 'Error reading PDF. Please try again.');
  }
});

function parseGrabStatement(text) {
  try {
    // Period
    const periodMatch = text.match(/\d{1,2}\s+(\w+),?\s+(\d{4})/);
    const period = periodMatch ? `${periodMatch[1]} ${periodMatch[2]}` : 'Unknown';

    // Split into clean lines
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Find the "Amount" header that comes after "Description" (the earnings table)
    let amtIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === 'Amount' && i > 5) {
        amtIdx = i;
        break;
      }
    }

    // Extract numbers in order after Amount header
    // Order: totalEarnings, transport, incentives, tips, deductions, ...
    let nums = [];
    if (amtIdx !== -1) {
      for (let i = amtIdx + 1; i < lines.length && nums.length < 8; i++) {
        const clean = lines[i].replace(/,/g, '').replace('S$', '');
        const n = parseFloat(clean);
        if (!isNaN(n) && lines[i].match(/^-?[\d,]+\.?\d*$/)) {
          nums.push(n);
        }
      }
    }

    console.log('Nums from Amount table:', nums);

    const transportEarnings = nums[1] || 0;
    const deliveriesEarnings = 0; // transport only in this statement
    const incentives = nums[2] || 0;
    const tips = nums[3] || 0;
    const totalDeductions = Math.abs(nums[4] || 0);

    // Monthly Total - look for S$X,XXX.XX pattern
    const mtMatch = text.match(/Monthly Total\s*\n[\s\S]{0,20}?S\$([\d,]+\.\d{2})/);
    const monthlyTotal = mtMatch ? parseFloat(mtMatch[1].replace(/,/g, '')) : 0;

    // CPF - number right after "contribution rate" line
    const cpfMatch = text.match(/contribution rate\s*\n+\s*([\d,]+\.\d{2})/);
    const cpfContribution = cpfMatch ? parseFloat(cpfMatch[1].replace(/,/g, '')) : 0;

    // Weekly breakdown
    const weeks = extractWeeklyBreakdown(text);

    return { period, transportEarnings, deliveriesEarnings, incentives, tips, totalDeductions, cpfContribution, monthlyTotal, weeks };

  } catch (e) {
    console.error('Parse error:', e);
    return null;
  }
}

function extractWeeklyBreakdown(text) {
  const weeks = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  for (let i = 0; i < lines.length; i++) {
    const periodMatch = lines[i].match(/^(\d{1,2}\s*-\s*\d{1,2}\s+\w+)$/);
    if (periodMatch && i + 1 < lines.length) {
      const nums = [];
      for (let j = i + 1; j < lines.length && nums.length < 4; j++) {
        const n = parseFloat(lines[j].replace(/,/g, ''));
        if (!isNaN(n)) nums.push(n);
        else break;
      }
      if (nums.length >= 4) {
        weeks.push({
          period: periodMatch[1],
          transport: nums[0],
          deliveries: nums[1],
          incentives: nums[2],
          tips: nums[3]
        });
      }
    }
  }
  return weeks;
}

function sendStatementSummary(chatId, d) {
  const gross = (d.transportEarnings + d.deliveriesEarnings + d.incentives + d.tips).toFixed(2);

  let weeksText = '';
  if (d.weeks && d.weeks.length > 0) {
    weeksText = '\nWeekly Breakdown\n';
    d.weeks.forEach(w => {
      const wTotal = (w.transport + w.deliveries + w.incentives + w.tips).toFixed(2);
      weeksText += `  ${w.period}: $${wTotal}\n`;
    });
  }

  const msg =
`Statement Processed: ${d.period}

Gross Earnings: $${gross}
  Transport: $${d.transportEarnings.toFixed(2)}
  Deliveries: $${d.deliveriesEarnings.toFixed(2)}
  Incentives: $${d.incentives.toFixed(2)}
  Tips: $${d.tips.toFixed(2)}

Deductions: -$${d.totalDeductions.toFixed(2)}
Your CPF: -$${d.cpfContribution.toFixed(2)}

Monthly Take-Home: $${d.monthlyTotal.toFixed(2)}
${weeksText}
Use /summary for all-time totals or /monthly for history.`;

  bot.sendMessage(chatId, msg);
}
