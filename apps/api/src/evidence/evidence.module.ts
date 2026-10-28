import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { BadRequestException } from '@nestjs/common';
import type { AppConfig } from '../config/environment';
import { STORAGE_CONFIG, EVIDENCE_LIMITS, storageConfig } from './evidence-config';
import { PrivateStorage, unsafeFilenameCharacter } from './private-storage';
import { AttachmentsService } from './attachments.service';
import {
  CrewAttachmentsController,
  OrderAttachmentsController,
  UploadAccessGuard,
} from './attachments.controller';
import { EvidenceService } from './evidence.service';
import {
  CrewEvidenceController,
  OrderEvidenceController,
  IssuesController,
} from './evidence.controller';
@Module({})
export class EvidenceModule {
  static forRoot(config: AppConfig): DynamicModule {
    const storage = storageConfig(config);
    const storageProvider = new PrivateStorage(storage);
    return {
      module: EvidenceModule,
      imports: [
        MulterModule.register({
          dest: (
            _request: unknown,
            _file: unknown,
            callback: (error: Error | null, path?: string) => void,
          ) => {
            void storageProvider.stagingDirectory().then(
              (path) => callback(null, path),
              () => callback(new Error('Private upload storage is unavailable.')),
            );
          },
          preservePath: true,
          limits: {
            fileSize: storage.pdfMaxBytes,
            files: 1,
            fields: 8,
            fieldSize: 4096,
            parts: 10,
            fieldNameSize: 64,
          },
          fileFilter: (
            _r: unknown,
            file: { originalname: string },
            callback: (error: Error | null, accept: boolean) => void,
          ) => {
            if (Array.from(file.originalname).some(unsafeFilenameCharacter))
              callback(
                new BadRequestException('The filename contains unsupported characters.'),
                false,
              );
            else callback(null, true);
          },
        }),
      ],
      providers: [
        { provide: STORAGE_CONFIG, useValue: storage },
        {
          provide: EVIDENCE_LIMITS,
          useValue: {
            imageMaxBytes: storage.imageMaxBytes,
            pdfMaxBytes: storage.pdfMaxBytes,
            maxPixels: storage.maxPixels,
            orderMaxFiles: storage.orderMaxFiles,
            orderMaxBytes: storage.orderMaxBytes,
          },
        },
        { provide: PrivateStorage, useFactory: () => storageProvider },
        AttachmentsService,
        UploadAccessGuard,
        EvidenceService,
      ],
      controllers: [
        CrewAttachmentsController,
        OrderAttachmentsController,
        CrewEvidenceController,
        OrderEvidenceController,
        IssuesController,
      ],
    };
  }
}
