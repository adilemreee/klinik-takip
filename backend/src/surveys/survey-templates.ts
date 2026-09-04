import { SurveyAnswerType } from '@prisma/client';
import type { SurveyDefinition } from './survey';

/**
 * The starter questionnaire (spec M18).
 *
 * ---------------------------------------------------------------------------
 * THIS IS A STARTER SET AND NO CLINICIAN HAS REVIEWED IT.
 *
 * The questions come straight from the specification's own list — pain,
 * swelling, sleep, satisfaction — and the wording is plain Turkish written for
 * this repository. What is **not** here, deliberately:
 *
 *   * No licensed instrument. SF-36, RAND-36, FACE-Q, BREAST-Q and the rest
 *     are copyrighted, and several require a paid licence per study. Shipping
 *     one in a public repository would be an infringement, and shipping a
 *     "close enough" paraphrase would be worse: a score from an altered
 *     instrument is not comparable to the published norms it looks like it
 *     should be compared to.
 *   * No expected recovery curve. "Pain of six on day two" and "pain of six at
 *     six weeks" are different clinical facts, and which is which is content
 *     the clinic owns — this module compares a patient with themselves and
 *     shows the milestone, rather than inventing a normal.
 *
 * The alarm thresholds below are placeholders chosen to be defensible, not
 * clinical guidance. **The clinic has to review them.**
 * ---------------------------------------------------------------------------
 *
 * The satisfaction question is the one the specification calls NPS. The single
 * question and its nought-to-ten scale are used everywhere, but "Net Promoter
 * Score" and "NPS" are registered trademarks, so nothing here is labelled with
 * them — the field is called what it measures.
 */
export const POST_OP_SURVEY: SurveyDefinition = {
  code: 'postop',
  version: 1,
  title: 'Ameliyat sonrası kısa değerlendirme',
  description:
    'Nasıl olduğunuzu birkaç soruda anlamak için. Cevaplarınız ekibinizin görebileceği kayıtlara işlenir.',
  // Roughly a week, a month, three months and six months: the points a
  // clinic usually wants, and the ones the follow-up module already uses.
  milestoneDays: [7, 30, 90, 180],
  questions: [
    {
      id: 'pain',
      text: 'Son 24 saatte ağrınızı 0 (hiç yok) ile 10 (dayanılmaz) arasında nasıl değerlendirirsiniz?',
      type: SurveyAnswerType.SCALE_0_10,
      direction: 'higher-is-worse',
      // Placeholder. A clinic may well want this lower in the first week and
      // higher later; that is exactly the judgement it has to make.
      alarmAt: 8,
      required: true,
    },
    {
      id: 'swelling',
      text: 'Şişlik ne kadar? 0 (hiç) — 10 (çok fazla)',
      type: SurveyAnswerType.SCALE_0_10,
      direction: 'higher-is-worse',
      alarmAt: 8,
    },
    {
      id: 'sleep',
      text: 'Uykunuz nasıl? 0 (hiç uyuyamıyorum) — 10 (çok iyi)',
      type: SurveyAnswerType.SCALE_0_10,
      direction: 'higher-is-better',
      alarmAt: 2,
    },
    {
      id: 'satisfaction',
      text: 'Kliniğimizi bir yakınınıza tavsiye etme ihtimaliniz nedir? 0 — 10',
      type: SurveyAnswerType.SCALE_0_10,
      direction: 'higher-is-better',
    },
    {
      id: 'comment',
      text: 'Eklemek istediğiniz bir şey var mı?',
      type: SurveyAnswerType.TEXT,
    },
  ],
};

/** Which answer the review invitation reads (spec M18). */
export const SATISFACTION_QUESTION = 'satisfaction';

export const STARTER_TEMPLATES: SurveyDefinition[] = [POST_OP_SURVEY];
