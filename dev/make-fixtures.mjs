// Builds stress-test datasets from the real data/rates.json, for the dev-only data toggle.
//   node dev/make-fixtures.mjs   then open http://localhost:5173/?data=worst
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { DAY_MS, summarize } from '../scripts/rules.mjs';

const ROOT = new URL('../', import.meta.url);
const OUT = new URL('dev/fixtures/', ROOT);
const real = JSON.parse(await readFile(new URL('data/rates.json', ROOT), 'utf8'));
const config = JSON.parse(await readFile(new URL('config.json', ROOT), 'utf8'));

const daysAgo = (n) => new Date(Date.now() - n * DAY_MS).toISOString();
const copy = () => real.series.map((p) => [...p]);

// Shaped exactly like check.mjs output: summary fields plus alert bookkeeping
function build(series, { cfg = config, ...extra } = {}) {
  return {
    updatedAt: daysAgo(0),
    source: real.source,
    ...summarize(series, cfg),
    alertedLevel: 0,
    lastAlertedDate: null,
    alertMissed: false,
    series,
    ...extra,
  };
}

const fixtures = {};

// Reached the target, alert sent
{
  const series = copy();
  series.at(-1)[1] = 3.011;
  fixtures.target = build(series, { alertedLevel: 2 });
}

// Within the early-warning band, alert sent
{
  const series = copy();
  series.at(-1)[1] = 3.055;
  fixtures.near = build(series, { alertedLevel: 1 });
}

// Worst case: a sudden crash far below the meter's range, data 9 days stale (the check stopped),
// alert never sent (Telegram secrets missing), user edited config to 2.5% over 60 days, page loaded 3 days later.
{
  const series = real.series.filter(([d]) => Date.parse(d) <= Date.now() - 9 * DAY_MS).map((p) => [...p]);
  series.at(-1)[1] = 2.841;
  fixtures.worst = build(series, {
    cfg: { ...config, thresholdPercent: 2.5, windowDays: 60 },
    updatedAt: daysAgo(3),
    alertMissed: true,
  });
}

// Edge: exactly on the target and unchanged from the previous day
{
  const series = copy();
  series.at(-1)[1] = config.targetRate;
  series.at(-2)[1] = config.targetRate;
  fixtures.edge = build(series, { alertedLevel: 2 });
}

// Malformed: a half-written file, e.g. an older app version reading newer data. Must show the error card.
fixtures.malformed = { ...real, latest: undefined, series: [] };

await mkdir(OUT, { recursive: true });
for (const [name, data] of Object.entries(fixtures)) {
  await writeFile(new URL(`${name}.json`, OUT), JSON.stringify(data, null, 1) + '\n');
  console.log(data.latest ? `${name}: ${data.latest.date} ${data.latest.rate} level ${data.priceLevel}` : name);
}
