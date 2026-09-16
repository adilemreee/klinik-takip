/**
 * One clinician and one patient with something on every screen.
 *
 * `seed-demo.ts` writes four patients at four points in a pathway, which is
 * the right shape for showing the product. This is the other thing somebody
 * needs: a single file with *every* screen populated, so the app can be walked
 * end to end and each one checked against something real.
 *
 * **Never for production.** It refuses there, and it refuses without an
 * explicit opt-in besides — it writes accounts that can sign in.
 *
 *   KLINIK_SHOWCASE=yes \
 *   SHOWCASE_DOCTOR_EMAIL=... SHOWCASE_DOCTOR_PASSWORD=... \
 *   SHOWCASE_PATIENT_EMAIL=... SHOWCASE_PATIENT_PASSWORD=... \
 *   npx ts-node scripts/seed-showcase.ts
 *
 * Credentials come from the environment and never from this file: the
 * repository is public.
 *
 * Passwords go through the same `checkPassword` the application uses. An
 * account seeded past the policy is an account whose owner cannot later change
 * it to anything similar, and a policy that only applies to some accounts is
 * not a policy.
 *
 * What it does not write: photographs. A photo row whose bytes are not in the
 * bucket draws as "could not be loaded", which is honest but useless for
 * checking the gallery — so the photographs are uploaded afterwards through
 * the real endpoint, which puts the object and the row down together.
 */
import {
  AppointmentStatus,
  AppointmentType,
  ComplicationStatus,
  ConsentType,
  Currency,
  DocumentType,
  ExportKind,
  LabFlag,
  MeasurementSource,
  MeasurementType,
  MedicationLogStatus,
  MessageStatus,
  MessageType,
  MilestoneStatus,
  NotificationChannel,
  NotificationStatus,
  PatientStatus,
  PaymentMethod,
  PaymentStatus,
  PrismaClient,
  ProcessingStatus,
  Role,
  SurveyAnswerType,
  SurveyStatus,
  TriageLevel,
  UserStatus,
} from '@prisma/client';
import { checkPassword } from '../src/auth/password.policy';
import { hashPassword } from '../src/crypto/hashing';
import { foldForSearch } from '../src/patients/search-folding';

const prisma = new PrismaClient();
const now = new Date();

/** `days` from now, at a given hour, in UTC. Negative is the past. */
function at(days: number, hour = 10): Date {
  const moment = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  moment.setUTCHours(hour, 0, 0, 0);
  return moment;
}

function required(name: string): string {
  const value = process.env[name];

  if (!value) throw new Error(`${name} is required`);

  return value;
}

/** The same check the application applies, on the same data. */
function vetted(password: string, personal: string[]): string {
  const result = checkPassword(password, personal);

  if (!result.valid) {
    throw new Error(`password rejected: ${result.reasons.join('; ')}`);
  }

  return password;
}

