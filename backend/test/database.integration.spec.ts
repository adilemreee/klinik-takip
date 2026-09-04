import { PrismaClient, Role } from '@prisma/client';

/**
 * Integration tests against a real PostgreSQL instance.
 *
 * These cover guarantees that live in the database, not in application code:
 * the append-only audit log, the search and vector indexes, and the role
 * matrix. A unit test with a mocked client cannot prove any of them.
 *
 * Run with: npm run test:integration
 */
describe('database schema', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('migrations', () => {
    it('creates every table the data model declares', async () => {
      const rows = await prisma.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `;
      const tables = rows.map((r) => r.table_name);

      // A representative slice across every module in spec section 5.
      for (const expected of [
        'users',
        'patients',
        'medical_profiles',
        'measurements',
        'documents',
        'lab_results',
        'photos',
        'conversations',
        'messages',
        'appointments',
        'follow_up_milestones',
        'medications',
        'medication_logs',
        'notifications',
        'ai_jobs',
        'ai_reports',
        'finance_records',
        'consents',
        'audit_logs',
        'emergency_events',
      ]) {
        expect(tables).toContain(expected);
      }
    });

    it('enables the extensions the model depends on', async () => {
      const rows = await prisma.$queryRaw<{ extname: string }[]>`
        SELECT extname FROM pg_extension
      `;
      const extensions = rows.map((r) => r.extname);

      expect(extensions).toEqual(expect.arrayContaining(['pgcrypto', 'pg_trgm', 'vector']));
    });
  });

  /**
   * Spec section 13. These run as the database owner — the same identity the
   * application connects with — so they prove the guarantee holds even against
   * the application itself, not merely against a restricted role.
   */
  describe('audit log immutability', () => {
    let insertedId: string;

    beforeAll(async () => {
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO audit_logs (id, action, entity_type, created_at)
        VALUES (gen_random_uuid(), 'READ', 'patients', now())
        RETURNING id
      `;
      insertedId = rows[0]!.id;
    });

    it('accepts inserts', () => {
      expect(insertedId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('rejects UPDATE', async () => {
      await expect(
        prisma.$executeRaw`UPDATE audit_logs SET entity_type = 'tampered' WHERE id = ${insertedId}::uuid`,
      ).rejects.toThrow(/append-only/);
    });

    it('rejects DELETE', async () => {
      await expect(
        prisma.$executeRaw`DELETE FROM audit_logs WHERE id = ${insertedId}::uuid`,
      ).rejects.toThrow(/append-only/);
    });

    it('rejects TRUNCATE, which row-level triggers would not catch', async () => {
      await expect(prisma.$executeRawUnsafe('TRUNCATE audit_logs')).rejects.toThrow(/append-only/);
    });

    it('rejects TRUNCATE of a single partition, which the parent trigger misses', async () => {
      // The table is partitioned by month, and a statement-level trigger on the
      // parent does not fire for `TRUNCATE audit_logs_2026_09`. Without a guard
      // on each partition, one statement empties a month of history.
      const [partition] = await prisma.$queryRaw<{ relname: string }[]>`
        SELECT c.relname FROM pg_class c
        JOIN pg_inherits i ON i.inhrelid = c.oid
        JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname = 'audit_logs' AND c.relname <> 'audit_logs_default'
        LIMIT 1
      `;

      expect(partition).toBeDefined();
      await expect(
        prisma.$executeRawUnsafe(`TRUNCATE "${partition!.relname}"`),
      ).rejects.toThrow(/append-only/);
    });

    it('is partitioned, with a default partition so a write can never fail', async () => {
      const [parent] = await prisma.$queryRaw<{ relkind: string }[]>`
        SELECT relkind FROM pg_class WHERE relname = 'audit_logs'
      `;
      const [fallback] = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM pg_class WHERE relname = 'audit_logs_default'
      `;

      expect(parent!.relkind).toBe('p');
      expect(Number(fallback!.n)).toBe(1);
    });

    it('guards every partition, including ones made later', async () => {
      // A month created next year by the sweep must carry the same rule as the
      // ones created by the migration.
      const unguarded = await prisma.$queryRaw<{ relname: string }[]>`
        SELECT c.relname FROM pg_class c
        JOIN pg_inherits i ON i.inhrelid = c.oid
        JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname = 'audit_logs'
          AND NOT EXISTS (
            SELECT 1 FROM pg_trigger t
            WHERE t.tgrelid = c.oid AND t.tgname LIKE '%no_truncate'
          )
      `;

      expect(unguarded).toEqual([]);
    });

    it('leaves the record intact after every attempt', async () => {
      const row = await prisma.auditLog.findFirst({ where: { id: insertedId } });

      expect(row?.entityType).toBe('patients');
    });
  });

  describe('indexes required by the spec', () => {
    const hasIndex = async (name: string): Promise<boolean> => {
      const rows = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${name}
      `;
      return rows.length === 1;
    };

    // Staff search on partial and misspelled names (spec M2). A B-tree cannot
    // serve a leading wildcard.
    it.each([
      'patients_last_name_trgm_idx',
      'patients_first_name_trgm_idx',
      'patients_mrn_trgm_idx',
    ])('has trigram index %s for patient search', async (name) => {
      expect(await hasIndex(name)).toBe(true);
    });

    it('has an HNSW index for RAG retrieval', async () => {
      expect(await hasIndex('protocol_chunks_embedding_idx')).toBe(true);
    });

    it.each([
      'follow_up_milestones_due_idx',
      'notifications_pending_idx',
      'messages_queued_idx',
    ])('has partial index %s for the scheduler hot path', async (name) => {
      expect(await hasIndex(name)).toBe(true);
    });
  });

  /**
   * Spec section 2 states two separations explicitly. They are the reason the
   * matrix exists at all, so they get their own tests rather than relying on a
   * reviewer noticing a stray line in the seed.
   */
  describe('role separation', () => {
    it('gives NURSE no financial permission whatsoever', async () => {
      const grants = await prisma.rolePermission.findMany({
        where: { role: Role.NURSE, permissionCode: { startsWith: 'finance' } },
      });

      expect(grants).toEqual([]);
    });

    it('gives FINANCE no clinical permission whatsoever', async () => {
      const grants = await prisma.rolePermission.findMany({
        where: {
          role: Role.FINANCE,
          OR: [
            { permissionCode: { startsWith: 'medical' } },
            { permissionCode: { startsWith: 'labs' } },
            { permissionCode: { startsWith: 'photos' } },
            { permissionCode: { startsWith: 'messages' } },
          ],
        },
      });

      expect(grants).toEqual([]);
    });

    it('limits PATIENT and CAREGIVER to their own file', async () => {
      const grants = await prisma.rolePermission.findMany({
        where: { role: { in: [Role.PATIENT, Role.CAREGIVER] } },
      });

      expect(grants.length).toBeGreaterThan(0);
      for (const grant of grants) {
        expect(grant.permissionCode).toMatch(/^self\./);
      }
    });

    it('gives SUPER_ADMIN every permission in the catalogue', async () => {
      const [catalogue, granted] = await Promise.all([
        prisma.permission.count(),
        prisma.rolePermission.count({ where: { role: Role.SUPER_ADMIN } }),
      ]);

      expect(granted).toBe(catalogue);
    });

    it('keeps the permission matrix in the database, not in code', async () => {
      // If this is ever zero, authorisation has silently moved back into code.
      expect(await prisma.permission.count()).toBeGreaterThan(0);
    });
  });

  /**
   * Money and clinical values must never be binary floats: 0.1 kg on a weight
   * curve and a cent on an invoice both have to survive a round trip.
   */
  describe('numeric precision', () => {
    it.each([
      ['finance_records', 'gross_amount'],
      ['finance_records', 'net_amount'],
      ['measurements', 'value'],
      ['lab_results', 'value'],
    ])('stores %s.%s as numeric, not floating point', async (table, column) => {
      const rows = await prisma.$queryRaw<{ data_type: string }[]>`
        SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
      `;

      expect(rows[0]?.data_type).toBe('numeric');
    });
  });
});
