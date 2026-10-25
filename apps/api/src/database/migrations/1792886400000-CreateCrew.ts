import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCrew1792886400000 implements MigrationInterface {
  name = 'CreateCrew1792886400000';

  private table(queryRunner: QueryRunner): string {
    const schema =
      queryRunner.connection.options.type === 'postgres'
        ? (queryRunner.connection.options.schema ?? 'public')
        : 'public';
    return `${queryRunner.connection.driver.escape(schema)}."crew"`;
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ${this.table(queryRunner)} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "code" varchar(32) NOT NULL,
        "name" varchar(120) NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "work_environment" varchar(7) NOT NULL,
        "service_area" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_crew" PRIMARY KEY ("id"),
        CONSTRAINT "uq_crew_code" UNIQUE ("code"),
        CONSTRAINT "ck_crew_code" CHECK ("code" ~ '^[A-Z][A-Z0-9_-]{2,31}$'),
        CONSTRAINT "ck_crew_name" CHECK (length(btrim("name")) > 0),
        CONSTRAINT "ck_crew_work_environment" CHECK ("work_environment" IN ('INDOOR', 'OUTDOOR')),
        CONSTRAINT "ck_crew_service_area" CHECK (length(btrim("service_area")) BETWEEN 1 AND 2000)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE ${this.table(queryRunner)}`);
  }
}