async function main(): Promise<void> {
  if (process.env.APP_ENV === 'production') {
    throw new Error('seed-showcase refuses to run against production');
  }

  if (process.env.KLINIK_SHOWCASE !== 'yes') {
    throw new Error('Set KLINIK_SHOWCASE=yes to confirm this is a demo database');
  }

  const doctorEmail = required('SHOWCASE_DOCTOR_EMAIL');
  const patientEmail = required('SHOWCASE_PATIENT_EMAIL');

  // The local part only. The rule rejects a password containing the account's
  // own name or address, and the whole address would reject every password
  // sharing a domain with it.
  const doctorPassword = vetted(required('SHOWCASE_DOCTOR_PASSWORD'), [
    doctorEmail.split('@')[0] ?? '',
  ]);
  const patientPassword = vetted(required('SHOWCASE_PATIENT_PASSWORD'), [
    patientEmail.split('@')[0] ?? '',
  ]);

  // ---------------------------------------------------------------- doctor

  const doctorUser = await prisma.user.upsert({
    where: { email: doctorEmail },
    create: {
      email: doctorEmail,
      role: Role.DOCTOR,
      status: UserStatus.ACTIVE,
      locale: 'tr',
      passwordHash: await hashPassword(doctorPassword),
    },
    update: {
      role: Role.DOCTOR,
      status: UserStatus.ACTIVE,
      passwordHash: await hashPassword(doctorPassword),
      deletedAt: null,
    },
  });

  const doctor = await prisma.staffProfile.upsert({
    where: { userId: doctorUser.id },
    create: {
      userId: doctorUser.id,
      firstName: 'Adil Emre',
      lastName: 'Aydın',
      title: 'Op. Dr.',
      specialty: 'Plastik, Rekonstrüktif ve Estetik Cerrahi',
      // Otherwise the agenda, the patient list and the queues are all scoped
      // to explicit assignments, and a clinic of one doctor sees nothing they
      // were not personally handed.
      canSeeAllPatients: true,
    },
    update: { canSeeAllPatients: true },
  });

  console.log(`doctor  ${doctorEmail}`);

  // The hours the clinic is bookable in, so the calendar can refuse a slot
  // outside them rather than accepting anything.
  for (const day of [1, 2, 3, 4, 5]) {
    await prisma.availabilityWindow.create({
      data: {
        staffId: doctor.id,
        dayOfWeek: day,
        startTime: '09:00',
        endTime: '17:00',
        timezone: 'Europe/Istanbul',
      },
    });
  }

  // --------------------------------------------------------------- patient

  const patientUser = await prisma.user.upsert({
    where: { email: patientEmail },
    create: {
      email: patientEmail,
      phone: '+905550000001',
      role: Role.PATIENT,
      status: UserStatus.ACTIVE,
      locale: 'tr',
      passwordHash: await hashPassword(patientPassword),
    },
    update: {
      role: Role.PATIENT,
      status: UserStatus.ACTIVE,
      passwordHash: await hashPassword(patientPassword),
      deletedAt: null,
    },
  });

  const agency = await prisma.agency.create({
    data: {
      name: 'Anadolu Sağlık Turizm',
      country: 'DE',
      contactName: 'Leyla Kurt',
      contactEmail: 'leyla@anadolusaglik.example',
      commissionRate: 0.12,
    },
  });

  const patient = await prisma.patient.create({
    data: {
      mrn: '2026-DEMO01',
      userId: patientUser.id,
      firstName: 'Zeynep',
      lastName: 'Kaya',
      searchText: foldForSearch('Zeynep Kaya'),
      birthDate: new Date(Date.UTC(1987, 2, 11)),
      sex: 'FEMALE',
      country: 'DE',
      city: 'Berlin',
      nationality: 'TR',
      preferredLanguage: 'tr',
      referralSource: 'Instagram',
      status: PatientStatus.POST_OP,
      assignedDoctorId: doctor.id,
      agencyId: agency.id,
    },
  });

  await prisma.patientAssignment.create({
    data: { patientId: patient.id, staffId: doctor.id, role: Role.DOCTOR },
  });

  await prisma.medicalProfile.create({
    data: {
      patientId: patient.id,
      bloodType: 'A Rh+',
      allergies: ['Penisilin'],
      chronicConditions: ['Hipotiroidi'],
      currentMedications: ['Levotiroksin 50 mcg'],
      smoking: false,
      alcohol: false,
      targetWeightKg: 68,
      notes: 'Ameliyat öncesi kan sulandırıcı kesildi.',
    },
  });

  const surgery = await prisma.surgery.create({
    data: {
      patientId: patient.id,
      procedureName: 'Septorinoplasti',
      procedureCode: 'SEPTORHINOPLASTY',
      performedAt: at(-24, 9),
      surgeonId: doctor.id,
      location: 'Ameliyathane 2',
    },
  });

  console.log(`patient ${patientEmail}  (${patient.mrn})`);

  // ------------------------------------------------------------ the record

  await measurements(patient.id);
  await labs(patient.id, doctorUser.id);
  await documents(patient.id);
  await medication(patient.id, doctor.id, doctorUser.id);
  await appointments(patient.id, doctor.id);
  await followUp(patient.id, surgery.id);
  await conversation(patient.id, patientUser.id, doctorUser.id);
  await complications(patient.id, patientUser.id, doctorUser.id);
  await consents(patient.id);
  await travel(patient.id, doctorUser.id);
  await survey(patient.id, surgery.id);
  await finance(patient.id, agency.id);
  await exportsAndNotifications(patient.id, doctorUser.id, patientUser.id);

  console.log('\nOne clinician, one patient, every screen.');
}

