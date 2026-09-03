import PDFDocument from 'pdfkit';
import { fonts } from '../fonts';
import {
  describeOmission,
  isOutOfRange,
  type MeasurementSeries,
  type PatientSummary,
  type SummaryLab,
} from '../summary';
import { project, scaleFor, type Box } from './chart';

/**
 * Drawing the patient summary (spec M12, T6.5).
 *
 * A template, not a layout engine: fixed sections in a fixed order, so two
 * summaries of two patients can be compared by eye and a reader knows where to
 * look. Everything that decides *what* goes in lives in `summary.ts`; this file
 * only puts it on the page.
 */

const PAGE = { size: 'A4' as const, margin: 48 };
const CONTENT_WIDTH = 595.28 - PAGE.margin * 2;

const INK = '#111827';
const MUTED = '#6b7280';
const RULE = '#d1d5db';
const WARN = '#b45309';

export interface PhotoBytes {
  id: string;
  data: Buffer;
  caption: string;
}

export interface RenderOptions {
  /** Fetched by the caller; this module does no I/O of its own. */
  photos?: PhotoBytes[];
}

export async function renderPatientSummary(
  summary: PatientSummary,
  options: RenderOptions = {},
): Promise<Buffer> {
  const font = fonts();
  const doc = new PDFDocument({
    size: PAGE.size,
    margin: PAGE.margin,
    info: {
      Title: `Hasta Özeti — ${summary.patient.mrn}`,
      Author: summary.clinicName,
      // No patient name in the metadata: a filename and a document title travel
      // further than the file's contents do.
      Subject: 'Hasta özet raporu',
      CreationDate: summary.generatedAt,
    },
  });

  doc.registerFont('body', font.regular);
  doc.registerFont('bold', font.bold);
  doc.font('body').fillColor(INK);

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  header(doc, summary);
  demographics(doc, summary);
  surgeries(doc, summary);
  charts(doc, summary);
  labs(doc, summary);
  medications(doc, summary);
  photos(doc, options.photos ?? []);
  aiReports(doc, summary);
  omissions(doc, summary);
  footer(doc, summary);

  doc.end();

  return finished;
}

type Doc = InstanceType<typeof PDFDocument>;

function header(doc: Doc, summary: PatientSummary): void {
  doc.font('bold').fontSize(18).text(summary.clinicName, { align: 'left' });
  doc.font('body').fontSize(10).fillColor(MUTED).text('Hasta Özet Raporu');
  doc.fillColor(INK);
  rule(doc);
}

function demographics(doc: Doc, summary: PatientSummary): void {
  const patient = summary.patient;

  section(doc, 'Hasta');
  doc.font('bold').fontSize(13).text(`${patient.firstName} ${patient.lastName}`);
  doc.font('body').fontSize(10);

  pairs(doc, [
    ['Dosya no', patient.mrn],
    ['Doğum tarihi', date(patient.birthDate)],
    ['Cinsiyet', patient.sex],
    ['Ülke', patient.city ? `${patient.country} — ${patient.city}` : patient.country],
    ['Dil', patient.preferredLanguage],
  ]);
}

function surgeries(doc: Doc, summary: PatientSummary): void {
  section(doc, 'Ameliyatlar');

  if (summary.surgeries.length === 0) {
    empty(doc, 'Kayıtlı ameliyat yok.');
    return;
  }

  for (const surgery of summary.surgeries) {
    doc.font('bold').fontSize(10).text(surgery.procedureName, { continued: true });
    doc
      .font('body')
      .fillColor(MUTED)
      .text(`   ${date(surgery.performedAt)}`)
      .fillColor(INK);

    const detail = [surgery.surgeon, surgery.location].filter(Boolean).join(' · ');
    if (detail) doc.fontSize(9).fillColor(MUTED).text(detail).fillColor(INK);

    doc.moveDown(0.4);
  }
}

function charts(doc: Doc, summary: PatientSummary): void {
  section(doc, 'Ölçümler');

  if (summary.series.length === 0) {
    empty(doc, 'Kayıtlı ölçüm yok.');
    return;
  }

  for (const series of summary.series) {
    ensureSpace(doc, 130);
    drawSeries(doc, series);
  }
}

