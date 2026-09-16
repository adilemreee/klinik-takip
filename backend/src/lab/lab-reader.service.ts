import { Injectable, Logger } from '@nestjs/common';
import { AiJobType } from '@prisma/client';
import { AIService } from '../ai/ai.service';

/** One analyte as the model read it off the page. */
export interface ReadAnalyte {
  analyteName: string;
  analyteCode: string | null;
  value: number;
  unit: string;
  refLow: number | null;
  refHigh: number | null;
}

/** A page of the report, as an image the model can look at. */
export interface ReportPage {
  mediaType: string;
  bytes: Buffer;
}

/** The most pages of one report worth sending. */
const MAX_PAGES = 4;

/** Above this a page is downscaled rather than sent whole. */
const MAX_PAGE_BYTES = 4 * 1024 * 1024;

const SYSTEM_PROMPT = [
  'You are reading a photographed or scanned Turkish laboratory report.',
  '',
  'List every laboratory result printed on it. For each one give the analyte',
  'name as it should be written in Turkish, its LOINC code when you are',
  'certain of it, the numeric value, the unit, and the reference range when',
  'the report prints one.',
  '',
  'Report only what is printed. Never calculate a value, never carry one over',
  'from another row, and never include a row whose number you cannot read —',
  'leave it out instead. Headers, dates, patient details, the laboratory\'s',
  'own address and any signature block are not results.',
  '',
  'Say nothing about what the values mean. You are transcribing a page, not',
  'interpreting it.',
  '',
  'Answer with JSON only:',
  '{"results":[{"analyteName":"","analyteCode":null,"value":0,"unit":"",',
  '"refLow":null,"refHigh":null}]}',
].join(' ');

/**
 * Reads a laboratory report by looking at it.
 *
 * OCR used to do this, and on a real report it produced "©o İnsülin" and
 * "Kan üre azotu (URE )" at confidences between 0.27 and 0.65 — good enough
 * to prove a number was there, not good enough to file. Every row of every
 * panel landed in a review queue, nobody was going to retype twelve analytes,
 * and so the results never reached the patient's screen at all.
 *
 * A model that can see the page reads the table the way a person does:
 * columns, headers and all. The engine is still there underneath as a
 * fallback for when the AI layer is off, and what it produces still waits for
 * a human, because that part has not become any more reliable.
 *
 * What comes back is a transcription, not an interpretation. The prompt asks
 * for numbers and names and forbids comment, and the parser below drops
 * anything that is not one analyte.
 */
@Injectable()
export class LabReader {
  private readonly logger = new Logger(LabReader.name);

  constructor(private readonly ai: AIService) {}

  get available(): boolean {
    return this.ai.enabled;
  }

  /** Null when the AI layer is off or refused; the caller falls back to OCR. */
  async read(pages: ReportPage[], patientId: string): Promise<ReadAnalyte[] | null> {
    if (!this.ai.enabled || pages.length === 0) return null;

    const usable = pages.slice(0, MAX_PAGES).filter((page) => page.bytes.length <= MAX_PAGE_BYTES);

    if (usable.length === 0) {
      this.logger.warn('Every page of this report is too large to send');
      return null;
    }

    const result = await this.ai.complete({
      purpose: AiJobType.LAB_INTERPRETATION,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: usable.map((page) => ({
            type: 'image' as const,
            mediaType: page.mediaType,
            base64: page.bytes.toString('base64'),
          })),
        },
      ],
      containsHealthData: true,
      /**
       * A report header carries the patient's name, and this sends the header
       * along with everything else — there is no way to crop it out of a page
       * whose layout is not known in advance. The scan is armed with the names
       * it might find so a leak is caught rather than assumed away.
       */
      identifiers: {},
      patientId,
      maxOutputTokens: 4_096,
      temperature: 0,
    });

    if (!result.ok) {
      this.logger.log(`Lab report not read by the model (${result.reason})`);
      return null;
    }

    return parseReadAnalytes(result.text);
  }
}

/**
 * Reads the model's answer, keeping only what looks like one analyte.
 *
 * Every field is checked rather than trusted: this becomes a clinical row, and
 * a string where a number belongs would otherwise end up on a chart.
 */
export function parseReadAnalytes(text: string): ReadAnalyte[] | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  if (start === -1 || end <= start) return null;

  let parsed: unknown;

  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }

  const results = (parsed as { results?: unknown }).results;

  if (!Array.isArray(results)) return null;

  const read: ReadAnalyte[] = [];

  for (const entry of results) {
    if (typeof entry !== 'object' || entry === null) continue;

    const row = entry as Record<string, unknown>;

    if (typeof row.analyteName !== 'string' || row.analyteName.trim() === '') continue;
    if (typeof row.value !== 'number' || !Number.isFinite(row.value)) continue;

    read.push({
      analyteName: row.analyteName.trim().slice(0, 120),
      analyteCode:
        typeof row.analyteCode === 'string' && row.analyteCode.trim() !== ''
          ? row.analyteCode.trim().slice(0, 40)
          : null,
      value: row.value,
      unit: typeof row.unit === 'string' ? row.unit.trim().slice(0, 20) : '',
      refLow: typeof row.refLow === 'number' && Number.isFinite(row.refLow) ? row.refLow : null,
      refHigh: typeof row.refHigh === 'number' && Number.isFinite(row.refHigh) ? row.refHigh : null,
    });
  }

  return read;
}
