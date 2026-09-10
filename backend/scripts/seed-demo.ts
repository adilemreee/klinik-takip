/**
 * Fills the demo patients with a clinic's worth of data.
 *
 * Written because the app looked broken when it was not: staging had six
 * patients and four of them were empty, the list showed an empty one first, and
 * somebody opening the app to try it tapped a blank file. Every screen worked;
 * there was nothing for them to show.
 *
 * The data is a story rather than noise. Four patients at four points in a
 * health-tourism pathway — a lead who has only asked a question, somebody
 * flying in next week, somebody scheduled a month out, somebody three months
 * past their operation — so that each screen has the state it was designed for:
 * an unread message, a lab result waiting for review, a critical value, an
 * appointment nobody has confirmed, a follow-up half done.
 *
 * **Never for production.** It refuses to run there, and it refuses without an
 * explicit opt-in besides. Made-up patients in a real clinic's records would be
 * indistinguishable from real ones the moment somebody exported a spreadsheet.
 *
 * Idempotent: a patient who already has a medical profile is left alone, so
 * running it twice does not double anybody's medication.
 *
 *   KLINIK_DEMO_SEED=yes npx ts-node scripts/seed-demo.ts
 */
import {
  AppointmentStatus,
  AppointmentType,
  ComplicationStatus,
  ConsentType,
  Currency,
  LabFlag,
  MeasurementSource,
  MeasurementType,
  MedicationLogStatus,
  MessageStatus,
  MessageType,
  MilestoneStatus,
  PaymentStatus,
  PatientStatus,
  PrismaClient,
  Role,
} from '@prisma/client';
import { foldForSearch } from '../src/patients/search-folding';

const prisma = new PrismaClient();

const DAY = 24 * 60 * 60 * 1000;
const now = new Date();

function daysFromNow(days: number, hour = 10): Date {
  const date = new Date(now.getTime() + days * DAY);
  date.setHours(hour, 0, 0, 0);

  return date;
}

/** A weight curve that looks like a person rather than a straight line. */
function weightSeries(start: number, end: number, points: number): number[] {
  return Array.from({ length: points }, (_, index) => {
    const progress = index / (points - 1);
    // A little wobble, deterministic so re-running produces the same chart.
    const wobble = Math.sin(index * 1.7) * 0.4;

    return Number((start + (end - start) * progress + wobble).toFixed(1));
  });
}

interface Story {
  /** Matched on, and created with, so a fresh database gets the demo too. */
  firstName: string;
  lastName: string;
  birthYear: number;
  sex: 'FEMALE' | 'MALE';
  country: string;
  city?: string;
  language: string;
  status: PatientStatus;
  referralSource?: string;
  profile: {
    bloodType: string;
    allergies: string[];
    chronicConditions: string[];
    currentMedications: string[];
    smoking: boolean;
    alcohol: boolean;
    targetWeightKg?: number;
    notes?: string;
  } | null;
  /**
   * The operation, past or planned.
   *
   * A negative `daysAgo` is one that has not happened yet — which is how the
   * clinic records a booking, and what the pre-operative checklist and the
   * consent form both read. `code` matches a `TEDAVI-ONAM-<code>.md` annex
   * and a procedure-specific checklist row when the clinic has written one.
   */
  surgery?: { name: string; daysAgo: number; location: string; code?: string };
  weights?: { from: number; to: number; overDays: number };
  vitals?: boolean;
  glucose?: boolean;
  labs?: { name: string; code: string; value: number; unit: string; low: number; high: number; flag: LabFlag; verified: boolean }[];
  medication?: { drug: string; dose: string; rule: string; days: number; taken: number; missed: number; stopped: boolean };
  appointments?: { type: AppointmentType; status: AppointmentStatus; inDays: number; note?: string }[];
  followUp?: { surgeryDaysAgo: number; done: number };
  messages?: { fromPatient: boolean; body: string; daysAgo: number }[];
  unread?: boolean;
  travel?: {
    arrivalFlight: string;
    arrivalInDays: number;
    departureFlight: string;
    departureInDays: number;
    hotel: string;
    greeter: string;
    interpreter?: { name: string; language: string };
    clearedToFly: boolean;
  };
  complication?: { note: string; area: string; status: ComplicationStatus; daysAgo: number };
  consents: ConsentType[];
  finance?: { procedure: string; gross: number; currency: Currency; paid: number; agency?: string };
}

