import type { MigrationInterface, QueryRunner } from 'typeorm';

const priorActions =
  "'ORDER_CREATED','ORDER_UPDATED','ITEM_ADDED','ITEM_UPDATED','ITEM_REMOVED','PAYMENT_RECORDED','PAYMENT_VOIDED','APPOINTMENT_CREATED','APPOINTMENT_UPDATED','APPOINTMENT_CONFIRMED','APPOINTMENT_CANCELLED','CONFIRMATION_RESET','EXECUTION_DEPARTED','EXECUTION_ARRIVED','EXECUTION_STARTED','EXECUTION_FINISHED','TASK_RESULT_CHANGED','ITEM_FULFILLMENT','RETURN_VISIT_REQUESTED','EXECUTION_NOTE_ADDED','ISSUE_CREATED','ISSUE_RESOLVED','ISSUE_REOPENED','ISSUE_NOTE_ADDED','ATTACHMENT_UPLOADED','ATTACHMENT_WITHDRAWN','ESTIMATE_SET','APPOINTMENT_RESCHEDULED','RETURN_VISIT_PLANNED','RETURN_VISIT_RESOLVED','RETURN_VISIT_REOPENED','ACCEPTANCE_PREPARED','ACCEPTANCE_SIGNED','ACCEPTANCE_ABSENT','EXCEPTION_REVIEWED','ACCEPTANCE_INVALIDATED'";

export class CreateCompletion1792886406100 implements MigrationInterface {
  name = 'CreateCompletion1792886406100';

  private table(runner: QueryRunner, name: string): string {
    const schema =
      runner.connection.options.type === 'postgres'
        ? (runner.connection.options.schema ?? 'public')
        : 'public';
    return `${runner.connection.driver.escape(schema)}.${runner.connection.driver.escape(name)}`;
  }

  async up(runner: QueryRunner): Promise<void> {
    const table = (name: string) => this.table(runner, name);
    await runner.query(`CREATE TABLE ${table('completion_record')} (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id uuid NOT NULL REFERENCES ${table('delivery_order')}(id) ON DELETE RESTRICT,
      actor_id uuid NOT NULL REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      reason varchar(4000) NOT NULL CHECK(length(btrim(reason)) > 0),
      readiness jsonb NOT NULL,
      CONSTRAINT uq_completion_id_order UNIQUE(id,order_id),
      CONSTRAINT ck_completion_readiness CHECK(
        jsonb_typeof(readiness) = 'object'
        AND readiness ?& ARRAY['schemaVersion','orderVersion','snapshotIds','signatureIds','exceptionIds','coverageRequestIds','operationalDetails']
        AND jsonb_typeof(readiness->'schemaVersion') = 'number' AND readiness->>'schemaVersion' = '1'
        AND jsonb_typeof(readiness->'orderVersion') = 'number' AND readiness->>'orderVersion' ~ '^[1-9][0-9]*$'
        AND jsonb_typeof(readiness->'snapshotIds') = 'array'
        AND jsonb_typeof(readiness->'signatureIds') = 'array'
        AND jsonb_typeof(readiness->'exceptionIds') = 'array'
        AND jsonb_typeof(readiness->'coverageRequestIds') = 'array'
        AND jsonb_typeof(readiness->'operationalDetails') = 'object'
      )
    )`);
    await runner.query(
      `CREATE INDEX ix_completion_order ON ${table('completion_record')}(order_id,created_at,id)`,
    );
    await runner.query(`CREATE TABLE ${table('order_reopen_event')} (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id uuid NOT NULL,
      completion_id uuid NOT NULL,
      actor_id uuid NOT NULL REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      reason varchar(4000) NOT NULL CHECK(length(btrim(reason)) > 0),
      source varchar(16) NOT NULL CHECK(source IN ('MANUAL','ISSUE','SNAPSHOT')),
      source_id uuid,
      CONSTRAINT uq_reopen_completion UNIQUE(completion_id),
      FOREIGN KEY(completion_id,order_id) REFERENCES ${table('completion_record')}(id,order_id) ON DELETE RESTRICT,
      CONSTRAINT ck_reopen_source CHECK(
        (source = 'MANUAL' AND source_id IS NULL) OR (source IN ('ISSUE','SNAPSHOT') AND source_id IS NOT NULL)
      )
    )`);
    await runner.query(
      `CREATE INDEX ix_reopen_order ON ${table('order_reopen_event')}(order_id,created_at,id)`,
    );
    // Existing orders remain open. The pointer is the only active completion marker.
    await runner.query(`ALTER TABLE ${table('delivery_order')}
      ADD COLUMN current_completion_id uuid,
      ADD CONSTRAINT fk_order_current_completion FOREIGN KEY(current_completion_id,id) REFERENCES ${table('completion_record')}(id,order_id) ON DELETE RESTRICT`);
    await runner.query(
      `ALTER TABLE ${table('activity_log')} DROP CONSTRAINT ck_activity_log_action`,
    );
    await runner.query(
      `ALTER TABLE ${table('activity_log')} ADD CONSTRAINT ck_activity_log_action CHECK(action IN (${priorActions},'ORDER_COMPLETED','ORDER_REOPENED'))`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const table = (name: string) => this.table(runner, name);
    await runner.query(
      `ALTER TABLE ${table('delivery_order')} DROP CONSTRAINT fk_order_current_completion, DROP COLUMN current_completion_id`,
    );
    await runner.query(`DROP TABLE ${table('order_reopen_event')}`);
    await runner.query(`DROP TABLE ${table('completion_record')}`);
    await runner.query(
      `ALTER TABLE ${table('activity_log')} DROP CONSTRAINT ck_activity_log_action`,
    );
    await runner.query(
      `ALTER TABLE ${table('activity_log')} ADD CONSTRAINT ck_activity_log_action CHECK(action IN (${priorActions}))`,
    );
  }
}
