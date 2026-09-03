import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  AppointmentStatus,
  AppointmentType,
  Currency,
  PrismaClient,
  Role,
  Sex,
  UserStatus,
} from '@prisma/client';
import { generateSync } from 'otplib';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isStaffRole } from '../src/auth/auth.errors';
import { AuthService } from '../src/auth/auth.service';
import { PermissionsService } from '../src/authz/permissions.service';
import { configureApp } from '../src/bootstrap';
import { Env } from '../src/config/env.schema';
import { hashPassword } from '../src/crypto/hashing';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';

const prisma = new PrismaClient();

interface NamedCount {
  label: string;
  count: number;
  share: number | null;
}

interface Totals {
  converted: string;
  unconverted: { currency: Currency; amount: string }[];
  complete: boolean;
}

/**
 * The clinic dashboard (spec M11, T6.4).
 *
 * Everything here is dated in 2040 so the figures are exactly the ones this
 * suite created: the reports are clinic-wide by nature, and asserting against a
 * shared database any other way is asserting against whatever ran before.
 */
describe('analytics', () => {
  const userIds: string[] = [];
  const staffProfiles: string[] = [];
  const patientIds: string[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let permissions: PermissionsService;

  const PASSWORD = 'correct-horse-battery-9';
  const FROM = '2040-01-01T00:00:00.000Z';
  // Read in the clinic's calendar, so the end instant has to land inside
  // 2040 in Istanbul: 23:59Z on 31 December is already January there.
  const TO = '2040-12-31T18:00:00.000Z';

  const actorFor = async (
    role: Role,
    grants: string[] = [],
  ): Promise<{ token: string; userId: string; staffId?: string }> => {
    const email = `anl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: {
        role,
        email,
        passwordHash: await hashPassword(PASSWORD),
        status: UserStatus.ACTIVE,
      },
    });
    userIds.push(user.id);

    for (const code of grants) {
      await prisma.userPermission.create({
        data: { userId: user.id, permissionCode: code, granted: true },
      });
    }
    await permissions.invalidate(user.id);

    if (isStaffRole(role)) {
      const profile = await prisma.staffProfile.create({
        data: { userId: user.id, firstName: 'Anl', lastName: role },
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

  const makePatient = async (options: {
    country?: string;
    city?: string | null;
    source?: string | null;
    createdAt?: string;
  } = {}): Promise<string> => {
    const patient = await prisma.patient.create({
      data: {
        mrn: `MRN-ANL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        firstName: 'Ayşe',
        lastName: 'Yılmaz',
        birthDate: new Date('1981-04-02'),
        sex: Sex.FEMALE,
        country: options.country ?? 'DE',
        city: options.city ?? null,
        referralSource: options.source ?? null,
        createdAt: new Date(options.createdAt ?? '2040-03-02T10:00:00.000Z'),
      },
    });
    patientIds.push(patient.id);
    return patient.id;
  };

  const get = (token: string, path: string, query: Record<string, string> = {}): request.Test =>
    request(server)
      .get(`/analytics/${path}`)
      .query({ from: FROM, to: TO, ...query })
      .set('Authorization', `Bearer ${token}`);

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
    permissions = app.get(PermissionsService);

    const redis = app.get(RedisService);
    await redis.waitUntilReady();
    await redis.client.flushdb();
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({
      where: { financeRecord: { patientId: { in: patientIds } } },
    });
    await prisma.financeRecord.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.appointment.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.surgery.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.exchangeRate.deleteMany({
      where: { validOn: { gte: new Date('2040-01-01'), lte: new Date('2041-01-01') } },
    });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.availabilityWindow.deleteMany({ where: { staffId: { in: staffProfiles } } });
    await prisma.userPermission.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  describe('who may see what', () => {
    it('keeps the dashboard away from the finance desk', async () => {
      // FINANCE holds finance.report and no analytics.read: money, not
      // clinical volumes.
      const finance = await actorFor(Role.FINANCE);

      await get(finance.token, 'procedures').expect(403);
      await get(finance.token, 'geography').expect(403);
      await get(finance.token, 'occupancy').expect(403);
      await get(finance.token, 'revenue').expect(200);
    });

    it('keeps revenue away from a dashboard user who may not see money', async () => {
      const coordinator = await actorFor(Role.COORDINATOR, ['analytics.read']);

      await get(coordinator.token, 'procedures').expect(200);
      await get(coordinator.token, 'revenue').expect(403);
    });

    it('says the revenue columns were withheld rather than leaving them out', async () => {
      // An absent revenue column reads as "this channel earned nothing", which
      // is a different and much worse claim than "you may not see this".
      const coordinator = await actorFor(Role.COORDINATOR, ['analytics.read']);

      const withheld = (await get(coordinator.token, 'channels').expect(200)).body as {
        revenueWithheld: boolean;
        channels: { revenue?: unknown }[];
      };

      expect(withheld.revenueWithheld).toBe(true);
      expect(withheld.channels.every((row) => row.revenue === undefined)).toBe(true);

      const doctor = await actorFor(Role.DOCTOR);
      const shown = (await get(doctor.token, 'channels').expect(200)).body as {
        revenueWithheld: boolean;
      };

      expect(shown.revenueWithheld).toBe(false);
    });
  });

  describe('operations', () => {
    it('counts them by month and leaves the quiet months in', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();

      await prisma.surgery.createMany({
        data: [
          { patientId, procedureName: 'Rinoplasti', performedAt: new Date('2040-03-04T09:00:00Z') },
          { patientId, procedureName: 'rinoplasti', performedAt: new Date('2040-03-18T09:00:00Z') },
          { patientId, procedureName: 'Saç ekimi', performedAt: new Date('2040-05-06T09:00:00Z') },
        ],
      });

      const report = (await get(doctor.token, 'procedures').expect(200)).body as {
        total: number;
        byMonth: { month: string; count: number }[];
        byProcedure: NamedCount[];
      };

      expect(report.total).toBe(3);
      // Twelve months of 2040, April among them with nothing in it: a chart
      // that omits an empty month draws a straight line through it.
      expect(report.byMonth).toHaveLength(12);
      expect(report.byMonth.find((row) => row.month === '2040-03')?.count).toBe(2);
      expect(report.byMonth.find((row) => row.month === '2040-04')?.count).toBe(0);

      // Two spellings of one operation are one operation.
      expect(report.byProcedure.find((row) => row.label === 'Rinoplasti')?.count).toBe(2);
    });
  });

  describe('geography', () => {
    it('counts the patients with no city instead of dropping them', async () => {
      const doctor = await actorFor(Role.DOCTOR);

      await makePatient({ country: 'DE', city: 'Berlin' });
      await makePatient({ country: 'DE', city: 'berlin' });
      await makePatient({ country: 'GB', city: null });

      const report = (await get(doctor.token, 'geography').expect(200)).body as {
        total: number;
        byCountry: NamedCount[];
        byCity: NamedCount[];
        cityUnknown: number;
      };

      expect(report.total).toBeGreaterThanOrEqual(3);
      expect(report.cityUnknown).toBeGreaterThanOrEqual(1);
      // Two spellings of Berlin are one city.
      expect(report.byCity.find((row) => row.label === 'Berlin')?.count).toBe(2);
    });

    it('gives no share at all when there are too few patients to divide', async () => {
      // "Germany, 33% of patients" from three files is arithmetically true and
      // will be read as something it is not.
      const doctor = await actorFor(Role.DOCTOR);

      const report = (
        await get(doctor.token, 'geography', {
          from: '2041-01-01T00:00:00.000Z',
          to: '2041-12-31T00:00:00.000Z',
        }).expect(200)
      ).body as { total: number; byCountry: NamedCount[] };

      await makePatient({ createdAt: '2041-02-02T10:00:00.000Z', country: 'FR' });

      const one = (
        await get(doctor.token, 'geography', {
          from: '2041-01-01T00:00:00.000Z',
          to: '2041-12-31T00:00:00.000Z',
        }).expect(200)
      ).body as { total: number; byCountry: NamedCount[] };

      expect(report.total).toBe(0);
      expect(one.total).toBe(1);
      expect(one.byCountry[0]!.count).toBe(1);
      // Null, not 1.0 — "not enough to say" rather than "all of them".
      expect(one.byCountry[0]!.share).toBeNull();
    });
  });

  describe('channels', () => {
    it('folds spellings, counts the unrecorded, and says what conversion means', async () => {
      const doctor = await actorFor(Role.DOCTOR);

      const converted = await makePatient({ source: 'Instagram' });
      await makePatient({ source: 'instagram ' });
      await makePatient({ source: null });

      await prisma.surgery.create({
        data: {
          patientId: converted,
          procedureName: 'Rinoplasti',
          performedAt: new Date('2040-06-01T09:00:00Z'),
        },
      });

      const report = (await get(doctor.token, 'channels').expect(200)).body as {
        channels: { key: string; label: string; patients: number; converted: number }[];
        conversionDefinition: string;
        minimumForRate: number;
      };

      const instagram = report.channels.find((row) => row.key === 'instagram');
      expect(instagram?.patients).toBe(2);
      expect(instagram?.label).toBe('Instagram');
      expect(instagram?.converted).toBe(1);

      // Patients with nothing recorded are their own row; dropping them would
      // inflate every other channel's share.
      expect(report.channels.find((row) => row.key === 'unknown')?.patients).toBeGreaterThanOrEqual(1);

      // Two readers must not be able to mean two things by "conversion".
      expect(report.conversionDefinition).toContain('at least one recorded operation');
      expect(report.minimumForRate).toBeGreaterThan(1);
    });
  });

  describe('revenue', () => {
    it('takes costs off the margin and says what it could not read', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient({ createdAt: '2042-07-01T10:00:00.000Z' });

      await prisma.financeRecord.create({
        data: {
          patientId,
          procedureName: 'Rinoplasti',
          currency: Currency.EUR,
          grossAmount: '4000.00',
          discount: '0',
          netAmount: '4000.00',
          agencyCommission: '400.00',
          costItems: [
            { label: 'İmplant', amount: '1200.00' },
            { label: 'Anestezi', amount: '300.00' },
            // Two that cannot be read as a cost.
            { label: 'Bozuk', amount: 'çok' },
            { note: 'no label at all' },
          ],
          createdAt: new Date('2042-07-02T10:00:00.000Z'),
        },
      });

      const report = (
        await get(doctor.token, 'revenue', {
          from: '2042-07-01T00:00:00.000Z',
          to: '2042-07-31T00:00:00.000Z',
          currency: Currency.EUR,
        }).expect(200)
      ).body as {
        net: Totals;
        cost: Totals;
        agencyCommission: Totals;
        margin: Totals;
        unreadableCostLines: number;
        recordCount: number;
      };

      expect(report.recordCount).toBe(1);
      expect(report.net.converted).toBe('4000.00');
      expect(report.cost.converted).toBe('1500.00');
      expect(report.agencyCommission.converted).toBe('400.00');
      // 4000 − 1500 − 400.
      expect(report.margin.converted).toBe('2100.00');
      // A margin missing something is worse than no margin at all.
      expect(report.unreadableCostLines).toBe(2);
    });

    it('leaves cancelled bills out and says how many', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient({ createdAt: '2043-01-01T10:00:00.000Z' });

      await prisma.financeRecord.createMany({
        data: [
          {
            patientId,
            procedureName: 'Rinoplasti',
            currency: Currency.EUR,
            grossAmount: '1000.00',
            discount: '0',
            netAmount: '1000.00',
            createdAt: new Date('2043-01-02T10:00:00.000Z'),
          },
          {
            patientId,
            procedureName: 'İptal',
            currency: Currency.EUR,
            grossAmount: '9000.00',
            discount: '0',
            netAmount: '9000.00',
            cancelledAt: new Date('2043-01-05T10:00:00.000Z'),
            createdAt: new Date('2043-01-03T10:00:00.000Z'),
          },
        ],
      });

      const report = (
        await get(doctor.token, 'revenue', {
          from: '2043-01-01T00:00:00.000Z',
          to: '2043-01-31T00:00:00.000Z',
          currency: Currency.EUR,
        }).expect(200)
      ).body as { net: Totals; recordCount: number; cancelledExcluded: number };

      expect(report.net.converted).toBe('1000.00');
      expect(report.recordCount).toBe(1);
      expect(report.cancelledExcluded).toBe(1);
    });

    it('carries what it could not convert all the way to the dashboard', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient({ createdAt: '2044-02-01T10:00:00.000Z' });

      await prisma.financeRecord.create({
        data: {
          patientId,
          procedureName: 'Rinoplasti',
          currency: Currency.GBP,
          grossAmount: '2000.00',
          discount: '0',
          netAmount: '2000.00',
          createdAt: new Date('2044-02-02T10:00:00.000Z'),
        },
      });

      const report = (
        await get(doctor.token, 'revenue', {
          from: '2044-02-01T00:00:00.000Z',
          to: '2044-02-28T00:00:00.000Z',
          currency: Currency.TRY,
        }).expect(200)
      ).body as { net: Totals; byMonth: { month: string; converted: boolean }[] };

      // No GBP→TRY rate on file. The two thousand pounds are still in the
      // answer, and the month is marked so a chart does not draw a dip that
      // never happened.
      expect(report.net.converted).toBe('0.00');
      expect(report.net.complete).toBe(false);
      expect(report.net.unconverted).toEqual([{ currency: Currency.GBP, amount: '2000.00' }]);
      expect(report.byMonth[0]!.converted).toBe(false);
    });

    it('averages per currency rather than blending them', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient({ createdAt: '2045-04-01T10:00:00.000Z' });

      for (const [currency, amount] of [
        [Currency.EUR, '4000.00'],
        [Currency.EUR, '6000.00'],
        [Currency.USD, '3000.00'],
      ] as const) {
        await prisma.financeRecord.create({
          data: {
            patientId,
            procedureName: 'Rinoplasti',
            currency,
            grossAmount: amount,
            discount: '0',
            netAmount: amount,
            createdAt: new Date('2045-04-02T10:00:00.000Z'),
          },
        });
      }

      const report = (
        await get(doctor.token, 'revenue', {
          from: '2045-04-01T00:00:00.000Z',
          to: '2045-04-30T00:00:00.000Z',
        }).expect(200)
      ).body as { averageByCurrency: { currency: Currency; average: string; count: number }[] };

      const euro = report.averageByCurrency.find((row) => row.currency === Currency.EUR);
      expect(euro).toEqual({ currency: Currency.EUR, average: '5000.00', count: 2 });
      expect(report.averageByCurrency.find((row) => row.currency === Currency.USD)?.average).toBe(
        '3000.00',
      );
    });

  });

  describe('occupancy', () => {
    it('divides booked minutes by the configured working hours', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();

      await prisma.availabilityWindow.create({
        data: { staffId: doctor.staffId!, dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
      });

      await prisma.appointment.createMany({
        data: [
          {
            patientId,
            staffId: doctor.staffId,
            type: AppointmentType.CONSULTATION,
            status: AppointmentStatus.CONFIRMED,
            scheduledAt: new Date('2040-08-06T09:00:00Z'),
            durationMinutes: 60,
          },
          {
            patientId,
            staffId: doctor.staffId,
            type: AppointmentType.CONTROL,
            status: AppointmentStatus.COMPLETED,
            scheduledAt: new Date('2040-08-13T09:00:00Z'),
            durationMinutes: 30,
          },
          // Cancelled: not booked time.
          {
            patientId,
            staffId: doctor.staffId,
            type: AppointmentType.CONTROL,
            status: AppointmentStatus.CANCELLED,
            scheduledAt: new Date('2040-08-20T09:00:00Z'),
            durationMinutes: 240,
          },
        ],
      });

      const report = (
        await get(doctor.token, 'occupancy', {
          from: '2040-08-01T00:00:00.000Z',
          to: '2040-08-31T00:00:00.000Z',
        }).expect(200)
      ).body as {
        byMonth: {
          month: string;
          bookedMinutes: number;
          availableMinutes: number;
          rate: number | null;
          appointments: number;
        }[];
        capacityUnconfigured: boolean;
      };

      const august = report.byMonth[0]!;

      expect(report.capacityUnconfigured).toBe(false);
      expect(august.month).toBe('2040-08');
      // The cancelled four hours are not booked time.
      expect(august.bookedMinutes).toBe(90);
      expect(august.appointments).toBe(2);
      expect(august.availableMinutes).toBeGreaterThanOrEqual(4 * 480);
      expect(august.rate).not.toBeNull();
    });
  });

  describe('the range', () => {
    it('refuses a range that runs backwards instead of answering a different question', async () => {
      const doctor = await actorFor(Role.DOCTOR);

      await get(doctor.token, 'procedures', {
        from: '2040-12-01T00:00:00.000Z',
        to: '2040-01-01T00:00:00.000Z',
      }).expect(400);
    });

    it('refuses an unbounded one', async () => {
      const doctor = await actorFor(Role.DOCTOR);

      await get(doctor.token, 'procedures', {
        from: '1990-01-01T00:00:00.000Z',
        to: '2090-01-01T00:00:00.000Z',
      }).expect(400);
    });
  });
});
