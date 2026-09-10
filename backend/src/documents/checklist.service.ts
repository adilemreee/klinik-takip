import { Injectable } from '@nestjs/common';
import { DocumentType, ProcessingStatus } from '@prisma/client';
import { type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PatientAccessService } from '../authz/patient-access.service';
import { PrismaService } from '../infra/prisma.service';

export interface ChecklistItem {
  documentType: DocumentType;
  label: string;
  mandatory: boolean;
  /** Whether the clinic has a usable document of this kind. */
  satisfied: boolean;
  /** The document that satisfies it, so a screen can offer to open it. */
  documentId: string | null;
}

export interface Checklist {
  items: ChecklistItem[];
  /** How many mandatory items are still missing — the number worth a badge. */
  missingMandatory: number;
  complete: boolean;
}

/**
 * What a patient still has to send before an operation (spec M17).
 *
 * The list is data, not code: a clinic that starts asking for an anaesthesia
 * questionnaire adds a row, not a release. `procedureType` on a requirement
 * narrows it to one operation; a null one applies to everybody.
 *
 * The point of the screen this feeds is the *missing* half. A patient who has
 * sent four of six documents and cannot tell which two are outstanding will
 * either send nothing or send everything again, and the clinic finds out on
 * the morning of the operation.
 */
@Injectable()
export class DocumentChecklistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
  ) {}

  async forPatient(user: AuthenticatedUser, patientId: string): Promise<Checklist> {
    await this.access.assertCanAccess(user, patientId);

    /*
     * The procedure the requirements are matched against.
     *
     * The most recent surgery row, which is also the planned one: the clinic
     * creates it when the operation is booked, with the date it will happen.
     * A patient with no surgery recorded yet gets the universal requirements
     * only — which is right, because nobody has said what they are having done.
     */
    const surgery = await this.prisma.surgery.findFirst({
      where: { patientId },
      orderBy: { performedAt: 'desc' },
      select: { procedureCode: true },
    });

    const requirements = await this.prisma.documentRequirement.findMany({
      where: {
        OR: [
          { procedureType: null },
          ...(surgery?.procedureCode ? [{ procedureType: surgery.procedureCode }] : []),
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });

    const documents = await this.prisma.document.findMany({
      where: {
        patientId,
        deletedAt: null,
        // A document the pipeline could not process is not a document the
        // clinic can rely on, so it does not satisfy a requirement. Saying
        // "passport received" over an unreadable scan is how somebody arrives
        // at the airport without one.
        ocrStatus: { not: ProcessingStatus.FAILED },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, type: true },
    });

    const newestByType = new Map<DocumentType, string>();
    for (const document of documents) {
      if (!newestByType.has(document.type)) {
        newestByType.set(document.type, document.id);
      }
    }

    const items = requirements.map((requirement): ChecklistItem => {
      const documentId = newestByType.get(requirement.documentType) ?? null;

      return {
        documentType: requirement.documentType,
        label: requirement.label,
        mandatory: requirement.isMandatory,
        satisfied: documentId !== null,
        documentId,
      };
    });

    const missingMandatory = items.filter((item) => item.mandatory && !item.satisfied).length;

    return {
      items,
      missingMandatory,
      // Only the mandatory ones decide this. An optional item left undone is
      // not an incomplete file, and colouring it red teaches people to ignore
      // the colour.
      complete: missingMandatory === 0,
    };
  }
}
