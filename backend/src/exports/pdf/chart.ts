/**
 * Line charts for the patient summary (spec M12: ölçüm grafikleri).
 *
 * Drawn as vectors rather than rendered through a browser: a chart of a dozen
 * weight readings does not justify a headless Chrome in the worker, and the
 * geometry is worth being able to test.
 *
 * The cases that matter are the degenerate ones. A patient with one reading, or
 * with three identical readings, is normal — and both of them divide by zero in
 * the obvious implementation.
 */

export interface Point {
  at: Date;
  value: number;
}

export interface Scale {
  min: number;
  max: number;
  /** Labelled gridlines, low to high. */
  ticks: number[];
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Minimum span, so a flat series is not drawn on a zero-height axis. */
const MIN_SPAN = 1e-6;

/**
 * The vertical scale for a series.
 *
 * A flat series gets a padded range rather than a zero one: three identical
 * weights are a real and common reading, and dividing by their range would put
 * every point at NaN and draw nothing at all.
 */
export function scaleFor(values: number[], tickCount = 4): Scale {
  const finite = values.filter((value) => Number.isFinite(value));

  if (finite.length === 0) return { min: 0, max: 1, ticks: [0, 1] };

  const low = Math.min(...finite);
  const high = Math.max(...finite);

  if (high - low < MIN_SPAN) {
    // Centre the flat line, with a band around it proportional to the value so
    // it works for a weight of 80 and a temperature of 36.6 alike.
    const padding = Math.max(Math.abs(low) * 0.05, 0.5);

    return {
      min: low - padding,
      max: low + padding,
      ticks: [round(low - padding), round(low), round(low + padding)],
    };
  }

  const step = niceStep((high - low) / tickCount);
  const min = Math.floor(low / step) * step;
  const max = Math.ceil(high / step) * step;

  const ticks: number[] = [];
  for (let value = min; value <= max + step / 2; value += step) {
    ticks.push(round(value));
  }

  return { min: round(min), max: round(max), ticks };
}

/** 1, 2, 5, 10, 20, 50 … — the steps a person would have chosen. */
export function niceStep(rough: number): number {
  if (!Number.isFinite(rough) || rough <= 0) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;

  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;

  return step * magnitude;
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Where each point sits inside the plot area.
 *
 * A single point is placed in the middle horizontally rather than at the left
 * edge, where it would read as the start of a trend that is not there.
 */
export function project(points: Point[], scale: Scale, box: Box): { x: number; y: number }[] {
  if (points.length === 0) return [];

  const sorted = [...points].sort((a, b) => a.at.getTime() - b.at.getTime());

  if (sorted.length === 1) {
    return [{ x: box.x + box.width / 2, y: yOf(sorted[0]!.value, scale, box) }];
  }

  const first = sorted[0]!.at.getTime();
  const last = sorted[sorted.length - 1]!.at.getTime();

  // Readings taken in the same second would otherwise divide by zero.
  const span = Math.max(last - first, 1);

  return sorted.map((point) => ({
    x: box.x + ((point.at.getTime() - first) / span) * box.width,
    y: yOf(point.value, scale, box),
  }));
}

function yOf(value: number, scale: Scale, box: Box): number {
  const span = Math.max(scale.max - scale.min, MIN_SPAN);
  const fraction = (value - scale.min) / span;

  // A value outside the scale is clamped to the plot rather than drawn over the
  // text above it. PDF y grows downwards, so the top of the box is the high end.
  const clamped = Math.min(Math.max(fraction, 0), 1);

  return box.y + box.height - clamped * box.height;
}