/**
 * Four patients at four points in the pathway.
 *
 * Deliberately not four copies of the same person: the screens differ by what
 * state a patient is in, and a demo where everybody is three months post-op
 * shows a third of the app.
 */
const STORIES: Story[] = [
  {
    firstName: 'Çağla',
    lastName: 'Şahin',
    birthYear: 1996,
    sex: 'FEMALE',
    country: 'TR',
    city: 'İzmir',
    language: 'tr',
    status: PatientStatus.LEAD,
    referralSource: 'Instagram',
    // A lead has no clinical record, and inventing one would misrepresent what
    // the status means. What she has is a question and an appointment request —
    // which is exactly what a lead is.
    profile: null,
    appointments: [
      { type: AppointmentType.CONSULTATION, status: AppointmentStatus.REQUESTED, inDays: 4, note: 'İlk görüşme talebi' },
    ],
    // From the clinic, not from her: a lead has no account yet, so anything
    // she asked came in by another route and somebody logged it. A message
    // with no sender would render as one nobody wrote.
    messages: [
      {
        fromPatient: false,
        body: 'Instagram üzerinden gelen fiyat sorunuzu aldık. Ön görüşme için bir randevu talebi oluşturduk.',
        daysAgo: 1,
      },
    ],
    consents: [ConsentType.DATA_PROCESSING],
  },
  {
    firstName: 'Sarah',
    lastName: 'Miller',
    birthYear: 1981,
    sex: 'FEMALE',
    country: 'GB',
    city: 'Manchester',
    language: 'en',
    status: PatientStatus.PRE_OP,
    referralSource: 'Google',
    profile: {
      bloodType: '0 Rh−',
      allergies: ['Penisilin', 'Lateks'],
      chronicConditions: ['Hipertansiyon'],
      currentMedications: ['Ramipril 5 mg'],
      smoking: false,
      alcohol: true,
      targetWeightKg: 62,
      notes: 'Uçuş öncesi tansiyon takibi isteniyor.',
    },
    // Booked, not done: six days out, which is what the checklist and the
    // consent form read to know which operation this patient is having.
    surgery: {
      name: 'Meme Büyütme',
      code: 'BREAST_AUGMENTATION',
      daysAgo: -6,
      location: 'Ameliyathane 1',
    },
    weights: { from: 68.5, to: 66.2, overDays: 60 },
    vitals: true,
    labs: [
      { name: 'Hemoglobin', code: '718-7', value: 9.1, unit: 'g/dL', low: 12, high: 16, flag: LabFlag.CRITICAL, verified: true },
      { name: 'Lökosit', code: '6690-2', value: 7.4, unit: '10³/µL', low: 4, high: 11, flag: LabFlag.NORMAL, verified: false },
      { name: 'Trombosit', code: '777-3', value: 240, unit: '10³/µL', low: 150, high: 400, flag: LabFlag.NORMAL, verified: false },
    ],
    medication: { drug: 'Ramipril', dose: '5 mg', rule: 'FREQ=DAILY;COUNT=60;BYHOUR=9', days: 30, taken: 26, missed: 4, stopped: false },
    appointments: [
      { type: AppointmentType.CONSULTATION, status: AppointmentStatus.CONFIRMED, inDays: 5, note: 'Ameliyat öncesi değerlendirme' },
      { type: AppointmentType.SURGERY, status: AppointmentStatus.CONFIRMED, inDays: 6 },
    ],
    messages: [
      { fromPatient: false, body: 'Tahlil sonuçlarınızı aldık, doktorunuz inceleyecek.', daysAgo: 3 },
      { fromPatient: true, body: 'Hemoglobin değerim düşük çıktı, ameliyat ertelenecek mi?', daysAgo: 1 },
    ],
    unread: true,
    travel: {
      arrivalFlight: 'BA676',
      arrivalInDays: 4,
      departureFlight: 'BA677',
      departureInDays: 13,
      hotel: 'Nişantaşı Suites',
      greeter: 'Emre Koç',
      interpreter: { name: 'Julia Ross', language: 'en' },
      clearedToFly: false,
    },
    complication: { note: 'Bacaklarda şişlik, uçuş sonrası.', area: 'Bacak', status: ComplicationStatus.REPORTED, daysAgo: 1 },
    consents: [ConsentType.DATA_PROCESSING],
  },
  {
    firstName: 'Ahmed',
    lastName: 'Al-Rashid',
    birthYear: 1978,
    sex: 'MALE',
    country: 'SA',
    city: 'Riyad',
    language: 'ar',
    status: PatientStatus.SCHEDULED,
    referralSource: 'Aracı kurum',
    profile: {
      bloodType: 'B Rh+',
      allergies: [],
      chronicConditions: ['Tip 2 diyabet'],
      currentMedications: ['Metformin 1000 mg'],
      smoking: true,
      alcohol: false,
      targetWeightKg: 88,
      notes: 'Ameliyat öncesi HbA1c hedefi < 7.',
    },
    weights: { from: 101.0, to: 96.4, overDays: 90 },
    vitals: true,
    glucose: true,
    labs: [
      { name: 'HbA1c', code: '4548-4', value: 7.4, unit: '%', low: 4, high: 5.7, flag: LabFlag.HIGH, verified: true },
      { name: 'Açlık glukozu', code: '1558-6', value: 132, unit: 'mg/dL', low: 70, high: 100, flag: LabFlag.HIGH, verified: true },
    ],
    medication: { drug: 'Metformin', dose: '1000 mg', rule: 'FREQ=DAILY;COUNT=120;BYHOUR=9,21', days: 40, taken: 68, missed: 12, stopped: false },
    appointments: [
      { type: AppointmentType.SURGERY, status: AppointmentStatus.CONFIRMED, inDays: 21 },
    ],
    messages: [
      { fromPatient: true, body: 'Metformin dozumu ameliyattan önce kesmem gerekir mi?', daysAgo: 5 },
      { fromPatient: false, body: 'Ameliyattan 24 saat önce kesiyoruz, size ayrıca hatırlatacağız.', daysAgo: 5 },
    ],
    travel: {
      arrivalFlight: 'SV263',
      arrivalInDays: 19,
      departureFlight: 'SV264',
      departureInDays: 30,
      hotel: 'Levent Park Hotel',
      greeter: 'Emre Koç',
      interpreter: { name: 'Layla Haddad', language: 'ar' },
      clearedToFly: false,
    },
    consents: [ConsentType.DATA_PROCESSING, ConsentType.TREATMENT],
    finance: { procedure: 'Sleeve gastrektomi', gross: 8500, currency: Currency.EUR, paid: 2500, agency: 'Gulf Health Bridge' },
  },
  {
    firstName: 'Mehmet',
    lastName: 'Öztürk',
    birthYear: 1989,
    sex: 'MALE',
    country: 'TR',
    city: 'Ankara',
    language: 'tr',
    status: PatientStatus.FOLLOW_UP,
    referralSource: 'Referans',
    profile: {
      bloodType: 'A Rh+',
      allergies: [],
      chronicConditions: [],
      currentMedications: [],
      smoking: false,
      alcohol: false,
      targetWeightKg: 78,
    },
    surgery: {
      name: 'Septorinoplasti',
      code: 'SEPTORHINOPLASTY',
      daysAgo: 95,
      location: 'Ameliyathane 2',
    },
    weights: { from: 84.0, to: 79.5, overDays: 95 },
    vitals: true,
    labs: [
      { name: 'Hemoglobin', code: '718-7', value: 14.2, unit: 'g/dL', low: 12, high: 16, flag: LabFlag.NORMAL, verified: true },
      { name: 'CRP', code: '1988-5', value: 2.1, unit: 'mg/L', low: 0, high: 5, flag: LabFlag.NORMAL, verified: true },
    ],
    medication: { drug: 'Amoksisilin', dose: '500 mg', rule: 'FREQ=DAILY;COUNT=16;BYHOUR=9,21', days: 8, taken: 15, missed: 1, stopped: true },
    appointments: [
      { type: AppointmentType.CONTROL, status: AppointmentStatus.COMPLETED, inDays: -60 },
      { type: AppointmentType.CONTROL, status: AppointmentStatus.CONFIRMED, inDays: 85 },
    ],
    followUp: { surgeryDaysAgo: 95, done: 4 },
    messages: [
      { fromPatient: true, body: 'Üçüncü ay kontrolüne gelemedim, ne zaman gelebilirim?', daysAgo: 10 },
      { fromPatient: false, body: 'Altıncı ay kontrolünüzde birlikte değerlendirelim, randevunuzu oluşturduk.', daysAgo: 10 },
    ],
    complication: { note: 'Burun sırtında hafif kızarıklık.', area: 'Burun', status: ComplicationStatus.RESOLVED, daysAgo: 70 },
    consents: [ConsentType.DATA_PROCESSING, ConsentType.TREATMENT, ConsentType.PHOTO_USAGE],
  },
];

