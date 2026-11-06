// Alert rules shared by the daily check (scripts/check.mjs), the app (index.html) and the test fixtures.
export const DAY_MS = 86_400_000;
export const MIN_OBSERVATIONS = 10;

// Average of the observations in the `days` calendar days before each date (the date itself excluded).
export function rollingAverage(points, days) {
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

// 0 = above the early-warning price, 1 = within it, 2 = at or below the target
export function priceLevel(rate, { targetRate, approachMargin }) {
  return rate <= targetRate ? 2 : rate <= targetRate + approachMargin + 1e-9 ? 1 : 0;
}

export function summarize(series, config) {
  const { targetRate, approachMargin, thresholdPercent, windowDays } = config;
  const last = series.length - 1;
  const average = rollingAverage(series, windowDays)[last];
  const latest = { date: series[last][0], rate: series[last][1] };
  const averageTargetRate = average * (1 - thresholdPercent / 100);
  return {
    targetRate,
    approachMargin,
    approachRate: Math.round((targetRate + approachMargin) * 1000) / 1000,
    thresholdPercent,
    windowDays,
    latest,
    previous: { date: series[last - 1][0], rate: series[last - 1][1] },
    average,
    diffPercent: ((latest.rate - average) / average) * 100,
    averageTargetRate,
    belowAverage: latest.rate <= averageTargetRate,
    priceLevel: priceLevel(latest.rate, config),
  };
}

// Which alerts are due, given what was already sent. Climbing back above a level re-arms its alert.
export function dueAlerts(summary, prior) {
  const alertedLevel = Math.min(prior.alertedLevel ?? 0, summary.priceLevel);
  const reasons = [];
  if (summary.priceLevel > alertedLevel) reasons.push(summary.priceLevel === 2 ? 'target' : 'approach');
  if (summary.belowAverage && summary.latest.date !== prior.lastAlertedDate) reasons.push('average');
  return { reasons, alertedLevel };
}
