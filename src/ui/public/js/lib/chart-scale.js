// Axis and coordinate math for the metrics charts. No DOM access.

/** The smallest of 1, 2, 5 x 10^n that is >= value, so axis labels are round numbers. */
export function niceMax(value) {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    const candidate = Number((step * magnitude).toPrecision(12));
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

/** `count + 1` evenly spaced tick values from 0 to max. */
export function ticks(max, count = 4) {
  return Array.from({ length: count + 1 }, (_, i) => Number(((max * i) / count).toPrecision(12)));
}

/** Pixel coordinates for a series: x spreads over the width, y = 0 at the bottom. */
export function scaleSeries(values, { width, height, max }) {
  const last = values.length - 1;
  return values.map((value, i) => ({
    x: last === 0 ? width / 2 : (width * i) / last,
    y: height - (height * value) / max,
    value,
  }));
}
