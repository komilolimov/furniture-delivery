import { Module } from '@nestjs/common';
import { CompletionService } from './completion.service';
import { CompletionController } from './completion.controller';
@Module({ controllers: [CompletionController], providers: [CompletionService] })
export class CompletionModule {}
