/**
 * Follow-up schedules per procedure (spec M6).
 *
 * The spec names D1, W1, M1, M2, M3, M6 and Y1 as the default set and says the
 * template varies by operation. It does: a hair transplant is watched closely
 * in the first fortnight and barely after three months, where a rhinoplasty's
 * result is not final until the first year.
 *
 * Encoded as offsets rather than dates so a postponed operation regenerates
 * correctly — see FollowUpService.
 */

export interface MilestoneSpec {
  /** Shown to the patient and matched to a photo phase label. */
  label: string;
  days?: number;
  months?: number;
}

export const DEFAULT_TEMPLATE = 'default';

const DEFAULT_MILESTONES: MilestoneSpec[] = [
  { label: 'D1', days: 1 },
  { label: 'W1', days: 7 },
  { label: 'M1', months: 1 },
  { label: 'M2', months: 2 },
  { label: 'M3', months: 3 },
  { label: 'M6', months: 6 },
  { label: 'Y1', months: 12 },
];

const TEMPLATES: Record<string, MilestoneSpec[]> = {
  [DEFAULT_TEMPLATE]: DEFAULT_MILESTONES,

  // Watched closely while the grafts take, and little afterwards until the
  // result is judged at a year.
  hairTransplant: [
    { label: 'D1', days: 1 },
    { label: 'D3', days: 3 },
    { label: 'W1', days: 7 },
    { label: 'W2', days: 14 },
    { label: 'M1', months: 1 },
    { label: 'M3', months: 3 },
    { label: 'M6', months: 6 },
    { label: 'Y1', months: 12 },
  ],

  // Swelling settles over months and the result is not final until the year.
  rhinoplasty: [
    { label: 'D1', days: 1 },
    { label: 'W1', days: 7 },
    { label: 'M1', months: 1 },
    { label: 'M3', months: 3 },
    { label: 'M6', months: 6 },
    { label: 'Y1', months: 12 },
  ],

  // The early weeks carry the surgical risk; the later checks are about weight.
  bariatric: [
    { label: 'D1', days: 1 },
    { label: 'W1', days: 7 },
    { label: 'W2', days: 14 },
    { label: 'M1', months: 1 },
    { label: 'M2', months: 2 },
    { label: 'M3', months: 3 },
    { label: 'M6', months: 6 },
    { label: 'Y1', months: 12 },
  ],
};

export function templateFor(name: string | null | undefined): MilestoneSpec[] {
  // An unknown template falls back to the default set rather than producing no
  // schedule at all: a patient with no follow-up dates is one nobody calls.
  return TEMPLATES[name ?? DEFAULT_TEMPLATE] ?? DEFAULT_MILESTONES;
}

export function templateNames(): string[] {
  return Object.keys(TEMPLATES);
}
