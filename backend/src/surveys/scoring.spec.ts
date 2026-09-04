import { SurveyAnswerType } from '@prisma/client';
import {
  MIN_COMPLETENESS,
  REVIEW_INVITE_FROM,
  WORSENING_DELTA,
  compare,
  invitesReview,
  isPartial,
  score,
} from './scoring';
import type { SurveyQuestion } from './survey';

/**
 * Scoring and the worsening rule (spec M18, T6.7).
 *
 * Two failures are being defended against. Reading pain and satisfaction the
 * same way inverts every alert the module produces — the patients in trouble
 * go quiet and the comfortable ones get chased. And alerting on ordinary
 * week-to-week variation produces an alert that gets turned off, after which
 * the real one is missed too.
 */
describe('survey scoring', () => {
  const pain: SurveyQuestion = {
    id: 'pain',
    text: 'Ağrı',
    type: SurveyAnswerType.SCALE_0_10,
    direction: 'higher-is-worse',
    alarmAt: 8,
  };
  const sleep: SurveyQuestion = {
    id: 'sleep',
    text: 'Uyku',
    type: SurveyAnswerType.SCALE_0_10,
    direction: 'higher-is-better',
    alarmAt: 2,
  };
  const slept: SurveyQuestion = { id: 'slept', text: 'Uyudunuz mu?', type: SurveyAnswerType.YES_NO };
  const comment: SurveyQuestion = { id: 'comment', text: 'Not', type: SurveyAnswerType.TEXT };

  const questions = [pain, sleep, slept, comment];

  describe('scoring', () => {
    it('keeps the numeric answers for the chart', () => {
      const scored = score(questions, { pain: 4, sleep: 7, slept: true, comment: 'iyi' });

      expect(scored.values).toEqual({ pain: 4, sleep: 7, slept: 1 });
    });

    it('leaves free text out of the numbers', () => {
      const scored = score([comment], { comment: 'çok ağrıyor' });

      expect(scored.values).toEqual({});
    });

    it('reports how much was answered', () => {
      const scored = score(questions, { pain: 4, sleep: 7 });

      expect(scored.answeredCount).toBe(2);
      expect(scored.questionCount).toBe(4);
      expect(scored.completeness).toBe(0.5);
    });

    it('marks a mostly blank form as partial', () => {
      // Its numbers are still stored and still shown — but a reader must see
      // that this point on the chart is not the same kind of thing as a full
      // one beside it.
      expect(isPartial(score(questions, { pain: 4 }))).toBe(true);
      expect(isPartial(score(questions, { pain: 4, sleep: 7 }))).toBe(false);
      expect(MIN_COMPLETENESS).toBeGreaterThan(0);
    });

    it('leaves a skipped question out of the values entirely', () => {
      // Not nought — absent. A chart must be able to draw a gap rather than a
      // point at the bottom of the scale.
      const scored = score(questions, { sleep: 7 });

      expect('pain' in scored.values).toBe(false);
      expect(scored.values).toEqual({ sleep: 7 });
    });

    it('scores a nought rather than treating it as absent', () => {
      const scored = score(questions, { pain: 0 });

      expect(scored.values.pain).toBe(0);
      expect(scored.answeredCount).toBe(1);
    });
  });

  describe('direction', () => {
    it('calls rising pain worse and rising sleep better', () => {
      const worse = compare(questions, { pain: 7, sleep: 8 }, { pain: 3, sleep: 5 });

      expect(worse.findings.map((finding) => finding.questionId)).toEqual(['pain']);
    });

    it('calls falling sleep worse', () => {
      // The inverted case: if this read the same way as pain, a patient who
      // stopped sleeping would look like they were improving.
      const worse = compare([sleep], { sleep: 3 }, { sleep: 8 });

      expect(worse.findings).toHaveLength(1);
      expect(worse.findings[0]!.kind).toBe('worsened');
      expect(worse.findings[0]!.previous).toBe(8);
    });

    it('says nothing when pain falls', () => {
      expect(compare(questions, { pain: 2 }, { pain: 8 }).findings).toEqual([]);
    });
  });

  describe('how much movement counts', () => {
    it('ignores ordinary week-to-week variation', () => {
      // Four to six is a bad morning, not a deterioration, and an alert on it
      // is an alert that gets turned off.
      expect(compare([pain], { pain: 6 }, { pain: 4 }).findings).toEqual([]);
    });

    it('reports a move of the threshold or more', () => {
      const result = compare([pain], { pain: 4 + WORSENING_DELTA }, { pain: 4 });

      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]!.kind).toBe('worsened');
    });
  });

  describe('the first questionnaire', () => {
    it('has nothing to compare against and says so', () => {
      const result = compare(questions, { pain: 5 }, null);

      expect(result.hasBaseline).toBe(false);
      expect(result.findings).toEqual([]);
    });

    it('can still be severe on its own', () => {
      // Pain at nine is worth seeing whether or not there is a previous answer.
      const result = compare(questions, { pain: 9 }, null);

      expect(result.hasBaseline).toBe(false);
      expect(result.findings[0]!.kind).toBe('severe');
    });
  });

  describe('absolute thresholds', () => {
    it('fire on their own side of the scale', () => {
      expect(compare([pain], { pain: 9 }, { pain: 9 }).findings[0]!.kind).toBe('severe');
      // Sleep is higher-is-better, so its alarm is a floor rather than a ceiling.
      expect(compare([sleep], { sleep: 1 }, { sleep: 1 }).findings[0]!.kind).toBe('severe');
      expect(compare([sleep], { sleep: 9 }, { sleep: 9 }).findings).toEqual([]);
    });

    it('fire even when the answer improved', () => {
      // Pain down from ten to eight is progress and still worth a look.
      const result = compare([pain], { pain: 8 }, { pain: 10 });

      expect(result.findings.map((finding) => finding.kind)).toEqual(['severe']);
    });

    it('do not fire on a question that has none', () => {
      const noAlarm: SurveyQuestion = { ...pain, alarmAt: undefined };

      expect(compare([noAlarm], { pain: 10 }, null).findings).toEqual([]);
    });
  });

  describe('a question that was skipped', () => {
    it('produces no finding either way', () => {
      // A blank is not a nought, and a nought-out-of-ten sleep score would be
      // an alarm nobody reported.
      expect(compare(questions, {}, { pain: 2, sleep: 9 }).findings).toEqual([]);
    });

    it('is not compared against a previous answer that is missing', () => {
      expect(compare([pain], { pain: 9 }, {}).findings.map((f) => f.kind)).toEqual(['severe']);
    });
  });

  describe('the review invitation', () => {
    it('goes only to the highest ratings', () => {
      expect(invitesReview(10)).toBe(true);
      expect(invitesReview(REVIEW_INVITE_FROM)).toBe(true);
      expect(invitesReview(REVIEW_INVITE_FROM - 1)).toBe(false);
    });

    it('never goes out on a low rating or a blank', () => {
      // Turning a complaint into an automated message is how a clinic makes an
      // unhappy patient angry.
      expect(invitesReview(0)).toBe(false);
      expect(invitesReview(undefined)).toBe(false);
    });
  });
});
