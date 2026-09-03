import {
  BRIEFING_HOUR,
  CLINIC_TIMEZONE,
  dayWindow,
  isQuiet,
  orderRisks,
  parseNarrative,
  renderFacts,
  type BriefingFacts,
  type RiskItem,
} from './briefing';
import { SYSTEM_PROMPT, buildUserPrompt } from './briefing.prompt';

const risk = (
  kind: RiskItem['kind'],
  waitingMinutes: number,
  patientId = 'p1',
): RiskItem => ({
  patientId,
  patientName: 'Ayşe Yılmaz',
  kind,
  detail: 'bekliyor',
  waitingMinutes,
});

const facts = (overrides: Partial<BriefingFacts> = {}): BriefingFacts => ({
  generatedAt: new Date('2026-03-04T05:00:00.000Z'),
  window: dayWindow(new Date('2026-03-04T05:00:00.000Z')),
  yesterday: {
    newMessages: 0,
    urgentMessages: 0,
    emergencies: 0,
    complications: 0,
    criticalLabs: 0,
  },
  today: { appointments: 0, followUps: 0 },
  atRisk: [],
  ...overrides,
});

const localHour = (at: Date): number =>
  Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: CLINIC_TIMEZONE,
      hour: '2-digit',
      hour12: false,
    }).format(at),
  );

const localDay = (at: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TIMEZONE }).format(at);

/**
 * The morning briefing.
 *
 * Everything here is arithmetic on days and ordering, which is exactly where a
 * briefing goes quietly wrong: an event filed under the wrong morning is an
 * event nobody reads, and a list ordered by the wrong key buries the thing the
 * doctor opened it for.
 */
describe("yesterday and today, as the clinic experiences them", () => {
  it('starts both days at local midnight', () => {
    const window = dayWindow(new Date('2026-03-04T11:00:00.000Z'));

    expect(localHour(window.todayStart)).toBe(0);
    expect(localHour(window.yesterdayStart)).toBe(0);
    expect(localHour(window.todayEnd)).toBe(0);
  });

  it('puts yesterday, today and tomorrow on consecutive dates', () => {
    const window = dayWindow(new Date('2026-03-04T11:00:00.000Z'));

    expect(localDay(window.yesterdayStart)).toBe('2026-03-03');
    expect(localDay(window.todayStart)).toBe('2026-03-04');
    expect(localDay(window.todayEnd)).toBe('2026-03-05');
  });

  /**
   * Istanbul is three hours ahead of UTC, so a UTC day boundary would file the
   * last three hours of every clinic evening under the following morning.
   */
  it('keeps a late clinic evening in the day it happened', () => {
    // 22:30 local on the 4th is 19:30 UTC — the same day either way. 00:30
    // local on the 5th is 21:30 UTC on the 4th, and that is the case that
    // breaks a UTC window.
    const window = dayWindow(new Date('2026-03-04T22:00:00.000Z'));

    expect(localDay(window.todayStart)).toBe('2026-03-05');
    expect(new Date('2026-03-04T21:30:00.000Z') >= window.todayStart).toBe(true);
  });

  /**
   * A briefing read at eight would otherwise cover from eight the previous
   * morning: an emergency at seven today would be filed under yesterday, and
   * one at seven yesterday would vanish.
   */
  it('does not slide with the clock', () => {
    const early = dayWindow(new Date('2026-03-04T04:00:00.000Z'));
    const late = dayWindow(new Date('2026-03-04T20:00:00.000Z'));

    expect(early.todayStart.getTime()).toBe(late.todayStart.getTime());
    expect(early.yesterdayStart.getTime()).toBe(late.yesterdayStart.getTime());
  });

  it('survives the spring clock change', () => {
    // Turkey no longer changes its clocks, so this is checked in a zone that
    // does — the arithmetic is shared, and a fixed offset would fail here.
    const window = dayWindow(new Date('2026-03-29T12:00:00.000Z'), 'Europe/Berlin');
    const berlinDay = (at: Date): string =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(at);

    expect(berlinDay(window.yesterdayStart)).toBe('2026-03-28');
    expect(berlinDay(window.todayStart)).toBe('2026-03-29');
    expect(berlinDay(window.todayEnd)).toBe('2026-03-30');
  });

  it('announces the briefing in the morning', () => {
    expect(BRIEFING_HOUR).toBe(8);
  });
});

