import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { EncryptionService } from '../crypto/encryption.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { InvitationService } from './invitation.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    TotpService,
    InvitationService,
    EncryptionService,
    // Global and deny-by-default: a new endpoint is protected unless someone
    // deliberately marks it @Public.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService, TokenService, EncryptionService],
})
export class AuthModule {}
