import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditAction, ProtocolDocument } from '@prisma/client';
import { AIService } from '../ai/ai.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../infra/prisma.service';
import { chunk } from './chunking';
import {
  FOLD_FROM,
  FOLD_TO,
  buildTsQuery,
  lexicalScore,
  merge,
  select,
  type Evidence,
  type Retrieved,
} from './retrieval';

/** How many candidates each search returns before they are merged and cut. */
const CANDIDATES = 12;

export interface UploadInput {
  title: string;
  content: string;
  /** Restricts retrieval to patients who had this procedure. */
  procedureType?: string;
  language?: string;
}

export interface DocumentSummary {
  document: ProtocolDocument;
  chunks: number;
  /** False when no embedding provider was configured at upload time. */
  embedded: boolean;
}

@Injectable()
export class ProtocolsService {
  private readonly logger = new Logger(ProtocolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Adds a document to the corpus the assistant is allowed to answer from.
   *
   * Chunked on the way in rather than at query time, because chunking is a
   * decision about the document and re-deciding it per question would make two
   * identical questions retrievable differently.
   */
  async upload(user: AuthenticatedUser, input: UploadInput): Promise<DocumentSummary> {
    const content = input.content.trim();

    if (content.length < 50) {
      throw new BadRequestException('A protocol document needs some content');
    }

    const pieces = chunk(content);

    if (pieces.length === 0) {
      throw new BadRequestException('Nothing in this document survived chunking');
    }

    const document = await this.prisma.$transaction(async (tx) => {
      const created = await tx.protocolDocument.create({
        data: {
          title: input.title.trim().slice(0, 300),
          procedureType: input.procedureType?.trim() || null,
          language: input.language ?? 'tr',
          content,
          uploadedById: user.id,
        },
      });

      await tx.protocolChunk.createMany({
        data: pieces.map((piece) => ({
          documentId: created.id,
          chunkIndex: piece.index,
          content: piece.content,
        })),
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.CREATE,
        entityType: 'protocol_documents',
        entityId: created.id,
        after: { id: created.id, title: created.title, chunks: pieces.length },
      });

      return created;
    });

    const embedded = await this.embedDocument(document.id);

    return { document, chunks: pieces.length, embedded };
  }

  async list(activeOnly = true): Promise<DocumentSummary[]> {
    const documents = await this.prisma.protocolDocument.findMany({
      where: activeOnly ? { isActive: true } : {},
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { chunks: true } } },
    });

    const embeddedCounts = await this.embeddedCounts(documents.map((d) => d.id));

