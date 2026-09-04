import { SurveyAnswerType } from '@prisma/client';

/**
 * What a questionnaire is, and what counts as an answer to it (spec M18).
 *
 * Kept apart from the database so the shape can be checked without one, and so
 * the rule that matters most here is in a single readable place: **an answer
 * that does not fit its question is refused, not stored.** A 0-10 pain score
 * arriving as 47, or as an answer to a question this version does not have, is
 * not data — and a trend line drawn through it would be worse than a gap.
 */

export interface SurveyQuestion {
  id: string;
  /** Turkish; the patient's own language is a client concern. */
  text: string;
  type: SurveyAnswerType;

  /**
   * Which way is bad.
   *
   * Pain rising is worsening; satisfaction rising is not. Getting this wrong
   * inverts every alert the module produces, so it is stated per question
   * rather than guessed from the wording.
   */
  direction?: 'higher-is-worse' | 'higher-is-better';

  /**
   * The value at or beyond which a clinician should see this answer,
   * regardless of trend.
   */
  alarmAt?: number;

  /** Answering is optional unless this says otherwise. */
  required?: boolean;
}

export interface SurveyDefinition {
  code: string;
  version: number;
  title: string;
  description?: string;
  questions: SurveyQuestion[];
  /** Days after the operation this is asked at. */
  milestoneDays: number[];
}

export type AnswerValue = number | boolean | string;
export type Answers = Record<string, AnswerValue>;

export class SurveyError extends Error {}

const SCALE_MIN = 0;
const SCALE_MAX = 10;

/** Free text a patient can write without it becoming a wall. */
const MAX_TEXT = 2000;

/**
 * Parses the questions column, refusing a shape that would silently misbehave.
 *
 * The column is JSON, so nothing stops a bad row getting in; a definition with
 * two questions sharing an id would make one answer overwrite the other, and
 * nobody would see it happen.
 */
export function parseQuestions(value: unknown): SurveyQuestion[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SurveyError('A questionnaire needs at least one question');
  }

  const questions = value.map((entry, index) => parseQuestion(entry, index));
  const ids = new Set<string>();

  for (const question of questions) {
    if (ids.has(question.id)) {
      throw new SurveyError(`Duplicate question id: ${question.id}`);
    }
    ids.add(question.id);
  }

  return questions;
}

function parseQuestion(entry: unknown, index: number): SurveyQuestion {
  if (typeof entry !== 'object' || entry === null) {
    throw new SurveyError(`Question ${index} is not an object`);
  }

  const raw = entry as Record<string, unknown>;

  if (typeof raw.id !== 'string' || raw.id.trim() === '') {
    throw new SurveyError(`Question ${index} has no id`);
  }
  if (typeof raw.text !== 'string' || raw.text.trim() === '') {
    throw new SurveyError(`Question ${raw.id} has no text`);
  }
  if (!isAnswerType(raw.type)) {
    throw new SurveyError(`Question ${raw.id} has an unknown type`);
  }

  const direction =
    raw.direction === 'higher-is-worse' || raw.direction === 'higher-is-better'
      ? raw.direction
      : undefined;

  // A direction on something that is not a scale would be meaningless, and an
  // alarm threshold on one would never fire.
  if (direction !== undefined && raw.type !== SurveyAnswerType.SCALE_0_10) {
    throw new SurveyError(`Question ${raw.id} has a direction but is not a scale`);
  }

  return {
    id: raw.id,
    text: raw.text,
    type: raw.type,
    direction,
    alarmAt: typeof raw.alarmAt === 'number' ? raw.alarmAt : undefined,
    required: raw.required === true,
  };
}

function isAnswerType(value: unknown): value is SurveyAnswerType {
  return (
    value === SurveyAnswerType.SCALE_0_10 ||
    value === SurveyAnswerType.YES_NO ||
    value === SurveyAnswerType.TEXT
  );
}

export interface ValidatedAnswers {
  answers: Answers;
  answeredCount: number;
  questionCount: number;
}

/**
 * Checks a patient's submission against the questions they were asked.
 *
 * Unanswered questions are allowed — a patient who does not want to say how
 * they slept should not be blocked from reporting their pain — but an answer
 * that does not fit is refused outright rather than coerced. Coercion is how a
 * blank becomes a nought, and nought out of ten pain is a clinical claim
 * nobody made.
 */
export function validateAnswers(
  questions: SurveyQuestion[],
  submitted: Record<string, unknown>,
): ValidatedAnswers {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const answers: Answers = {};

  for (const [id, value] of Object.entries(submitted)) {
    const question = byId.get(id);

    // An answer to a question this version does not ask. Refused rather than
    // dropped: it means the client is on a different version of the form, and
    // storing the rest as if that were fine hides a real mismatch.
    if (!question) throw new SurveyError(`No such question: ${id}`);

    if (value === null || value === undefined || value === '') continue;

    answers[id] = coerce(question, value);
  }

  for (const question of questions) {
    if (question.required && answers[question.id] === undefined) {
      throw new SurveyError(`Question ${question.id} must be answered`);
    }
  }

  return {
    answers,
    answeredCount: Object.keys(answers).length,
    questionCount: questions.length,
  };
}

function coerce(question: SurveyQuestion, value: unknown): AnswerValue {
  switch (question.type) {
    case SurveyAnswerType.SCALE_0_10: {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new SurveyError(`Question ${question.id} expects a number`);
      }
      if (!Number.isInteger(value) || value < SCALE_MIN || value > SCALE_MAX) {
        throw new SurveyError(
          `Question ${question.id} expects a whole number from ${SCALE_MIN} to ${SCALE_MAX}`,
        );
      }
      return value;
    }

    case SurveyAnswerType.YES_NO: {
      if (typeof value !== 'boolean') {
        throw new SurveyError(`Question ${question.id} expects yes or no`);
      }
      return value;
    }

    case SurveyAnswerType.TEXT: {
      if (typeof value !== 'string') {
        throw new SurveyError(`Question ${question.id} expects text`);
      }
      if (value.length > MAX_TEXT) {
        throw new SurveyError(`Question ${question.id} is too long`);
      }
      return value;
    }
  }
}
