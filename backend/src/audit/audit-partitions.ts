import { Logger } from '@nestjs/common';
import type { PrismaService } from '../infra/prisma.service';
import type { JobHandler } from '../queue/job-runner';

/**
 * Building next month's audit partition before next month (spec section 13).
 *
 * `audit_logs` is range-partitioned by month and has a default partition
 * underneath it, so a write can never fail for want of somewhere to go. But the
 * default is a safety net, not a plan: **once a row lands in it, the partition
 * that row belongs in can no longer be created** — PostgreSQL refuses, because
 * attaching it would move rows out from under the default's constraint. The
 * table then quietly stops being partitioned in any useful sense, and the fix
 * is a manual data move.
 *
 * So the months are built ahead, and this checks every day rather than on the
 * first of the month: a worker that happened to be restarting at midnight on
 * the 1st must not be the reason a year of history ends up in one heap.
 */

/** How far ahead to build. Three months of slack for a worker that was down. */
const MONTHS_AHEAD = 3;

export function auditPartitionSweep(prisma: PrismaService): JobHandler {
  const logger = new Logger('AuditPartitions');

  return async (): Promise<void> => {
    const created: string[] = [];

    for (let offset = 0; offset <= MONTHS_AHEAD; offset += 1) {
      const month = new Date();
      month.setUTCDate(1);
      month.setUTCMonth(month.getUTCMonth() + offset);

      const name = await ensurePartition(prisma, month);
      if (name) created.push(name);
    }

    if (created.length > 0) {
      logger.log(`Created audit partition(s): ${created.join(', ')}`);
    }

    await warnAboutDefault(prisma, logger);
  };
}

/**
 * Creates one month's partition if it is not there.
 *
 * @returns the partition name when it was created, null when it already existed.
 */
export async function ensurePartition(
  prisma: PrismaService,
  month: Date,
): Promise<string | null> {
  const day = month.toISOString().slice(0, 10);

  const rows = await prisma.$queryRawUnsafe<{ existed: boolean; name: string }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_class
       WHERE relname = 'audit_logs_' || to_char($1::date, 'YYYY_MM')
     ) AS existed,
     audit_logs_ensure_partition($1::date) AS name`,
    day,
  );

  const row = rows[0];

  return row && !row.existed ? row.name : null;
}

/**
 * Says something when a row has landed in the default partition.
 *
 * It should never happen, and if it does the table has a hole that widens: the
 * month that row belongs to can no longer be partitioned off. Loud, because the
 * symptom is otherwise invisible until somebody tries to retire an old month
 * and finds they cannot.
 */
async function warnAboutDefault(prisma: PrismaService, logger: Logger): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(*) AS count FROM audit_logs_default`,
  );

  const count = Number(rows[0]?.count ?? 0);

  if (count > 0) {
    logger.error(
      `${count} audit row(s) are in the default partition. The months they belong to can no longer be created; they have to be moved by hand.`,
    );
  }
}
