import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIdentity1792886401000 implements MigrationInterface {
  name = 'CreateIdentity1792886401000';

  private table(queryRunner: QueryRunner, name: string): string {
    const schema =
      queryRunner.connection.options.type === 'postgres'
        ? (queryRunner.connection.options.schema ?? 'public')
        : 'public';
    return `${queryRunner.connection.driver.escape(schema)}.${queryRunner.connection.driver.escape(name)}`;
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = (name: string) => this.table(queryRunner, name);
    await queryRunner.query(`CREATE TABLE ${table('app_user')} (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      username varchar(64) NOT NULL,
      display_name varchar(120) NOT NULL,
      password_hash varchar(512) NOT NULL,
      role varchar(16) NOT NULL,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_app_user PRIMARY KEY (id),
      CONSTRAINT uq_app_user_username UNIQUE (username),
      CONSTRAINT ck_app_user_username CHECK (username ~ '^[a-z][a-z0-9._-]{2,63}$'),
      CONSTRAINT ck_app_user_display_name CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
      CONSTRAINT ck_app_user_role CHECK (role IN ('ADMIN', 'DISPATCHER', 'CREW_MEMBER'))
    )`);
    await queryRunner.query(`CREATE TABLE ${table('auth_session')} (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      token_hash varchar(64) NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      CONSTRAINT pk_auth_session PRIMARY KEY (id),
      CONSTRAINT uq_auth_session_token_hash UNIQUE (token_hash),
      CONSTRAINT fk_auth_session_user FOREIGN KEY (user_id) REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      CONSTRAINT ck_auth_session_token_hash CHECK (token_hash ~ '^[a-f0-9]{64}$')
    )`);
    await queryRunner.query(
      `CREATE INDEX ix_auth_session_user_id ON ${table('auth_session')}(user_id)`,
    );
    await queryRunner.query(`CREATE TABLE ${table('crew_member')} (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      crew_id uuid NOT NULL,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_crew_member PRIMARY KEY (id),
      CONSTRAINT uq_crew_member_user_crew UNIQUE (user_id, crew_id),
      CONSTRAINT fk_crew_member_user FOREIGN KEY (user_id) REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      CONSTRAINT fk_crew_member_crew FOREIGN KEY (crew_id) REFERENCES ${table('crew')}(id) ON DELETE RESTRICT
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_crew_member_active_user ON ${table('crew_member')}(user_id) WHERE active = true`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_crew_member_crew_id ON ${table('crew_member')}(crew_id)`,
    );
    await queryRunner.query(`CREATE TABLE ${table('external_participant')} (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      crew_id uuid NOT NULL,
      name varchar(120) NOT NULL,
      specialty varchar(120) NOT NULL,
      phone varchar(40),
      email varchar(254),
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_external_participant PRIMARY KEY (id),
      CONSTRAINT fk_external_participant_crew FOREIGN KEY (crew_id) REFERENCES ${table('crew')}(id) ON DELETE RESTRICT,
      CONSTRAINT ck_external_participant_name CHECK (length(btrim(name)) BETWEEN 1 AND 120),
      CONSTRAINT ck_external_participant_specialty CHECK (length(btrim(specialty)) BETWEEN 1 AND 120)
    )`);
    await queryRunner.query(
      `CREATE INDEX ix_external_participant_crew_id ON ${table('external_participant')}(crew_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['external_participant', 'crew_member', 'auth_session', 'app_user']) {
      await queryRunner.query(`DROP TABLE ${this.table(queryRunner, table)}`);
    }
  }
}
