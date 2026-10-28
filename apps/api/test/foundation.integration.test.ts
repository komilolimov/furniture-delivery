import { randomUUID } from 'node:crypto';
import { createServer, createConnection } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import type { HealthResponse } from '@furniture-delivery/contracts';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication } from '../src/application';
import { readIntegrationConfig } from '../src/config/environment';
import type { AppConfig } from '../src/config/environment';
import { Crew } from '../src/crews/crew.entity';
import { createDataSource } from '../src/database/data-source';
import { seedCrews } from '../src/database/demo-crews';

async function openTunnel(config: AppConfig, port = 0) {
  const sockets = new Set<Socket>();
  const server = createServer((client) => {
    const upstream = createConnection({
      host: config.database.host,
      port: config.database.port,
    });
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => {
        client.destroy();
        upstream.destroy();
      });
    }
    client.pipe(upstream);
    upstream.pipe(client);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    port: (server.address() as AddressInfo).port,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

describe('M1 foundation on a dedicated PostgreSQL test database', () => {
  const schema = `m1_${randomUUID().replaceAll('-', '')}`;
  let config: AppConfig;
  let admin: DataSource | undefined;
  let dataSource: DataSource | undefined;
  let app: INestApplication | undefined;
  let tunnel: Awaited<ReturnType<typeof openTunnel>> | undefined;

  beforeAll(async () => {
    config = readIntegrationConfig();
    admin = createDataSource(config);
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    dataSource = createDataSource(config, { schema });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await app?.close();
    await tunnel?.close();
    if (dataSource?.isInitialized) await dataSource.destroy();
    if (admin?.isInitialized) {
      // Only the unique schema created by this test is eligible for cleanup.
      if (!/^m1_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe cleanup schema.');
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });

  it('migrates once, seeds ten crews repeatedly and preserves user changes', async () => {
    if (!dataSource) throw new Error('Test PostgreSQL is not initialized.');
    expect((await dataSource.runMigrations()).map(({ name }) => name)).toEqual([
      'CreateCrew1792886400000',
      'CreateIdentity1792886401000',
      'CreateOrders1792886402000',
      'CreatePlanning1792886403000',
      'CreateExecution1792886404000',
      'CreateEvidence1792886404100',
      'CreateEstimates1792886405000',
      'CreateReturnVisits1792886405100',
      'CreateAcceptance1792886406000',
      'CreateCompletion1792886406100',
    ]);
    expect(await dataSource.runMigrations()).toHaveLength(0);
    await seedCrews(dataSource, 'test');
    const repository = dataSource.getRepository(Crew);
    expect(await repository.count()).toBe(10);
    const crew = await repository.findOneByOrFail({ code: 'DEMO-01' });
    await repository.update(crew.id, {
      name: 'Edited crew',
      active: false,
      serviceArea: 'Edited area',
    });
    const edited = await repository.findOneByOrFail({ id: crew.id });
    await Promise.all([seedCrews(dataSource, 'test'), seedCrews(dataSource, 'test')]);
    expect(await repository.count()).toBe(10);
    expect(await repository.findOneByOrFail({ id: crew.id })).toEqual(edited);
    expect(edited.createdAt).toBeInstanceOf(Date);
    expect(edited.updatedAt).toBeInstanceOf(Date);
    // A fresh connection sees the same persisted UUID and edited content.
    const reconnected = createDataSource(config, { schema });
    try {
      await reconnected.initialize();
      expect(await reconnected.getRepository(Crew).findOneByOrFail({ id: crew.id })).toEqual(
        edited,
      );
    } finally {
      if (reconnected.isInitialized) await reconnected.destroy();
    }
  });

  it('enforces unique codes, required fields and environment constraints in PostgreSQL', async () => {
    if (!dataSource) throw new Error('Test PostgreSQL is not initialized.');
    const table = `"${schema}"."crew"`;
    const insert = `INSERT INTO ${table} (code, name, work_environment, service_area) VALUES ($1, $2, $3, $4)`;
    await expect(
      dataSource.query(insert, ['DEMO-01', 'Duplicate', 'INDOOR', 'Demo']),
    ).rejects.toThrow();
    await expect(dataSource.query(insert, ['CHECK-01', '', 'INDOOR', 'Demo'])).rejects.toThrow();
    await expect(
      dataSource.query(insert, ['CHECK-02', 'Invalid', 'OTHER', 'Demo']),
    ).rejects.toThrow();
    await expect(
      dataSource.query(insert, ['CHECK-03', 'Invalid', 'INDOOR', null]),
    ).rejects.toThrow();
    await expect(seedCrews(dataSource, 'production')).rejects.toThrow();
    expect(await dataSource.getRepository(Crew).count()).toBe(10);
  });

  it('keeps HTTP alive during a real connection outage and recovers without restarting the API', async () => {
    // A real TCP tunnel to PostgreSQL lets the test interrupt DB connectivity without mocks
    // or stopping the API, and without affecting the development database.
    tunnel = await openTunnel(config);
    const port = tunnel.port;
    await tunnel.close();
    tunnel = undefined;
    app = await createApplication({
      ...config,
      database: { ...config.database, host: '127.0.0.1', port },
    });
    await app.listen(0, '127.0.0.1');
    const url = `${await app.getUrl()}/api/health`;

    const assertHealth = async (expectedStatus: number, database: 'up' | 'down') => {
      const response = await fetch(url);
      expect(response.status).toBe(expectedStatus);
      expect(response.headers.get('cache-control')).toContain('no-store');
      const body = (await response.json()) as HealthResponse;
      expect(body).toEqual({
        status: expectedStatus === 200 ? 'ok' : 'error',
        api: 'up',
        database,
        checkedAt: expect.any(String),
      });
    };

    await assertHealth(503, 'down');
    tunnel = await openTunnel(config, port);
    await assertHealth(200, 'up');
    await tunnel.close();
    tunnel = undefined;
    await assertHealth(503, 'down');
    tunnel = await openTunnel(config, port);
    await assertHealth(200, 'up');
    expect((await fetch(`${await app.getUrl()}/api/crews`)).status).toBe(401);
  });
});
