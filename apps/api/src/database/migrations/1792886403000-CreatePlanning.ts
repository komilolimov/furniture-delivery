import type { MigrationInterface, QueryRunner } from 'typeorm';

const oldActions =
  "'ORDER_CREATED','ORDER_UPDATED','ITEM_ADDED','ITEM_UPDATED','ITEM_REMOVED','PAYMENT_RECORDED','PAYMENT_VOIDED'";
const planningActions =
  "'APPOINTMENT_CREATED','APPOINTMENT_UPDATED','APPOINTMENT_CONFIRMED','APPOINTMENT_CANCELLED','CONFIRMATION_RESET'";

export class CreatePlanning1792886403000 implements MigrationInterface {
  name = 'CreatePlanning1792886403000';

  private table(queryRunner: QueryRunner, name: string): string {
    const schema =
      queryRunner.connection.options.type === 'postgres'
        ? (queryRunner.connection.options.schema ?? 'public')
        : 'public';
    return `${queryRunner.connection.driver.escape(schema)}.${queryRunner.connection.driver.escape(name)}`;
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = (name: string) => this.table(queryRunner, name);
    await queryRunner.query(`CREATE TABLE ${table('crew_planning_config')} (
      crew_id uuid NOT NULL,
      weekly_windows jsonb NOT NULL,
      travel_buffer_minutes integer NOT NULL DEFAULT 30,
      version integer NOT NULL DEFAULT 1,
      updated_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_crew_planning_config PRIMARY KEY (crew_id),
      CONSTRAINT fk_crew_planning_config_crew FOREIGN KEY (crew_id) REFERENCES ${table('crew')}(id) ON DELETE RESTRICT,
      CONSTRAINT fk_crew_planning_config_author FOREIGN KEY (updated_by) REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      CONSTRAINT ck_crew_planning_windows CHECK (jsonb_typeof(weekly_windows) = 'array' AND jsonb_array_length(weekly_windows) <= 49),
      CONSTRAINT ck_crew_planning_buffer CHECK (travel_buffer_minutes BETWEEN 0 AND 180),
      CONSTRAINT ck_crew_planning_version CHECK (version > 0)
    )`);
    await queryRunner.query(`INSERT INTO ${table('crew_planning_config')}(crew_id,weekly_windows)
      SELECT id, '[{"weekday":1,"startTime":"08:00","endTime":"18:00"},{"weekday":2,"startTime":"08:00","endTime":"18:00"},{"weekday":3,"startTime":"08:00","endTime":"18:00"},{"weekday":4,"startTime":"08:00","endTime":"18:00"},{"weekday":5,"startTime":"08:00","endTime":"18:00"}]'::jsonb
      FROM ${table('crew')} ON CONFLICT (crew_id) DO NOTHING`);
    await queryRunner.query(`CREATE TABLE ${table('crew_unavailability')} (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      crew_id uuid NOT NULL,
      start_at timestamptz NOT NULL,
      end_at timestamptz NOT NULL,
      reason varchar(1000) NOT NULL,
      active boolean NOT NULL DEFAULT true,
      created_by uuid NOT NULL,
      updated_by uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_crew_unavailability PRIMARY KEY (id),
      CONSTRAINT fk_crew_unavailability_crew FOREIGN KEY (crew_id) REFERENCES ${table('crew')}(id) ON DELETE RESTRICT,
      CONSTRAINT fk_crew_unavailability_creator FOREIGN KEY (created_by) REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      CONSTRAINT fk_crew_unavailability_editor FOREIGN KEY (updated_by) REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      CONSTRAINT ck_crew_unavailability_range CHECK (start_at < end_at),
      CONSTRAINT ck_crew_unavailability_reason CHECK (length(btrim(reason)) BETWEEN 1 AND 1000)
    )`);
    await queryRunner.query(
      `CREATE INDEX ix_crew_unavailability_crew ON ${table('crew_unavailability')}(crew_id,start_at,end_at)`,
    );
    await queryRunner.query(`CREATE TABLE ${table('task_template')} (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      code varchar(64) NOT NULL,
      name varchar(200) NOT NULL,
      description varchar(4000) NOT NULL DEFAULT '',
      active boolean NOT NULL DEFAULT true,
      required boolean NOT NULL DEFAULT false,
      severity varchar(8) NOT NULL DEFAULT 'MEDIUM',
      default_priority integer NOT NULL DEFAULT 0,
      applicability varchar(32) NOT NULL DEFAULT 'ALL',
      created_by uuid,
      updated_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_task_template PRIMARY KEY (id),
      CONSTRAINT uq_task_template_code UNIQUE (code),
      CONSTRAINT fk_task_template_creator FOREIGN KEY (created_by) REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      CONSTRAINT fk_task_template_editor FOREIGN KEY (updated_by) REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      CONSTRAINT ck_task_template_code CHECK (code ~ '^[A-Z][A-Z0-9_-]{2,63}$'),
      CONSTRAINT ck_task_template_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
      CONSTRAINT ck_task_template_severity CHECK (severity IN ('LOW','MEDIUM','HIGH')),
      CONSTRAINT ck_task_template_priority CHECK (default_priority BETWEEN 0 AND 9999),
      CONSTRAINT ck_task_template_applicability CHECK (applicability IN ('ALL','DELIVERY_ONLY','DELIVERY_AND_ASSEMBLY'))
    )`);
    await queryRunner.query(`CREATE TABLE ${table('appointment')} (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      order_id uuid NOT NULL,
      planned_start_at timestamptz NOT NULL,
      planned_end_at timestamptz NOT NULL,
      duration_minutes integer NOT NULL,
      status varchar(16) NOT NULL DEFAULT 'SCHEDULED',
      confirmation_status varchar(24) NOT NULL DEFAULT 'NEEDS_CONFIRMATION',
      confirmed_at timestamptz,
      confirmed_by uuid,
      cancelled_at timestamptz,
      cancelled_by uuid,
      cancel_reason varchar(1000),
      notes varchar(4000) NOT NULL DEFAULT '',
      version integer NOT NULL DEFAULT 1,
      idempotency_key varchar(100) NOT NULL,
      fingerprint varchar(64) NOT NULL,
      created_by uuid NOT NULL,
      updated_by uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_appointment PRIMARY KEY (id),
      CONSTRAINT uq_appointment_order_key UNIQUE (order_id,idempotency_key),
      CONSTRAINT fk_appointment_order FOREIGN KEY (order_id) REFERENCES ${table('delivery_order')}(id) ON DELETE RESTRICT,
      CONSTRAINT fk_appointment_creator FOREIGN KEY (created_by) REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      CONSTRAINT fk_appointment_editor FOREIGN KEY (updated_by) REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      CONSTRAINT fk_appointment_confirmation_author FOREIGN KEY (confirmed_by) REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      CONSTRAINT fk_appointment_cancellation_author FOREIGN KEY (cancelled_by) REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      CONSTRAINT ck_appointment_range CHECK (planned_start_at < planned_end_at),
      CONSTRAINT ck_appointment_duration CHECK (duration_minutes BETWEEN 1 AND 1440 AND EXTRACT(EPOCH FROM (planned_end_at-planned_start_at)) = duration_minutes * 60),
      CONSTRAINT ck_appointment_status CHECK (status IN ('SCHEDULED','CANCELLED')),
      CONSTRAINT ck_appointment_version CHECK (version > 0),
      CONSTRAINT ck_appointment_key CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,100}$'),
      CONSTRAINT ck_appointment_fingerprint CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
      CONSTRAINT ck_appointment_confirmation CHECK (
        (confirmation_status='NEEDS_CONFIRMATION' AND confirmed_at IS NULL AND confirmed_by IS NULL) OR
        (confirmation_status='CONFIRMED' AND confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL)
      ),
      CONSTRAINT ck_appointment_cancellation CHECK (
        (status='SCHEDULED' AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL) OR
        (status='CANCELLED' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancel_reason IS NOT NULL AND length(btrim(cancel_reason)) BETWEEN 1 AND 1000)
      )
    )`);
    await queryRunner.query(
      `CREATE INDEX ix_appointment_order_id ON ${table('appointment')}(order_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_appointment_range ON ${table('appointment')}(planned_start_at,planned_end_at)`,
    );
    await queryRunner.query(`CREATE TABLE ${table('crew_assignment')} (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      appointment_id uuid NOT NULL,
      crew_id uuid NOT NULL,
      status varchar(16) NOT NULL DEFAULT 'ASSIGNED',
      travel_buffer_minutes integer NOT NULL,
      cancelled_at timestamptz,
      cancelled_by uuid,
      cancel_reason varchar(1000),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_crew_assignment PRIMARY KEY (id),
      CONSTRAINT fk_crew_assignment_appointment FOREIGN KEY (appointment_id) REFERENCES ${table('appointment')}(id) ON DELETE RESTRICT,
      CONSTRAINT fk_crew_assignment_crew FOREIGN KEY (crew_id) REFERENCES ${table('crew')}(id) ON DELETE RESTRICT,
      CONSTRAINT fk_crew_assignment_cancellation_author FOREIGN KEY (cancelled_by) REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      CONSTRAINT ck_crew_assignment_buffer CHECK (travel_buffer_minutes BETWEEN 0 AND 180),
      CONSTRAINT ck_crew_assignment_status CHECK (status IN ('ASSIGNED','CANCELLED')),
      CONSTRAINT ck_crew_assignment_cancellation CHECK (
        (status='ASSIGNED' AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL) OR
        (status='CANCELLED' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancel_reason IS NOT NULL AND length(btrim(cancel_reason)) BETWEEN 1 AND 1000)
      )
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_crew_assignment_active ON ${table('crew_assignment')}(appointment_id,crew_id) WHERE status='ASSIGNED'`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_crew_assignment_crew ON ${table('crew_assignment')}(crew_id,appointment_id)`,
    );
    await queryRunner.query(`CREATE TABLE ${table('task')} (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      assignment_id uuid NOT NULL,
      template_id uuid,
      name varchar(200) NOT NULL,
      description varchar(4000) NOT NULL DEFAULT '',
      required boolean NOT NULL,
      severity varchar(8) NOT NULL,
      priority integer NOT NULL,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_task PRIMARY KEY (id),
      CONSTRAINT fk_task_assignment FOREIGN KEY (assignment_id) REFERENCES ${table('crew_assignment')}(id) ON DELETE RESTRICT,
      CONSTRAINT fk_task_template FOREIGN KEY (template_id) REFERENCES ${table('task_template')}(id) ON DELETE RESTRICT,
      CONSTRAINT ck_task_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
      CONSTRAINT ck_task_severity CHECK (severity IN ('LOW','MEDIUM','HIGH')),
      CONSTRAINT ck_task_priority CHECK (priority BETWEEN 0 AND 9999),
      CONSTRAINT ck_task_required CHECK (NOT required OR active)
    )`);
    await queryRunner.query(`CREATE INDEX ix_task_assignment ON ${table('task')}(assignment_id)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_task_active_template ON ${table('task')}(assignment_id,template_id) WHERE active=true AND template_id IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE ${table('activity_log')} DROP CONSTRAINT ck_activity_log_action`,
    );
    await queryRunner.query(
      `ALTER TABLE ${table('activity_log')} ADD CONSTRAINT ck_activity_log_action CHECK (action IN (${oldActions},${planningActions}))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = (name: string) => this.table(queryRunner, name);
    // This deliberately refuses rollback when planning audit rows exist; never erase history.
    await queryRunner.query(
      `ALTER TABLE ${table('activity_log')} DROP CONSTRAINT ck_activity_log_action`,
    );
    await queryRunner.query(
      `ALTER TABLE ${table('activity_log')} ADD CONSTRAINT ck_activity_log_action CHECK (action IN (${oldActions}))`,
    );
    for (const name of [
      'task',
      'crew_assignment',
      'appointment',
      'task_template',
      'crew_unavailability',
      'crew_planning_config',
    ]) {
      await queryRunner.query(`DROP TABLE ${table(name)}`);
    }
  }
}
