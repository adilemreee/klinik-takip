import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PermissionsGuard } from './guards/permissions.guard';
import { PatientAccessService } from './patient-access.service';
import { PermissionsService } from './permissions.service';

@Global()
@Module({
  providers: [
    PermissionsService,
    PatientAccessService,
    // Registered after JwtAuthGuard, so request.user is populated by the time
    // this runs. Nest applies APP_GUARDs in provider order.
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [PermissionsService, PatientAccessService],
})
export class AuthzModule {}
