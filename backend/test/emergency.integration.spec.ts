import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  AuditAction,
  EmergencyStatus,
  NotificationChannel,
  PrismaClient,
  Role,
  Sex,
  UserStatus,
} from '@prisma/client';
import { generateSync } from 'otplib';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { isStaffRole } from '../src/auth/auth.errors';
import { configureApp } from '../src/bootstrap';
import { Env } from '../src/config/env.schema';
import { hashPassword } from '../src/crypto/hashing';
import { EmergencyService } from '../src/emergency/emergency.service';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';
import { NOTIFICATION_TYPES } from '../src/notifications/templates';

interface PatientView {
  event: {
    id: string;
    status: string;
    escalationLevel: number;
    latitude: string | null;
    longitude: string | null;
    note: string | null;
  };
  guidance: {
    language: string;
    emergencyNumber: { number: string; countryCode: string; source: string };
    steps: { id: string; text: string; critical: boolean }[];
  };
  alreadyOpen: boolean;
}

interface StaffView {
  event: { id: string; status: string; escalationLevel: number; resolution: string | null };
  summary: {
    fullName: string;
    bloodType: string | null;
    allergies: string[];
    lastSurgery: { procedureName: string; daysAgo: number } | null;
  };
  waitingMinutes: number;
  responseMinutes: number | null;
  unanswered: boolean;
}

interface Actor {
  token: string;
  userId: string;
  staffId?: string;
}

/**
 * The panic button (spec M8).
 *
 * Everything in this suite is about one question: did somebody's phone actually
 * ring? The alarm being *recorded* is the easy half, and it is the half that
 * looks fine in a demo while the other half has never worked.
 */
