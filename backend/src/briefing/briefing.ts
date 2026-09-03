import { instantAt, localDate } from '../common/local-calendar';

/**
 * The morning briefing (spec M5): what happened yesterday, what is on today,
 * who is at risk.
 *
 * **The briefing is data, not prose.** Every number here comes from a query,
 * and the model — when there is one — is given those numbers and allowed to
 * write a paragraph about them and nothing else. A generated sentence saying
 * three patients need attention when the query found five is worse than no
 * briefing at all: it is a briefing that is wrong in the direction of calm.
 *
 * So the doctor always gets the facts. The narrative is a convenience laid on
 * top of them, and the screen shows both.
 */

/** The clinic's day, matching every other schedule in the system. */
export const CLINIC_TIMEZONE = 'Europe/Istanbul';

/** When the morning notification goes out, in clinic local time. */
export const BRIEFING_HOUR = 8;

export interface DayWindow {
  /** Local midnight at the start of yesterday. */
  yesterdayStart: Date;
  /** Local midnight this morning — the end of yesterday and start of today. */
  todayStart: Date;
  /** Local midnight tomorrow. */
  todayEnd: Date;
}

/**
 * Yesterday and today as the clinic experiences them.
 *
 * Not `now - 24h`: a briefing read at 08:00 would then cover from 08:00 the
 * previous morning, so an emergency at 07:00 today would be filed under
 * yesterday and one at 07:00 yesterday would vanish. And not UTC days either —
 * Istanbul is three hours ahead, so a UTC day boundary puts the last three
 * hours of every clinic evening into the wrong briefing.
 */
export function dayWindow(now: Date, timezone: string = CLINIC_TIMEZONE): DayWindow {
  const today = localDate(now, timezone);
  const todayStart = instantAt(today, 0, timezone);

  // Stepped back through the instant rather than by arithmetic on the date, so
  // a daylight-saving change makes yesterday 23 or 25 hours long rather than
  // moving the boundary.
  const yesterdayStart = instantAt(
    localDate(new Date(todayStart.getTime() - 12 * 60 * 60 * 1000), timezone),
    0,
    timezone,
  );

  const todayEnd = instantAt(
    localDate(new Date(todayStart.getTime() + 36 * 60 * 60 * 1000), timezone),
    0,
    timezone,
  );

  return { yesterdayStart, todayStart, todayEnd };
}

/** One line of the briefing that names a patient a clinician should look at. */
export interface RiskItem {
  patientId: string;
  patientName: string;
  /** Stable id for the kind of risk, so a client can pick an icon or a screen. */
  kind:
    | 'emergency-unanswered'
    | 'message-urgent'
    | 'complication-overdue'
    | 'follow-up-missed'
    | 'report-unreviewed';
  /** Human-readable detail; never the patient's own words. */
  detail: string;
  /** How long it has been waiting, in minutes. Drives the ordering. */
  waitingMinutes: number;
}

export interface BriefingFacts {
  generatedAt: Date;
  window: DayWindow;

  yesterday: {
    newMessages: number;
    urgentMessages: number;
    emergencies: number;
    complications: number;
    criticalLabs: number;
  };

  today: {
    appointments: number;
    followUps: number;
  };

  /** Ordered: longest waiting first, emergencies before everything else. */
  atRisk: RiskItem[];
}

/**
 * Emergencies first, then by how long the thing has been waiting.
 *
 * A list ordered only by age puts a three-day-old unreviewed report above an
 * emergency raised twenty minutes ago, and the doctor reads from the top.
 */
const KIND_ORDER: Record<RiskItem['kind'], number> = {
  'emergency-unanswered': 0,
  'message-urgent': 1,
  'complication-overdue': 2,
  'follow-up-missed': 3,
  'report-unreviewed': 4,
};

export function orderRisks(items: RiskItem[]): RiskItem[] {
  return [...items].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.waitingMinutes - a.waitingMinutes,
  );
}

/** Whether anything happened at all — a quiet morning is worth saying plainly. */
export function isQuiet(facts: BriefingFacts): boolean {
  const { yesterday, today, atRisk } = facts;

  return (
    atRisk.length === 0 &&
    today.appointments === 0 &&
    today.followUps === 0 &&
    yesterday.newMessages === 0 &&
    yesterday.emergencies === 0 &&
    yesterday.complications === 0 &&
    yesterday.criticalLabs === 0
  );
}

/**
 * The facts as the model sees them.
 *
 * Names are not in it. The narrative is a paragraph about counts and kinds; the
 * list of who is at risk is rendered by the client from the structured data,
 * where it does not have to travel anywhere.
 */
export function renderFacts(facts: BriefingFacts): string {
  const risksByKind = new Map<string, number>();

  for (const item of facts.atRisk) {
    risksByKind.set(item.kind, (risksByKind.get(item.kind) ?? 0) + 1);
  }

  return [
    'Dün:',
    `- Yeni hasta mesajı: ${facts.yesterday.newMessages}`,
    `- Bunlardan acil sınıflandırılan: ${facts.yesterday.urgentMessages}`,
    `- Acil durum çağrısı: ${facts.yesterday.emergencies}`,
    `- Komplikasyon bildirimi: ${facts.yesterday.complications}`,
    `- Kritik tahlil değeri: ${facts.yesterday.criticalLabs}`,
    '',
    'Bugün:',
    `- Randevu: ${facts.today.appointments}`,
    `- Kontrol kilometre taşı: ${facts.today.followUps}`,
    '',
    'Bekleyenler:',
    ...(facts.atRisk.length === 0
      ? ['- yok']
      : [...risksByKind.entries()].map(([kind, count]) => `- ${kind}: ${count}`)),
  ].join('\n');
}

/**
 * Reads the model's paragraph back, and returns nothing rather than a guess.
 *
 * Nothing is lost when this returns null: the facts are already on the screen,
 * and the narrative was only ever a convenience.
 */
export function parseNarrative(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let json: string | null = null;

  for (let index = start; index < raw.length; index += 1) {
    const character = raw[index]!;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === '\\') {
      escaped = true;
      continue;
    }

    if (character === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        json = raw.slice(start, index + 1);
        break;
      }
    }
  }

  if (json === null) return null;

  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const narrative = typeof parsed.narrative === 'string' ? parsed.narrative.trim() : '';

    return narrative.length > 0 ? narrative.slice(0, 2_000) : null;
  } catch {
    return null;
  }
}