function drawSeries(doc: Doc, series: MeasurementSeries): void {
  const latest = series.latest;
  const reading =
    latest.secondaryValue === null
      ? `${latest.value} ${series.unit}`
      : `${latest.value}/${latest.secondaryValue} ${series.unit}`;

  doc.font('bold').fontSize(10).text(series.type, { continued: true });
  doc
    .font('body')
    .fillColor(MUTED)
    .text(`   son ölçüm ${reading} · ${date(latest.measuredAt)} · ${series.points.length} kayıt`)
    .fillColor(INK);

  const box: Box = { x: PAGE.margin + 40, y: doc.y + 6, width: CONTENT_WIDTH - 50, height: 70 };
  const scale = scaleFor(series.points.map((point) => point.value));
  const projected = project(series.points, scale, box);

  doc.save().lineWidth(0.5).strokeColor(RULE);

  for (const tick of scale.ticks) {
    const y = box.y + box.height - ((tick - scale.min) / Math.max(scale.max - scale.min, 1e-6)) * box.height;

    doc.moveTo(box.x, y).lineTo(box.x + box.width, y).stroke();
    doc
      .font('body')
      .fontSize(7)
      .fillColor(MUTED)
      .text(String(round(tick)), PAGE.margin, y - 3, { width: 36, align: 'right' });
  }

  doc.restore();

  if (projected.length === 1) {
    // One reading is a dot. A line of one point would draw nothing at all, and
    // a line drawn across the box would invent a trend.
    doc.save().fillColor(INK).circle(projected[0]!.x, projected[0]!.y, 2.5).fill().restore();
  } else if (projected.length > 1) {
    doc.save().lineWidth(1.2).strokeColor(INK);
    doc.moveTo(projected[0]!.x, projected[0]!.y);
    for (const point of projected.slice(1)) doc.lineTo(point.x, point.y);
    doc.stroke().restore();
  }

  doc.y = box.y + box.height + 14;
  doc.x = PAGE.margin;
}

function labs(doc: Doc, summary: PatientSummary): void {
  section(doc, 'Laboratuvar');

  if (summary.labs.length === 0) {
    empty(doc, 'Doğrulanmış laboratuvar sonucu yok.');
    return;
  }

  const columns = [200, 90, 120, 100];
  tableHeader(doc, ['Analit', 'Değer', 'Referans', 'Tarih'], columns);

  for (const lab of summary.labs.slice(0, 40)) {
    ensureSpace(doc, 20);
    row(doc, [labName(lab), `${lab.value} ${lab.unit}`, range(lab), date(lab.measuredAt)], columns, {
      // Out of range is marked, never colour alone: a printed summary is often
      // read in black and white.
      emphasise: isOutOfRange(lab),
    });
  }

  if (summary.labs.length > 40) {
    doc.moveDown(0.3);
    doc
      .font('body')
      .fontSize(8)
      .fillColor(MUTED)
      .text(`En yeni 40 sonuç gösterildi; toplam ${summary.labs.length}.`)
      .fillColor(INK);
  }
}

function labName(lab: SummaryLab): string {
  return isOutOfRange(lab) ? `! ${lab.analyteName}` : lab.analyteName;
}

function range(lab: SummaryLab): string {
  if (lab.refLow === null && lab.refHigh === null) return '—';

  return `${lab.refLow ?? '—'} – ${lab.refHigh ?? '—'}`;
}

function medications(doc: Doc, summary: PatientSummary): void {
  section(doc, 'İlaçlar');

  if (summary.medications.length === 0) {
    empty(doc, 'Kayıtlı ilaç yok.');
    return;
  }

  const columns = [170, 90, 160, 90];
  tableHeader(doc, ['İlaç', 'Doz', 'Plan', 'Uyum'], columns);

  for (const medication of summary.medications) {
    ensureSpace(doc, 20);
    row(
      doc,
      [
        medication.stoppedAt ? `${medication.drugName} (durduruldu)` : medication.drugName,
        medication.dose,
        medication.schedule,
        // Null is not nought per cent: a course with nothing due yet has no
        // score, and printing zero would tell a patient they are failing.
        medication.adherencePercent === null ? '—' : `%${medication.adherencePercent}`,
      ],
      columns,
    );
  }
}

function photos(doc: Doc, images: PhotoBytes[]): void {
  if (images.length === 0) return;

  section(doc, 'Fotoğraflar');

  let x = PAGE.margin;
  const width = (CONTENT_WIDTH - 16) / 3;

  ensureSpace(doc, width + 30);
  const top = doc.y;

  for (const [index, image] of images.entries()) {
    if (index > 0 && index % 3 === 0) {
      doc.y = top + width + 26;
      x = PAGE.margin;
      ensureSpace(doc, width + 30);
    }

    try {
      doc.image(image.data, x, doc.y, { fit: [width, width], align: 'center' });
    } catch {
      // A photo that cannot be decoded must not take the whole report down.
      doc.font('body').fontSize(8).fillColor(WARN).text('(görüntü okunamadı)', x, doc.y);
      doc.fillColor(INK);
    }

    doc.font('body').fontSize(7).fillColor(MUTED).text(image.caption, x, doc.y + width + 4, {
      width,
    });
    doc.fillColor(INK);

    x += width + 8;
  }

  doc.y = top + width + 30;
  doc.x = PAGE.margin;
}

