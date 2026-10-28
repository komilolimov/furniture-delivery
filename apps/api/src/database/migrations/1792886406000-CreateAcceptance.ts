import type { MigrationInterface, QueryRunner } from 'typeorm';

const priorActions =
  "'ORDER_CREATED','ORDER_UPDATED','ITEM_ADDED','ITEM_UPDATED','ITEM_REMOVED','PAYMENT_RECORDED','PAYMENT_VOIDED','APPOINTMENT_CREATED','APPOINTMENT_UPDATED','APPOINTMENT_CONFIRMED','APPOINTMENT_CANCELLED','CONFIRMATION_RESET','EXECUTION_DEPARTED','EXECUTION_ARRIVED','EXECUTION_STARTED','EXECUTION_FINISHED','TASK_RESULT_CHANGED','ITEM_FULFILLMENT','RETURN_VISIT_REQUESTED','EXECUTION_NOTE_ADDED','ISSUE_CREATED','ISSUE_RESOLVED','ISSUE_REOPENED','ISSUE_NOTE_ADDED','ATTACHMENT_UPLOADED','ATTACHMENT_WITHDRAWN','ESTIMATE_SET','APPOINTMENT_RESCHEDULED','RETURN_VISIT_PLANNED','RETURN_VISIT_RESOLVED','RETURN_VISIT_REOPENED'";

export class CreateAcceptance1792886406000 implements MigrationInterface {
  name = 'CreateAcceptance1792886406000';

  private table(runner: QueryRunner, name: string): string {
    const schema =
      runner.connection.options.type === 'postgres'
        ? (runner.connection.options.schema ?? 'public')
        : 'public';
    return `${runner.connection.driver.escape(schema)}.${runner.connection.driver.escape(name)}`;
  }

