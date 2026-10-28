import 'reflect-metadata';
import { DataSource } from 'typeorm';
import type { AppConfig } from '../config/environment';
import { Crew } from '../crews/crew.entity';
import { User } from '../identity/user.entity';
import { AuthSession } from '../identity/auth-session.entity';
import { CrewMember } from '../identity/crew-member.entity';
import { ExternalParticipant } from '../identity/external-participant.entity';
import { CreateCrew1792886400000 } from './migrations/1792886400000-CreateCrew';
import { CreateIdentity1792886401000 } from './migrations/1792886401000-CreateIdentity';
import { CreateOrders1792886402000 } from './migrations/1792886402000-CreateOrders';
import { Order } from '../orders/order.entity';
import { OrderItem } from '../orders/order-item.entity';
import { Payment } from '../orders/payment.entity';
import { ActivityLog } from '../orders/activity-log.entity';
import { Appointment } from '../planning/appointment.entity';
import { CrewAssignment } from '../planning/crew-assignment.entity';
import { TaskTemplate } from '../planning/task-template.entity';
import { Task } from '../planning/task.entity';
import { CrewPlanningConfig } from '../planning/crew-planning-config.entity';
import { CrewUnavailability } from '../planning/crew-unavailability.entity';
import { CreatePlanning1792886403000 } from './migrations/1792886403000-CreatePlanning';
import { CreateExecution1792886404000 } from './migrations/1792886404000-CreateExecution';
import { ExecutionReceipt } from '../execution/execution-receipt.entity';
import { FinishReport } from '../execution/finish-report.entity';
import { ReturnVisitRequest } from '../execution/return-visit-request.entity';

import { ExecutionNote } from '../evidence/execution-note.entity';
import { Issue } from '../evidence/issue.entity';
import { IssueEvent } from '../evidence/issue-event.entity';
import { IssueItem } from '../evidence/issue-item.entity';
import { IssueAttachment } from '../evidence/issue-attachment.entity';
import { Attachment } from '../evidence/attachment.entity';
import { EvidenceReceipt } from '../evidence/evidence-receipt.entity';
import { CreateEvidence1792886404100 } from './migrations/1792886404100-CreateEvidence';
import { CreateEstimates1792886405000 } from './migrations/1792886405000-CreateEstimates';
import { CreateReturnVisits1792886405100 } from './migrations/1792886405100-CreateReturnVisits';
import { ReturnVisitAttempt } from '../execution/return-visit-attempt.entity';
import { AcceptanceSnapshot } from '../acceptance/acceptance-snapshot.entity';
import { AcceptanceSlot } from '../acceptance/acceptance-slot.entity';
import { SignatureConfirmation } from '../acceptance/signature-confirmation.entity';
import { ExceptionReview } from '../acceptance/exception-review.entity';
import { CreateAcceptance1792886406000 } from './migrations/1792886406000-CreateAcceptance';
import { CompletionRecord } from '../completion/completion-record.entity';
import { OrderReopenEvent } from '../completion/order-reopen-event.entity';
import { CreateCompletion1792886406100 } from './migrations/1792886406100-CreateCompletion';
import { RealtimeCommitSubscriber } from '../realtime/post-commit';

export function createDataSource(
  config: AppConfig,
  overrides: { database?: string; schema?: string; port?: number } = {},
): DataSource {
  return new DataSource({
    type: 'postgres',
    host: config.database.host,
    port: overrides.port ?? config.database.port,
    database: overrides.database ?? config.database.name,
    username: config.database.user,
    password: config.database.password,
    schema: overrides.schema ?? config.database.schema ?? 'public',
    entities: [
      Crew,
      User,
      AuthSession,
      CrewMember,
      ExternalParticipant,
      Order,
      OrderItem,
      Payment,
      ActivityLog,
      Appointment,
      CrewAssignment,
      TaskTemplate,
      Task,
      CrewPlanningConfig,
      CrewUnavailability,
      ExecutionReceipt,
      FinishReport,
      ReturnVisitRequest,
      ReturnVisitAttempt,
      ExecutionNote,
      Issue,
      IssueEvent,
      IssueItem,
      IssueAttachment,
      Attachment,
      EvidenceReceipt,
      AcceptanceSnapshot,
      AcceptanceSlot,
      SignatureConfirmation,
      ExceptionReview,
      CompletionRecord,
      OrderReopenEvent,
    ],
    migrations: [
      CreateCrew1792886400000,
      CreateIdentity1792886401000,
      CreateOrders1792886402000,
      CreatePlanning1792886403000,
      CreateExecution1792886404000,
      CreateEvidence1792886404100,
      CreateEstimates1792886405000,
      CreateReturnVisits1792886405100,
      CreateAcceptance1792886406000,
      CreateCompletion1792886406100,
    ],
    migrationsTableName: 'typeorm_migrations',
    subscribers: [RealtimeCommitSubscriber],
    migrationsTransactionMode: 'all',
    synchronize: false,
    migrationsRun: false,
    uuidExtension: 'pgcrypto',
    installExtensions: false,
    // Do not log SQL parameters, database credentials or raw connection errors.
    logging: false,
    poolErrorHandler: () => undefined,
    extra: {
      max: 5,
      connectionTimeoutMillis: 2000,
      query_timeout: 2000,
      statement_timeout: 2000,
    },
  });
}
