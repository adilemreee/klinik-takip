import { DocumentType, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * The documents every patient has to send before an operation (spec M17).
 *
 * A starting point, not a rule: the table is data so a clinic can add an
 * anaesthesia questionnaire without a release. Nothing here is narrowed to a
 * procedure — the four below are asked for whatever is being done, and a
 * procedure-specific row is added with `procedureType` set to the surgery's
 * code.
 *
 * Labels are Turkish because the clinic's own staff maintain the list and the
 * app shows what the row says. A clinic serving another language edits the
 * rows rather than waiting for a translation key.
 */
const DOCUMENT_REQUIREMENTS: {
  documentType: DocumentType;
  label: string;
  isMandatory: boolean;
  sortOrder: number;
}[] = [
  { documentType: DocumentType.PASSPORT, label: 'Pasaport', isMandatory: true, sortOrder: 10 },
  { documentType: DocumentType.LAB, label: 'Kan tahlilleri', isMandatory: true, sortOrder: 20 },
  { documentType: DocumentType.ECG, label: 'EKG', isMandatory: true, sortOrder: 30 },
  {
    documentType: DocumentType.CONSENT,
    label: 'İmzalı onam formu',
    isMandatory: true,
    sortOrder: 40,
  },
  {
    documentType: DocumentType.IMAGING,
    label: 'Görüntüleme (varsa)',
    isMandatory: false,
    sortOrder: 50,
  },
];

/**
 * Seeds the reference data a deployment needs.
 *
 * It used to seed the permission catalogue and the role matrix too — 42 rows
 * and 113 grants, written on every deploy so the clinic could edit them
 * afterwards. Nobody ever edited them, and they are a constant in
 * `src/authz/role-permissions.ts` now, so there is nothing to write.
 *
 * Idempotent: safe to run on every deploy.
 */
async function main(): Promise<void> {
  /*
   * The checklist rows.
   *
   * Keyed on type-plus-procedure rather than given fixed ids, and only created
   * when absent: a clinic that has renamed "Kan tahlilleri" or made the
   * imaging row mandatory must not have that undone by the next deploy.
   */
  for (const requirement of DOCUMENT_REQUIREMENTS) {
    const existing = await prisma.documentRequirement.findFirst({
      where: { documentType: requirement.documentType, procedureType: null },
      select: { id: true },
    });

    if (!existing) {
      await prisma.documentRequirement.create({ data: requirement });
    }
  }

  const requirementCount = await prisma.documentRequirement.count();
  console.log(`Seeded ${requirementCount} document requirements`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
