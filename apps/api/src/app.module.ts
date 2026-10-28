import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { AppConfig } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CrewModule } from './crews/crews.module';
import { OrdersModule } from './orders/orders.module';
import { PlanningModule } from './planning/planning.module';
import { ExecutionModule } from './execution/execution.module';
import { EvidenceModule } from './evidence/evidence.module';
import { ReturnVisitsModule } from './return-visits/return-visits.module';
import { ReschedulingModule } from './rescheduling/rescheduling.module';
import { CompletionModule } from './completion/completion.module';
import { RealtimeModule } from './realtime/realtime.module';
import { AcceptanceModule } from './acceptance/acceptance.module';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DatabaseModule.forRoot(config),
        AuthModule.forRoot(config.auth),
        HealthModule,
        UsersModule,
        CrewModule,
        OrdersModule,
        PlanningModule,
        ExecutionModule,
        EvidenceModule.forRoot(config),
        ReschedulingModule,
        ReturnVisitsModule,
        AcceptanceModule,
        CompletionModule,
        RealtimeModule.forRoot(config.auth.webOrigin),
      ],
    };
  }
}
