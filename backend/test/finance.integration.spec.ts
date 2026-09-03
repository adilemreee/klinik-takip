import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  Currency,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
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
import { configureApp } from '../src/bootstrap';
import { Env } from '../src/config/env.schema';
import { hashPassword } from '../src/crypto/hashing';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';

const prisma = new PrismaClient();

interface RecordView {
  id: string;
  patientId: string;
  patient: {
    id: string;
    mrn: string;
    firstName: string;
    lastName: string;
    country: string;
  } | null;
  currency: Currency;
  grossAmount: string;
  discount: string;
  netAmount: string;
  paidAmount: string;
  refundedAmount: string;
  balance: string;
  paymentStatus: PaymentStatus;
  paidAt: string | null;
  cancelledAt: string | null;
  agencyCommission: string | null;
  payments: {
    id: string;
    kind: PaymentKind;
    amount: string;
    currency: Currency;
    appliedAmount: string;
    rate: string | null;
    reversedAt: string | null;
  }[];
}

interface Totals {
  currency: Currency;
  converted: string;
  byCurrency: { currency: Currency; amount: string }[];
  unconverted: { currency: Currency; amount: string }[];
  complete: boolean;
}

/**
 * Finance records, the payment ledger and the collection report (spec M11, T6.3).
 *
 * Two classes of failure are being defended here. One is a bill whose status
 * disagrees with the money against it, which stops being chased and is never
 * noticed. The other is spec section 2's rule in both directions: the nurse has
 * no finance permission at all, and the finance desk has no clinical access at
 * all.
 */
