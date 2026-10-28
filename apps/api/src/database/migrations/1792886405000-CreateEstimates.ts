import type { MigrationInterface, QueryRunner } from 'typeorm';

const priorActions =
  "'ORDER_CREATED','ORDER_UPDATED','ITEM_ADDED','ITEM_UPDATED','ITEM_REMOVED','PAYMENT_RECORDED','PAYMENT_VOIDED','APPOINTMENT_CREATED','APPOINTMENT_UPDATED','APPOINTMENT_CONFIRMED','APPOINTMENT_CANCELLED','CONFIRMATION_RESET','EXECUTION_DEPARTED','EXECUTION_ARRIVED','EXECUTION_STARTED','EXECUTION_FINISHED','TASK_RESULT_CHANGED','ITEM_FULFILLMENT','RETURN_VISIT_REQUESTED','EXECUTION_NOTE_ADDED','ISSUE_CREATED','ISSUE_RESOLVED','ISSUE_REOPENED','ISSUE_NOTE_ADDED','ATTACHMENT_UPLOADED','ATTACHMENT_WITHDRAWN'";

export class CreateEstimates1792886405000 implements MigrationInterface {
  name = 'CreateEstimates1792886405000';

  private table(runner: QueryRunner, name: string): string {
    const schema =
      runner.connection.options.type === 'postgres'
        ? (runner.connection.options.schema ?? 'public')
        : 'public';
    return `${runner.connection.driver.escape(schema)}.${runner.connection.driver.escape(name)}`;
  }

  async up(runner: QueryRunner): Promise<void> {
    const table = (name: string) => this.table(runner, name);
    await runner.query(`ALTER TABLE ${table('crew_assignment')}
      ADD COLUMN estimated_finish_at timestamptz,
      ADD COLUMN estimate_updated_at timestamptz,
      ADD COLUMN estimate_updated_by uuid REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      ADD COLUMN estimate_reason varchar(4000),
      ADD COLUMN estimate_version integer NOT NULL DEFAULT 1,
      ADD CONSTRAINT ck_assignment_estimate_version CHECK(estimate_version > 0),
      ADD CONSTRAINT ck_assignment_estimate_metadata CHECK(
        (estimated_finish_at IS NULL AND estimate_updated_at IS NULL AND estimate_updated_by IS NULL AND estimate_reason IS NULL)
        OR (estimate_updated_at IS NOT NULL AND estimate_updated_by IS NOT NULL AND estimate_reason IS NOT NULL AND length(btrim(estimate_reason)) > 0)
      )`);
    await runner.query(
      `ALTER TABLE ${table('activity_log')} DROP CONSTRAINT ck_activity_log_action`,
    );
    await runner.query(
      `ALTER TABLE ${table('activity_log')} ADD CONSTRAINT ck_activity_log_action CHECK(action IN (${priorActions},'ESTIMATE_SET'))`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const table = (name: string) => this.table(runner, name);
    await runner.query(
      `ALTER TABLE ${table('activity_log')} DROP CONSTRAINT ck_activity_log_action`,
    );
    await runner.query(
      `ALTER TABLE ${table('activity_log')} ADD CONSTRAINT ck_activity_log_action CHECK(action IN (${priorActions}))`,
    );
    await runner.query(`ALTER TABLE ${table('crew_assignment')}
      DROP CONSTRAINT ck_assignment_estimate_metadata,
      DROP CONSTRAINT ck_assignment_estimate_version,
      DROP COLUMN estimated_finish_at,
      DROP COLUMN estimate_updated_at,
      DROP COLUMN estimate_updated_by,
      DROP COLUMN estimate_reason,
      DROP COLUMN estimate_version`);
  }
}