/** Weight over three months, a height to divide it by, and vitals. */
async function measurements(patientId: string): Promise<void> {
  const points = 12;
  const weights = Array.from({ length: points }, (_, index) =>
    Number((74.8 - (index * (74.8 - 69.4)) / (points - 1)).toFixed(1)),
  );

  await prisma.measurement.createMany({
    data: weights.map((value, index) => ({
      patientId,
      type: MeasurementType.WEIGHT,
      value,
      unit: 'kg',
      measuredAt: at(-90 + (index * 90) / (points - 1), 8),
      source: index % 3 === 0 ? MeasurementSource.NURSE : MeasurementSource.PATIENT,
    })),
  });

  await prisma.measurement.create({
    data: {
      patientId,
      type: MeasurementType.HEIGHT,
      value: 168,
      unit: 'cm',
      measuredAt: at(-90, 8),
      source: MeasurementSource.NURSE,
    },
  });

  await prisma.measurement.createMany({
    data: [0, 7, 14, 21, 28].flatMap((back) => [
      {
        patientId,
        type: MeasurementType.BLOOD_PRESSURE,
        value: 124 + (back % 3) * 4,
        secondaryValue: 78 + (back % 2) * 4,
        unit: 'mmHg',
        measuredAt: at(-back, 9),
        source: MeasurementSource.NURSE,
      },
      {
        patientId,
        type: MeasurementType.PULSE,
        value: 70 + (back % 4) * 3,
        unit: 'bpm',
        measuredAt: at(-back, 9),
        source: MeasurementSource.DEVICE,
      },
    ]),
  });
}

/**
 * Two panels: one a clinician has confirmed, one still waiting — with a
 * critical value in it, so the review screen has the row it exists for.
 */
async function labs(patientId: string, staffUserId: string): Promise<void> {
  const panels = [
    {
      daysAgo: 26,
      name: 'ameliyat-oncesi-tahlil.pdf',
      verified: true,
      analytes: [
        { code: '718-7', name: 'Hemoglobin', value: 13.4, unit: 'g/dL', low: 12, high: 16, flag: LabFlag.NORMAL },
        { code: '4544-3', name: 'Hematokrit', value: 40.1, unit: '%', low: 36, high: 46, flag: LabFlag.NORMAL },
        { code: '3016-3', name: 'TSH', value: 5.9, unit: 'mIU/L', low: 0.4, high: 4.0, flag: LabFlag.HIGH },
      ],
    },
    {
      daysAgo: 3,
      name: 'kontrol-tahlil.pdf',
      verified: false,
      analytes: [
        { code: '1988-5', name: 'C Reaktif Protein (CRP)', value: 84.0, unit: 'mg/L', low: 0, high: 5, flag: LabFlag.CRITICAL },
        { code: '718-7', name: 'Hemoglobin', value: 11.8, unit: 'g/dL', low: 12, high: 16, flag: LabFlag.LOW },
        { code: '6690-2', name: 'Lökosit', value: 9.2, unit: '10^3/uL', low: 4, high: 11, flag: LabFlag.NORMAL },
      ],
    },
  ];

  for (const panel of panels) {
    const measuredAt = at(-panel.daysAgo, 8);

    const document = await prisma.document.create({
      data: {
        patientId,
        type: DocumentType.LAB,
        fileKey: `demo/${panel.name}`,
        originalName: panel.name,
        mime: 'application/pdf',
        size: 0,
        ocrStatus: ProcessingStatus.DONE,
        aiStatus: ProcessingStatus.DONE,
        createdAt: measuredAt,
      },
    });

    for (const analyte of panel.analytes) {
      await prisma.labResult.create({
        data: {
          patientId,
          documentId: document.id,
          analyteCode: analyte.code,
          analyteName: analyte.name,
          value: analyte.value,
          unit: analyte.unit,
          refLow: analyte.low,
          refHigh: analyte.high,
          flag: analyte.flag,
          measuredAt,
          ocrConfidence: panel.verified ? null : 0.79,
          verifiedById: panel.verified ? staffUserId : null,
          verifiedAt: panel.verified ? at(-panel.daysAgo + 1, 11) : null,
        },
      });
    }
  }
}

/** The pre-operative checklist, part filed and part still missing. */
async function documents(patientId: string): Promise<void> {
  await prisma.document.createMany({
    data: [
      {
        patientId,
        type: DocumentType.PASSPORT,
        fileKey: 'demo/pasaport.pdf',
        originalName: 'pasaport.pdf',
        mime: 'application/pdf',
        size: 0,
        ocrStatus: ProcessingStatus.DONE,
        aiStatus: ProcessingStatus.DONE,
        createdAt: at(-40, 12),
      },
      {
        patientId,
        type: DocumentType.CONSENT,
        fileKey: 'demo/onam.pdf',
        originalName: 'onam.pdf',
        mime: 'application/pdf',
        size: 0,
        ocrStatus: ProcessingStatus.DONE,
        aiStatus: ProcessingStatus.DONE,
        createdAt: at(-26, 12),
      },
      // Still in OCR, so the documents screen has a row in progress.
      {
        patientId,
        type: DocumentType.OTHER,
        fileKey: 'demo/ekg.pdf',
        originalName: 'ekg.pdf',
        mime: 'application/pdf',
        size: 0,
        ocrStatus: ProcessingStatus.PROCESSING,
        aiStatus: ProcessingStatus.QUEUED,
        createdAt: at(-1, 12),
      },
    ],
  });
}

