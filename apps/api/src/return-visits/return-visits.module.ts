import { Module } from '@nestjs/common';
import { ReturnVisitsController } from './return-visits.controller';
import { ReturnVisitsService } from './return-visits.service';
@Module({ controllers: [ReturnVisitsController], providers: [ReturnVisitsService] })
export class ReturnVisitsModule {}