function aiReports(doc: Doc, summary: PatientSummary): void {
  if (summary.aiReports.length === 0) return;

  section(doc, 'Yapay Zekâ Özetleri');
  doc
    .font('body')
    .fontSize(8)
    .fillColor(MUTED)
    .text('Bu metinler bir model tarafından üretilmiş ve bir hekim tarafından onaylanmıştır.')
    .fillColor(INK);
  doc.moveDown(0.4);

  for (const report of summary.aiReports) {
    ensureSpace(doc, 60);
    doc.font('bold').fontSize(10).text(report.source);
    doc
      .font('body')
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        `${date(report.generatedAt)} · ${report.model} · onaylayan: ${report.reviewerName ?? 'hekim'}`,
      )
      .fillColor(INK);
    doc.fontSize(9).text(report.contentMd, { width: CONTENT_WIDTH });
    doc.moveDown(0.5);
  }
}

/**
 * What is not in this document, and why.
 *
 * Printed rather than left to the reader's assumption. A summary with no photo
 * section reads as a patient with no photographs.
 */
function omissions(doc: Doc, summary: PatientSummary): void {
  if (summary.omissions.length === 0) return;

  ensureSpace(doc, 60);
  section(doc, 'Bu Rapora Girmeyenler');

  for (const omission of summary.omissions) {
    doc.font('body').fontSize(9).fillColor(WARN).text(`• ${describeOmission(omission)}`);
  }

  doc.fillColor(INK);
}

function footer(doc: Doc, summary: PatientSummary): void {
  doc.moveDown(1);
  rule(doc);
  doc
    .font('body')
    .fontSize(8)
    .fillColor(MUTED)
    .text(
      `${date(summary.generatedAt, true)} tarihinde ${summary.generatedBy} tarafından üretildi. ` +
        'Bu rapor o andaki kayıtların bir anlık görüntüsüdür; hasta dosyası bundan sonra değişmiş olabilir.',
      { width: CONTENT_WIDTH },
    );
  doc.fillColor(INK);
}

// ------------------------------------------------------------------ helpers

function section(doc: Doc, title: string): void {
  ensureSpace(doc, 40);
  doc.moveDown(0.8);
  doc.font('bold').fontSize(11).fillColor(INK).text(title);
  rule(doc);
}

function rule(doc: Doc): void {
  const y = doc.y + 2;

  doc.save().lineWidth(0.5).strokeColor(RULE);
  doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + CONTENT_WIDTH, y).stroke();
  doc.restore();
  doc.y = y + 6;
}

function pairs(doc: Doc, entries: [string, string][]): void {
  for (const [label, value] of entries) {
    doc.font('body').fontSize(9).fillColor(MUTED).text(label, { continued: true, width: 120 });
    doc.fillColor(INK).text(`  ${value}`);
  }
}

function tableHeader(doc: Doc, headings: string[], columns: number[]): void {
  const y = doc.y;
  let x = PAGE.margin;

  doc.font('bold').fontSize(8).fillColor(MUTED);

  for (const [index, heading] of headings.entries()) {
    doc.text(heading, x, y, { width: columns[index] });
    x += columns[index]!;
  }

  doc.fillColor(INK);
  doc.y = y + 12;
  doc.x = PAGE.margin;
}

function row(
  doc: Doc,
  cells: string[],
  columns: number[],
  options: { emphasise?: boolean } = {},
): void {
  const y = doc.y;
  let x = PAGE.margin;

  doc.font(options.emphasise ? 'bold' : 'body').fontSize(9);

  for (const [index, cell] of cells.entries()) {
    doc.text(cell, x, y, { width: columns[index], ellipsis: true, lineBreak: false });
    x += columns[index]!;
  }

  doc.y = y + 13;
  doc.x = PAGE.margin;
}

function empty(doc: Doc, text: string): void {
  doc.font('body').fontSize(9).fillColor(MUTED).text(text).fillColor(INK);
}

/** Starts a new page when the next block would not fit on this one. */
function ensureSpace(doc: Doc, needed: number): void {
  const bottom = doc.page.height - PAGE.margin;

  if (doc.y + needed > bottom) {
    doc.addPage();
    doc.x = PAGE.margin;
  }
}

function date(value: Date, withTime = false): string {
  const formatter = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });

  return formatter.format(value);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