/** A course being taken, mostly on time. */
async function medication(
  patientId: string,
  staffId: string,
  staffUserId: string,
): Promise<void> {
  const days = 10;

  const course = await prisma.medication.create({
    data: {
      patientId,
      drugName: 'Amoksisilin/Klavulanat',
      dose: '1000 mg',
      form: 'tablet',
      frequencyRule: 'FREQ=DAILY;COUNT=20;BYHOUR=9,21',
      startDate: at(-days, 9),
      instructions: 'Tok karnına alın.',
      prescriberId: staffId,
      approvedById: staffUserId,
      approvedAt: at(-days, 9),
    },
  });

  const doses: { at: Date; missed: boolean }[] = [];

  for (let index = 0; index < 18; index += 1) {
    const day = Math.floor(index / 2);
    const hour = index % 2 === 0 ? 9 : 21;

    doses.push({ at: at(-days + day, hour), missed: index === 7 || index === 12 });
  }

  await prisma.medicationLog.createMany({
    data: doses.map(({ at: scheduledAt, missed }) => ({
      medicationId: course.id,
      scheduledAt,
      takenAt: missed ? null : new Date(scheduledAt.getTime() + 12 * 60 * 1000),
      status: missed ? MedicationLogStatus.SKIPPED : MedicationLogStatus.TAKEN,
    })),
  });
}

/** One kept, one coming, one the patient asked for and nobody has confirmed. */
async function appointments(patientId: string, staffId: string): Promise<void> {
  await prisma.appointment.createMany({
    data: [
      {
        patientId,
        staffId,
        type: AppointmentType.SURGERY,
        status: AppointmentStatus.COMPLETED,
        scheduledAt: at(-24, 9),
        durationMinutes: 120,
        location: 'Ameliyathane 2',
        remindersSent: ['P7D', 'P1D'],
      },
      {
        patientId,
        staffId,
        type: AppointmentType.CONTROL,
        status: AppointmentStatus.CONFIRMED,
        scheduledAt: at(4, 11),
        durationMinutes: 30,
        location: 'Klinik · 2. kat',
        remindersSent: [],
      },
      {
        patientId,
        staffId,
        type: AppointmentType.VIDEO_CALL,
        status: AppointmentStatus.REQUESTED,
        scheduledAt: at(11, 15),
        durationMinutes: 30,
        note: 'Burun ucundaki şişlik için görüşmek istiyorum.',
        remindersSent: [],
      },
    ],
  });
}

/** The schedule after an operation: some kept, one missed, the rest ahead. */
async function followUp(patientId: string, surgeryId: string): Promise<void> {
  const schedule = await prisma.followUpSchedule.create({
    data: { patientId, surgeryId, surgeryDate: at(-24, 9), template: 'default' },
  });

  const milestones = [
    { label: 'D1', days: 1 },
    { label: 'W1', days: 7 },
    { label: 'M1', days: 30 },
    { label: 'M2', days: 60 },
    { label: 'M3', days: 90 },
    { label: 'M6', days: 180 },
    { label: 'Y1', days: 365 },
  ];

  await prisma.followUpMilestone.createMany({
    data: milestones.map((milestone, index) => {
      const dueAt = at(-24 + milestone.days, 11);
      const done = index < 2;

      return {
        scheduleId: schedule.id,
        label: milestone.label,
        dueAt,
        status: done
          ? MilestoneStatus.COMPLETED
          : dueAt < now
            ? MilestoneStatus.MISSED
            : MilestoneStatus.PENDING,
        completedAt: done ? dueAt : null,
      };
    }),
  });
}