describe('finance', () => {
  const userIds: string[] = [];
  const staffProfiles: string[] = [];
  const patientIds: string[] = [];
  const agencyIds: string[] = [];
  const rateDays: Date[] = [];

  let app: INestApplication;
  let server: Server;
  let auth: AuthService;

  const PASSWORD = 'correct-horse-battery-9';

  const actorFor = async (role: Role): Promise<{ token: string; userId: string }> => {
    const email = `fin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: {
        role,
        email,
        passwordHash: await hashPassword(PASSWORD),
        status: UserStatus.ACTIVE,
      },
    });
    userIds.push(user.id);

    if (isStaffRole(role)) {
      const profile = await prisma.staffProfile.create({
        data: { userId: user.id, firstName: 'Fin', lastName: role },
      });
      staffProfiles.push(profile.id);

      const setup = await auth.beginTotpEnrolment(user.id);
      await auth.confirmTotpEnrolment(user.id, generateSync({ secret: setup.secret }));
      const login = await auth.login(email, PASSWORD, generateSync({ secret: setup.secret }), {});

      return { token: login.tokens!.accessToken, userId: user.id };
    }

    const login = await auth.login(email, PASSWORD, undefined, {});
    return { token: login.tokens!.accessToken, userId: user.id };
  };

  const makePatient = async (): Promise<string> => {
    const patient = await prisma.patient.create({
      data: {
        mrn: `MRN-FIN-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        firstName: 'Ayşe',
        lastName: 'Yılmaz',
        birthDate: new Date('1981-04-02'),
        sex: Sex.FEMALE,
        country: 'DE',
      },
    });
    patientIds.push(patient.id);
    return patient.id;
  };

  const bill = async (
    token: string,
    patientId: string,
    body: Record<string, unknown> = {},
  ): Promise<RecordView> => {
    const response = await request(server)
      .post(`/patients/${patientId}/finance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        procedureName: 'Rinoplasti',
        currency: Currency.EUR,
        grossAmount: '4500.00',
        discount: '500.00',
        ...body,
      })
      .expect(201);

    return response.body as RecordView;
  };

  const pay = (token: string, recordId: string, body: Record<string, unknown>): request.Test =>
    request(server)
      .post(`/finance/records/${recordId}/payments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ method: PaymentMethod.BANK_TRANSFER, ...body });

  const putRate = async (
    token: string,
    base: Currency,
    quote: Currency,
    rate: string,
    validOn: string,
  ): Promise<void> => {
    await request(server)
      .post('/finance/rates')
      .set('Authorization', `Bearer ${token}`)
      .send({ base, quote, rate, validOn })
      .expect(201);

    rateDays.push(new Date(`${validOn}T00:00:00.000Z`));
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

    const redis = app.get(RedisService);
    await redis.waitUntilReady();
    await redis.client.flushdb();
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({
      where: { financeRecord: { patientId: { in: patientIds } } },
    });
    await prisma.financeRecord.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.exchangeRate.deleteMany({ where: { validOn: { in: rateDays } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.agency.deleteMany({ where: { id: { in: agencyIds } } });
    await prisma.deviceSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.staffProfile.deleteMany({ where: { id: { in: staffProfiles } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  describe('the wall between money and medicine (spec section 2)', () => {
    it('gives the nurse no finance access of any kind', async () => {
      const nurse = await actorFor(Role.NURSE);
      const patientId = await makePatient();

      for (const path of [
        '/finance/records',
        '/finance/collections?from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z',
        '/finance/outstanding',
        `/patients/${patientId}/finance`,
      ]) {
        await request(server)
          .get(path)
          .set('Authorization', `Bearer ${nurse.token}`)
          .expect(403);
      }

      await request(server)
        .post(`/patients/${patientId}/finance`)
        .set('Authorization', `Bearer ${nurse.token}`)
        .send({ procedureName: 'Rinoplasti', currency: Currency.EUR, grossAmount: '100.00' })
        .expect(403);
    });

    it('gives the finance desk no clinical access of any kind', async () => {
      const finance = await actorFor(Role.FINANCE);
      const patientId = await makePatient();

      for (const path of [
        `/patients/${patientId}`,
        `/patients/${patientId}/medications`,
        `/patients/${patientId}/measurements`,
        `/patients/${patientId}/documents`,
        `/patients/${patientId}/photos`,
      ]) {
        const response = await request(server)
          .get(path)
          .set('Authorization', `Bearer ${finance.token}`);

        // Either shape is correct; what must not happen is a 200.
        expect([403, 404]).toContain(response.status);
      }
    });

    it('lets the finance desk see whose bill it is, and nothing more', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const finance = await actorFor(Role.FINANCE);
      const patientId = await makePatient();
      await bill(doctor.token, patientId);

      const response = await request(server)
        .get(`/patients/${patientId}/finance`)
        .set('Authorization', `Bearer ${finance.token}`)
        .expect(200);

      const [record] = response.body as RecordView[];

      // A name, a file number and a country: enough to know whose bill this is.
      expect(record!.patient?.firstName).toBe('Ayşe');
      expect(record!.patient?.country).toBe('DE');
      expect(record!.patient?.mrn).toContain('MRN-FIN-');
      // And nothing else: no diagnosis, no procedure history, no notes.
      expect(Object.keys(record!.patient!).sort()).toEqual([
        'country',
        'firstName',
        'id',
        'lastName',
        'mrn',
      ]);
    });

    it('works clinic-wide, because the books are not divisible', async () => {
      // The finance role has no patient scope at all — deliberately, since it
      // is not meant to browse patients. Its access comes from the permission.
      const doctor = await actorFor(Role.DOCTOR);
      const finance = await actorFor(Role.FINANCE);
      const patientId = await makePatient();
      const created = await bill(doctor.token, patientId);

      await request(server)
        .get(`/finance/records/${created.id}`)
        .set('Authorization', `Bearer ${finance.token}`)
        .expect(200);
    });
  });

  describe('raising a bill', () => {
    it('computes the net from the gross and the discount', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();

      const record = await bill(doctor.token, patientId, {
        grossAmount: '4500.00',
        discount: '500.00',
      });

      expect(record.netAmount).toBe('4000.00');
      expect(record.paymentStatus).toBe(PaymentStatus.PENDING);
      expect(record.balance).toBe('4000.00');
    });

    it('refuses a net that arrives from a client', async () => {
      // The net is not an independent number, so there is no field for it: a
      // supplied net is a net that can disagree with the two it is made of.
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();

      await request(server)
        .post(`/patients/${patientId}/finance`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({
          procedureName: 'Rinoplasti',
          currency: Currency.EUR,
          grossAmount: '4500.00',
          netAmount: '99.00',
        })
        .expect(400);
    });

    it('returns amounts as strings with both decimal places', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const record = await bill(doctor.token, await makePatient(), {
        grossAmount: '1200',
        discount: '0',
      });

      expect(record.grossAmount).toBe('1200.00');
      expect(record.netAmount).toBe('1200.00');
    });

    it('refuses an amount that arrives as a JSON number', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();

      await request(server)
        .post(`/patients/${patientId}/finance`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ procedureName: 'Rinoplasti', currency: Currency.EUR, grossAmount: 4500.5 })
        .expect(400);
    });

    it.each([
      ['a discount larger than the bill', { grossAmount: '100.00', discount: '200.00' }],
      ['more precision than the currency has', { grossAmount: '100.005' }],
      ['a negative amount', { grossAmount: '-100.00' }],
    ])('refuses %s', async (_label, body) => {
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();

      await request(server)
        .post(`/patients/${patientId}/finance`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ procedureName: 'Rinoplasti', currency: Currency.EUR, ...body })
        .expect(400);
    });

    it('applies the agency commission from the standing rate', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const agency = await prisma.agency.create({
        data: { name: `Aracı ${Date.now()}`, commissionRate: '0.1000' },
      });
      agencyIds.push(agency.id);

      const record = await bill(doctor.token, await makePatient(), { agencyId: agency.id });

      expect(record.agencyCommission).toBe('400.00');
    });

    it('lets a negotiated commission override the standing rate', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const agency = await prisma.agency.create({
        data: { name: `Aracı ${Date.now()}-b`, commissionRate: '0.1000' },
      });
      agencyIds.push(agency.id);

      const record = await bill(doctor.token, await makePatient(), {
        agencyId: agency.id,
        agencyCommission: '250.00',
      });

      expect(record.agencyCommission).toBe('250.00');
    });
  });

  describe('the payment ledger', () => {
    it('walks a bill from pending to paid across instalments', async () => {
      const finance = await actorFor(Role.FINANCE);
      const doctor = await actorFor(Role.DOCTOR);
      const record = await bill(doctor.token, await makePatient());

      const afterDeposit = (
        await pay(finance.token, record.id, { amount: '1500.00' }).expect(201)
      ).body as RecordView;

      expect(afterDeposit.paymentStatus).toBe(PaymentStatus.PARTIAL);
      expect(afterDeposit.paidAmount).toBe('1500.00');
      expect(afterDeposit.balance).toBe('2500.00');
      expect(afterDeposit.paidAt).toBeNull();

      const settled = (await pay(finance.token, record.id, { amount: '2500.00' }).expect(201))
        .body as RecordView;

      expect(settled.paymentStatus).toBe(PaymentStatus.PAID);
      expect(settled.balance).toBe('0.00');
      expect(settled.paidAt).not.toBeNull();
    });

    it('has no way for a client to set the payment status', async () => {
      const finance = await actorFor(Role.FINANCE);
      const doctor = await actorFor(Role.DOCTOR);
      const record = await bill(doctor.token, await makePatient());

      // The dangerous write: a bill marked paid with nothing collected drops
      // out of the receivables report and is never chased again. There is no
      // field for it, and the request is refused rather than partly applied.
      await request(server)
        .patch(`/finance/records/${record.id}`)
        .set('Authorization', `Bearer ${finance.token}`)
        .send({ paymentStatus: PaymentStatus.PAID, paidAmount: '4000.00' })
        .expect(400);

      const after = (
        await request(server)
          .get(`/finance/records/${record.id}`)
          .set('Authorization', `Bearer ${finance.token}`)
          .expect(200)
      ).body as RecordView;

      expect(after.paymentStatus).toBe(PaymentStatus.PENDING);
      expect(after.paidAmount).toBe('0.00');
    });

    it('keeps the derived status when an editable field changes', async () => {
      const finance = await actorFor(Role.FINANCE);
      const doctor = await actorFor(Role.DOCTOR);
      const record = await bill(doctor.token, await makePatient());
      await pay(finance.token, record.id, { amount: '1500.00' }).expect(201);

      const edited = (
        await request(server)
          .patch(`/finance/records/${record.id}`)
          .set('Authorization', `Bearer ${finance.token}`)
          .send({ note: 'Taksitli ödeme planı' })
          .expect(200)
      ).body as RecordView;

      expect(edited.paymentStatus).toBe(PaymentStatus.PARTIAL);
      expect(edited.paidAmount).toBe('1500.00');
    });

    it('corrects a mistyped payment by reversing it, not deleting it', async () => {
      const finance = await actorFor(Role.FINANCE);
      const doctor = await actorFor(Role.DOCTOR);
      const record = await bill(doctor.token, await makePatient());

      const paid = (await pay(finance.token, record.id, { amount: '4000.00' }).expect(201))
        .body as RecordView;
      expect(paid.paymentStatus).toBe(PaymentStatus.PAID);

      const reversed = (
        await request(server)
          .post(`/finance/payments/${paid.payments[0]!.id}/reverse`)
          .set('Authorization', `Bearer ${finance.token}`)
          .send({ reason: 'Yanlış hastaya işlendi' })
          .expect(201)
      ).body as RecordView;

      expect(reversed.paymentStatus).toBe(PaymentStatus.PENDING);
      expect(reversed.paidAmount).toBe('0.00');
      // The row is still there, with the amount that was entered.
      expect(reversed.payments).toHaveLength(1);
      expect(reversed.payments[0]!.amount).toBe('4000.00');
      expect(reversed.payments[0]!.reversedAt).not.toBeNull();
    });

    it('refuses to reverse the same payment twice', async () => {
      const finance = await actorFor(Role.FINANCE);
      const doctor = await actorFor(Role.DOCTOR);
      const record = await bill(doctor.token, await makePatient());
      const paid = (await pay(finance.token, record.id, { amount: '100.00' }).expect(201))
        .body as RecordView;

      const reverse = (): request.Test =>
        request(server)
          .post(`/finance/payments/${paid.payments[0]!.id}/reverse`)
          .set('Authorization', `Bearer ${finance.token}`)
          .send({ reason: 'düzeltme' });

      await reverse().expect(201);
      await reverse().expect(409);
    });

    it('tells a refund apart from money that never arrived', async () => {
      const finance = await actorFor(Role.FINANCE);
      const doctor = await actorFor(Role.DOCTOR);
      const record = await bill(doctor.token, await makePatient());

      await pay(finance.token, record.id, { amount: '4000.00' }).expect(201);
      const refunded = (
        await pay(finance.token, record.id, {
          amount: '4000.00',
          kind: PaymentKind.REFUND,
        }).expect(201)
      ).body as RecordView;

      expect(refunded.paymentStatus).toBe(PaymentStatus.REFUNDED);
      expect(refunded.refundedAmount).toBe('4000.00');
    });

    describe('a payment in another currency', () => {
      it('must say how much of the bill it settles', async () => {
        const finance = await actorFor(Role.FINANCE);
        const doctor = await actorFor(Role.DOCTOR);
        const record = await bill(doctor.token, await makePatient());

        // The rate that settles a bill is the one the bank used that day.
        // Guessing it would mean the software decided, from a table it cannot
        // verify, whether a patient still owes money.
        await pay(finance.token, record.id, {
          amount: '150000.00',
          currency: Currency.TRY,
        }).expect(400);
      });

      it('records the rate it worked out to', async () => {
        const finance = await actorFor(Role.FINANCE);
        const doctor = await actorFor(Role.DOCTOR);
        const record = await bill(doctor.token, await makePatient());

        const view = (
          await pay(finance.token, record.id, {
            amount: '152000.00',
            currency: Currency.TRY,
            appliedAmount: '4000.00',
          }).expect(201)
        ).body as RecordView;

        expect(view.paymentStatus).toBe(PaymentStatus.PAID);
        expect(view.payments[0]!.currency).toBe(Currency.TRY);
        expect(view.payments[0]!.appliedAmount).toBe('4000.00');
        // 4000 / 152000, at the column's precision rather than rounded to two.
        expect(view.payments[0]!.rate).toBe('0.02631579');
      });
    });

    it('refuses a payment against a cancelled bill', async () => {
      const finance = await actorFor(Role.FINANCE);
      const doctor = await actorFor(Role.DOCTOR);
      const record = await bill(doctor.token, await makePatient());

      await request(server)
        .post(`/finance/records/${record.id}/cancel`)
        .set('Authorization', `Bearer ${finance.token}`)
        .send({ reason: 'Ameliyat yapılmadı' })
        .expect(201);

      await pay(finance.token, record.id, { amount: '100.00' }).expect(409);
    });

    it('keeps money already collected visible on a cancelled bill', async () => {
      const finance = await actorFor(Role.FINANCE);
      const doctor = await actorFor(Role.DOCTOR);
      const record = await bill(doctor.token, await makePatient());
      await pay(finance.token, record.id, { amount: '1000.00' }).expect(201);

      const cancelled = (
        await request(server)
          .post(`/finance/records/${record.id}/cancel`)
          .set('Authorization', `Bearer ${finance.token}`)
          .send({ reason: 'Hasta vazgeçti' })
          .expect(201)
      ).body as RecordView;

      // A cancelled bill is not a deleted one: the deposit still has to be
      // accounted for, and usually refunded.
      expect(cancelled.paymentStatus).toBe(PaymentStatus.CANCELLED);
      expect(cancelled.paidAmount).toBe('1000.00');
    });

    it('re-settles the bill when a discount is applied afterwards', async () => {
      const finance = await actorFor(Role.FINANCE);
      const doctor = await actorFor(Role.DOCTOR);
      const record = await bill(doctor.token, await makePatient());
      await pay(finance.token, record.id, { amount: '3500.00' }).expect(201);

      const discounted = (
        await request(server)
          .patch(`/finance/records/${record.id}`)
          .set('Authorization', `Bearer ${finance.token}`)
          .send({ discount: '1000.00' })
          .expect(200)
      ).body as RecordView;

      // 4500 − 1000 = 3500, which is exactly what was paid. Leaving the old
      // status behind would keep chasing money that is no longer owed.
      expect(discounted.netAmount).toBe('3500.00');
      expect(discounted.paymentStatus).toBe(PaymentStatus.PAID);
    });
  });

  describe('what the database will not accept whatever the service does', () => {
    it('refuses a payment of zero or less', async () => {
      const doctor = await actorFor(Role.DOCTOR);
      const record = await bill(doctor.token, await makePatient());

      await expect(
        prisma.payment.create({
          data: {
            financeRecordId: record.id,
            amount: '-100.00',
            currency: Currency.EUR,
            appliedAmount: '-100.00',
            method: PaymentMethod.CASH,
            paidAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it('refuses a net that disagrees with the gross and the discount', async () => {
      const patientId = await makePatient();

      await expect(
        prisma.financeRecord.create({
          data: {
            patientId,
            procedureName: 'Rinoplasti',
            currency: Currency.EUR,
            grossAmount: '1000.00',
            discount: '100.00',
            netAmount: '1000.00',
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('the collection report', () => {
    it('adds up money received in the period, at each payment\'s own rate', async () => {
      const finance = await actorFor(Role.FINANCE);
      const doctor = await actorFor(Role.DOCTOR);

      await putRate(finance.token, Currency.EUR, Currency.TRY, '38.00', '2031-03-02');
      await putRate(finance.token, Currency.EUR, Currency.TRY, '40.00', '2031-03-20');

      const first = await bill(doctor.token, await makePatient(), { grossAmount: '1000.00', discount: '0' });
      const second = await bill(doctor.token, await makePatient(), { grossAmount: '1000.00', discount: '0' });

      await pay(finance.token, first.id, {
        amount: '1000.00',
        paidAt: '2031-03-02T10:00:00.000Z',
      }).expect(201);
      await pay(finance.token, second.id, {
        amount: '1000.00',
        paidAt: '2031-03-20T10:00:00.000Z',
      }).expect(201);

      const report = (
        await request(server)
          .get('/finance/collections')
          .query({ from: '2031-03-01T00:00:00.000Z', to: '2031-03-31T00:00:00.000Z', currency: Currency.TRY })
          .set('Authorization', `Bearer ${finance.token}`)
          .expect(200)
      ).body as { received: Totals; net: Totals; paymentCount: number };

      // 38000 + 40000. Converting both at one rate would move a month's
      // revenue every time the report was run.
      expect(report.received.converted).toBe('78000.00');
      expect(report.received.complete).toBe(true);
      expect(report.paymentCount).toBe(2);
    });

    it('says what it could not convert instead of leaving it out', async () => {
      const finance = await actorFor(Role.FINANCE);
      const doctor = await actorFor(Role.DOCTOR);

      await putRate(finance.token, Currency.EUR, Currency.TRY, '38.00', '2032-05-04');

      const euro = await bill(doctor.token, await makePatient(), { grossAmount: '1000.00', discount: '0' });
      const sterling = await bill(doctor.token, await makePatient(), {
        currency: Currency.GBP,
        grossAmount: '2000.00',
        discount: '0',
      });

      await pay(finance.token, euro.id, {
        amount: '1000.00',
        paidAt: '2032-05-04T10:00:00.000Z',
      }).expect(201);
      await pay(finance.token, sterling.id, {
        amount: '2000.00',
        currency: Currency.GBP,
        paidAt: '2032-05-04T10:00:00.000Z',
      }).expect(201);

      const report = (
        await request(server)
          .get('/finance/collections')
          .query({ from: '2032-05-01T00:00:00.000Z', to: '2032-05-31T00:00:00.000Z', currency: Currency.TRY })
          .set('Authorization', `Bearer ${finance.token}`)
          .expect(200)
      ).body as { received: Totals };

      expect(report.received.converted).toBe('38000.00');
      // The two thousand pounds are still in the answer, in pounds.
      expect(report.received.complete).toBe(false);
      expect(report.received.unconverted).toEqual([
        { currency: Currency.GBP, amount: '2000.00' },
      ]);
    });

    it('nets refunds off the money received', async () => {
      const finance = await actorFor(Role.FINANCE);
      const doctor = await actorFor(Role.DOCTOR);
      const record = await bill(doctor.token, await makePatient(), {
        currency: Currency.TRY,
        grossAmount: '5000.00',
        discount: '0',
      });

      await pay(finance.token, record.id, {
        amount: '5000.00',
        currency: Currency.TRY,
        paidAt: '2033-07-05T10:00:00.000Z',
      }).expect(201);
      await pay(finance.token, record.id, {
        amount: '1000.00',
        currency: Currency.TRY,
        kind: PaymentKind.REFUND,
        paidAt: '2033-07-08T10:00:00.000Z',
      }).expect(201);

      const report = (
        await request(server)
          .get('/finance/collections')
          .query({ from: '2033-07-01T00:00:00.000Z', to: '2033-07-31T00:00:00.000Z', currency: Currency.TRY })
          .set('Authorization', `Bearer ${finance.token}`)
          .expect(200)
      ).body as { received: Totals; refunded: Totals; net: Totals };

      expect(report.received.converted).toBe('5000.00');
      expect(report.refunded.converted).toBe('1000.00');
      expect(report.net.converted).toBe('4000.00');
    });

    it('leaves a reversed payment out of the money received', async () => {
      const finance = await actorFor(Role.FINANCE);
      const doctor = await actorFor(Role.DOCTOR);
      const record = await bill(doctor.token, await makePatient(), {
        currency: Currency.TRY,
        grossAmount: '900.00',
        discount: '0',
      });

      const paid = (
        await pay(finance.token, record.id, {
          amount: '900.00',
          currency: Currency.TRY,
          paidAt: '2034-02-06T10:00:00.000Z',
        }).expect(201)
      ).body as RecordView;

      await request(server)
        .post(`/finance/payments/${paid.payments[0]!.id}/reverse`)
        .set('Authorization', `Bearer ${finance.token}`)
        .send({ reason: 'çift girildi' })
        .expect(201);

      const report = (
        await request(server)
          .get('/finance/collections')
          .query({ from: '2034-02-01T00:00:00.000Z', to: '2034-02-28T00:00:00.000Z', currency: Currency.TRY })
          .set('Authorization', `Bearer ${finance.token}`)
          .expect(200)
      ).body as { received: Totals; paymentCount: number };

      expect(report.received.converted).toBe('0.00');
      expect(report.paymentCount).toBe(0);
    });

    it('needs the report permission, not just read', async () => {
      const finance = await actorFor(Role.FINANCE);

      // FINANCE holds finance.report; a coordinator holds neither.
      const coordinator = await actorFor(Role.COORDINATOR);

      await request(server)
        .get('/finance/collections')
        .query({ from: '2026-01-01T00:00:00.000Z', to: '2026-12-31T00:00:00.000Z' })
        .set('Authorization', `Bearer ${coordinator.token}`)
        .expect(403);

      await request(server)
        .get('/finance/collections')
        .query({ from: '2026-01-01T00:00:00.000Z', to: '2026-12-31T00:00:00.000Z' })
        .set('Authorization', `Bearer ${finance.token}`)
        .expect(200);
    });
  });

  describe('what is still owed', () => {
    it('counts debts and not overpayments', async () => {
      const finance = await actorFor(Role.FINANCE);

      const report = (
        await request(server)
          .get('/finance/outstanding')
          .query({ currency: Currency.TRY })
          .set('Authorization', `Bearer ${finance.token}`)
          .expect(200)
      ).body as { outstanding: Totals; ageing: { bucket: string; recordCount: number }[] };

      expect(report.ageing.map((bucket) => bucket.bucket)).toEqual([
        'current',
        'd30',
        'd60',
        'over90',
      ]);
      // Every bill raised in this suite is minutes old.
      expect(report.ageing[0]!.recordCount).toBeGreaterThan(0);
    });
  });

  describe('exchange rates', () => {
    it('refuses a rate of a currency against itself', async () => {
      const finance = await actorFor(Role.FINANCE);

      await request(server)
        .post('/finance/rates')
        .set('Authorization', `Bearer ${finance.token}`)
        .send({ base: Currency.TRY, quote: Currency.TRY, rate: '1', validOn: '2035-01-05' })
        .expect(400);
    });

    it('replaces a rate for a day rather than duplicating it', async () => {
      const finance = await actorFor(Role.FINANCE);

      await putRate(finance.token, Currency.USD, Currency.TRY, '35.00', '2035-01-06');
      await putRate(finance.token, Currency.USD, Currency.TRY, '36.00', '2035-01-06');

      const rows = await prisma.exchangeRate.findMany({
        where: {
          base: Currency.USD,
          quote: Currency.TRY,
          validOn: new Date('2035-01-06T00:00:00.000Z'),
        },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]!.rate.toString()).toBe('36');
    });
  });

  describe('the audit trail', () => {
    it('records who looked at a bill and who moved money', async () => {
      const finance = await actorFor(Role.FINANCE);
      const doctor = await actorFor(Role.DOCTOR);
      const patientId = await makePatient();
      const record = await bill(doctor.token, patientId);

      await pay(finance.token, record.id, { amount: '500.00' }).expect(201);
      await request(server)
        .get(`/finance/records/${record.id}`)
        .set('Authorization', `Bearer ${finance.token}`)
        .expect(200);

      const entries = await prisma.auditLog.findMany({
        where: { patientId, entityType: { in: ['finance_records', 'payments'] } },
      });

      expect(entries.map((entry) => `${entry.entityType}:${entry.action}`)).toEqual(
        expect.arrayContaining(['finance_records:CREATE', 'payments:CREATE']),
      );
    });
  });
});
