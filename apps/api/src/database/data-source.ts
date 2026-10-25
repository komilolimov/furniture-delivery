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
    entities: [Crew, User, AuthSession, CrewMember, ExternalParticipant],
    migrations: [CreateCrew1792886400000, CreateIdentity1792886401000],
    migrationsTableName: 'typeorm_migrations',
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
