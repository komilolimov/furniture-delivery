import type { MigrationInterface, QueryRunner } from 'typeorm';

const priorActions =
  "'ORDER_CREATED','ORDER_UPDATED','ITEM_ADDED','ITEM_UPDATED','ITEM_REMOVED','PAYMENT_RECORDED','PAYMENT_VOIDED','APPOINTMENT_CREATED','APPOINTMENT_UPDATED','APPOINTMENT_CONFIRMED','APPOINTMENT_CANCELLED','CONFIRMATION_RESET','EXECUTION_DEPARTED','EXECUTION_ARRIVED','EXECUTION_STARTED','EXECUTION_FINISHED','TASK_RESULT_CHANGED','ITEM_FULFILLMENT','RETURN_VISIT_REQUESTED','EXECUTION_NOTE_ADDED','ISSUE_CREATED','ISSUE_RESOLVED','ISSUE_REOPENED','ISSUE_NOTE_ADDED','ATTACHMENT_UPLOADED','ATTACHMENT_WITHDRAWN','ESTIMATE_SET'";

export class CreateReturnVisits1792886405100 implements MigrationInterface {
  name = 'CreateReturnVisits1792886405100';

  private table(runner: QueryRunner, name: string): string {
    const schema =
      runner.connection.options.type === 'postgres'
        ? (runner.connection.options.schema ?? 'public')
        : 'public';
    return `${runner.connection.driver.escape(schema)}.${runner.connection.driver.escape(name)}`;
  }

  async up(runner: QueryRunner): Promise<void> {
    const table = (name: string) => this.table(runner, name);
    await runner.query(`ALTER TABLE ${table('return_visit_request')}
      DROP CONSTRAINT ck_return_status,
      ADD COLUMN version integer NOT NULL DEFAULT 1,
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN updated_by uuid REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      ADD COLUMN resolved_at timestamptz,
      ADD COLUMN resolved_by uuid REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      ADD COLUMN resolution varchar(4000),
      ADD CONSTRAINT ck_return_status CHECK(status IN ('OPEN','PLANNED','RESOLVED')),
      ADD CONSTRAINT ck_return_version CHECK(version > 0),
      ADD CONSTRAINT uq_return_request_id_order UNIQUE(id,order_id),
      ADD CONSTRAINT ck_return_resolution CHECK(
        (status <> 'RESOLVED' AND resolved_at IS NULL AND resolved_by IS NULL AND resolution IS NULL)
        OR (status = 'RESOLVED' AND (
          (resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution IS NOT NULL AND length(btrim(resolution)) > 0)
          OR (version = 1 AND resolved_at IS NULL AND resolved_by IS NULL AND resolution IS NULL)
        ))
      )`);
    // Preserve historical timestamps rather than claiming these requests were edited by migration.
    await runner.query(`UPDATE ${table('return_visit_request')} SET updated_at = created_at`);
    await runner.query(`ALTER TABLE ${table('task')}
      ADD COLUMN source_task_id uuid REFERENCES ${table('task')}(id) ON DELETE RESTRICT,
      ADD COLUMN return_scope_key uuid,
      ADD CONSTRAINT ck_task_source_not_self CHECK(source_task_id IS NULL OR source_task_id <> id)`);
    await runner.query(`CREATE INDEX ix_task_source ON ${table('task')}(source_task_id)`);
    await runner.query(`CREATE INDEX ix_task_return_scope ON ${table('task')}(return_scope_key)`);
    await runner.query(
      `CREATE UNIQUE INDEX uq_task_active_return_scope ON ${table('task')}(assignment_id,return_scope_key) WHERE active = true AND return_scope_key IS NOT NULL`,
    );
    await runner.query(`CREATE TABLE ${table('return_visit_attempt')} (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id uuid NOT NULL,
      request_id uuid NOT NULL,
      appointment_id uuid NOT NULL,
      "current" boolean NOT NULL DEFAULT true,
      closed_outcome varchar(16),
      scope jsonb NOT NULL,
      return_requested boolean NOT NULL DEFAULT false,
      created_by uuid NOT NULL REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      closed_at timestamptz,
      closed_by uuid REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      close_reason varchar(4000),
      CONSTRAINT uq_return_attempt_appointment UNIQUE(appointment_id),
      FOREIGN KEY(request_id,order_id) REFERENCES ${table('return_visit_request')}(id,order_id) ON DELETE RESTRICT,
      FOREIGN KEY(appointment_id,order_id) REFERENCES ${table('appointment')}(id,order_id) ON DELETE RESTRICT,
      CONSTRAINT ck_return_attempt_scope CHECK(
        jsonb_typeof(scope) = 'object' AND scope ? 'tasks' AND scope ? 'itemTargets'
        AND jsonb_typeof(scope->'tasks') = 'array' AND jsonb_typeof(scope->'itemTargets') = 'array'
      ),
      CONSTRAINT ck_return_attempt_closure CHECK(
        ("current" = true AND closed_outcome IS NULL AND closed_at IS NULL AND closed_by IS NULL AND close_reason IS NULL)
        OR ("current" = false AND closed_outcome IS NOT NULL AND closed_outcome IN ('CANCELLED','FAILED','RESOLVED') AND closed_at IS NOT NULL AND closed_by IS NOT NULL AND close_reason IS NOT NULL AND length(btrim(close_reason)) > 0)
      )
    )`);
    await runner.query(
      `CREATE UNIQUE INDEX uq_return_attempt_current ON ${table('return_visit_attempt')}(request_id) WHERE "current" = true`,
    );
    await runner.query(
      `CREATE INDEX ix_return_attempt_request ON ${table('return_visit_attempt')}(request_id,created_at,id)`,
    );
    await runner.query(
      `ALTER TABLE ${table('activity_log')} DROP CONSTRAINT ck_activity_log_action`,
    );
    await runner.query(
      `ALTER TABLE ${table('activity_log')} ADD CONSTRAINT ck_activity_log_action CHECK(action IN (${priorActions},'APPOINTMENT_RESCHEDULED','RETURN_VISIT_PLANNED','RETURN_VISIT_RESOLVED','RETURN_VISIT_REOPENED'))`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const table = (name: string) => this.table(runner, name);
    await runner.query(`DROP TABLE ${table('return_visit_attempt')}`);
    await runner.query(`DROP INDEX ${table('uq_task_active_return_scope')}`);
    await runner.query(`DROP INDEX ${table('ix_task_return_scope')}`);
    await runner.query(`DROP INDEX ${table('ix_task_source')}`);
    await runner.query(`ALTER TABLE ${table('task')}
      DROP CONSTRAINT ck_task_source_not_self,
      DROP COLUMN source_task_id,
      DROP COLUMN return_scope_key`);
    await runner.query(`ALTER TABLE ${table('return_visit_request')}
      DROP CONSTRAINT ck_return_status,
      DROP CONSTRAINT ck_return_version,
      DROP CONSTRAINT ck_return_resolution,
      DROP CONSTRAINT uq_return_request_id_order,
      DROP COLUMN version,
      DROP COLUMN updated_at,
      DROP COLUMN updated_by,
      DROP COLUMN resolved_at,
      DROP COLUMN resolved_by,
      DROP COLUMN resolution,
      ADD CONSTRAINT ck_return_status CHECK(status IN ('OPEN','RESOLVED'))`);
    await runner.query(
      `ALTER TABLE ${table('activity_log')} DROP CONSTRAINT ck_activity_log_action`,
    );
    await runner.query(
      `ALTER TABLE ${table('activity_log')} ADD CONSTRAINT ck_activity_log_action CHECK(action IN (${priorActions}))`,
    );
  }
}
