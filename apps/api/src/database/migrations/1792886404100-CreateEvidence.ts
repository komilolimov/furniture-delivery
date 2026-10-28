import type { MigrationInterface, QueryRunner } from 'typeorm';
const priorActions =
  "'ORDER_CREATED','ORDER_UPDATED','ITEM_ADDED','ITEM_UPDATED','ITEM_REMOVED','PAYMENT_RECORDED','PAYMENT_VOIDED','APPOINTMENT_CREATED','APPOINTMENT_UPDATED','APPOINTMENT_CONFIRMED','APPOINTMENT_CANCELLED','CONFIRMATION_RESET','EXECUTION_DEPARTED','EXECUTION_ARRIVED','EXECUTION_STARTED','EXECUTION_FINISHED','TASK_RESULT_CHANGED','ITEM_FULFILLMENT','RETURN_VISIT_REQUESTED'";
export class CreateEvidence1792886404100 implements MigrationInterface {
  name = 'CreateEvidence1792886404100';
  private table(r: QueryRunner, name: string): string {
    const schema =
      r.connection.options.type === 'postgres'
        ? (r.connection.options.schema ?? 'public')
        : 'public';
    return `${r.connection.driver.escape(schema)}.${r.connection.driver.escape(name)}`;
  }
  async up(r: QueryRunner): Promise<void> {
    const t = (name: string) => this.table(r, name);
    await r.query(
      `ALTER TABLE ${t('order_item')} ADD CONSTRAINT uq_item_id_order UNIQUE(id,order_id)`,
    );
    await r.query(
      `ALTER TABLE ${t('appointment')} ADD CONSTRAINT uq_appointment_id_order UNIQUE(id,order_id)`,
    );
    await r.query(
      `ALTER TABLE ${t('crew_assignment')} ADD CONSTRAINT uq_assignment_id_appointment UNIQUE(id,appointment_id)`,
    );
    const provenance = `order_id uuid NOT NULL REFERENCES ${t('delivery_order')}(id) ON DELETE RESTRICT, appointment_id uuid, assignment_id uuid, item_id uuid,
      FOREIGN KEY(appointment_id,order_id) REFERENCES ${t('appointment')}(id,order_id) ON DELETE RESTRICT,
      FOREIGN KEY(assignment_id,appointment_id) REFERENCES ${t('crew_assignment')}(id,appointment_id) ON DELETE RESTRICT,
      FOREIGN KEY(item_id,order_id) REFERENCES ${t('order_item')}(id,order_id) ON DELETE RESTRICT,
      CHECK(assignment_id IS NULL OR appointment_id IS NOT NULL),
      visibility varchar(24) NOT NULL CHECK(visibility IN ('BACKOFFICE_ONLY','CREW_VISIBLE')),
      author_id uuid NOT NULL REFERENCES ${t('app_user')}(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now()`;
    await r.query(
      `CREATE TABLE ${t('execution_note')} (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ${provenance}, text varchar(4000) NOT NULL CHECK(length(btrim(text)) BETWEEN 1 AND 4000))`,
    );
    await r.query(
      `CREATE INDEX ix_execution_note_order ON ${t('execution_note')}(order_id,created_at,id)`,
    );
    await r.query(`CREATE TABLE ${t('evidence_issue')} (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ${provenance},
      type varchar(32) NOT NULL CHECK(type IN ('DAMAGE','MISSING_PARTS','WRONG_PRODUCT','QUANTITY_MISMATCH','ACCESS_PROBLEM','CUSTOMER_UNAVAILABLE','OTHER')),
      description varchar(4000) NOT NULL CHECK(length(btrim(description)) BETWEEN 1 AND 4000),
      reported_source varchar(16) NOT NULL CHECK(reported_source IN ('CREW','CUSTOMER')),
      status varchar(16) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED')), version integer NOT NULL DEFAULT 1 CHECK(version>0),
      updated_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, resolved_by uuid REFERENCES ${t('app_user')}(id) ON DELETE RESTRICT, resolution varchar(4000),
      CONSTRAINT uq_issue_id_order UNIQUE(id,order_id),
      CHECK((status='OPEN' AND resolved_at IS NULL AND resolved_by IS NULL AND resolution IS NULL) OR (status='RESOLVED' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution IS NOT NULL AND length(btrim(resolution))>0)))`);
    await r.query(`CREATE INDEX ix_issue_order_status ON ${t('evidence_issue')}(order_id,status)`);
    await r.query(`CREATE TABLE ${t('issue_event')} (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), issue_id uuid NOT NULL REFERENCES ${t('evidence_issue')}(id) ON DELETE RESTRICT,
      kind varchar(16) NOT NULL CHECK(kind IN ('CREATED','NOTE','RESOLVED','REOPENED')), text varchar(4000) NOT NULL CHECK(length(btrim(text)) BETWEEN 1 AND 4000),
      actor_id uuid NOT NULL REFERENCES ${t('app_user')}(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now())`);
    await r.query(
      `CREATE INDEX ix_issue_event_issue ON ${t('issue_event')}(issue_id,created_at,id)`,
    );
    await r.query(`CREATE TABLE ${t('attachment')} (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ${provenance},
      proof_type varchar(24) CHECK(proof_type IN ('DELIVERY','ASSEMBLY','DAMAGE','MISSING_PARTS','OTHER')),
      kind varchar(8) NOT NULL CHECK(kind IN ('IMAGE','PDF')), state varchar(8) NOT NULL DEFAULT 'READY' CHECK(state='READY'),
      display_name varchar(150) NOT NULL CHECK(length(display_name)>0), content_type varchar(32) NOT NULL,
      size_bytes integer NOT NULL CHECK(size_bytes>0), width integer, height integer,
      storage_key varchar(80) NOT NULL UNIQUE CHECK(storage_key ~ '^[a-f0-9-]{36}\\.(webp|pdf)$'),
      source_hash varchar(64) NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
      withdrawn_at timestamptz, withdrawn_by uuid REFERENCES ${t('app_user')}(id) ON DELETE RESTRICT, withdraw_reason varchar(4000),
      CONSTRAINT uq_attachment_id_order UNIQUE(id,order_id),
      CHECK((kind='IMAGE' AND content_type='image/webp' AND width IS NOT NULL AND height IS NOT NULL AND width>0 AND height>0) OR (kind='PDF' AND content_type='application/pdf' AND width IS NULL AND height IS NULL)),
      CHECK((withdrawn_at IS NULL AND withdrawn_by IS NULL AND withdraw_reason IS NULL) OR (withdrawn_at IS NOT NULL AND withdrawn_by IS NOT NULL AND withdraw_reason IS NOT NULL AND length(btrim(withdraw_reason))>0)))`);
    await r.query(`CREATE INDEX ix_attachment_order ON ${t('attachment')}(order_id,created_at,id)`);
    await r.query(`CREATE TABLE ${t('issue_item')} (issue_id uuid NOT NULL, item_id uuid NOT NULL, order_id uuid NOT NULL,
      PRIMARY KEY(issue_id,item_id), FOREIGN KEY(issue_id,order_id) REFERENCES ${t('evidence_issue')}(id,order_id) ON DELETE RESTRICT, FOREIGN KEY(item_id,order_id) REFERENCES ${t('order_item')}(id,order_id) ON DELETE RESTRICT)`);
    await r.query(`CREATE TABLE ${t('issue_attachment')} (issue_id uuid NOT NULL, attachment_id uuid NOT NULL, order_id uuid NOT NULL,
      PRIMARY KEY(issue_id,attachment_id), FOREIGN KEY(issue_id,order_id) REFERENCES ${t('evidence_issue')}(id,order_id) ON DELETE RESTRICT, FOREIGN KEY(attachment_id,order_id) REFERENCES ${t('attachment')}(id,order_id) ON DELETE RESTRICT)`);
    await r.query(`CREATE TABLE ${t('evidence_receipt')} (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES ${t('app_user')}(id) ON DELETE RESTRICT,
      order_id uuid NOT NULL REFERENCES ${t('delivery_order')}(id) ON DELETE RESTRICT, action varchar(64) NOT NULL,
      operation_key varchar(100) NOT NULL CHECK(operation_key ~ '^[A-Za-z0-9_-]{8,100}$'), fingerprint varchar(64) NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
      result_id uuid, created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT uq_evidence_receipt_command UNIQUE(actor_id,order_id,action,operation_key))`);
    await r.query(`ALTER TABLE ${t('activity_log')} DROP CONSTRAINT ck_activity_log_action`);
    await r.query(
      `ALTER TABLE ${t('activity_log')} ADD CONSTRAINT ck_activity_log_action CHECK(action IN (${priorActions},'EXECUTION_NOTE_ADDED','ISSUE_CREATED','ISSUE_RESOLVED','ISSUE_REOPENED','ISSUE_NOTE_ADDED','ATTACHMENT_UPLOADED','ATTACHMENT_WITHDRAWN'))`,
    );
  }
  async down(r: QueryRunner): Promise<void> {
    const t = (name: string) => this.table(r, name);
    for (const name of [
      'evidence_receipt',
      'issue_attachment',
      'issue_item',
      'issue_event',
      'attachment',
      'evidence_issue',
      'execution_note',
    ])
      await r.query(`DROP TABLE ${t(name)}`);
    await r.query(`ALTER TABLE ${t('order_item')} DROP CONSTRAINT uq_item_id_order`);
    await r.query(`ALTER TABLE ${t('appointment')} DROP CONSTRAINT uq_appointment_id_order`);
    await r.query(
      `ALTER TABLE ${t('crew_assignment')} DROP CONSTRAINT uq_assignment_id_appointment`,
    );
    await r.query(`ALTER TABLE ${t('activity_log')} DROP CONSTRAINT ck_activity_log_action`);
    await r.query(
      `ALTER TABLE ${t('activity_log')} ADD CONSTRAINT ck_activity_log_action CHECK(action IN (${priorActions}))`,
    );
  }
}