/** A thread with one message the clinic has not read, triaged as urgent. */
async function conversation(
  patientId: string,
  patientUserId: string,
  staffUserId: string,
): Promise<void> {
  const thread = await prisma.conversation.create({
    data: { patientId, subject: null, lastMessageAt: at(0, 8) },
  });

  await prisma.conversationParticipant.createMany({
    data: [
      // The clinician's read mark is before the last message: unread.
      { conversationId: thread.id, userId: staffUserId, lastReadAt: at(-2, 12) },
      { conversationId: thread.id, userId: patientUserId, lastReadAt: at(0, 9) },
    ],
  });

  const messages = [
    { fromPatient: true, body: 'Merhaba, dikiş bölgesinde hafif kızarıklık var.', daysAgo: 6, triage: TriageLevel.ROUTINE },
    { fromPatient: false, body: 'Fotoğrafını gönderebilir misiniz? Pansumanı günde bir kez değiştirin.', daysAgo: 6, triage: null },
    { fromPatient: true, body: 'Bu sabah ateşim 38.4 çıktı ve kızarıklık arttı.', daysAgo: 0, triage: TriageLevel.URGENT },
  ];

  for (const message of messages) {
    await prisma.message.create({
      data: {
        conversationId: thread.id,
        senderId: message.fromPatient ? patientUserId : staffUserId,
        type: MessageType.TEXT,
        body: message.body,
        status: MessageStatus.DELIVERED,
        triageLevel: message.triage,
        createdAt: at(-message.daysAgo, message.fromPatient ? 8 : 14),
      },
    });
  }
}

/** One open past the clinic's threshold, one closed. */
async function complications(
  patientId: string,
  patientUserId: string,
  staffUserId: string,
): Promise<void> {
  await prisma.complication.create({
    data: {
      patientId,
      status: ComplicationStatus.REPORTED,
      note: 'Ameliyat bölgesinde kızarıklık ve sıcaklık var, akıntı geldi.',
      bodyArea: 'Burun',
      reportedById: patientUserId,
      reportedAt: at(0, 2),
    },
  });

  await prisma.complication.create({
    data: {
      patientId,
      status: ComplicationStatus.RESOLVED,
      note: 'Burun sırtında hafif morluk.',
      bodyArea: 'Burun',
      reportedById: patientUserId,
      reportedAt: at(-18, 20),
      acknowledgedById: staffUserId,
      acknowledgedAt: at(-18, 21),
      resolvedById: staffUserId,
      resolvedAt: at(-15, 9),
      resolution: 'Kendiliğinden geriledi, ek tedavi gerekmedi.',
    },
  });
}

async function consents(patientId: string): Promise<void> {
  for (const type of [ConsentType.DATA_PROCESSING, ConsentType.TREATMENT, ConsentType.PHOTO_USAGE]) {
    await prisma.consent.create({
      data: { patientId, type, version: 1, signedAt: at(-26, 10) },
    });
  }
}

async function travel(patientId: string, staffUserId: string): Promise<void> {
  await prisma.travelPlan.create({
    data: {
      patientId,
      arrivalFlight: 'TK1728',
      arrivalAt: at(-26, 14),
      departureFlight: 'TK1729',
      departureAt: at(-20, 16),
      hotelName: 'Nişantaşı Suites',
      hotelAddress: 'Teşvikiye Cd. No: 12, Şişli, İstanbul',
      hotelCheckIn: at(-26, 15),
      hotelCheckOut: at(-20, 11),
      greeterName: 'Murat Tekin',
      greeterPhone: '+90 555 000 00 00',
      transferNote: 'Havalimanı çıkışında isim tabelasıyla karşılanacak.',
      interpreterName: 'Elif Aydın',
      interpreterLanguage: 'de',
      interpreterPhone: '+90 555 111 11 11',
      clearedToFlyAt: at(-21, 12),
      clearedToFlyById: staffUserId,
    },
  });
}