describe('the emergency button', () => {
  const prisma = new PrismaClient();
  const userIds: string[] = [];
  const staffProfiles: string[] = [];
  const patientIds: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let emergency: EmergencyService;

  const PASSWORD = 'correct-horse-battery-9';

  const actorFor = async (role: Role): Promise<Actor> => {
    const email = `er-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: {
        role,
        email,
        phone: `+9055${Math.floor(Math.random() * 100_000_000).toString().padStart(8, '0')}`,
        passwordHash: await hashPassword(PASSWORD),
        status: UserStatus.ACTIVE,
      },
    });
    userIds.push(user.id);

    if (isStaffRole(role)) {
      const profile = await prisma.staffProfile.create({
        data: { userId: user.id, firstName: 'Er', lastName: role },
      });
      staffProfiles.push(profile.id);

      const setup = await auth.beginTotpEnrolment(user.id);
      await auth.confirmTotpEnrolment(user.id, generateSync({ secret: setup.secret }));
      const login = await auth.login(email, PASSWORD, generateSync({ secret: setup.secret }), {});

      return { token: login.tokens!.accessToken, userId: user.id, staffId: profile.id };
    }

    const login = await auth.login(email, PASSWORD, undefined, {});
    return { token: login.tokens!.accessToken, userId: user.id };
  };

  const makePatient = async (
    userId?: string,
    options: { country?: string; language?: string; doctorStaffId?: string } = {},
  ): Promise<string> => {
    const patient = await prisma.patient.create({
      data: {
        mrn: `MRN-ER-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        firstName: 'Deniz',
        lastName: 'Kaya',
        birthDate: new Date('1979-06-04'),
        sex: Sex.FEMALE,
        country: options.country ?? 'DE',
        preferredLanguage: options.language ?? 'tr',
        assignedDoctorId: options.doctorStaffId,
        userId,
      },
    });
    patientIds.push(patient.id);
    return patient.id;
  };

  const assign = async (patientId: string, staffId: string, role: Role): Promise<void> => {
    await prisma.patientAssignment.create({ data: { patientId, staffId, role } });
  };

  const press = (token: string, body: Record<string, unknown> = {}): request.Test =>
    request(server).post('/me/emergency').set('Authorization', `Bearer ${token}`).send(body);

  /**
   * Counted per channel on purpose.
   *
   * A push that fails opens the fallback chain, which writes a second row of
   * the same type on SMS — so counting by type alone answers "how many attempts
   * were made", not "did the phone ring". In this environment every sender
   * reports failure, so every alert has both.
   */
  const notificationsFor = async (
    userId: string,
    type: string,
    channel: NotificationChannel = NotificationChannel.PUSH,
  ): Promise<number> => prisma.notification.count({ where: { userId, type, channel } });

  /** Moves an event back in time so the sweep sees the ladder as due. */
  const age = async (eventId: string, minutes: number): Promise<void> => {
    await prisma.emergencyEvent.update({
      where: { id: eventId },
      data: { triggeredAt: new Date(Date.now() - minutes * 60_000) },
    });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(StorageService)
      .useValue({ ping: jest.fn().mockResolvedValue(undefined) })
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app, app.get(ConfigService<Env, true>));
    await app.init();

    server = app.getHttpServer() as Server;
    auth = app.get(AuthService);
    emergency = app.get(EmergencyService);

    const redis = app.get(RedisService);
    await redis.waitUntilReady();
    await redis.client.flushdb();
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.notificationPreference.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.emergencyEvent.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.surgery.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.medicalProfile.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patientAssignment.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  describe('pressing it', () => {
    it('raises the alarm and hands back the card in one round trip', async () => {
      const patient = await actorFor(Role.PATIENT);
      await makePatient(patient.userId, { country: 'GB', language: 'en' });

      const view = (await press(patient.token, { note: 'Dikişten kanama var' }).expect(201))
        .body as PatientView;

      expect(view.event.status).toBe(EmergencyStatus.TRIGGERED);
      expect(view.event.note).toBe('Dikişten kanama var');
      expect(view.alreadyOpen).toBe(false);
      // The card comes back with the alarm rather than in a second request: the
      // moment it is needed is the moment the connection is worst.
      expect(view.guidance.emergencyNumber.number).toBe('999');
      expect(view.guidance.steps.filter((step) => step.critical)).toHaveLength(1);
    });

    /**
     * A patient in trouble presses again when nothing visibly happens, and a
     * flaky connection retries on its own. Two events would mean two escalation
     * ladders, and the second keeps climbing after somebody answered the first.
     */
    it('does not start a second alarm when the button is pressed twice', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      const first = (await press(patient.token).expect(201)).body as PatientView;
      const second = (await press(patient.token).expect(201)).body as PatientView;

      expect(second.event.id).toBe(first.event.id);
      expect(second.alreadyOpen).toBe(true);
      expect(await prisma.emergencyEvent.count({ where: { patientId } })).toBe(1);
    });

    it('keeps a real location', async () => {
      const patient = await actorFor(Role.PATIENT);
      await makePatient(patient.userId);

      const view = (await press(patient.token, { latitude: 41.0082, longitude: 28.9784 }).expect(201))
        .body as PatientView;

      expect(Number(view.event.latitude)).toBeCloseTo(41.0082, 4);
      expect(Number(view.event.longitude)).toBeCloseTo(28.9784, 4);
    });

    /**
     * The decision this test exists to pin down: a bad fix costs the pin, not
     * the alarm. Validating the range in the DTO would turn a phone that had
     * not got a lock yet into a 400 — and a 400 here means the patient pressed
     * the button and nothing happened.
     */
    it('still raises the alarm when the phone reports a nonsense location', async () => {
      const patient = await actorFor(Role.PATIENT);
      await makePatient(patient.userId);

      const view = (await press(patient.token, { latitude: 0, longitude: 0 }).expect(201))
        .body as PatientView;

      expect(view.event.status).toBe(EmergencyStatus.TRIGGERED);
      expect(view.event.latitude).toBeNull();
      expect(view.event.longitude).toBeNull();
    });

    it('serves the card on its own, so the app can hold it before anything is wrong', async () => {
      const patient = await actorFor(Role.PATIENT);
      await makePatient(patient.userId, { country: 'US' });

      const card = (
        await request(server)
          .get('/me/emergency/guidance')
          .set('Authorization', `Bearer ${patient.token}`)
          .expect(200)
      ).body as PatientView['guidance'];

      expect(card.emergencyNumber.number).toBe('911');
      expect(card.steps.some((step) => step.text.includes('911'))).toBe(true);
    });
  });

  describe('who gets woken', () => {
    it('alerts the assigned nurse the moment the button is pressed', async () => {
      const nurse = await actorFor(Role.NURSE);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await assign(patientId, nurse.staffId!, Role.NURSE);

      await press(patient.token).expect(201);

      expect(await notificationsFor(nurse.userId, NOTIFICATION_TYPES.emergencyTriggered)).toBe(1);
    });

    /**
     * The rung the ladder exists for. Two minutes with no answer and the
     * coordinator's phone goes; five and the doctor's does.
     */
    it('climbs to the coordinator at two minutes and the doctor at five', async () => {
      const nurse = await actorFor(Role.NURSE);
      const coordinator = await actorFor(Role.COORDINATOR);
      const doctor = await actorFor(Role.DOCTOR);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId, { doctorStaffId: doctor.staffId });
      await assign(patientId, nurse.staffId!, Role.NURSE);
      await assign(patientId, coordinator.staffId!, Role.COORDINATOR);

      const view = (await press(patient.token).expect(201)).body as PatientView;

      await age(view.event.id, 2);
      await emergency.escalateDue();

      expect(await notificationsFor(coordinator.userId, NOTIFICATION_TYPES.emergencyEscalated)).toBe(1);
      expect(await notificationsFor(doctor.userId, NOTIFICATION_TYPES.emergencyEscalated)).toBe(0);

      await age(view.event.id, 5);
      await emergency.escalateDue();

      expect(await notificationsFor(doctor.userId, NOTIFICATION_TYPES.emergencyEscalated)).toBe(1);
      expect(
        (await prisma.emergencyEvent.findUniqueOrThrow({ where: { id: view.event.id } }))
          .escalationLevel,
      ).toBe(2);
    });

    /**
     * A worker that restarted arrives late with both rungs due at once. Firing
     * them together would spend the whole ladder in one step and leave nobody
     * in reserve.
     */
    it('climbs one rung per sweep even when the sweep is very late', async () => {
      const nurse = await actorFor(Role.NURSE);
      const coordinator = await actorFor(Role.COORDINATOR);
      const doctor = await actorFor(Role.DOCTOR);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId, { doctorStaffId: doctor.staffId });
      await assign(patientId, nurse.staffId!, Role.NURSE);
      await assign(patientId, coordinator.staffId!, Role.COORDINATOR);

      const view = (await press(patient.token).expect(201)).body as PatientView;
      await age(view.event.id, 60);
      await emergency.escalateDue();

      expect(await notificationsFor(doctor.userId, NOTIFICATION_TYPES.emergencyEscalated)).toBe(0);
      expect(
        (await prisma.emergencyEvent.findUniqueOrThrow({ where: { id: view.event.id } }))
          .escalationLevel,
      ).toBe(1);
    });

    /**
     * The collapse rule, end to end: a patient with no nurse assigned must not
     * spend the first two minutes — most of the time this feature has — in
     * silence.
     */
    it('gives the first alarm to the coordinator when no nurse is assigned', async () => {
      const coordinator = await actorFor(Role.COORDINATOR);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await assign(patientId, coordinator.staffId!, Role.COORDINATOR);

      await press(patient.token).expect(201);

      expect(await notificationsFor(coordinator.userId, NOTIFICATION_TYPES.emergencyTriggered)).toBe(1);
    });

    /**
     * A patient with no care team at all is precisely the patient nobody is
     * watching. The floor under the ladder is everyone who may receive one.
     */
    it('falls through to the emergency rota for a patient with no care team', async () => {
      const onRota = await actorFor(Role.DOCTOR);
      const patient = await actorFor(Role.PATIENT);
      await makePatient(patient.userId);

      await press(patient.token).expect(201);

      expect(await notificationsFor(onRota.userId, NOTIFICATION_TYPES.emergencyTriggered)).toBe(1);
    });

    /**
     * The spec asks for push *and* SMS. The SMS is not a duplicate — it is what
     * reaches a phone that has no data but still has signal, which is a large
     * share of the times a patient abroad presses this.
     */
    it('follows the alert onto SMS when the push does not land', async () => {
      const nurse = await actorFor(Role.NURSE);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await assign(patientId, nurse.staffId!, Role.NURSE);

      await press(patient.token).expect(201);

      expect(
        await notificationsFor(
          nurse.userId,
          NOTIFICATION_TYPES.emergencyTriggered,
          NotificationChannel.SMS,
        ),
      ).toBe(1);
    });

    /**
     * An alert you can turn off is an alert that will be off on the night it
     * matters, and the person who turned it off will not remember doing so.
     */
    it('ignores a notification preference that would silence it', async () => {
      const nurse = await actorFor(Role.NURSE);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await assign(patientId, nurse.staffId!, Role.NURSE);

      await prisma.notificationPreference.create({
        data: {
          userId: nurse.userId,
          type: NOTIFICATION_TYPES.emergencyTriggered,
          channel: NotificationChannel.PUSH,
          enabled: false,
        },
      });

      await press(patient.token).expect(201);

      expect(await notificationsFor(nurse.userId, NOTIFICATION_TYPES.emergencyTriggered)).toBe(1);
    });
  });

  describe('answering it', () => {
    it('stops the ladder and tells the patient somebody has it', async () => {
      const nurse = await actorFor(Role.NURSE);
      const coordinator = await actorFor(Role.COORDINATOR);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await assign(patientId, nurse.staffId!, Role.NURSE);
      await assign(patientId, coordinator.staffId!, Role.COORDINATOR);

      const view = (await press(patient.token).expect(201)).body as PatientView;

      const answered = (
        await request(server)
          .patch(`/emergency/${view.event.id}/acknowledge`)
          .set('Authorization', `Bearer ${nurse.token}`)
          .expect(200)
      ).body as StaffView;

      expect(answered.event.status).toBe(EmergencyStatus.ACKNOWLEDGED);
      expect(answered.responseMinutes).not.toBeNull();

      // The patient has been staring at a screen with no idea anyone saw it.
      expect(await notificationsFor(patient.userId, NOTIFICATION_TYPES.emergencyAcknowledged)).toBe(1);

      await age(view.event.id, 30);
      await emergency.escalateDue();

      expect(await notificationsFor(coordinator.userId, NOTIFICATION_TYPES.emergencyEscalated)).toBe(0);
    });

    it('refuses a second pick-up, so the response time stays the first one', async () => {
      const nurse = await actorFor(Role.NURSE);
      const other = await actorFor(Role.NURSE);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await assign(patientId, nurse.staffId!, Role.NURSE);

      const view = (await press(patient.token).expect(201)).body as PatientView;

      await request(server)
        .patch(`/emergency/${view.event.id}/acknowledge`)
        .set('Authorization', `Bearer ${nurse.token}`)
        .expect(200);

      await request(server)
        .patch(`/emergency/${view.event.id}/acknowledge`)
        .set('Authorization', `Bearer ${other.token}`)
        .expect(400);
    });

    it('puts blood type, allergies and the last operation on the clinician\'s screen', async () => {
      const nurse = await actorFor(Role.NURSE);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await assign(patientId, nurse.staffId!, Role.NURSE);
      await prisma.medicalProfile.create({
        data: { patientId, bloodType: '0 Rh-', allergies: ['penisilin'], chronicConditions: ['astım'] },
      });
      await prisma.surgery.create({
        data: {
          patientId,
          procedureName: 'Sleeve gastrektomi',
          performedAt: new Date(Date.now() - 9 * 86_400_000),
        },
      });

      const view = (await press(patient.token).expect(201)).body as PatientView;

      const detail = (
        await request(server)
          .get(`/emergency/${view.event.id}`)
          .set('Authorization', `Bearer ${nurse.token}`)
          .expect(200)
      ).body as StaffView;

      expect(detail.summary.bloodType).toBe('0 Rh-');
      expect(detail.summary.allergies).toEqual(['penisilin']);
      expect(detail.summary.lastSurgery?.procedureName).toBe('Sleeve gastrektomi');
      expect(detail.summary.lastSurgery?.daysAgo).toBe(9);
    });

    it('closes with a note, and refuses to close without one', async () => {
      const nurse = await actorFor(Role.NURSE);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await assign(patientId, nurse.staffId!, Role.NURSE);

      const view = (await press(patient.token).expect(201)).body as PatientView;

      await request(server)
        .patch(`/emergency/${view.event.id}/resolve`)
        .set('Authorization', `Bearer ${nurse.token}`)
        .send({ resolution: '   ' })
        .expect(400);

      const closed = (
        await request(server)
          .patch(`/emergency/${view.event.id}/resolve`)
          .set('Authorization', `Bearer ${nurse.token}`)
          .send({ resolution: 'Hasta arandı, kanama durdu, kontrole çağrıldı' })
          .expect(200)
      ).body as StaffView;

      expect(closed.event.status).toBe(EmergencyStatus.RESOLVED);
      expect(closed.event.resolution).toContain('kanama durdu');

      // Closing one nobody acknowledged still stamps the acknowledgement: the
      // clinician who dealt with it in one step did answer, and an empty field
      // would record it as never responded to.
      expect(closed.responseMinutes).not.toBeNull();
    });
  });

  describe('the patient taking it back', () => {
    it('cancels an alarm nobody has picked up yet', async () => {
      const patient = await actorFor(Role.PATIENT);
      await makePatient(patient.userId);

      const view = (await press(patient.token).expect(201)).body as PatientView;

      const cancelled = (
        await request(server)
          .patch(`/me/emergency/${view.event.id}/cancel`)
          .set('Authorization', `Bearer ${patient.token}`)
          .expect(200)
      ).body as PatientView['event'];

      expect(cancelled.status).toBe(EmergencyStatus.FALSE_ALARM);
    });

    /**
     * Once a clinician has it they may well be on the phone to the patient.
     * Letting the record close underneath them would leave the person handling
     * it looking at an event that says it never happened.
     */
    it('refuses to cancel once a clinician is handling it', async () => {
      const nurse = await actorFor(Role.NURSE);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await assign(patientId, nurse.staffId!, Role.NURSE);

      const view = (await press(patient.token).expect(201)).body as PatientView;

      await request(server)
        .patch(`/emergency/${view.event.id}/acknowledge`)
        .set('Authorization', `Bearer ${nurse.token}`)
        .expect(200);

      await request(server)
        .patch(`/me/emergency/${view.event.id}/cancel`)
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(400);
    });

    it('does not let a patient read the clinic\'s queue', async () => {
      const patient = await actorFor(Role.PATIENT);
      await makePatient(patient.userId);

      await request(server)
        .get('/emergency')
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(403);
    });
  });

  describe('breaking the glass', () => {
    /**
     * Everywhere else a nurse who is not assigned is told the patient does not
     * exist. Here that is wrong: the ladder's last rung is everyone who can
     * receive an alert precisely because the assigned nurse may be off shift,
     * and waking someone who is then shown a 404 is worse than not waking them.
     */
    it('lets any nurse on the rota open an alarm that is still open', async () => {
      const assigned = await actorFor(Role.NURSE);
      const stranger = await actorFor(Role.NURSE);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await assign(patientId, assigned.staffId!, Role.NURSE);

      const view = (await press(patient.token).expect(201)).body as PatientView;

      const detail = (
        await request(server)
          .get(`/emergency/${view.event.id}`)
          .set('Authorization', `Bearer ${stranger.token}`)
          .expect(200)
      ).body as StaffView;

      expect(detail.summary.fullName).toBe('Deniz Kaya');

      // The whole justification for the widening is that it can be found
      // afterwards, so it is written under its own action rather than buried
      // among a hundred thousand ordinary reads.
      const trail = await prisma.auditLog.count({
        where: {
          actorId: stranger.userId,
          action: AuditAction.EMERGENCY_ACCESS,
          entityId: view.event.id,
        },
      });

      expect(trail).toBe(1);
    });

    /** A closed call is history, and history goes back to ordinary scoping. */
    it('closes the door again once the alarm is resolved', async () => {
      const assigned = await actorFor(Role.NURSE);
      const stranger = await actorFor(Role.NURSE);
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);
      await assign(patientId, assigned.staffId!, Role.NURSE);

      const view = (await press(patient.token).expect(201)).body as PatientView;

      await request(server)
        .patch(`/emergency/${view.event.id}/resolve`)
        .set('Authorization', `Bearer ${assigned.token}`)
        .send({ resolution: 'Yanlış alarm, hasta iyi' })
        .expect(200);

      await request(server)
        .get(`/emergency/${view.event.id}`)
        .set('Authorization', `Bearer ${stranger.token}`)
        .expect(404);
    });

    it('does not widen anything for someone who is not on the rota', async () => {
      const finance = await actorFor(Role.FINANCE);
      const patient = await actorFor(Role.PATIENT);
      await makePatient(patient.userId);

      const view = (await press(patient.token).expect(201)).body as PatientView;

      await request(server)
        .get(`/emergency/${view.event.id}`)
        .set('Authorization', `Bearer ${finance.token}`)
        .expect(403);
    });
  });
});