async function main(): Promise<void> {
  // `APP_ENV`, not `NODE_ENV`. Staging runs a production *build* — NODE_ENV is
  // `production` there and correctly so — and guarding on it blocked the one
  // environment this script exists for. APP_ENV is the deployment, and the
  // config schema validates it against `local | staging | production`.
  if (process.env.APP_ENV === 'production') {
    throw new Error('seed-demo refuses to run against production');
  }

  if (process.env.KLINIK_DEMO_SEED !== 'yes') {
    throw new Error('Set KLINIK_DEMO_SEED=yes to confirm this is a demo database');
  }

  const doctor = await prisma.staffProfile.findFirst({
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true } } },
  });

  if (!doctor) throw new Error('No staff profile to attribute the records to');

  let filled = 0;

  for (const story of STORIES) {
    let patient = await prisma.patient.findFirst({
      where: { firstName: story.firstName, lastName: story.lastName, deletedAt: null },
      include: { medicalProfile: true, user: { select: { id: true } } },
    });

    // Created when absent, so a fresh database gets the demo rather than
    // depending on patients somebody made by hand once.
    if (!patient) {
      const created = await prisma.patient.create({
        data: {
          mrn: await nextMrn(),
          firstName: story.firstName,
          lastName: story.lastName,
          searchText: foldForSearch(`${story.firstName} ${story.lastName}`),
          birthDate: new Date(Date.UTC(story.birthYear, 4, 12)),
          sex: story.sex,
          country: story.country,
          city: story.city ?? null,
          preferredLanguage: story.language,
          referralSource: story.referralSource ?? null,
          status: story.status,
          assignedDoctorId: doctor.id,
        },
      });

      patient = { ...created, medicalProfile: null, user: null };
      console.log(`created ${story.firstName} ${story.lastName} (${created.mrn})`);
    }

    // The marker for "already filled". A patient with a profile — or, for the
    // lead who has none by design, with a message — is left alone.
    //
    // Messages rather than conversations: opening a chat creates an empty
    // conversation, so counting those read a patient nobody had written to as
    // already done.
    const already = story.profile
      ? patient.medicalProfile !== null
      : (await prisma.message.count({ where: { conversation: { patientId: patient.id } } })) > 0;

    if (already) {
      console.log(`skipped ${story.firstName}: already has data`);
      continue;
    }

    await fill(story, patient.id, patient.user?.id ?? null, doctor.id, doctor.user.id);
    filled += 1;
    console.log(`filled ${story.firstName} ${patient.lastName}`);
  }

  console.log(`\n${filled} patient file(s) filled.`);
}

