// Fetches the Bank of Israel USD/ILS representative rate, writes data/rates.json for the app,
// and sends a Telegram alert when the rate nears or reaches the target price, or drops well below its average.
//
//   node scripts/check.mjs           normal run (each alert is sent once until the rate climbs back)
//   node scripts/check.mjs --test    also sends a test message with the current status
//   node scripts/check.mjs --dry     never sends anything
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { DAY_MS, MIN_OBSERVATIONS, dueAlerts, summarize } from './rules.mjs';

const ROOT = new URL('../', import.meta.url);
const DATA_DIR = new URL('data/', ROOT);
const DATA_FILE = new URL('rates.json', DATA_DIR);
const HISTORY_DAYS = 260; // enough for a 6-month chart plus the averaging window before it

const args = new Set(process.argv.slice(2));
const config = JSON.parse(await readFile(new URL('config.json', ROOT), 'utf8'));

const series = await fetchSeries();
if (series.length < MIN_OBSERVATIONS + 1) throw new Error(`Only ${series.length} observations returned`);

const summary = summarize(series, config);
const prior = await readPrior();
const { reasons, alertedLevel: settledLevel } = dueAlerts(summary, prior);
let alertedLevel = settledLevel;
let lastAlertedDate = prior.lastAlertedDate ?? null;
let alertMissed = false;

const { latest, average, diffPercent, targetRate, approachRate } = summary;
console.log(
  `${latest.date}: ${latest.rate.toFixed(3)} ILS, target ${targetRate} (early ${approachRate}), ` +
    `${config.windowDays}-day average ${average.toFixed(3)} (${diffPercent.toFixed(2)}%), due: ${reasons.join(', ') || 'none'}`,
);

if (!args.has('--dry')) {
  if (args.has('--test')) {
    if (!(await sendTelegram(testMessage(summary)))) {
      throw new Error('Test message not sent: add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID as repository secrets.');
    }
    console.log('Test message sent.');
  }
  if (reasons.length) {
    if (await sendTelegram(alertMessage(reasons, summary))) {
      alertedLevel = summary.priceLevel;
      if (reasons.includes('average')) lastAlertedDate = latest.date;
      console.log(`Alert sent: ${reasons.join(', ')}`);
    } else {
      alertMissed = true;
    }
  }
}

await mkdir(DATA_DIR, { recursive: true });
await writeFile(
  DATA_FILE,
  JSON.stringify(
    {
      updatedAt: new Date().toISOString(),
      source: 'בנק ישראל · שער יציג',
      ...summary,
      average: round(average),
      diffPercent: round(diffPercent),
      averageTargetRate: round(summary.averageTargetRate),
      alertedLevel,
      lastAlertedDate,
      alertMissed,
      series,
    },
    null,
    1,
  ) + '\n',
);

async function fetchSeries() {
  const start = new Date(Date.now() - HISTORY_DAYS * DAY_MS).toISOString().slice(0, 10);
  const url =
    'https://edge.boi.org.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_USD_ILS' +
    `?startperiod=${start}&format=csv`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`Bank of Israel responded ${res.status}`);
      return parseCsv(await res.text());
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
    }
  }
  throw lastError;
}

function parseCsv(text) {
  const [header, ...rows] = text.trim().split(/\r?\n/);
  const columns = header.split(',');
  const dateCol = columns.indexOf('TIME_PERIOD');
  const valueCol = columns.indexOf('OBS_VALUE');
  if (dateCol < 0 || valueCol < 0) throw new Error('Unexpected CSV format from Bank of Israel');
  return rows
    .map((row) => row.split(','))
    .map((cells) => [cells[dateCol], Number(cells[valueCol])])
    .filter(([date, rate]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && rate > 0)
    .sort((a, b) => a[0].localeCompare(b[0]));
}

async function readPrior() {
  try {
    return JSON.parse(await readFile(DATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set, skipping message.');
    return false;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }),
  });
  if (!res.ok) throw new Error(`Telegram responded ${res.status}: ${await res.text()}`);
  return true;
}

function agorot(rate) {
  return String(Number((Math.abs(rate - targetRate) * 100).toFixed(1)));
}

function targetLine(rate) {
  return rate <= targetRate
    ? `השער הגיע ליעד שקבעת, ${targetRate.toFixed(2)} ₪.`
    : `עוד ${agorot(rate)} אגורות ליעד שקבעת, ${targetRate.toFixed(2)} ₪.`;
}

function averageLine() {
  const direction = diffPercent < 0 ? 'נמוך' : 'גבוה';
  return `${direction} ב-${Math.abs(diffPercent).toFixed(1)}% מהממוצע של ${config.windowDays} הימים האחרונים (${average.toFixed(3)} ₪).`;
}

function alertMessage(due) {
  const titles = {
    target: '🎯 <b>הדולר הגיע ליעד שלך</b>',
    approach: '👀 <b>הדולר מתקרב ליעד שלך</b>',
    average: '📉 <b>הדולר נמוך מהממוצע</b>',
  };
  return [
    titles[due[0]],
    '',
    `השער היציג היום: <b>${latest.rate.toFixed(3)} ₪</b>`,
    targetLine(latest.rate),
    due.includes('average') ? averageLine() : '',
    appLink(),
    '',
    '<i>זה לא ייעוץ השקעות, ההחלטה שלך.</i>',
  ].filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\n');
}

function testMessage() {
  return [
    '✅ <b>הודעת בדיקה: ההתראות עובדות</b>',
    '',
    `השער היציג: ${latest.rate.toFixed(3)} ₪. ${targetLine(latest.rate)}`,
    `התראה מוקדמת תישלח ב-${approachRate.toFixed(2)} ₪, והתראה נוספת ביעד.`,
    `השער ${averageLine()}`,
    appLink(),
  ].join('\n');
}

function appLink() {
  return process.env.APP_URL ? `<a href="${process.env.APP_URL}">פתח את האפליקציה</a>` : '';
}

function round(value) {
  return Math.round(value * 10_000) / 10_000;
}
