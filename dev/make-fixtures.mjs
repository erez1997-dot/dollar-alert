// Builds stress-test datasets from the real data/rates.json, for the dev-only data toggle.
//   node dev/make-fixtures.mjs   then open http://localhost:5173/?data=worst
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const OUT = new URL('dev/fixtures/', ROOT);
const DAY_MS = 86_400_000;
const real = JSON.parse(await readFile(new URL('data/rates.json', ROOT), 'utf8'));

function rollingAverage(points, days) {
  const out = [];
  let start = 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) sum += points[i - 1][1];
    const from = Date.parse(points[i][0]) - days * DAY_MS;
    while (start < i && Date.parse(points[start][0]) < from) sum -= points[start++][1];
    const count = i - start;
    out.push(count >= 10 ? sum / count : null);
  }
  return out;
}

// Rebuilds every derived field the way check.mjs does, so a fixture is shaped exactly like real output.
function build(series, { thresholdPercent, windowDays, updatedAt, lastAlertedDate }) {
  const avg = rollingAverage(series, windowDays).at(-1);
  const [date, rate] = series.at(-1);
  const diffPercent = ((rate - avg) / avg) * 100;
  const targetRate = avg * (1 - thresholdPercent / 100);
  return {
    ...real,
    updatedAt,
    thresholdPercent,
    windowDays,
    latest: { date, rate },
    previous: { date: series.at(-2)[0], rate: series.at(-2)[1] },
    average: avg,
    diffPercent,
    targetRate,
    isGoodTime: rate <= targetRate,
    lastAlertedDate: typeof lastAlertedDate === 'function' ? lastAlertedDate(date) : lastAlertedDate,
    series,
  };
}

const daysAgo = (n) => new Date(Date.now() - n * DAY_MS).toISOString();
const fixtures = {};

// Good time to buy, alert really sent
{
  const series = real.series.map((p) => [...p]);
  const avg = rollingAverage(series, real.windowDays).at(-1);
  series.at(-1)[1] = Math.round(avg * 0.975 * 1000) / 1000;
  fixtures.good = build(series, { ...real, updatedAt: daysAgo(0), lastAlertedDate: (d) => d });
}

// Worst case: a sudden −7% shock, data 9 days stale (the check stopped), alert never sent
// (Telegram secrets missing), user edited config to a 2.5% threshold over 60 days, page loaded 3 days later.
{
  const series = real.series.filter(([d]) => Date.parse(d) <= Date.now() - 9 * DAY_MS).map((p) => [...p]);
  const avg = rollingAverage(series, 60).at(-1);
  series.at(-1)[1] = Math.round(avg * 0.93 * 1000) / 1000;
  fixtures.worst = build(series, { thresholdPercent: 2.5, windowDays: 60, updatedAt: daysAgo(3), lastAlertedDate: null });
}

// Edge: rate exactly on the average and unchanged from the previous day, half-percent threshold
{
  const series = real.series.map((p) => [...p]);
  const avg = rollingAverage(series, real.windowDays).at(-1);
  const flat = Math.round(avg * 1000) / 1000;
  series.at(-1)[1] = flat;
  series.at(-2)[1] = flat;
  fixtures.edge = build(series, { thresholdPercent: 0.5, windowDays: real.windowDays, updatedAt: daysAgo(0), lastAlertedDate: null });
}

// Malformed: a half-written file, e.g. an older app version reading newer data. Must show the error card.
fixtures.malformed = { ...real, latest: undefined, series: [] };

await mkdir(OUT, { recursive: true });
for (const [name, data] of Object.entries(fixtures)) {
  await writeFile(new URL(`${name}.json`, OUT), JSON.stringify(data, null, 1) + '\n');
  console.log(data.latest ? `${name}: ${data.latest.date} ${data.latest.rate} diff ${data.diffPercent.toFixed(2)}%` : name);
}