    return documents.map((document) => ({
      document,
      chunks: document._count.chunks,
      embedded: (embeddedCounts.get(document.id) ?? 0) > 0,
    }));
  }

  /**
   * Retiring a document rather than deleting it.
   *
   * An answer the assistant gave last month cited a passage; deleting the
   * document would leave that citation pointing at nothing, and a clinic
   * reviewing what the bot told a patient needs to be able to read what it was
   * reading.
   */
  async deactivate(user: AuthenticatedUser, documentId: string): Promise<ProtocolDocument> {
    const existing = await this.prisma.protocolDocument.findUnique({ where: { id: documentId } });

    if (!existing) {
      throw new NotFoundException('Protocol document not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.protocolDocument.update({
        where: { id: documentId },
        data: { isActive: false },
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.UPDATE,
        entityType: 'protocol_documents',
        entityId: documentId,
        before: { isActive: existing.isActive },
        after: { isActive: false },
      });

      return updated;
    });
  }

  /**
   * Embeds a document's chunks, when there is a provider to do it.
   *
   * Protocol text is the clinic's own writing rather than anyone's medical
   * record, so this is the one call in the system that declares no patient
   * data — and the leak check still runs over it, because a protocol written
   * with a real case in it is not impossible.
   */
  async embedDocument(documentId: string): Promise<boolean> {
    if (!this.ai.embeddingsEnabled) return false;

    const chunks = await this.prisma.protocolChunk.findMany({
      where: { documentId },
      orderBy: { chunkIndex: 'asc' },
      select: { id: true, content: true },
    });

    if (chunks.length === 0) return false;

    const result = await this.ai.embed({
      texts: chunks.map((piece) => piece.content),
      containsHealthData: false,
    });

    if (!result.ok) {
      this.logger.warn(`Document ${documentId} was stored without embeddings (${result.reason})`);
      return false;
    }

    for (const [index, piece] of chunks.entries()) {
      const vector = result.vectors[index];
      if (!vector) continue;

      // Raw SQL because Prisma cannot write an Unsupported column.
      await this.prisma.$executeRawUnsafe(
        'UPDATE protocol_chunks SET embedding = $1::vector WHERE id = $2::uuid',
        `[${vector.join(',')}]`,
        piece.id,
      );
    }

    return true;
  }

  /**
   * What the corpus has to say about a question.
   *
   * Two searches, because they fail differently: the vector search finds a
   * passage that means the same thing in different words, the lexical one finds
   * the passage that uses the patient's actual words, and a chunk both agree on
   * is the closest thing to a second opinion available here.
   *
   * Restricted to documents for the patient's own procedure or to general ones.
   * A sleeve gastrectomy instruction shown to a rhinoplasty patient is not a
   * near miss; it is a different operation's aftercare.
   */
  async retrieve(question: string, procedureType: string | null): Promise<Evidence> {
    const [vector, lexical] = await Promise.all([
      this.vectorSearch(question, procedureType),
      this.lexicalSearch(question, procedureType),
    ]);

    return select(merge(vector, lexical));
  }

  private async vectorSearch(question: string, procedureType: string | null): Promise<Retrieved[]> {
    if (!this.ai.embeddingsEnabled) return [];

    // The question is the patient's own words, so it is patient data.
    const embedded = await this.ai.embed({ texts: [question], containsHealthData: true });

    if (!embedded.ok || !embedded.vectors[0]) return [];

    const literal = `[${embedded.vectors[0].join(',')}]`;

    const rows = await this.prisma.$queryRawUnsafe<
      { chunk_id: string; document_id: string; title: string; content: string; score: number }[]
    >(
      `SELECT c.id AS chunk_id, d.id AS document_id, d.title, c.content,
              1 - (c.embedding <=> $1::vector) AS score
         FROM protocol_chunks c
         JOIN protocol_documents d ON d.id = c.document_id
        WHERE d.is_active = true
          AND c.embedding IS NOT NULL
          AND (d.procedure_type IS NULL OR d.procedure_type = $2)
        ORDER BY c.embedding <=> $1::vector
        LIMIT ${CANDIDATES}`,
      literal,
      procedureType,
    );

    return rows.map((row) => toRetrieved(row, Number(row.score), 'vector'));
  }

  private async lexicalSearch(question: string, procedureType: string | null): Promise<Retrieved[]> {
    const query = buildTsQuery(question);

    // A question of nothing but stopwords has no terms to search for, and
    // `to_tsquery('')` is a syntax error rather than an empty result.
    if (query.length === 0) return [];

    // The index is built over exactly this expression; anything else here and
    // the planner falls back to a sequential scan of the whole corpus.
    const folded = `to_tsvector('simple', translate(c.content, '${FOLD_FROM}', '${FOLD_TO}'))`;

    const rows = await this.prisma.$queryRawUnsafe<
      { chunk_id: string; document_id: string; title: string; content: string; score: number }[]
    >(
      `SELECT c.id AS chunk_id, d.id AS document_id, d.title, c.content,
              ts_rank(${folded}, to_tsquery('simple', $1)) AS score
         FROM protocol_chunks c
         JOIN protocol_documents d ON d.id = c.document_id
        WHERE d.is_active = true
          AND (d.procedure_type IS NULL OR d.procedure_type = $2)
          AND ${folded} @@ to_tsquery('simple', $1)
        ORDER BY score DESC
        LIMIT ${CANDIDATES}`,
      query,
      procedureType,
    );

    return rows.map((row) => toRetrieved(row, lexicalScore(Number(row.score)), 'lexical'));
  }

  private async embeddedCounts(documentIds: string[]): Promise<Map<string, number>> {
    if (documentIds.length === 0) return new Map();

    const rows = await this.prisma.$queryRawUnsafe<{ document_id: string; embedded: bigint }[]>(
      `SELECT document_id, COUNT(*) AS embedded
         FROM protocol_chunks
        WHERE embedding IS NOT NULL AND document_id = ANY($1::uuid[])
        GROUP BY document_id`,
      documentIds,
    );

    return new Map(rows.map((row) => [row.document_id, Number(row.embedded)]));
  }
}

function toRetrieved(
  row: { chunk_id: string; document_id: string; title: string; content: string },
  score: number,
  via: 'vector' | 'lexical',
): Retrieved {
  return {
    chunkId: row.chunk_id,
    documentId: row.document_id,
    documentTitle: row.title,
    content: row.content,
    score: Number.isFinite(score) ? score : 0,
    via,
  };
}
