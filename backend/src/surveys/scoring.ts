import { SurveyAnswerType } from '@prisma/client';
import type { Answers, SurveyQuestion } from './survey';

/**
 * Scoring a questionnaire and deciding whether a patient is getting worse
 * (spec M18).
 *
 * Two things here are easy to get wrong in a way nobody notices.
 *
 * **Direction.** Pain going up is worsening; satisfaction going up is not.
 * Reading both the same way inverts every alert this module produces — the
 * patients in trouble go quiet and the comfortable ones get chased.
 *
 * **What counts as a trend.** Self-reported numbers are noisy: a patient who
 * says 4 one week and 6 the next has not necessarily deteriorated, they may
 * have had a bad morning. An alert on every wobble is an alert that gets
 * turned off, and then the real one is missed too. So a change has to be large
 * enough to mean something, and it is always measured against **this patient's
 * own previous answer** rather than a population curve this software does not
 * have.
 */

export interface Scored {
  /** Question id to the numeric answer, for the trend series. */
  values: Record<string, number>;
  answeredCount: number;
  questionCount: number;
  /** Answered over asked. A reader must see which they are looking at. */
  completeness: number;
}

/**
 * How much of a questionnaire has to be answered before its numbers are put on
 * a chart next to a full one.
 *
 * Not a clinical constant — a threshold this module chose so that a mostly
 * blank form is visibly different from a complete one. Below it the answers are
 * still stored and still shown; they are marked as partial.
 */
export const MIN_COMPLETENESS = 0.5;

export function score(questions: SurveyQuestion[], answers: Answers): Scored {
  const values: Record<string, number> = {};

  for (const question of questions) {
    const answer = answers[question.id];
    if (answer === undefined) continue;

    if (question.type === SurveyAnswerType.SCALE_0_10 && typeof answer === 'number') {
      values[question.id] = answer;
    }

    if (question.type === SurveyAnswerType.YES_NO && typeof answer === 'boolean') {
      values[question.id] = answer ? 1 : 0;
    }
  }

  const answeredCount = Object.keys(answers).length;

  return {
    values,
    answeredCount,
    questionCount: questions.length,
    completeness: questions.length === 0 ? 0 : answeredCount / questions.length,
  };
}

export function isPartial(scored: Scored): boolean {
  return scored.completeness < MIN_COMPLETENESS;
}

/**
 * How much a directional answer has to move before it is called a change.
 *
 * Three points on a nought-to-ten scale. Two would fire on ordinary
 * day-to-day variation in how somebody rates their own pain; four would miss a
 * real slide from three to six.
 */
export const WORSENING_DELTA = 3;

export type FindingKind = 'worsened' | 'severe';

export interface Finding {
  kind: FindingKind;
  questionId: string;
  questionText: string;
  value: number;
  /** The same question's answer last time. Absent for a `severe` finding. */
  previous?: number;
}

export interface TrendResult {
  findings: Finding[];
  /**
   * False when there is nothing to compare against.
   *
   * The first questionnaire after an operation has no predecessor, so it can
   * produce a `severe` finding but never a `worsened` one — and a screen must
   * not draw a trend line through a single point.
   */
  hasBaseline: boolean;
}

/**
 * Compares the newest answers with the previous ones.
 *
 * Deliberately not a curve fit or a moving average over the whole series: with
 * four or five points, a fitted trend is mostly an artefact of the fit. The
 * question a clinician actually asks — "is this worse than last time, and is
 * it bad enough to look at now" — is answered directly.
 *
 * @param previous the last set of numeric answers, or null for a first response.
 */
export function compare(
  questions: SurveyQuestion[],
  latest: Record<string, number>,
  previous: Record<string, number> | null,
): TrendResult {
  const findings: Finding[] = [];

  for (const question of questions) {
    const value = latest[question.id];
    if (value === undefined) continue;

    // An absolute threshold stands on its own: pain at nine is worth seeing
    // whether or not it is worse than last week's nine.
    if (question.alarmAt !== undefined && crossesAlarm(question, value)) {
      findings.push({
        kind: 'severe',
        questionId: question.id,
        questionText: question.text,
        value,
      });
    }

    if (question.direction === undefined || previous === null) continue;

    const before = previous[question.id];
    if (before === undefined) continue;

    const change =
      question.direction === 'higher-is-worse' ? value - before : before - value;

    if (change >= WORSENING_DELTA) {
      findings.push({
        kind: 'worsened',
        questionId: question.id,
        questionText: question.text,
        value,
        previous: before,
      });
    }
  }

  return { findings, hasBaseline: previous !== null };
}

function crossesAlarm(question: SurveyQuestion, value: number): boolean {
  if (question.alarmAt === undefined) return false;

  // Which side of the threshold is alarming follows the question's direction,
  // for the same reason the comparison does.
  return question.direction === 'higher-is-better'
    ? value <= question.alarmAt
    : value >= question.alarmAt;
}

/**
 * Whether a satisfaction answer is high enough to invite a public review
 * (spec M18).
 *
 * Nine and ten, the conventional cut for a promoter. The invitation is
 * optional and one-way: a low rating never triggers anything aimed at the
 * patient, because turning a complaint into an automated message is how a
 * clinic makes an unhappy patient angry.
 */
export const REVIEW_INVITE_FROM = 9;

export function invitesReview(satisfaction: number | undefined): boolean {
  return satisfaction !== undefined && satisfaction >= REVIEW_INVITE_FROM;
}
