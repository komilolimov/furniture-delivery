import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AttachmentResponse, IssueResponse } from '@furniture-delivery/contracts';
import { Attachment } from '../src/evidence/attachment.entity';
import { PrivateStorage } from '../src/evidence/private-storage';
import { DatabaseService } from '../src/database/database.service';
import { inspectStorage } from '../src/evidence/storage-inspect';
import {
  createEvidenceFixture,
  evidenceJson as json,
  freshOperation,
  type EvidenceFixture,
} from './evidence-fixture';
describe('M5 real multipart/private storage quota and finalization', () => {
  let f: EvidenceFixture, png: Buffer;
  beforeAll(async () => {
    f = await createEvidenceFixture('m5_cross', (config, root) => ({
      ...config,
      storage: { root },
    }));
    png = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#775432' } })
      .png()
      .toBuffer();
  }, 30000);
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => f?.close());
  function form(
    key: string,
    bytes = png,
    name = 'fixture.png',
    type = 'image/png',
    fields: Record<string, string> = {},
  ) {
    const value = new FormData();
    value.append('operationKey', key);
    for (const [k, v] of Object.entries(fields)) value.append(k, v);
    value.append('file', new Blob([new Uint8Array(bytes)], { type }), name);
    return value;
  }
  const post = (
    orderId: string,
    key = freshOperation(),
    bytes = png,
    name = 'fixture.png',
    type = 'image/png',
    fields: Record<string, string> = {},
  ) =>
    f.call(
      f.dispatcher,
      '/orders/' + orderId + '/attachments',
      'POST',
      form(key, bytes, name, type, fields),
    );
  const files = () => readdir(join(f.storageRoot, 'final'));
  async function count(orderId: string) {
    return f.source.getRepository(Attachment).countBy({ orderId });
  }
  async function cleanTemps() {
    expect(await readdir(join(f.storageRoot, 'staging'))).toEqual([]);
    expect(await readdir(join(f.storageRoot, 'validated'))).toEqual([]);
  }
  it('detects real bytes, reencodes MIME-spoofed images, and serves PDF as attachment with explicit HEAD/Range behavior', async () => {
    const c = await f.context();
    const saved = await json<AttachmentResponse>(
      await post(c.order.id, freshOperation(), png, 'misleading.pdf', 'application/pdf'),
    );
    expect(saved.attachment.kind).toBe('IMAGE');
    expect(saved.attachment.contentType).toBe('image/webp');
    const image = await f.call(f.dispatcher, saved.attachment.contentUrl.replace('/api', ''));
    expect(image.status).toBe(200);
    expect((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).format).toBe('webp');
    const pdf = await json<AttachmentResponse>(
      await post(
        c.order.id,
        freshOperation(),
        Buffer.from('%PDF-1.7\nfixture\n%%EOF'),
        'safe.pdf',
        'application/pdf',
      ),
    );
    const content = pdf.attachment.contentUrl.replace('/api', '');
    const head = await f.call(f.dispatcher, content, 'HEAD');
    expect(head.status).toBe(200);
    expect(head.headers.get('content-disposition')).toContain('attachment;');
    expect(head.headers.get('x-content-type-options')).toBe('nosniff');
    expect(head.headers.get('cache-control')).toContain('no-store');
    expect(await head.text()).toBe('');
    expect(
      (await f.call(f.dispatcher, content, 'GET', undefined, { Range: 'bytes=0-4' })).status,
    ).toBe(416);
    await cleanTemps();
  });
  it('rejects unsupported/corrupt bytes, traversal/header-control filenames, fields and multiple files without READY rows', async () => {
    const c = await f.context();
    for (const bytes of [
      Buffer.from('<svg/>'),
      Buffer.from('MZ executable'),
      Buffer.from([137, 80, 78, 71, 13, 10]),
    ])
      expect((await post(c.order.id, freshOperation(), bytes)).status).toBe(400);
    for (const name of ['../../escape.png', 'bad\\path.png', 'bad\r\nname.png'])
      expect((await post(c.order.id, freshOperation(), png, name)).status).toBe(400);
    expect(
      (
        await post(c.order.id, freshOperation(), png, 'x.png', 'image/png', {
          storageKey: '../escape',
        })
      ).status,
    ).toBe(400);
    const many = form(freshOperation());
    many.append('file', new Blob([new Uint8Array(png)]), 'second.png');
    expect(
      (await f.call(f.dispatcher, '/orders/' + c.order.id + '/attachments', 'POST', many)).status,
    ).toBe(400);
    expect(await count(c.order.id)).toBe(0);
    await cleanTemps();
  });
  it('enforces disk-backed raw byte, multipart field and decoded-pixel limits', async () => {
    const c = await f.context();
    const storage = f.app.get(PrivateStorage);
    storage.config.imageMaxBytes = 20;
    expect((await post(c.order.id)).status).toBe(413);
    storage.config.imageMaxBytes = 10485760;
    storage.config.maxPixels = 4;
    expect((await post(c.order.id)).status).toBe(400);
    storage.config.maxPixels = 40000000;
    expect(
      (
        await post(
          c.order.id,
          freshOperation(),
          Buffer.alloc(20971521, 0),
          'too-large.pdf',
          'application/pdf',
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await post(c.order.id, freshOperation(), png, 'x.png', 'image/png', {
          itemId: 'x'.repeat(5000),
        })
      ).status,
    ).toBe(400);
    expect(await count(c.order.id)).toBe(0);
    await cleanTemps();
  });
  it('replays same source+metadata before decode, conflicts changed source, and keeps withdrawn replay withdrawn', async () => {
    const c = await f.context(),
      key = freshOperation(),
      first = await json<AttachmentResponse>(await post(c.order.id, key));
    const decode = vi
      .spyOn(f.app.get(PrivateStorage), 'validate')
      .mockRejectedValue(new Error('processor changed'));
    const replay = await json<AttachmentResponse>(await post(c.order.id, key));
    expect(replay.attachment.id).toBe(first.attachment.id);
    expect(decode).not.toHaveBeenCalled();
    expect((await post(c.order.id, key, Buffer.from('different'))).status).toBe(409);
    decode.mockRestore();
    const withdrawn = await json<AttachmentResponse>(
      await f.call(
        f.dispatcher,
        '/orders/' + c.order.id + '/attachments/' + first.attachment.id + '/withdraw',
        'POST',
        { operationKey: freshOperation(), reason: 'Withdraw fixture' },
      ),
    );
    expect(withdrawn.attachment.withdrawnAt).not.toBeNull();
    const late = await json<AttachmentResponse>(await post(c.order.id, key));
    expect(late.attachment.id).toBe(first.attachment.id);
    expect(late.attachment.withdrawnAt).not.toBeNull();
    expect(
      (await f.call(f.dispatcher, late.attachment.contentUrl.replace('/api', ''))).status,
    ).toBe(404);
    expect(await count(c.order.id)).toBe(1);
    await cleanTemps();
  });
  async function finalRace(
    orderId: string,
    first: () => Promise<Response>,
    second: () => Promise<Response>,
  ) {
    const storage = f.app.get(PrivateStorage),
      original = storage.validate.bind(storage);
    let ready = 0;
    let release!: () => void, allReady!: () => void;
    const gate = new Promise<void>((done) => (release = done)),
      both = new Promise<void>((done) => (allReady = done));
    vi.spyOn(storage, 'validate').mockImplementation(async (...args) => {
      const result = await original(...args);
      ready++;
      if (ready === 2) allReady();
      await gate;
      return result;
    });
    const pending = Promise.all([first(), second()]);
    await Promise.race([
      both,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Both uploads must finish validation')), 2000),
      ),
    ]);
    const held = await f.barrier('delivery_order', orderId);
    try {
      release();
      await f.waiters(held.pid, 2);
    } finally {
      release();
      await held.runner.rollbackTransaction();
      await held.runner.release();
    }
    return pending;
  }
  it('observably serializes concurrent identical uploads into one READY row and one final copy', async () => {
    const c = await f.context(),
      key = freshOperation(),
      before = await files();
    const responses = await finalRace(
      c.order.id,
      () => post(c.order.id, key),
      () => post(c.order.id, key),
    );
    const a = await json<AttachmentResponse>(responses[0]!),
      b = await json<AttachmentResponse>(responses[1]!);
    expect(a.attachment.id).toBe(b.attachment.id);
    expect(await count(c.order.id)).toBe(1);
    expect((await files()).length).toBe(before.length + 1);
    await cleanTemps();
  });
  it('observably enforces per-order file and byte quota against concurrent publication', async () => {
    const c = await f.context(),
      storage = f.app.get(PrivateStorage);
    storage.config.orderMaxFiles = 1;
    const responses = await finalRace(
      c.order.id,
      () => post(c.order.id),
      () => post(c.order.id),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await count(c.order.id)).toBe(1);
    storage.config.orderMaxFiles = 100;
    vi.restoreAllMocks();
    const d = await f.context();
    storage.config.orderMaxBytes = 1;
    expect((await post(d.order.id)).status).toBe(409);
    expect(await count(d.order.id)).toBe(0);
    storage.config.orderMaxBytes = 262144000;
    await cleanTemps();
  });
  it('storage publication error rolls back metadata and cleans only this request temporary data', async () => {
    const c = await f.context(),
      old = await json<AttachmentResponse>(await post(c.order.id)),
      before = await files();
    vi.spyOn(f.app.get(PrivateStorage), 'promote').mockRejectedValue(
      new Error('fixture storage failure'),
    );
    expect((await post(c.order.id)).status).toBe(500);
    expect(await count(c.order.id)).toBe(1);
    expect(await files()).toEqual(before);
    expect((await f.call(f.dispatcher, old.attachment.contentUrl.replace('/api', ''))).status).toBe(
      200,
    );
    await cleanTemps();
  });
  it('real audit failure rolls back READY/receipt and removes only the new promoted file', async () => {
    const c = await f.context(),
      old = await json<AttachmentResponse>(await post(c.order.id)),
      before = await files();
    await f.source.query(
      `CREATE FUNCTION "${f.schema}".reject_upload_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ATTACHMENT_UPLOADED' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$`,
    );
    await f.source.query(
      `CREATE TRIGGER reject_upload_audit BEFORE INSERT ON "${f.schema}".activity_log FOR EACH ROW EXECUTE FUNCTION "${f.schema}".reject_upload_audit()`,
    );
    try {
      expect((await post(c.order.id)).status).toBe(500);
    } finally {
      await f.source.query(`DROP TRIGGER reject_upload_audit ON "${f.schema}".activity_log`);
      await f.source.query(`DROP FUNCTION "${f.schema}".reject_upload_audit()`);
    }
    expect(await count(c.order.id)).toBe(1);
    expect(await files()).toEqual(before);
    expect((await f.call(f.dispatcher, old.attachment.contentUrl.replace('/api', ''))).status).toBe(
      200,
    );
    await cleanTemps();
  });
  it('SQL constraints reject NULL image dimensions, withdrawn reasons and resolved issue resolutions', async () => {
    const c = await f.context(),
      uploaded = await json<AttachmentResponse>(await post(c.order.id));
    await expect(
      f.source.query(`UPDATE "${f.schema}".attachment SET width=NULL WHERE id=$1`, [
        uploaded.attachment.id,
      ]),
    ).rejects.toThrow();
    await expect(
      f.source.query(
        `UPDATE "${f.schema}".attachment SET withdrawn_at=now(),withdrawn_by=$2,withdraw_reason=NULL WHERE id=$1`,
        [uploaded.attachment.id, f.dispatcher.user.id],
      ),
    ).rejects.toThrow();
    const issue = await json<IssueResponse>(
      await f.call(f.dispatcher, '/orders/' + c.order.id + '/issues', 'POST', {
        operationKey: freshOperation(),
        type: 'DAMAGE',
        description: 'Fixture constraint issue',
        reportedSource: 'CUSTOMER',
      }),
    );
    await expect(
      f.source.query(
        `UPDATE "${f.schema}".evidence_issue SET status='RESOLVED',resolved_at=now(),resolved_by=$2,resolution=NULL WHERE id=$1`,
        [issue.issue.id, f.dispatcher.user.id],
      ),
    ).rejects.toThrow();
    const unchanged = await f.source
      .getRepository(Attachment)
      .findOneByOrFail({ id: uploaded.attachment.id });
    expect(unchanged.width).toBeGreaterThan(0);
    expect(unchanged.withdrawnAt).toBeNull();
  });
  it('releases the connected runner when transaction initialization fails and cleans its staged data', async () => {
    const c = await f.context(),
      before = await files(),
      storage = f.app.get(PrivateStorage),
      validate = storage.validate.bind(storage);
    const source = await f.app.get(DatabaseService).getDataSource(),
      create = source.createQueryRunner.bind(source);
    let validated = false,
      injected = false,
      released = false;
    vi.spyOn(storage, 'validate').mockImplementation(async (...args) => {
      const result = await validate(...args);
      validated = true;
      return result;
    });
    vi.spyOn(source, 'createQueryRunner').mockImplementation((mode) => {
      const runner = create(mode);
      if (validated && !injected) {
        injected = true;
        const release = runner.release.bind(runner);
        runner.startTransaction = async () => {
          throw new Error('fixture transaction initialization failure');
        };
        runner.release = async () => {
          released = true;
          await release();
        };
      }
      return runner;
    });
    expect((await post(c.order.id)).status).toBe(500);
    expect(injected).toBe(true);
    expect(released).toBe(true);
    expect(await count(c.order.id)).toBe(0);
    expect(await files()).toEqual(before);
    await cleanTemps();
    vi.restoreAllMocks();
    await json<AttachmentResponse>(await post(c.order.id));
    expect(await count(c.order.id)).toBe(1);
  });
  it('metadata constraint failure rolls back the upload and a retry can publish it', async () => {
    const c = await f.context(),
      key = freshOperation(),
      before = await files();
    const storage = f.app.get(PrivateStorage),
      validate = storage.validate.bind(storage);
    vi.spyOn(storage, 'validate').mockImplementation(async (...args) => ({
      ...(await validate(...args)),
      width: 0,
    }));
    expect((await post(c.order.id, key)).status).toBe(500);
    expect(await count(c.order.id)).toBe(0);
    expect(await files()).toEqual(before);
    await cleanTemps();
    vi.restoreAllMocks();
    await json<AttachmentResponse>(await post(c.order.id, key));
    expect(await count(c.order.id)).toBe(1);
  });
  it('unknown uncommitted finalization resolves absence under Order lock before cleanup', async () => {
    const c = await f.context(),
      key = freshOperation(),
      before = await files();
    const source = await f.app.get(DatabaseService).getDataSource(),
      original = source.createQueryRunner.bind(source);
    let failed = false;
    vi.spyOn(source, 'createQueryRunner').mockImplementation((mode) => {
      const runner = original(mode),
        commit = runner.commitTransaction.bind(runner);
      runner.commitTransaction = async () => {
        if (
          !failed &&
          (await runner.manager.getRepository(Attachment).existsBy({ orderId: c.order.id }))
        ) {
          failed = true;
          throw new Error('fixture COMMIT interrupted before commit');
        }
        await commit();
      };
      return runner;
    });
    expect((await post(c.order.id, key)).status).toBe(503);
    expect(failed).toBe(true);
    expect(await count(c.order.id)).toBe(0);
    expect(await files()).toEqual(before);
    vi.restoreAllMocks();
    await json<AttachmentResponse>(await post(c.order.id, key));
    expect(await count(c.order.id)).toBe(1);
    await cleanTemps();
  });
  it('unresolved COMMIT outcome keeps an orphan for safe dry-run diagnosis instead of deleting possible READY bytes', async () => {
    const c = await f.context(),
      before = await files();
    const source = await f.app.get(DatabaseService).getDataSource(),
      original = source.createQueryRunner.bind(source);
    let failed = false;
    vi.spyOn(source, 'createQueryRunner').mockImplementation((mode) => {
      if (failed) throw new Error('fixture recovery database unavailable');
      const runner = original(mode),
        commit = runner.commitTransaction.bind(runner);
      runner.commitTransaction = async () => {
        if (await runner.manager.getRepository(Attachment).existsBy({ orderId: c.order.id })) {
          failed = true;
          throw new Error('fixture unknown COMMIT');
        }
        await commit();
      };
      return runner;
    });
    expect((await post(c.order.id)).status).toBe(503);
    expect(await count(c.order.id)).toBe(0);
    const after = await files(),
      orphan = after.filter((key) => !before.includes(key));
    expect(orphan).toHaveLength(1);
    vi.restoreAllMocks();
    const rows = await f.source
      .getRepository(Attachment)
      .createQueryBuilder('file')
      .addSelect('file.storageKey')
      .getMany();
    const diagnostic = await inspectStorage(
      f.storageRoot,
      rows.map((row) => row.storageKey),
    );
    expect(diagnostic.unreferencedFinalKeys).toContain(orphan[0]);
    expect(await files()).toEqual(after);
    await cleanTemps();
  });
  it('unknown COMMIT preserves the actually committed final file and exact retry recovers one attachment', async () => {
    const c = await f.context(),
      key = freshOperation(),
      source = await f.app.get(DatabaseService).getDataSource(),
      original = source.createQueryRunner.bind(source);
    let failed = false;
    vi.spyOn(source, 'createQueryRunner').mockImplementation((mode) => {
      const runner = original(mode),
        commit = runner.commitTransaction.bind(runner);
      runner.commitTransaction = async () => {
        const hasNew = await runner.manager
          .getRepository(Attachment)
          .existsBy({ orderId: c.order.id });
        await commit();
        if (hasNew && !failed) {
          failed = true;
          throw new Error('fixture lost COMMIT acknowledgement');
        }
      };
      return runner;
    });
    const response = await post(c.order.id, key);
    expect(response.status).toBe(503);
    expect(failed).toBe(true);
    expect(await count(c.order.id)).toBe(1);
    vi.restoreAllMocks();
    const replay = await json<AttachmentResponse>(await post(c.order.id, key));
    const ready = await f.call(f.dispatcher, replay.attachment.contentUrl.replace('/api', ''));
    expect(ready.status).toBe(200);
    const bytes = Buffer.from(await ready.arrayBuffer());
    expect((await sharp(bytes).metadata()).format).toBe('webp');
    const rows = await f.source
      .getRepository(Attachment)
      .createQueryBuilder('file')
      .addSelect('file.storageKey')
      .where('file.orderId=:orderId', { orderId: c.order.id })
      .getMany();
    expect(await readFile(join(f.storageRoot, 'final', rows[0]!.storageKey))).toEqual(bytes);
    expect(await count(c.order.id)).toBe(1);
    await cleanTemps();
  });
});