describe('what the doctor reads first', () => {
  /**
   * Ordered only by age, a three-day-old unreviewed report sits above an
   * emergency raised twenty minutes ago — and the doctor reads from the top.
   */
  it('puts an unanswered emergency above everything older', () => {
    const ordered = orderRisks([
      risk('report-unreviewed', 4_320),
      risk('follow-up-missed', 2_880),
      risk('emergency-unanswered', 20),
    ]);

    expect(ordered.map((item) => item.kind)).toEqual([
      'emergency-unanswered',
      'follow-up-missed',
      'report-unreviewed',
    ]);
  });

  it('orders within a kind by how long it has waited', () => {
    const ordered = orderRisks([
      risk('message-urgent', 30, 'a'),
      risk('message-urgent', 300, 'b'),
      risk('message-urgent', 120, 'c'),
    ]);

    expect(ordered.map((item) => item.patientId)).toEqual(['b', 'c', 'a']);
  });

  it('leaves an empty list alone', () => {
    expect(orderRisks([])).toEqual([]);
  });
});

describe('a quiet morning', () => {
  it('is quiet when nothing happened and nothing is waiting', () => {
    expect(isQuiet(facts())).toBe(true);
  });

  it('is not quiet when somebody is waiting', () => {
    expect(isQuiet(facts({ atRisk: [risk('message-urgent', 60)] }))).toBe(false);
  });

  it('is not quiet when there is anything on today', () => {
    expect(isQuiet(facts({ today: { appointments: 1, followUps: 0 } }))).toBe(false);
    expect(isQuiet(facts({ today: { appointments: 0, followUps: 2 } }))).toBe(false);
  });

  it('is not quiet when yesterday had anything in it', () => {
    expect(
      isQuiet(
        facts({
          yesterday: {
            newMessages: 3,
            urgentMessages: 0,
            emergencies: 0,
            complications: 0,
            criticalLabs: 0,
          },
        }),
      ),
    ).toBe(false);
  });
});

/**
 * The model gets counts and nothing else. The list of who is waiting is
 * rendered by the client from the structured data, where it does not have to
 * travel anywhere.
 */
describe('what the model is given', () => {
  it('carries the counts', () => {
    const rendered = renderFacts(
      facts({
        yesterday: {
          newMessages: 7,
          urgentMessages: 2,
          emergencies: 1,
          complications: 0,
          criticalLabs: 3,
        },
        today: { appointments: 5, followUps: 2 },
      }),
    );

    expect(rendered).toContain('Yeni hasta mesajı: 7');
    expect(rendered).toContain('Acil durum çağrısı: 1');
    expect(rendered).toContain('Randevu: 5');
  });

  it('carries no patient name, because it is not given one', () => {
    const rendered = renderFacts(facts({ atRisk: [risk('emergency-unanswered', 40)] }));

    expect(rendered).not.toContain('Ayşe');
    expect(rendered).not.toContain('p1');
    expect(rendered).toContain('emergency-unanswered: 1');
  });

  it('says plainly when nothing is waiting', () => {
    expect(renderFacts(facts())).toContain('- yok');
  });

  it('counts the waiting by kind rather than listing them', () => {
    const rendered = renderFacts(
      facts({
        atRisk: [
          risk('message-urgent', 100, 'a'),
          risk('message-urgent', 200, 'b'),
          risk('follow-up-missed', 5_000, 'c'),
        ],
      }),
    );

    expect(rendered).toContain('message-urgent: 2');
    expect(rendered).toContain('follow-up-missed: 1');
  });

  it('puts the numbers in the user prompt', () => {
    expect(buildUserPrompt('Dün:\n- Yeni hasta mesajı: 7')).toContain('Yeni hasta mesajı: 7');
  });
});

describe('reading the narrative back', () => {
  it('reads a paragraph', () => {
    expect(parseNarrative('{"narrative":"Sakin bir sabah."}')).toBe('Sakin bir sabah.');
  });

  it('digs it out of a code fence', () => {
    expect(parseNarrative('```json\n{"narrative":"İki mesaj bekliyor."}\n```')).toBe(
      'İki mesaj bekliyor.',
    );
  });

  /**
   * Nothing is lost when this returns null: the facts are already on the
   * screen, and the paragraph was only ever a convenience.
   */
  it('returns nothing rather than a guess', () => {
    for (const raw of ['', 'Bilmiyorum', '{}', '{"narrative":""}', '{"narrative":123}']) {
      expect(parseNarrative(raw)).toBeNull();
    }
  });

  it('handles a brace inside the paragraph', () => {
    expect(parseNarrative('{"narrative":"Şöyle dedi: \\"} bitti\\""}')).toContain('bitti');
  });
});

describe('the briefing system prompt', () => {
  /** The four red lines are asserted for every prompt in src/ai/red-lines.spec.ts. */
  it('forbids the model adding anything to the numbers', () => {
    expect(SYSTEM_PROMPT).toContain('Yalnızca verilen sayıları');
  });

  it('tells the model it has no patient names to write', () => {
    expect(SYSTEM_PROMPT).toContain('Hasta adı');
  });

  it('asks for a short paragraph rather than a report', () => {
    expect(SYSTEM_PROMPT).toContain('En fazla dört cümle');
  });
});