/** A PROM template, one answered and one waiting. */
async function survey(patientId: string, surgeryId: string): Promise<void> {
  const template = await prisma.surveyTemplate.create({
    data: {
      code: 'RHINO-QOL',
      version: 1,
      title: 'Burun estetiği sonrası yaşam kalitesi',
      description: 'Son bir haftayı düşünerek yanıtlayın.',
      milestoneDays: [7, 30, 90],
      // `type` is what parseQuestions reads; a question without it is rejected
      // and takes the whole of GET /me/surveys down with it. `direction` says
      // which end of the scale is the bad one, so an alarm threshold means
      // something.
      questions: [
        {
          id: 'breathing',
          text: 'Burnunuzdan nefes almakta zorlanıyor musunuz?',
          type: SurveyAnswerType.SCALE_0_10,
          direction: 'higher-is-worse',
          alarmAt: 8,
          required: true,
        },
        {
          id: 'pain',
          text: 'Ağrınız ne düzeyde?',
          type: SurveyAnswerType.SCALE_0_10,
          direction: 'higher-is-worse',
          alarmAt: 8,
          required: true,
        },
        {
          id: 'appearance',
          text: 'Görünümünüzden memnun musunuz?',
          type: SurveyAnswerType.SCALE_0_10,
          direction: 'higher-is-better',
        },
        { id: 'note', text: 'Eklemek istediğiniz bir şey var mı?', type: SurveyAnswerType.TEXT },
      ],
    },
  });

  const answered = await prisma.surveyAssignment.create({
    data: {
      patientId,
      templateId: template.id,
      surgeryId,
      milestoneDays: 7,
      scheduledFor: at(-17, 10),
      status: SurveyStatus.COMPLETED,
      sentAt: at(-17, 10),
    },
  });

  await prisma.surveyResponse.create({
    data: {
      assignmentId: answered.id,
      patientId,
      templateCode: template.code,
      templateVersion: template.version,
      answers: { breathing: 6, pain: 4, appearance: 7 },
      scores: { total: 17, average: 5.7 },
      answeredCount: 3,
      questionCount: 4,
      submittedAt: at(-16, 19),
    },
  });

  await prisma.surveyAssignment.create({
    data: {
      patientId,
      templateId: template.id,
      surgeryId,
      milestoneDays: 30,
      // Yesterday, not the milestone's own date: `mine()` only lists what is
      // already due, and a questionnaire scheduled for next week leaves the
      // patient's survey card empty on a demo that exists to be looked at.
      scheduledFor: at(-1, 10),
      status: SurveyStatus.PENDING,
    },
  });
}

async function finance(patientId: string, agencyId: string): Promise<void> {
  const gross = 4800;
  const paid = 3000;

  const record = await prisma.financeRecord.create({
    data: {
      patientId,
      procedureName: 'Septorinoplasti',
      currency: Currency.EUR,
      grossAmount: gross,
      discount: 0,
      netAmount: gross,
      paidAmount: paid,
      paymentStatus: PaymentStatus.PARTIAL,
      agencyId,
      agencyCommission: Number((gross * 0.12).toFixed(2)),
    },
  });

  // Without a rate for the month the finance screen can add up the euros and
  // says so rather than quietly leaving them out of the total.
  await prisma.exchangeRate.create({
    data: {
      base: Currency.EUR,
      quote: Currency.TRY,
      rate: 47.2,
      validOn: at(-1, 12),
    },
  });

  await prisma.payment.create({
    data: {
      financeRecordId: record.id,
      amount: paid,
      currency: Currency.EUR,
      // Paid in the record's own currency, so nothing was converted.
      appliedAmount: paid,
      method: PaymentMethod.BANK_TRANSFER,
      reference: 'TR-2026-0918',
      paidAt: at(-26, 12),
    },
  });
}

/** One finished export, and a notification each side has waiting. */
async function exportsAndNotifications(
  patientId: string,
  staffUserId: string,
  patientUserId: string,
): Promise<void> {
  await prisma.export.create({
    data: {
      kind: ExportKind.PATIENT_SUMMARY,
      status: ProcessingStatus.DONE,
      requestedById: staffUserId,
      patientId,
      params: { includePhotos: false },
      contents: { rows: 1 },
      fileKey: 'demo/ozet.pdf',
      mime: 'application/pdf',
      size: 0,
      startedAt: at(-2, 12),
      finishedAt: at(-2, 12),
      expiresAt: at(5, 12),
    },
  });

  await prisma.notification.createMany({
    data: [
      {
        userId: staffUserId,
        type: 'complication.reported',
        title: 'Yeni şikayet bildirimi',
        body: 'Zeynep Kaya: ameliyat bölgesinde kızarıklık ve akıntı.',
        channel: NotificationChannel.PUSH,
        status: NotificationStatus.PENDING,
        createdAt: at(0, 2),
      },
      {
        userId: patientUserId,
        type: 'appointment.reminder',
        title: 'Kontrol randevunuz yaklaşıyor',
        body: 'Dört gün sonra saat 11:00, Klinik · 2. kat.',
        channel: NotificationChannel.PUSH,
        status: NotificationStatus.PENDING,
        createdAt: at(0, 7),
      },
    ],
  });
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
