import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExecution1792886404000 implements MigrationInterface {
  name = 'CreateExecution1792886404000';
  private table(runner: QueryRunner, name: string): string {
    const schema =
      runner.connection.options.type === 'postgres'
        ? (runner.connection.options.schema ?? 'public')
        : 'public';
    return `${runner.connection.driver.escape(schema)}.${runner.connection.driver.escape(name)}`;
  }
  async up(runner: QueryRunner): Promise<void> {
    const t = (name: string) => this.table(runner, name);
    await runner.query(`ALTER TABLE ${t('crew_assignment')}
      ADD COLUMN execution_status varchar(32) NOT NULL DEFAULT 'NOT_STARTED',
      ADD COLUMN execution_version integer NOT NULL DEFAULT 1,
      ADD COLUMN departed_at timestamptz, ADD COLUMN arrived_at timestamptz,
      ADD COLUMN actual_start_at timestamptz, ADD COLUMN actual_end_at timestamptz,
      ADD CONSTRAINT ck_assignment_execution_version CHECK (execution_version > 0),
      ADD CONSTRAINT ck_assignment_execution_status CHECK (execution_status IN ('NOT_STARTED','ON_THE_WAY','ARRIVED','IN_PROGRESS','COMPLETED','PARTIALLY_COMPLETED','BLOCKED')),
      ADD CONSTRAINT ck_assignment_cancel_execution CHECK (status <> 'CANCELLED' OR execution_status = 'NOT_STARTED'),
      ADD CONSTRAINT ck_assignment_execution_times CHECK (
        (execution_status = 'NOT_STARTED' AND departed_at IS NULL AND arrived_at IS NULL AND actual_start_at IS NULL AND actual_end_at IS NULL) OR
        (execution_status = 'ON_THE_WAY' AND departed_at IS NOT NULL AND arrived_at IS NULL AND actual_start_at IS NULL AND actual_end_at IS NULL) OR
        (execution_status = 'ARRIVED' AND departed_at IS NOT NULL AND arrived_at IS NOT NULL AND arrived_at >= departed_at AND actual_start_at IS NULL AND actual_end_at IS NULL) OR
        (execution_status = 'IN_PROGRESS' AND departed_at IS NOT NULL AND arrived_at IS NOT NULL AND actual_start_at IS NOT NULL AND arrived_at >= departed_at AND actual_start_at >= arrived_at AND actual_end_at IS NULL) OR
        (execution_status IN ('COMPLETED','PARTIALLY_COMPLETED') AND departed_at IS NOT NULL AND arrived_at IS NOT NULL AND actual_start_at IS NOT NULL AND actual_end_at IS NOT NULL AND arrived_at >= departed_at AND actual_start_at >= arrived_at AND actual_end_at >= actual_start_at) OR
        (execution_status = 'BLOCKED' AND departed_at IS NOT NULL AND actual_end_at IS NOT NULL AND actual_end_at >= departed_at AND
          (arrived_at IS NULL OR (arrived_at >= departed_at AND arrived_at <= actual_end_at)) AND
          (actual_start_at IS NULL OR (arrived_at IS NOT NULL AND actual_start_at >= arrived_at AND actual_start_at <= actual_end_at)))
      )`);
    await runner.query(
      `CREATE UNIQUE INDEX uq_crew_active_execution ON ${t('crew_assignment')}(crew_id) WHERE status = 'ASSIGNED' AND execution_status IN ('ON_THE_WAY','ARRIVED','IN_PROGRESS')`,
    );
    await runner.query(`ALTER TABLE ${t('task')}
      ADD COLUMN result_status varchar(16) NOT NULL DEFAULT 'PENDING',
      ADD COLUMN result_version integer NOT NULL DEFAULT 1,
      ADD COLUMN done_by uuid REFERENCES ${t('app_user')}(id) ON DELETE RESTRICT,
      ADD COLUMN done_at timestamptz, ADD COLUMN result_reason varchar(4000),
      ADD CONSTRAINT ck_task_result_version CHECK (result_version > 0),
      ADD CONSTRAINT ck_task_result_status CHECK (result_status IN ('PENDING','DONE','SKIPPED')),
      ADD CONSTRAINT ck_task_result_required CHECK (NOT required OR result_status <> 'SKIPPED'),
      ADD CONSTRAINT ck_task_result_metadata CHECK (
        (result_status = 'PENDING' AND done_by IS NULL AND done_at IS NULL) OR
        (result_status IN ('DONE','SKIPPED') AND done_by IS NOT NULL AND done_at IS NOT NULL)
      ),
      ADD CONSTRAINT ck_task_skip_reason CHECK (result_status <> 'SKIPPED' OR (result_reason IS NOT NULL AND length(btrim(result_reason)) > 0))`);
    await runner.query(`ALTER TABLE ${t('order_item')}
      ADD COLUMN delivered_quantity integer NOT NULL DEFAULT 0,
      ADD COLUMN assembled_quantity integer NOT NULL DEFAULT 0,
      ADD COLUMN fulfillment_version integer NOT NULL DEFAULT 1,
      ADD CONSTRAINT ck_item_fulfillment_version CHECK (fulfillment_version > 0),
      ADD CONSTRAINT ck_item_fulfillment CHECK (0 <= assembled_quantity AND assembled_quantity <= delivered_quantity AND delivered_quantity <= quantity),
      ADD CONSTRAINT ck_item_no_assembly CHECK (requires_assembly OR assembled_quantity = 0)`);
    await runner.query(`CREATE TABLE ${t('execution_receipt')} (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES ${t('app_user')}(id) ON DELETE RESTRICT,
      assignment_id uuid NOT NULL REFERENCES ${t('crew_assignment')}(id) ON DELETE RESTRICT,
      action varchar(64) NOT NULL, operation_key varchar(100) NOT NULL, fingerprint varchar(64) NOT NULL,
      result_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_execution_receipt_command UNIQUE(actor_id,assignment_id,action,operation_key),
      CONSTRAINT ck_execution_receipt_key CHECK (operation_key ~ '^[A-Za-z0-9_-]{8,100}$'),
      CONSTRAINT ck_execution_receipt_hash CHECK (fingerprint ~ '^[a-f0-9]{64}$')
    )`);
    await runner.query(`CREATE TABLE ${t('finish_report')} (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES ${t('delivery_order')}(id) ON DELETE RESTRICT,
      appointment_id uuid NOT NULL REFERENCES ${t('appointment')}(id) ON DELETE RESTRICT,
      assignment_id uuid NOT NULL REFERENCES ${t('crew_assignment')}(id) ON DELETE RESTRICT,
      outcome varchar(32) NOT NULL, summary varchar(4000) NOT NULL, reason varchar(4000), remaining_work varchar(4000),
      quantity_scope varchar(32) NOT NULL DEFAULT 'ACCUMULATED_ORDER', task_results jsonb NOT NULL, quantities jsonb NOT NULL,
      known_issue_ids uuid[] NOT NULL DEFAULT '{}', attachment_ids uuid[] NOT NULL DEFAULT '{}',
      author_id uuid NOT NULL REFERENCES ${t('app_user')}(id) ON DELETE RESTRICT,
      actual_end_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_finish_report_assignment UNIQUE(assignment_id),
      CONSTRAINT ck_finish_outcome CHECK (outcome IN ('COMPLETED','PARTIALLY_COMPLETED','BLOCKED')),
      CONSTRAINT ck_finish_summary CHECK (length(btrim(summary)) BETWEEN 1 AND 4000),
      CONSTRAINT ck_finish_quantity_scope CHECK (quantity_scope = 'ACCUMULATED_ORDER'),
      CONSTRAINT ck_finish_snapshot_arrays CHECK (jsonb_typeof(task_results) = 'array' AND jsonb_typeof(quantities) = 'array'),
      CONSTRAINT ck_finish_partial_details CHECK (outcome = 'COMPLETED' OR (reason IS NOT NULL AND length(btrim(reason)) > 0 AND remaining_work IS NOT NULL AND length(btrim(remaining_work)) > 0))
    )`);
    await runner.query(`CREATE TABLE ${t('return_visit_request')} (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES ${t('delivery_order')}(id) ON DELETE RESTRICT,
      appointment_id uuid NOT NULL REFERENCES ${t('appointment')}(id) ON DELETE RESTRICT,
      assignment_id uuid NOT NULL REFERENCES ${t('crew_assignment')}(id) ON DELETE RESTRICT,
      finish_report_id uuid NOT NULL REFERENCES ${t('finish_report')}(id) ON DELETE RESTRICT,
      status varchar(16) NOT NULL DEFAULT 'OPEN', reason varchar(4000) NOT NULL, remaining_work varchar(4000) NOT NULL,
      author_id uuid NOT NULL REFERENCES ${t('app_user')}(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_return_visit_assignment UNIQUE(assignment_id),
      CONSTRAINT ck_return_status CHECK (status IN ('OPEN','RESOLVED')),
      CONSTRAINT ck_return_reason CHECK (length(btrim(reason)) BETWEEN 1 AND 4000 AND length(btrim(remaining_work)) BETWEEN 1 AND 4000)
    )`);
    await runner.query(
      `CREATE INDEX ix_return_order ON ${t('return_visit_request')}(order_id,status)`,
    );
    const actions =
      "'ORDER_CREATED','ORDER_UPDATED','ITEM_ADDED','ITEM_UPDATED','ITEM_REMOVED','PAYMENT_RECORDED','PAYMENT_VOIDED','APPOINTMENT_CREATED','APPOINTMENT_UPDATED','APPOINTMENT_CONFIRMED','APPOINTMENT_CANCELLED','CONFIRMATION_RESET','EXECUTION_DEPARTED','EXECUTION_ARRIVED','EXECUTION_STARTED','EXECUTION_FINISHED','TASK_RESULT_CHANGED','ITEM_FULFILLMENT','RETURN_VISIT_REQUESTED'";
    await runner.query(`ALTER TABLE ${t('activity_log')} DROP CONSTRAINT ck_activity_log_action`);
    await runner.query(
      `ALTER TABLE ${t('activity_log')} ADD CONSTRAINT ck_activity_log_action CHECK (action IN (${actions}))`,
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    const t = (name: string) => this.table(runner, name);
    for (const table of ['return_visit_request', 'finish_report', 'execution_receipt'])
      await runner.query(`DROP TABLE ${t(table)}`);
    await runner.query(
      `ALTER TABLE ${t('order_item')} DROP CONSTRAINT ck_item_fulfillment_version, DROP CONSTRAINT ck_item_fulfillment, DROP CONSTRAINT ck_item_no_assembly, DROP COLUMN delivered_quantity, DROP COLUMN assembled_quantity, DROP COLUMN fulfillment_version`,
    );
    await runner.query(
      `ALTER TABLE ${t('task')} DROP CONSTRAINT ck_task_result_version, DROP CONSTRAINT ck_task_result_status, DROP CONSTRAINT ck_task_result_required, DROP CONSTRAINT ck_task_result_metadata, DROP CONSTRAINT ck_task_skip_reason, DROP COLUMN result_status, DROP COLUMN result_version, DROP COLUMN done_by, DROP COLUMN done_at, DROP COLUMN result_reason`,
    );
    await runner.query(`DROP INDEX ${t('uq_crew_active_execution')}`);
    await runner.query(
      `ALTER TABLE ${t('crew_assignment')} DROP CONSTRAINT ck_assignment_execution_version, DROP CONSTRAINT ck_assignment_execution_status, DROP CONSTRAINT ck_assignment_cancel_execution, DROP CONSTRAINT ck_assignment_execution_times, DROP COLUMN execution_status, DROP COLUMN execution_version, DROP COLUMN departed_at, DROP COLUMN arrived_at, DROP COLUMN actual_start_at, DROP COLUMN actual_end_at`,
    );
    await runner.query(`ALTER TABLE ${t('activity_log')} DROP CONSTRAINT ck_activity_log_action`);
    await runner.query(
      `ALTER TABLE ${t('activity_log')} ADD CONSTRAINT ck_activity_log_action CHECK (action IN ('ORDER_CREATED','ORDER_UPDATED','ITEM_ADDED','ITEM_UPDATED','ITEM_REMOVED','PAYMENT_RECORDED','PAYMENT_VOIDED','APPOINTMENT_CREATED','APPOINTMENT_UPDATED','APPOINTMENT_CONFIRMED','APPOINTMENT_CANCELLED','CONFIRMATION_RESET'))`,
    );
  }
}
