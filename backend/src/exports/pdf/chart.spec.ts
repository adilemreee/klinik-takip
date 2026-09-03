import { niceStep, project, scaleFor, type Box } from './chart';

/**
 * Chart geometry for the patient summary (spec M12, T6.5).
 *
 * The interesting cases are the degenerate ones, because they are not rare: a
 * patient with one reading, or three identical ones, is completely normal — and
 * both divide by zero in the obvious implementation.
 */
describe('chart geometry', () => {
  const box: Box = { x: 100, y: 200, width: 400, height: 80 };
  const at = (day: number): Date => new Date(Date.UTC(2026, 2, day));

  describe('the vertical scale', () => {
    it('spans the data with round numbers', () => {
      const scale = scaleFor([82.4, 79.1, 85.6]);

      expect(scale.min).toBeLessThanOrEqual(79.1);
      expect(scale.max).toBeGreaterThanOrEqual(85.6);
      expect(scale.ticks.length).toBeGreaterThan(1);
    });

    it('gives a flat series a range rather than a zero one', () => {
      // Three identical weights is a real reading. A zero range puts every
      // point at NaN and draws nothing at all.
      const scale = scaleFor([80, 80, 80]);

      expect(scale.max).toBeGreaterThan(scale.min);
      expect(scale.min).toBeLessThan(80);
      expect(scale.max).toBeGreaterThan(80);
    });

    it('pads a flat series proportionally, so it works for a temperature too', () => {
      const weight = scaleFor([80]);
      const temperature = scaleFor([36.6]);

      expect(weight.max - weight.min).toBeGreaterThan(temperature.max - temperature.min);
      expect(temperature.max).toBeGreaterThan(36.6);
    });

    it('has something to draw even with no data', () => {
      const scale = scaleFor([]);

      expect(scale.max).toBeGreaterThan(scale.min);
      expect(Number.isFinite(scale.min)).toBe(true);
    });

    it('ignores values that are not numbers', () => {
      const scale = scaleFor([80, Number.NaN, 90, Number.POSITIVE_INFINITY]);

      expect(Number.isFinite(scale.min)).toBe(true);
      expect(Number.isFinite(scale.max)).toBe(true);
    });
  });

  describe('tick steps', () => {
    it('picks the steps a person would have', () => {
      expect(niceStep(0.9)).toBe(1);
      expect(niceStep(1.4)).toBe(2);
      expect(niceStep(3)).toBe(5);
      expect(niceStep(7)).toBe(10);
      expect(niceStep(23)).toBe(50);
    });

    it('never returns zero, whatever it is handed', () => {
      // A zero step is an infinite loop building the tick list.
      expect(niceStep(0)).toBeGreaterThan(0);
      expect(niceStep(-5)).toBeGreaterThan(0);
      expect(niceStep(Number.NaN)).toBeGreaterThan(0);
    });
  });

  describe('projection', () => {
    it('puts a single reading in the middle, not at the edge', () => {
      // At the left edge it reads as the beginning of a trend that is not there.
      const points = project([{ at: at(1), value: 80 }], scaleFor([80]), box);

      expect(points).toHaveLength(1);
      expect(points[0]!.x).toBe(box.x + box.width / 2);
    });

    it('spreads readings across the box by their date', () => {
      const points = project(
        [
          { at: at(1), value: 80 },
          { at: at(11), value: 82 },
          { at: at(21), value: 84 },
        ],
        scaleFor([80, 82, 84]),
        box,
      );

      expect(points[0]!.x).toBe(box.x);
      expect(points[2]!.x).toBe(box.x + box.width);
      expect(points[1]!.x).toBeCloseTo(box.x + box.width / 2, 5);
    });

    it('sorts by date, because readings are entered out of order', () => {
      const points = project(
        [
          { at: at(21), value: 84 },
          { at: at(1), value: 80 },
        ],
        scaleFor([80, 84]),
        box,
      );

      // The earliest reading is on the left however it arrived.
      expect(points[0]!.x).toBe(box.x);
      expect(points[0]!.y).toBeGreaterThan(points[1]!.y);
    });

    it('survives two readings at the same instant', () => {
      const points = project(
        [
          { at: at(1), value: 80 },
          { at: at(1), value: 84 },
        ],
        scaleFor([80, 84]),
        box,
      );

      expect(points.every((point) => Number.isFinite(point.x))).toBe(true);
    });

    it('draws a higher value higher up the page', () => {
      const scale = scaleFor([70, 90]);
      const points = project(
        [
          { at: at(1), value: 70 },
          { at: at(2), value: 90 },
        ],
        scale,
        box,
      );

      // PDF y grows downwards, so the larger value has the smaller y.
      expect(points[1]!.y).toBeLessThan(points[0]!.y);
    });

    it('keeps a point outside the scale inside the plot', () => {
      // Otherwise it is drawn over the text above the chart.
      const points = project([{ at: at(1), value: 1000 }], { min: 0, max: 100, ticks: [] }, box);

      expect(points[0]!.y).toBeGreaterThanOrEqual(box.y);
      expect(points[0]!.y).toBeLessThanOrEqual(box.y + box.height);
    });

    it('has nothing to draw for no readings', () => {
      expect(project([], scaleFor([]), box)).toEqual([]);
    });
  });
});
