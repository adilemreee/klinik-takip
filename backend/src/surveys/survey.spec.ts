import { SurveyAnswerType } from '@prisma/client';
import { STARTER_TEMPLATES } from './survey-templates';
import { SurveyError, parseQuestions, validateAnswers, type SurveyQuestion } from './survey';

/**
 * Questionnaire definitions and what counts as an answer (spec M18, T6.7).
 *
 * The rule under test throughout: an answer that does not fit its question is
 * refused, never coerced. Coercion is how a blank becomes a nought, and nought
 * out of ten pain is a clinical claim nobody made.
 */
describe('surveys', () => {
  const questions: SurveyQuestion[] = [
    {
      id: 'pain',
      text: 'Ağrı',
      type: SurveyAnswerType.SCALE_0_10,
      direction: 'higher-is-worse',
      alarmAt: 8,
      required: true,
    },
    { id: 'slept', text: 'Uyudunuz mu?', type: SurveyAnswerType.YES_NO },
    { id: 'comment', text: 'Not', type: SurveyAnswerType.TEXT },
  ];

  describe('answers', () => {
    it('takes a complete submission', () => {
      const result = validateAnswers(questions, { pain: 4, slept: true, comment: 'iyiyim' });

      expect(result.answeredCount).toBe(3);
      expect(result.questionCount).toBe(3);
      expect(result.answers.pain).toBe(4);
    });

    it('allows a question to be left unanswered', () => {
      // A patient who does not want to say how they slept should still be able
      // to report their pain.
      const result = validateAnswers(questions, { pain: 4 });

      expect(result.answeredCount).toBe(1);
      expect(result.answers.slept).toBeUndefined();
    });

    it('treats an empty value as unanswered rather than as a nought', () => {
      const result = validateAnswers(questions, { pain: 4, comment: '', slept: null });

      expect(result.answeredCount).toBe(1);
      expect(result.answers.comment).toBeUndefined();
    });

    it('still insists on a required question', () => {
      expect(() => validateAnswers(questions, { slept: true })).toThrow(/pain/);
    });

    describe('a value that does not fit', () => {
      it.each([
        ['above the scale', { pain: 47 }],
        ['below the scale', { pain: -1 }],
        ['not a whole number', { pain: 4.5 }],
        ['not a number at all', { pain: 'çok' }],
        ['not finite', { pain: Number.NaN }],
      ])('is refused when it is %s', (_label, submitted) => {
        expect(() => validateAnswers(questions, submitted)).toThrow(SurveyError);
      });

      it('is refused for a yes/no question too', () => {
        expect(() => validateAnswers(questions, { pain: 1, slept: 'evet' })).toThrow(SurveyError);
      });

      it('is refused for text that is not text', () => {
        expect(() => validateAnswers(questions, { pain: 1, comment: 12 })).toThrow(SurveyError);
      });

      it('is refused for text longer than a person would write', () => {
        expect(() =>
          validateAnswers(questions, { pain: 1, comment: 'a'.repeat(5000) }),
        ).toThrow(SurveyError);
      });
    });

    it('refuses an answer to a question this version does not ask', () => {
      // It means the client is on a different version of the form, and storing
      // the rest as if that were fine hides a real mismatch.
      expect(() => validateAnswers(questions, { pain: 4, mood: 3 })).toThrow(/mood/);
    });

    it('accepts nought, which is a real answer', () => {
      const result = validateAnswers(questions, { pain: 0 });

      expect(result.answers.pain).toBe(0);
      expect(result.answeredCount).toBe(1);
    });

    it('accepts false, which is also a real answer', () => {
      const result = validateAnswers(questions, { pain: 1, slept: false });

      expect(result.answers.slept).toBe(false);
      expect(result.answeredCount).toBe(2);
    });
  });

  describe('definitions', () => {
    it('reads a well-formed set of questions', () => {
      const parsed = parseQuestions([
        { id: 'pain', text: 'Ağrı', type: 'SCALE_0_10', direction: 'higher-is-worse' },
      ]);

      expect(parsed[0]!.direction).toBe('higher-is-worse');
    });

    it('refuses two questions sharing an id', () => {
      // One answer would overwrite the other and nobody would see it happen.
      expect(() =>
        parseQuestions([
          { id: 'pain', text: 'A', type: 'SCALE_0_10' },
          { id: 'pain', text: 'B', type: 'SCALE_0_10' },
        ]),
      ).toThrow(/Duplicate/);
    });

    it('refuses a direction on something that is not a scale', () => {
      // It would be meaningless, and the alarm on it would never fire.
      expect(() =>
        parseQuestions([{ id: 'slept', text: 'A', type: 'YES_NO', direction: 'higher-is-worse' }]),
      ).toThrow(/direction/);
    });

    it.each([
      ['an empty list', []],
      ['not a list', { id: 'pain' }],
      ['a question with no id', [{ text: 'A', type: 'SCALE_0_10' }]],
      ['a question with no text', [{ id: 'pain', type: 'SCALE_0_10' }]],
      ['an unknown type', [{ id: 'pain', text: 'A', type: 'SLIDER' }]],
    ])('refuses %s', (_label, value) => {
      expect(() => parseQuestions(value)).toThrow(SurveyError);
    });
  });

  describe('the starter questionnaire', () => {
    it('parses as its own definition', () => {
      for (const template of STARTER_TEMPLATES) {
        expect(() => parseQuestions(template.questions)).not.toThrow();
      }
    });

    it('covers what the specification asks for', () => {
      const ids = STARTER_TEMPLATES[0]!.questions.map((question) => question.id);

      expect(ids).toEqual(expect.arrayContaining(['pain', 'swelling', 'sleep', 'satisfaction']));
    });

    it('gives every scale a direction, so no alert can be inverted', () => {
      for (const question of STARTER_TEMPLATES[0]!.questions) {
        if (question.type === SurveyAnswerType.SCALE_0_10) {
          expect(question.direction).toBeDefined();
        }
      }
    });

    it('does not use a trademark it has no claim to', () => {
      // The nought-to-ten recommendation question is everywhere, but "Net
      // Promoter Score" and "NPS" are registered marks.
      const text = JSON.stringify(STARTER_TEMPLATES);

      expect(text).not.toMatch(/\bNPS\b/i);
      expect(text).not.toMatch(/net promoter/i);
    });
  });
});
