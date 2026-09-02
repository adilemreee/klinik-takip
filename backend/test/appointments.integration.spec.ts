import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  AppointmentStatus,
  AppointmentType,
  PrismaClient,
  Role,
  Sex,
  UserStatus,
} from '@prisma/client';
import { generateSync } from 'otplib';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AuthService } from '../src/auth/auth.service';
import { isStaffRole } from '../src/auth/auth.errors';
import { configureApp } from '../src/bootstrap';
import { Env } from '../src/config/env.schema';
import { hashPassword } from '../src/crypto/hashing';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';

interface AppointmentBody {
  id: string;
  status: string;
  scheduledAt: string;
  remindersSent: string[];
}

/**
 * Appointments (spec M10).
 *
 * The two failures that matter are booking two patients into one slot and
 * booking somebody into a time the clinic is not open. Both look fine until
 * somebody arrives.
 */
describe('appointments', () => {
  const prisma = new PrismaClient();
  const userIds: string[] = [];
  const staffProfiles: string[] = [];
  const patientIds: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let appointments: AppointmentsService;
  let doctor: { token: string; userId: string; staffId: string };

  const PASSWORD = 'correct-horse-battery-9';

  /**
   * A slot on the next Monday, given as minutes from noon Istanbul.
   *
   * Every test picks its own so they cannot book over each other: the window is
   * 09:00–18:00, and the doctor is shared.
   */
  const slotAt = (minutesFromNoon: number): string =>
    new Date(nextMondayNoon().getTime() + minutesFromNoon * 60_000).toISOString();

  /** The next Monday at 12:00 Istanbul, so tests never book into the past. */
  const nextMondayNoon = (): Date => {
    const now = new Date();
    const days = (8 - now.getUTCDay()) % 7 || 7;
    const monday = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    return new Date(
      Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), 9, 0, 0),
    );
  };

  const actorFor = async (
    role: Role,
  ): Promise<{ token: string; userId: string; staffId: string }> => {
    const email = `ap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: { role, email, passwordHash: await hashPassword(PASSWORD), status: UserStatus.ACTIVE },
    });
    userIds.push(user.id);

    if (isStaffRole(role)) {
      const profile = await prisma.staffProfile.create({
        data: { userId: user.id, firstName: 'Ap', lastName: role },
      });
      staffProfiles.push(profile.id);

      const setup = await auth.beginTotpEnrolment(user.id);
      await auth.confirmTotpEnrolment(user.id, generateSync({ secret: setup.secret }));
      const login = await auth.login(email, PASSWORD, generateSync({ secret: setup.secret }), {});
      return { token: login.tokens!.accessToken, userId: user.id, staffId: profile.id };
    }

    const login = await auth.login(email, PASSWORD, undefined, {});
    return { token: login.tokens!.accessToken, userId: user.id, staffId: '' };
  };

  const makePatient = async (userId?: string): Promise<string> => {
    const patient = await prisma.patient.create({
      data: {
        mrn: `MRN-AP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        firstName: 'Ayse',
        lastName: 'Yilmaz',
        birthDate: new Date('1985-03-12'),
        sex: Sex.FEMALE,
        country: 'DE',
        userId,
      },
    });
    patientIds.push(patient.id);
    return patient.id;
  };

  /** Publishes Monday 09:00–18:00 for a staff member. */
  const publishHours = async (staffId: string): Promise<void> => {
    await prisma.availabilityWindow.create({
      data: {
        staffId,
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '18:00',
        timezone: 'Europe/Istanbul',
      },
    });
  };

  const book = (
    patientId: string,
    body: Record<string, unknown>,
    token = doctor.token,
  ): request.Test =>
    request(server)
      .post(`/patients/${patientId}/appointments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: AppointmentType.CONTROL, ...body });

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
    appointments = app.get(AppointmentsService);

    const redis = app.get(RedisService);
    await redis.waitUntilReady();
    await redis.client.flushdb();

    doctor = await actorFor(Role.DOCTOR);
    await publishHours(doctor.staffId);
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.availabilityWindow.deleteMany({ where: { staffId: { in: staffProfiles } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  describe('booking', () => {
    it('books a slot inside the published hours', async () => {
      const patientId = await makePatient();

      const response = await book(patientId, {
        scheduledAt: slotAt(0),
        staffId: doctor.staffId,
      }).expect(201);

      // Staff booking is already agreed to by the clinic.
      expect((response.body as AppointmentBody).status).toBe(AppointmentStatus.CONFIRMED);
    });

    /** The failure that puts two people in one room. */
    it('refuses a slot already taken', async () => {
      const patientId = await makePatient();
      const other = await makePatient();
      await book(patientId, { scheduledAt: slotAt(60), staffId: doctor.staffId }).expect(201);

      const clash = await book(other, {
        scheduledAt: slotAt(75),
        staffId: doctor.staffId,
      }).expect(409);

      expect(JSON.stringify(clash.body)).toContain('SLOT_TAKEN');
    });

    /**
     * Touching is not overlapping — this is how a clinic fills a morning.
     */
    it('allows a slot that starts when another ends', async () => {
      const patientId = await makePatient();
      const other = await makePatient();
      await book(patientId, { scheduledAt: slotAt(120), staffId: doctor.staffId }).expect(201);

      await book(other, { scheduledAt: slotAt(150), staffId: doctor.staffId }).expect(201);
    });

    /** Booking somebody into a time the clinic is not open. */
    it('refuses a slot outside the published hours', async () => {
      const patientId = await makePatient();
      const response = await book(patientId, {
        // 07:00 Istanbul, before the 09:00 opening.
        scheduledAt: slotAt(-300),
        staffId: doctor.staffId,
      }).expect(409);

      expect(JSON.stringify(response.body)).toContain('OUTSIDE_AVAILABILITY');
    });

    /**
     * A doctor who has published no hours has not offered any, and inventing
     * some would book patients into time nobody agreed to.
     */
    it('refuses to book a staff member with no published hours', async () => {
      const patientId = await makePatient();
      const nurse = await actorFor(Role.NURSE);

      await book(patientId, { scheduledAt: slotAt(0), staffId: nurse.staffId }).expect(409);
    });

    /** An appointment nobody can attend. */
    it('refuses a date in the past', async () => {
      const patientId = await makePatient();

      await book(patientId, {
        scheduledAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      }).expect(400);
    });

    it('refuses a role without appointments.write', async () => {
      const patientId = await makePatient();
      const finance = await actorFor(Role.FINANCE);

      await book(patientId, { scheduledAt: slotAt(0) }, finance.token).expect(403);
    });

    it('reports not found for a patient outside the caller scope', async () => {
      const patientId = await makePatient();
      const coordinator = await actorFor(Role.COORDINATOR);

      await book(patientId, { scheduledAt: slotAt(0) }, coordinator.token).expect(404);
    });
  });

  describe('the request and approval flow', () => {
    /**
     * Collapsing this would put strangers straight into a doctor's day: the
     * clinic has agreed to its own calendar, not to whoever asked.
     */
    it('files a patient booking as a request', async () => {
      const patient = await actorFor(Role.PATIENT);
      await makePatient(patient.userId);

      const response = await request(server)
        .post('/me/appointments')
        .set('Authorization', `Bearer ${patient.token}`)
        .send({
          type: AppointmentType.CONSULTATION,
          scheduledAt: slotAt(180),
          staffId: doctor.staffId,
        })
        .expect(201);

      expect((response.body as AppointmentBody).status).toBe(AppointmentStatus.REQUESTED);
    });

    it('confirms a request', async () => {
      const patient = await actorFor(Role.PATIENT);
      await makePatient(patient.userId);

      const requested = (
        await request(server)
          .post('/me/appointments')
          .set('Authorization', `Bearer ${patient.token}`)
          .send({
            type: AppointmentType.CONSULTATION,
            scheduledAt: slotAt(240),
            staffId: doctor.staffId,
          })
          .expect(201)
      ).body as AppointmentBody;

      const confirmed = await request(server)
        .patch(`/appointments/${requested.id}/confirm`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(200);

      expect((confirmed.body as AppointmentBody).status).toBe(AppointmentStatus.CONFIRMED);
    });

    it('refuses to confirm twice', async () => {
      const patientId = await makePatient();
      const booked = (
        await book(patientId, { scheduledAt: slotAt(300), staffId: doctor.staffId }).expect(201)
      ).body as AppointmentBody;

      await request(server)
        .patch(`/appointments/${booked.id}/confirm`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .expect(400);
    });
  });

  describe('moving and cancelling', () => {
    const bookOne = async (minutesFromNoon: number): Promise<AppointmentBody> => {
      const patientId = await makePatient();

      return (
        await book(patientId, {
          scheduledAt: slotAt(minutesFromNoon),
          staffId: doctor.staffId,
        }).expect(201)
      ).body as AppointmentBody;
    };

    /**
     * A patient told "tomorrow" for an appointment that has moved needs telling
     * again, so the reminders already sent are cleared.
     */
    it('clears the reminders already sent when an appointment moves', async () => {
      const booked = await bookOne(-60);

      await prisma.appointment.update({
        where: { id: booked.id },
        data: { remindersSent: ['P7D'] },
      });

      const moved = await request(server)
        .patch(`/appointments/${booked.id}/reschedule`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ scheduledAt: slotAt(210) })
        .expect(200);

      expect((moved.body as AppointmentBody).remindersSent).toEqual([]);
    });

    it('refuses to move an appointment into the past', async () => {
      const booked = await bookOne(-120);

      await request(server)
        .patch(`/appointments/${booked.id}/reschedule`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ scheduledAt: new Date(Date.now() - 3600_000).toISOString() })
        .expect(400);
    });

    it('cancels with a reason', async () => {
      const booked = await bookOne(-180);

      const response = await request(server)
        .patch(`/appointments/${booked.id}/cancel`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ reason: 'Hasta gelemiyor' })
        .expect(200);

      expect((response.body as AppointmentBody).status).toBe(AppointmentStatus.CANCELLED);
    });

    /**
     * Someone who cannot come should be able to say so without telephoning:
     * that is the difference between a cancelled slot and a no-show.
     */
    it('lets a patient cancel their own appointment', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      const booked = (
        await book(patientId, { scheduledAt: slotAt(-150), staffId: doctor.staffId }).expect(201)
      ).body as AppointmentBody;

      await request(server)
        .patch(`/appointments/${booked.id}/cancel`)
        .set('Authorization', `Bearer ${patient.token}`)
        .send({})
        .expect(200);
    });

    /** A cancelled slot is free again. */
    it('frees the slot a cancelled appointment held', async () => {
      const at = slotAt(270);
      const patientId = await makePatient();
      const other = await makePatient();

      const booked = (
        await book(patientId, { scheduledAt: at, staffId: doctor.staffId }).expect(201)
      ).body as AppointmentBody;

      await book(other, { scheduledAt: at, staffId: doctor.staffId }).expect(409);

      await request(server)
        .patch(`/appointments/${booked.id}/cancel`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({})
        .expect(200);

      await book(other, { scheduledAt: at, staffId: doctor.staffId }).expect(201);
    });
  });

  describe('reminders', () => {
    /** T-7d, T-1d, T-2h (spec M10). */
    it('sends a reminder once its moment arrives', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      const soon = new Date(Date.now() + 90 * 60 * 1000);
      const appointment = await prisma.appointment.create({
        data: {
          patientId,
          type: AppointmentType.CONTROL,
          status: AppointmentStatus.CONFIRMED,
          scheduledAt: soon,
          durationMinutes: 30,
        },
      });

      const sent = await appointments.sendDueReminders();

      expect(sent).toBeGreaterThanOrEqual(1);

      const stored = await prisma.appointment.findUniqueOrThrow({
        where: { id: appointment.id },
      });
      expect(stored.remindersSent).toContain('PT2H');

      const notifications = await prisma.notification.findMany({
        where: { userId: patient.userId, type: 'appointment.reminder' },
      });
      expect(notifications.length).toBeGreaterThanOrEqual(1);
    });

    /** A worker that restarts must not send the same reminder twice. */
    it('does not repeat a reminder already sent', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      await prisma.appointment.create({
        data: {
          patientId,
          type: AppointmentType.CONTROL,
          status: AppointmentStatus.CONFIRMED,
          scheduledAt: new Date(Date.now() + 90 * 60 * 1000),
          durationMinutes: 30,
        },
      });

      await appointments.sendDueReminders();
      const before = await prisma.notification.count({ where: { userId: patient.userId } });

      await appointments.sendDueReminders();
      const after = await prisma.notification.count({ where: { userId: patient.userId } });

      expect(after).toBe(before);
    });

    /** A cancelled appointment does not remind anyone to attend it. */
    it('sends nothing for a cancelled appointment', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      await prisma.appointment.create({
        data: {
          patientId,
          type: AppointmentType.CONTROL,
          status: AppointmentStatus.CANCELLED,
          scheduledAt: new Date(Date.now() + 90 * 60 * 1000),
          durationMinutes: 30,
        },
      });

      await appointments.sendDueReminders();

      expect(await prisma.notification.count({ where: { userId: patient.userId } })).toBe(0);
    });
  });

  describe('the calendar file', () => {
    it('serves the patient their appointments as iCalendar', async () => {
      const patient = await actorFor(Role.PATIENT);
      const patientId = await makePatient(patient.userId);

      await book(patientId, {
        scheduledAt: slotAt(330),
        staffId: doctor.staffId,
        location: 'Kat 3, Oda 12',
      }).expect(201);

      const response = await request(server)
        .get('/me/appointments/calendar.ics')
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(200);

      expect(response.headers['content-type']).toContain('text/calendar');
      expect(response.text).toContain('BEGIN:VCALENDAR');
      expect(response.text).toContain('BEGIN:VEVENT');
      // The comma is escaped, or the calendar app drops the rest of the line.
      expect(response.text).toContain('LOCATION:Kat 3\\, Oda 12');
    });

    it('serves an empty calendar for a patient with no appointments', async () => {
      const patient = await actorFor(Role.PATIENT);
      await makePatient(patient.userId);

      const response = await request(server)
        .get('/me/appointments/calendar.ics')
        .set('Authorization', `Bearer ${patient.token}`)
        .expect(200);

      expect(response.text).toContain('BEGIN:VCALENDAR');
      expect(response.text).not.toContain('BEGIN:VEVENT');
    });
  });
});