async function fill(
  story: Story,
  patientId: string,
  patientUserId: string | null,
  staffId: string,
  staffUserId: string,
): Promise<void> {
  if (story.profile) {
    const { targetWeightKg, ...rest } = story.profile;

    await prisma.medicalProfile.create({
      data: { patientId, ...rest, targetWeightKg: targetWeightKg ?? null },
    });
  }

  // Whoever is looking after them. Without this the file's care team is empty
  // and — more to the point — scope-limited staff cannot see the patient.
  //
  // There is no unique key on (patient, staff): the table records assignments
  // over time, and the same person can be assigned, unassigned and assigned
  // again. So this checks for a live one rather than upserting.
  const assigned = await prisma.patientAssignment.count({
    where: { patientId, staffId, unassignedAt: null },
  });

  if (assigned === 0) {
    await prisma.patientAssignment.create({ data: { patientId, staffId, role: Role.DOCTOR } });
  }

  let surgeryId: string | null = null;

  if (story.surgery) {
    const surgery = await prisma.surgery.create({
      data: {
        patientId,
        procedureName: story.surgery.name,
        procedureCode: story.surgery.code,
        performedAt: daysFromNow(-story.surgery.daysAgo, 9),
        surgeonId: staffId,
        location: story.surgery.location,
      },
    });

    surgeryId = surgery.id;
  }

  if (story.weights) {
    const points = 12;
    const values = weightSeries(story.weights.from, story.weights.to, points);

    await prisma.measurement.createMany({
      data: values.map((value, index) => ({
        patientId,
        type: MeasurementType.WEIGHT,
        value,
        unit: 'kg',
        measuredAt: daysFromNow(-story.weights!.overDays + (index * story.weights!.overDays) / (points - 1), 8),
        source: index % 3 === 0 ? MeasurementSource.NURSE : MeasurementSource.PATIENT,
      })),
    });

    // A height, so the BMI curve has something to divide by.
    await prisma.measurement.create({
      data: {
        patientId,
        type: MeasurementType.HEIGHT,
        value: 172,
        unit: 'cm',
        measuredAt: daysFromNow(-story.weights.overDays, 8),
        source: MeasurementSource.NURSE,
      },
    });
  }

  if (story.vitals) {
    await prisma.measurement.createMany({
      data: [0, 7, 14, 21, 28].flatMap((back) => [
        {
          patientId,
          type: MeasurementType.BLOOD_PRESSURE,
          value: 128 + (back % 3) * 4,
          secondaryValue: 82 + (back % 2) * 3,
          unit: 'mmHg',
          measuredAt: daysFromNow(-back, 9),
          source: MeasurementSource.NURSE,
        },
        {
          patientId,
          type: MeasurementType.PULSE,
          value: 72 + (back % 4) * 3,
          unit: 'bpm',
          measuredAt: daysFromNow(-back, 9),
          source: MeasurementSource.DEVICE,
        },
      ]),
    });
  }

  if (story.glucose) {
    await prisma.measurement.createMany({
      data: [0, 3, 6, 9, 12, 15, 18, 21].map((back) => ({
        patientId,
        type: MeasurementType.GLUCOSE,
        value: 118 + Math.round(Math.sin(back) * 14),
        unit: 'mg/dL',
        measuredAt: daysFromNow(-back, 7),
        source: MeasurementSource.PATIENT,
      })),
    });
  }

  for (const [index, lab] of (story.labs ?? []).entries()) {
    await prisma.labResult.create({
      data: {
        patientId,
        analyteCode: lab.code,
        analyteName: lab.name,
        value: lab.value,
        unit: lab.unit,
        refLow: lab.low,
        refHigh: lab.high,
        flag: lab.flag,
        measuredAt: daysFromNow(-3 - index, 8),
        // Unverified results carry an OCR confidence, because that is what they
        // are: something a machine read and nobody has confirmed (spec M16).
        ocrConfidence: lab.verified ? null : 0.82,
        verifiedById: lab.verified ? staffUserId : null,
        verifiedAt: lab.verified ? daysFromNow(-2 - index, 11) : null,
      },
    });
  }

  if (story.medication) {
    const medication = await prisma.medication.create({
      data: {
        patientId,
        drugName: story.medication.drug,
        dose: story.medication.dose,
        form: 'tablet',
        frequencyRule: story.medication.rule,
        startDate: daysFromNow(-story.medication.days, 9),
        instructions: 'Tok karnına alın.',
        prescriberId: staffId,
        approvedById: staffUserId,
        approvedAt: daysFromNow(-story.medication.days, 9),
        stoppedAt: story.medication.stopped ? daysFromNow(-1, 12) : null,
      },
    });

    // One row per scheduled dose, at the hours the rule names. The table has a
    // unique key on (medication, scheduled_at) — because a dose is one moment —
    // so the times have to be the real ones rather than an index over a day.
    const hours = doseHours(story.medication.rule);
    const total = story.medication.taken + story.medication.missed;
    const doses: { at: Date; missed: boolean }[] = [];

    for (let index = 0; index < total; index += 1) {
      const day = Math.floor(index / hours.length);
      const hour = hours[index % hours.length]!;

      doses.push({
        at: daysFromNow(-story.medication.days + day, hour),
        // Spread the misses rather than clustering them at the start, so the
        // adherence figure comes from a plausible pattern.
        missed: index % 6 === 4 && doses.filter((d) => d.missed).length < story.medication.missed,
      });
    }

    await prisma.medicationLog.createMany({
      data: doses.map(({ at, missed }) => ({
        medicationId: medication.id,
        scheduledAt: at,
        takenAt: missed ? null : new Date(at.getTime() + 15 * 60 * 1000),
        status: missed ? MedicationLogStatus.SKIPPED : MedicationLogStatus.TAKEN,
      })),
    });
  }

  for (const appointment of story.appointments ?? []) {
    await prisma.appointment.create({
      data: {
        patientId,
        staffId,
        type: appointment.type,
        status: appointment.status,
        scheduledAt: daysFromNow(appointment.inDays, 11),
        durationMinutes: appointment.type === AppointmentType.SURGERY ? 120 : 30,
        location: 'Klinik',
        note: appointment.note ?? null,
        remindersSent: [],
      },
    });
  }

  if (story.followUp) {
    const schedule = await prisma.followUpSchedule.create({
      data: {
        patientId,
        surgeryId,
        surgeryDate: daysFromNow(-story.followUp.surgeryDaysAgo, 9),
        template: 'default',
      },
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
        const dueAt = daysFromNow(-story.followUp!.surgeryDaysAgo + milestone.days, 11);
        const done = index < story.followUp!.done;

        return {
          scheduleId: schedule.id,
          label: milestone.label,
          dueAt,
          // Past and not done is missed, not pending: a milestone whose date
          // has gone by and which still says "waiting" is a schedule nobody
          // trusts.
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

  const last = story.messages?.[story.messages.length - 1];

  if (story.messages?.length && last) {
    // Reused when one already exists: a patient has one conversation with the
    // clinic, and opening the chat screen creates it whether or not anybody
    // wrote anything.
    const existing = await prisma.conversation.findFirst({ where: { patientId } });

    const conversation =
      existing ??
      (await prisma.conversation.create({ data: { patientId, subject: null } }));

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: daysFromNow(-last.daysAgo, 14) },
    });

    await prisma.conversationParticipant.deleteMany({
      where: { conversationId: conversation.id },
    });

    await prisma.conversationParticipant.createMany({
      data: [
        {
          conversationId: conversation.id,
          userId: staffUserId,
          // Unread means the clinician's read mark is before the last message.
          lastReadAt: story.unread ? daysFromNow(-last.daysAgo - 1, 12) : daysFromNow(0, 23),
        },
        ...(patientUserId ? [{ conversationId: conversation.id, userId: patientUserId }] : []),
      ],
    });

    for (const message of story.messages) {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: message.fromPatient ? patientUserId : staffUserId,
          type: MessageType.TEXT,
          body: message.body,
          status: MessageStatus.DELIVERED,
          createdAt: daysFromNow(-message.daysAgo, 14),
        },
      });
    }
  }

  if (story.travel) {
    await prisma.travelPlan.create({
      data: {
        patientId,
        arrivalFlight: story.travel.arrivalFlight,
        arrivalAt: daysFromNow(story.travel.arrivalInDays, 14),
        departureFlight: story.travel.departureFlight,
        departureAt: daysFromNow(story.travel.departureInDays, 16),
        hotelName: story.travel.hotel,
        hotelAddress: 'Teşvikiye Cd. No: 12, Şişli, İstanbul',
        hotelCheckIn: daysFromNow(story.travel.arrivalInDays, 15),
        hotelCheckOut: daysFromNow(story.travel.departureInDays, 11),
        greeterName: story.travel.greeter,
        greeterPhone: '+90 555 000 00 00',
        transferNote: 'Havalimanı çıkışında isim tabelasıyla karşılanacak.',
        interpreterName: story.travel.interpreter?.name ?? null,
        interpreterLanguage: story.travel.interpreter?.language ?? null,
        interpreterPhone: story.travel.interpreter ? '+90 555 111 11 11' : null,
        clearedToFlyAt: story.travel.clearedToFly ? daysFromNow(-1, 12) : null,
        clearedToFlyById: story.travel.clearedToFly ? staffUserId : null,
      },
    });
  }

  if (story.complication) {
    await prisma.complication.create({
      data: {
        patientId,
        status: story.complication.status,
        note: story.complication.note,
        bodyArea: story.complication.area,
        reportedById: patientUserId,
        reportedAt: daysFromNow(-story.complication.daysAgo, 20),
        acknowledgedById:
          story.complication.status === ComplicationStatus.REPORTED ? null : staffUserId,
        acknowledgedAt:
          story.complication.status === ComplicationStatus.REPORTED
            ? null
            : daysFromNow(-story.complication.daysAgo + 1, 9),
        resolvedById:
          story.complication.status === ComplicationStatus.RESOLVED ? staffUserId : null,
        resolvedAt:
          story.complication.status === ComplicationStatus.RESOLVED
            ? daysFromNow(-story.complication.daysAgo + 3, 9)
            : null,
        resolution:
          story.complication.status === ComplicationStatus.RESOLVED
            ? 'Kendiliğinden geriledi, ek tedavi gerekmedi.'
            : null,
      },
    });
  }

  for (const type of story.consents) {
    await prisma.consent.create({
      data: {
        patientId,
        type,
        version: 1,
        signedAt: daysFromNow(-40, 10),
      },
    });
  }

  if (story.finance) {
    const agency = story.finance.agency
      ? await prisma.agency.upsert({
          where: { id: await agencyId(story.finance.agency) },
          create: {
            name: story.finance.agency,
            country: 'SA',
            contactName: 'Omar Nasser',
            contactEmail: 'omar@gulfhealthbridge.example',
            commissionRate: 0.12,
          },
          update: {},
        })
      : null;

    const net = story.finance.gross;

    await prisma.financeRecord.create({
      data: {
        patientId,
        procedureName: story.finance.procedure,
        currency: story.finance.currency,
        grossAmount: story.finance.gross,
        discount: 0,
        netAmount: net,
        paidAmount: story.finance.paid,
        paymentStatus:
          story.finance.paid >= net
            ? PaymentStatus.PAID
            : story.finance.paid > 0
              ? PaymentStatus.PARTIAL
              : PaymentStatus.PENDING,
        agencyId: agency?.id ?? null,
        agencyCommission: agency ? Number((net * 0.12).toFixed(2)) : null,
      },
    });
  }
}

/** The hours a `BYHOUR=` rule names, or nine in the morning if it names none. */
function doseHours(rule: string): number[] {
  const match = /BYHOUR=([0-9,]+)/.exec(rule);

  if (!match?.[1]) return [9];

  return match[1].split(',').map(Number);
}

/**
 * The next demo file number.
 *
 * Deliberately in the clinic's own format rather than a UUID: the number is
 * what gets written on paper, and a demo whose file numbers look nothing like
 * the real ones teaches somebody the wrong shape.
 */
async function nextMrn(): Promise<string> {
  const year = now.getFullYear();

  for (let attempt = 1; attempt < 1000; attempt += 1) {
    const mrn = `${year}-DEMO${String(attempt).padStart(2, '0')}`;
    const taken = await prisma.patient.count({ where: { mrn } });

    if (taken === 0) return mrn;
  }

  throw new Error('Could not find a free demo file number');
}

/** The agency's id if it exists, or a value that will never match. */
async function agencyId(name: string): Promise<string> {
  const existing = await prisma.agency.findFirst({ where: { name }, select: { id: true } });

  return existing?.id ?? '00000000-0000-0000-0000-000000000000';
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
