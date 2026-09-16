import { Injectable, Logger } from '@nestjs/common';
import { AiJobType, DocumentType } from '@prisma/client';
import { AIService } from '../ai/ai.service';

/** A page of the document, as an image the model can look at. */
export interface DocumentPage {
  mediaType: string;
  bytes: Buffer;
}

/** Above this a page is left out rather than sent. */
const MAX_PAGE_BYTES = 4 * 1024 * 1024;

const SYSTEM_PROMPT = [
  'You are told what kind of document a photograph or scan is. Answer with one',
  'of these words and nothing else:',
  '',
  'LAB — laboratory results: analytes, values, reference ranges.',
  'IMAGING — a radiology or imaging report.',
  'ECG — an electrocardiogram trace or its report.',
  'REPORT — any other clinical report, discharge summary or operation note.',
  'CONSENT — a consent form, signed or not.',
  'INVOICE — an invoice, receipt or price quotation.',
  'PASSPORT — a passport, identity card or travel document.',
  'OTHER — anything else, or a page you cannot make out.',
  '',
  'Answer OTHER when you are unsure. A document filed as the wrong kind is',
  'worse than one filed as OTHER, because the wrong kind sends it down a',
  'pipeline built for something else.',
].join(' ');

const ANSWERS: Record<string, DocumentType> = {
  LAB: DocumentType.LAB,
  IMAGING: DocumentType.IMAGING,
  ECG: DocumentType.ECG,
  REPORT: DocumentType.REPORT,
  CONSENT: DocumentType.CONSENT,
  INVOICE: DocumentType.INVOICE,
  PASSPORT: DocumentType.PASSPORT,
  OTHER: DocumentType.OTHER,
};

/**
 * Says what an uploaded document is, so nobody has to be asked.
 *
 * Every upload screen — the patient's and the clinic's — began by asking which
 * of eight kinds this file was. A patient photographing a page from a folder
 * does not necessarily know whether it is a REPORT or an IMAGING, and getting
 * it wrong is not a labelling mistake: the kind decides what happens next, so
 * a lab report filed as OTHER is a lab report whose values are never read.
 *
 * The model looks at the first page and answers with one word. When it cannot
 * tell, the answer is OTHER and whatever the uploader said stands.
 */
@Injectable()
export class DocumentClassifier {
  private readonly logger = new Logger(DocumentClassifier.name);

  constructor(private readonly ai: AIService) {}

  /** Null when the AI layer is off, refused, or unsure. */
  async classify(pages: DocumentPage[], patientId: string): Promise<DocumentType | null> {
    if (!this.ai.enabled || pages.length === 0) return null;

    const first = pages[0]!;

    if (first.bytes.length > MAX_PAGE_BYTES) return null;

    const result = await this.ai.complete({
      purpose: AiJobType.OCR,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', mediaType: first.mediaType, base64: first.bytes.toString('base64') },
          ],
        },
      ],
      containsHealthData: true,
      identifiers: {},
      patientId,
      // One word.
      maxOutputTokens: 8,
      temperature: 0,
    });

    if (!result.ok) {
      this.logger.log(`Document not classified (${result.reason})`);
      return null;
    }

    const answer = result.text.trim().toUpperCase().replace(/[^A-Z]/g, '');
    const type = ANSWERS[answer];

    if (type === undefined || type === DocumentType.OTHER) return null;

    return type;
  }
}
