// Fetches the Bank of Israel USD/ILS representative rate, writes data/rates.json for the app,
// and sends a Telegram alert when the latest rate is below the recent average by the configured threshold.
//
//   node scripts/check.mjs           normal run (alerts once per new rate date)
//   node scripts/check.mjs --test    also sends a test message with the current status
//   node scripts/check.mjs --dry     never sends anything
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const DATA_DIR = new URL('data/', ROOT);
const DATA_FILE = new URL('rates.json', DATA_DIR);
const HISTORY_DAYS = 260; // enough for a 6-month chart plus the averaging window before it
const MIN_OBSERVATIONS = 10;
const DAY_MS = 86_400_000;

const args = new Set(process.argv.slice(2));
const config = JSON.parse(await readFile(new URL('config.json', ROOT), 'utf8'));
const { thresholdPercent, windowDays } = config;

const series = await fetchSeries();
if (series.length < MIN_OBSERVATIONS + 1) throw new Error(`Only ${series.length} observations returned`);

const averages = rollingAverage(series, windowDays);
const last = series.length - 1;
const latest = { date: series[last][0], rate: series[last][1] };
const previous = { date: series[last - 1][0], rate: series[last - 1][1] };
const average = averages[last];
const diffPercent = ((latest.rate - average) / average) * 100;
const targetRate = average * (1 - thresholdPercent / 100);
const isGoodTime = latest.rate <= targetRate;

const prior = await readPrior();
let lastAlertedDate = prior.lastAlertedDate ?? null;

const status = { latest, average, diffPercent, targetRate, isGoodTime };
console.log(
  `${latest.date}: ${latest.rate.toFixed(3)} ILS, ${windowDays}-day average ${average.toFixed(3)}, ` +
    `diff ${diffPercent.toFixed(2)}%, target ${targetRate.toFixed(3)}, good time: ${isGoodTime}`,
);

if (!args.has('--dry')) {
  if (args.has('--test')) {
    if (!(await sendTelegram(testMessage(status)))) {
      throw new Error('Test message not sent: add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID as repository secrets.');
    }
    console.log('Test message sent.');
  }
  if (isGoodTime && latest.date !== lastAlertedDate) {
    if (await sendTelegram(alertMessage(status))) {
      lastAlertedDate = latest.date;
      console.log('Alert sent.');
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
      thresholdPercent,
      windowDays,
      latest,
      previous,
      average: round(average),
      diffPercent: round(diffPercent),
      targetRate: round(targetRate),
      isGoodTime,
      lastAlertedDate,
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

// Average of the observations in the `days` calendar days before each date (the date itself excluded).
// The app has the same function so the chart matches the alert.
function rollingAverage(points, days) {
  const out = [];
  let start = 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) sum += points[i - 1][1];
    const from = Date.parse(points[i][0]) - days * DAY_MS;
    while (start < i && Date.parse(points[start][0]) < from) sum -= points[start++][1];
    const count = i - start;
    out.push(count >= MIN_OBSERVATIONS ? sum / count : null);
  }
  return out;
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

function alertMessage({ latest, average, diffPercent }) {
  return [
    '💵 <b>זמן טוב לקנות דולר</b>',
    '',
    `השער היציג היום: <b>${latest.rate.toFixed(3)} ₪</b>`,
    `נמוך ב-${Math.abs(diffPercent).toFixed(1)}% מהממוצע של ${windowDays} הימים האחרונים (${average.toFixed(3)} ₪)`,
    appLink(),
    '',
    '<i>זה לא ייעוץ השקעות, ההחלטה שלך.</i>',
  ].join('\n');
}

function testMessage({ latest, average, diffPercent, targetRate, isGoodTime }) {
  const direction = diffPercent < 0 ? 'נמוך' : 'גבוה';
  return [
    '✅ <b>הודעת בדיקה: ההתראות עובדות</b>',
    '',
    `השער היציג: ${latest.rate.toFixed(3)} ₪, ${direction} ב-${Math.abs(diffPercent).toFixed(1)}% מהממוצע (${average.toFixed(3)} ₪)`,
    isGoodTime ? 'עכשיו זה זמן טוב לקנות.' : `התראה תישלח כשהשער יירד מתחת ל-${targetRate.toFixed(3)} ₪.`,
    appLink(),
  ].join('\n');
}

function appLink() {
  return process.env.APP_URL ? `<a href="${process.env.APP_URL}">פתח את האפליקציה</a>` : '';
}

function round(value) {
  return Math.round(value * 10_000) / 10_000;
}
