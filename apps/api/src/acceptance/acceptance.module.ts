import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import {
  AcceptanceActionsController,
  BackofficeAcceptanceController,
  CrewAcceptanceController,
  SignatureUploadGuard,
} from './acceptance.controller';
import { AcceptanceService } from './acceptance.service';
import { SIGNATURE_MAX_BYTES } from './signature-png';
@Module({
  // This module's default is bounded memory storage, independent of evidence's disk upload setup.
  imports: [
    MulterModule.register({
      limits: {
        fileSize: SIGNATURE_MAX_BYTES,
        files: 1,
        fields: 1,
        fieldSize: 8192,
        parts: 3,
        fieldNameSize: 32,
        headerPairs: 100,
      },
    }),
  ],
  controllers: [
    BackofficeAcceptanceController,
    CrewAcceptanceController,
    AcceptanceActionsController,
  ],
  providers: [AcceptanceService, SignatureUploadGuard],
})
export class AcceptanceModule {}
