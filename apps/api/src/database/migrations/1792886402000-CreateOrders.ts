import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrders1792886402000 implements MigrationInterface {
  name = 'CreateOrders1792886402000';

  private table(queryRunner: QueryRunner, name: string): string {
    const schema =
      queryRunner.connection.options.type === 'postgres'
        ? (queryRunner.connection.options.schema ?? 'public')
        : 'public';
    return `${queryRunner.connection.driver.escape(schema)}.${queryRunner.connection.driver.escape(name)}`;
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = (name: string) => this.table(queryRunner, name);
    const sequence = table('delivery_order_number_seq').replaceAll("'", "''");
    await queryRunner.query(`CREATE SEQUENCE ${table('delivery_order_number_seq')}`);
    await queryRunner.query(`CREATE TABLE ${table('delivery_order')} (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      number varchar(32) NOT NULL DEFAULT ('ORD-' || nextval('${sequence}'::regclass)::text),
      seed_key varchar(64),
      customer_name varchar(200) NOT NULL,
      contact_name varchar(200),
      phone_numbers jsonb NOT NULL,
      email varchar(254),
      address varchar(500) NOT NULL,
      city varchar(120) NOT NULL,
      country varchar(120) NOT NULL,
      postal_code varchar(24),
      service_type varchar(32) NOT NULL,
      work_description varchar(4000) NOT NULL,
      estimated_duration_minutes integer NOT NULL,
      floor varchar(40),
      has_elevator boolean,
      easy_access boolean,
      parking_available boolean,
      access_restrictions varchar(4000) NOT NULL DEFAULT '',
      access_notes varchar(4000) NOT NULL DEFAULT '',
      internal_notes varchar(4000) NOT NULL DEFAULT '',
      crew_notes varchar(4000) NOT NULL DEFAULT '',
      order_total_cents integer NOT NULL,
      currency varchar(3) NOT NULL DEFAULT 'EUR',
      version integer NOT NULL DEFAULT 1,
      created_by uuid NOT NULL,
      updated_by uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_delivery_order PRIMARY KEY (id),
      CONSTRAINT uq_delivery_order_number UNIQUE (number),
      CONSTRAINT uq_delivery_order_seed_key UNIQUE (seed_key),
      CONSTRAINT fk_delivery_order_created_by FOREIGN KEY (created_by) REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      CONSTRAINT fk_delivery_order_updated_by FOREIGN KEY (updated_by) REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      CONSTRAINT ck_delivery_order_customer CHECK (length(btrim(customer_name)) BETWEEN 1 AND 200),
      CONSTRAINT ck_delivery_order_address CHECK (length(btrim(address)) BETWEEN 1 AND 500),
      CONSTRAINT ck_delivery_order_city CHECK (length(btrim(city)) BETWEEN 1 AND 120),
      CONSTRAINT ck_delivery_order_country CHECK (length(btrim(country)) BETWEEN 1 AND 120),
      CONSTRAINT ck_delivery_order_description CHECK (length(btrim(work_description)) BETWEEN 1 AND 4000),
      CONSTRAINT ck_delivery_order_phones CHECK (jsonb_typeof(phone_numbers) = 'array' AND jsonb_array_length(phone_numbers) BETWEEN 1 AND 5),
      CONSTRAINT ck_delivery_order_duration CHECK (estimated_duration_minutes BETWEEN 1 AND 10080),
      CONSTRAINT ck_delivery_order_total CHECK (order_total_cents BETWEEN 0 AND 2000000000),
      CONSTRAINT ck_delivery_order_currency CHECK (currency = 'EUR'),
      CONSTRAINT ck_delivery_order_version CHECK (version > 0),
      CONSTRAINT ck_delivery_order_service CHECK (service_type IN ('DELIVERY_ONLY', 'DELIVERY_AND_ASSEMBLY'))
    )`);
    await queryRunner.query(
      `ALTER SEQUENCE ${table('delivery_order_number_seq')} OWNED BY ${table('delivery_order')}.number`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_delivery_order_created_id ON ${table('delivery_order')}(created_at DESC, id DESC)`,
    );
    await queryRunner.query(`CREATE TABLE ${table('order_item')} (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      order_id uuid NOT NULL,
      description varchar(1000) NOT NULL,
      quantity integer NOT NULL,
      configuration varchar(2000) NOT NULL DEFAULT '',
      ambient varchar(120) NOT NULL DEFAULT '',
      notes varchar(2000) NOT NULL DEFAULT '',
      requires_assembly boolean NOT NULL DEFAULT false,
      sort_order integer NOT NULL DEFAULT 0,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_order_item PRIMARY KEY (id),
      CONSTRAINT fk_order_item_order FOREIGN KEY (order_id) REFERENCES ${table('delivery_order')}(id) ON DELETE RESTRICT,
      CONSTRAINT ck_order_item_description CHECK (length(btrim(description)) BETWEEN 1 AND 1000),
      CONSTRAINT ck_order_item_quantity CHECK (quantity BETWEEN 1 AND 10000),
      CONSTRAINT ck_order_item_sort_order CHECK (sort_order BETWEEN 0 AND 9999)
    )`);
    await queryRunner.query(
      `CREATE INDEX ix_order_item_order_id ON ${table('order_item')}(order_id)`,
    );
    await queryRunner.query(`CREATE TABLE ${table('payment')} (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      order_id uuid NOT NULL,
      amount_cents integer NOT NULL,
      paid_on date NOT NULL,
      method varchar(16) NOT NULL,
      note varchar(2000),
      status varchar(8) NOT NULL DEFAULT 'RECORDED',
      idempotency_key varchar(100) NOT NULL,
      fingerprint varchar(64) NOT NULL,
      created_by uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      voided_by uuid,
      voided_at timestamptz,
      void_reason varchar(1000),
      CONSTRAINT pk_payment PRIMARY KEY (id),
      CONSTRAINT uq_payment_order_key UNIQUE (order_id, idempotency_key),
      CONSTRAINT fk_payment_order FOREIGN KEY (order_id) REFERENCES ${table('delivery_order')}(id) ON DELETE RESTRICT,
      CONSTRAINT fk_payment_created_by FOREIGN KEY (created_by) REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      CONSTRAINT fk_payment_voided_by FOREIGN KEY (voided_by) REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      CONSTRAINT ck_payment_amount CHECK (amount_cents BETWEEN 1 AND 2000000000),
      CONSTRAINT ck_payment_date CHECK (paid_on BETWEEN DATE '1900-01-01' AND DATE '9999-12-31'),
      CONSTRAINT ck_payment_method CHECK (method IN ('CASH', 'BANK_TRANSFER', 'CARD', 'OTHER')),
      CONSTRAINT ck_payment_status CHECK (status IN ('RECORDED', 'VOIDED')),
      CONSTRAINT ck_payment_key CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,100}$'),
      CONSTRAINT ck_payment_fingerprint CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
      CONSTRAINT ck_payment_void CHECK (
        (status = 'RECORDED' AND voided_by IS NULL AND voided_at IS NULL AND void_reason IS NULL) OR
        (status = 'VOIDED' AND voided_by IS NOT NULL AND voided_at IS NOT NULL AND void_reason IS NOT NULL AND length(btrim(void_reason)) BETWEEN 1 AND 1000)
      )
    )`);
    await queryRunner.query(`CREATE INDEX ix_payment_order_id ON ${table('payment')}(order_id)`);
    await queryRunner.query(`CREATE TABLE ${table('activity_log')} (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      order_id uuid NOT NULL,
      actor_id uuid NOT NULL,
      action varchar(24) NOT NULL,
      target_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      reason varchar(1000),
      changes jsonb NOT NULL DEFAULT '{}'::jsonb,
      CONSTRAINT pk_activity_log PRIMARY KEY (id),
      CONSTRAINT fk_activity_log_order FOREIGN KEY (order_id) REFERENCES ${table('delivery_order')}(id) ON DELETE RESTRICT,
      CONSTRAINT fk_activity_log_actor FOREIGN KEY (actor_id) REFERENCES ${table('app_user')}(id) ON DELETE RESTRICT,
      CONSTRAINT ck_activity_log_action CHECK (action IN ('ORDER_CREATED', 'ORDER_UPDATED', 'ITEM_ADDED', 'ITEM_UPDATED', 'ITEM_REMOVED', 'PAYMENT_RECORDED', 'PAYMENT_VOIDED')),
      CONSTRAINT ck_activity_log_changes CHECK (jsonb_typeof(changes) = 'object')
    )`);
    await queryRunner.query(
      `CREATE INDEX ix_activity_log_order_id ON ${table('activity_log')}(order_id, created_at, id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of ['activity_log', 'payment', 'order_item', 'delivery_order']) {
      await queryRunner.query(`DROP TABLE ${this.table(queryRunner, name)}`);
    }
    // Dropping the owning order column also removes its sequence.
  }
}
