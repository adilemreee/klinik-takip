import { Module } from '@nestjs/common';
import { FinanceController, PatientFinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

/** Finance records, the payment ledger and collection reports (spec M11, T6.3). */
@Module({
  controllers: [FinanceController, PatientFinanceController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