  async up(runner: QueryRunner): Promise<void> {
    const table = (name: string) => this.table(runner, name);
    await runner.query(`CREATE TABLE ${table('acceptance_snapshot')} (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id uuid NOT NULL,
      appointment_id uuid NOT NULL,
      version integer NOT NULL CHECK(version > 0),
      payload jsonb NOT NULL CHECK(jsonb_typeof(payload) = 'object'),
      canonical text NOT NULL,
      hash varchar(64) NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'),
      created_by uuid NOT NULL REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      invalidated_at timestamptz,
      invalidated_by uuid REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      invalidation_reason varchar(4000),
      CONSTRAINT uq_acceptance_snapshot_revision UNIQUE(appointment_id,version),
      CONSTRAINT uq_acceptance_snapshot_provenance UNIQUE(id,order_id,appointment_id),
      CONSTRAINT uq_acceptance_snapshot_hash UNIQUE(id,hash),
      FOREIGN KEY(appointment_id,order_id) REFERENCES ${table('appointment')}(id,order_id) ON DELETE RESTRICT,
      CONSTRAINT ck_acceptance_canonical CHECK(canonical::jsonb = payload),
      CONSTRAINT ck_acceptance_invalidation CHECK(
        (invalidated_at IS NULL AND invalidated_by IS NULL AND invalidation_reason IS NULL)
        OR (invalidated_at IS NOT NULL AND invalidated_by IS NOT NULL AND invalidation_reason IS NOT NULL AND length(btrim(invalidation_reason)) > 0)
      )
    )`);
    await runner.query(
      `CREATE UNIQUE INDEX uq_acceptance_snapshot_current ON ${table('acceptance_snapshot')}(appointment_id) WHERE invalidated_at IS NULL`,
    );
    await runner.query(
      `CREATE INDEX ix_acceptance_snapshot_order ON ${table('acceptance_snapshot')}(order_id,created_at,id)`,
    );
    await runner.query(`CREATE TABLE ${table('acceptance_slot')} (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      snapshot_id uuid NOT NULL,
      order_id uuid NOT NULL,
      appointment_id uuid NOT NULL,
      kind varchar(16) NOT NULL CHECK(kind IN ('CUSTOMER','CREW')),
      assignment_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_acceptance_slot_assignment UNIQUE(snapshot_id,assignment_id),
      CONSTRAINT uq_acceptance_slot_snapshot UNIQUE(id,snapshot_id),
      FOREIGN KEY(snapshot_id,order_id,appointment_id) REFERENCES ${table('acceptance_snapshot')}(id,order_id,appointment_id) ON DELETE RESTRICT,
      FOREIGN KEY(assignment_id,appointment_id) REFERENCES ${table('crew_assignment')}(id,appointment_id) ON DELETE RESTRICT,
      CONSTRAINT ck_acceptance_slot_kind CHECK(
        (kind = 'CUSTOMER' AND assignment_id IS NULL) OR (kind = 'CREW' AND assignment_id IS NOT NULL)
      )
    )`);
    await runner.query(
      `CREATE UNIQUE INDEX uq_acceptance_customer_slot ON ${table('acceptance_slot')}(snapshot_id) WHERE kind = 'CUSTOMER'`,
    );
    await runner.query(`CREATE TABLE ${table('signature_confirmation')} (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slot_id uuid NOT NULL,
      snapshot_id uuid NOT NULL,
      snapshot_hash varchar(64) NOT NULL,
      method varchar(16) NOT NULL CHECK(method IN ('SIGNED','ABSENCE')),
      signer_name varchar(200),
      signer_relation varchar(200),
      captured_by_user_id uuid NOT NULL REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      recorded_at timestamptz NOT NULL DEFAULT now(),
      png bytea,
      image_digest varchar(64),
      width integer,
      height integer,
      size_bytes integer,
      absence_kind varchar(24),
      absence_reason varchar(4000),
      CONSTRAINT uq_signature_slot UNIQUE(slot_id),
      CONSTRAINT uq_signature_id_slot_method UNIQUE(id,slot_id,method),
      FOREIGN KEY(slot_id,snapshot_id) REFERENCES ${table('acceptance_slot')}(id,snapshot_id) ON DELETE RESTRICT,
      FOREIGN KEY(snapshot_id,snapshot_hash) REFERENCES ${table('acceptance_snapshot')}(id,hash) ON DELETE RESTRICT,
      CONSTRAINT ck_signature_confirmation_method CHECK(
        (method = 'SIGNED'
          AND signer_name IS NOT NULL AND length(btrim(signer_name)) > 0
          AND png IS NOT NULL AND image_digest IS NOT NULL AND image_digest ~ '^[a-f0-9]{64}$'
          AND width IS NOT NULL AND width BETWEEN 1 AND 2048
          AND height IS NOT NULL AND height BETWEEN 1 AND 1024
          AND width * height <= 2097152
          AND size_bytes IS NOT NULL AND size_bytes BETWEEN 1 AND 262144 AND octet_length(png) = size_bytes
          AND substring(png FROM 1 FOR 8) = decode('89504e470d0a1a0a','hex')
          AND absence_kind IS NULL AND absence_reason IS NULL)
        OR (method = 'ABSENCE'
          AND signer_name IS NULL AND signer_relation IS NULL
          AND png IS NULL AND image_digest IS NULL AND width IS NULL AND height IS NULL AND size_bytes IS NULL
          AND absence_kind IS NOT NULL AND absence_kind IN ('REFUSED','ABSENT','UNABLE_TO_SIGN')
          AND absence_reason IS NOT NULL AND length(btrim(absence_reason)) > 0)
      )
    )`);
    await runner.query(`CREATE TABLE ${table('exception_review')} (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slot_id uuid NOT NULL,
      confirmation_id uuid NOT NULL,
      confirmation_method varchar(16) NOT NULL DEFAULT 'ABSENCE' CHECK(confirmation_method = 'ABSENCE'),
      decision varchar(16) NOT NULL CHECK(decision IN ('APPROVED','REJECTED')),
      reason varchar(4000) NOT NULL CHECK(length(btrim(reason)) > 0),
      reviewed_by_user_id uuid NOT NULL REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      reviewed_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_exception_review_slot UNIQUE(slot_id),
      CONSTRAINT uq_exception_review_confirmation UNIQUE(confirmation_id),
      FOREIGN KEY(confirmation_id,slot_id,confirmation_method) REFERENCES ${table('signature_confirmation')}(id,slot_id,method) ON DELETE RESTRICT
    )`);
    await runner.query(
      `ALTER TABLE ${table('activity_log')} DROP CONSTRAINT ck_activity_log_action`,
    );
    await runner.query(
      `ALTER TABLE ${table('activity_log')} ADD CONSTRAINT ck_activity_log_action CHECK(action IN (${priorActions},'ACCEPTANCE_PREPARED','ACCEPTANCE_SIGNED','ACCEPTANCE_ABSENT','EXCEPTION_REVIEWED','ACCEPTANCE_INVALIDATED'))`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const table = (name: string) => this.table(runner, name);
    for (const name of [
      'exception_review',
      'signature_confirmation',
      'acceptance_slot',
      'acceptance_snapshot',
    ])
      await runner.query(`DROP TABLE ${table(name)}`);
    await runner.query(
      `ALTER TABLE ${table('activity_log')} DROP CONSTRAINT ck_activity_log_action`,
    );
    await runner.query(
      `ALTER TABLE ${table('activity_log')} ADD CONSTRAINT ck_activity_log_action CHECK(action IN (${priorActions}))`,
    );
  }
}
