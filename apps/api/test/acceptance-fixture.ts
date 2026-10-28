import type {
  AcceptanceDocumentRecord,
  BackofficeAcceptanceResponse,
  CrewAssignmentDetail,
  CrewAssignmentResponse,
  TerminalOutcome,
} from '@furniture-delivery/contracts';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { expect } from 'vitest';
import {
  evidenceJson as json,
  freshOperation,
  safeEvidence,
  type EvidenceActor,
  type EvidenceContext,
  type EvidenceFixture,
} from './evidence-fixture';

/** A synthetic stroke pattern for tests only; no person's name or real signature is encoded. */
export async function syntheticSignature(width = 240, height = 80): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 4, 255);
  for (let x = 12; x < width - 12; x++) {
    const y = Math.floor(height / 2 + Math.sin(x / 9) * Math.max(3, height / 5));
    for (let dy = -2; dy <= 2; dy++) {
      const offset = ((y + dy) * width + x) * 4;
      pixels[offset] = 25;
      pixels[offset + 1] = 38;
      pixels[offset + 2] = 55;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

export const bytesHash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
export const signatureForm = (
  payload: unknown,
  png: Buffer,
  filename = 'synthetic-strokes.png',
  type = 'image/png',
) => {
  const form = new FormData();
  form.append('payload', JSON.stringify(payload));
  form.append('signature', new Blob([new Uint8Array(png)], { type }), filename);
  return form;
};

/** Build a valid two-frame APNG from Sharp's real PNG chunks, without embedding image bytes in source/logs. */
export function animatedSignaturePng(png: Buffer): Buffer {
  const crc = (bytes: Buffer) => {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (name: string, data: Buffer) => {
    const type = Buffer.from(name),
      size = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc(Buffer.concat([type, data])));
    return Buffer.concat([size, type, data, checksum]);
  };
  let offset = 8;
  const chunks: { type: string; data: Buffer }[] = [];
  while (offset < png.length) {
    const size = png.readUInt32BE(offset),
      type = png.toString('ascii', offset + 4, offset + 8);
    chunks.push({ type, data: png.subarray(offset + 8, offset + 8 + size) });
    offset += size + 12;
  }
  const ihdr = chunks.find((entry) => entry.type === 'IHDR')!.data;
  const control = Buffer.alloc(8);
  control.writeUInt32BE(2);
  const frame = (sequence: number) => {
    const value = Buffer.alloc(26);
    value.writeUInt32BE(sequence);
    value.writeUInt32BE(ihdr.readUInt32BE(0), 4);
    value.writeUInt32BE(ihdr.readUInt32BE(4), 8);
    value.writeUInt16BE(1, 20);
    value.writeUInt16BE(10, 22);
    return value;
  };
  const image = Buffer.concat(
    chunks.filter((entry) => entry.type === 'IDAT').map((entry) => entry.data),
  );
  const sequence = Buffer.alloc(4);
  sequence.writeUInt32BE(2);
  return Buffer.concat([
    png.subarray(0, 8),
    chunk('IHDR', ihdr),
    chunk('acTL', control),
    chunk('fcTL', frame(0)),
    chunk('IDAT', image),
    chunk('fcTL', frame(1)),
    chunk('fdAT', Buffer.concat([sequence, image])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export async function completeAcceptanceTasks(
  f: EvidenceFixture,
  actor: EvidenceActor,
  id: string,
): Promise<CrewAssignmentDetail> {
  let current = await f.detail(actor, id);
  for (const task of current.tasks.filter((entry) => entry.resultStatus === 'PENDING'))
    current = (
      await json<CrewAssignmentResponse>(
        await f.call(actor, f.path(id, '/tasks/' + task.id + '/result'), 'POST', {
          operationKey: freshOperation(),
          expectedTaskVersion: task.resultVersion,
          resultStatus: 'DONE',
        }),
      )
    ).assignment;
  return current;
}

export async function setAcceptanceQuantities(
  f: EvidenceFixture,
  actor: EvidenceActor,
  id: string,
  full = true,
): Promise<CrewAssignmentDetail> {
  let current = await f.detail(actor, id);
  for (const item of current.items) {
    const deliveredQuantity = full ? item.quantity : Math.min(1, item.quantity),
      assembledQuantity = item.requiresAssembly && full ? item.quantity : 0;
    current = (
      await json<CrewAssignmentResponse>(
        await f.call(actor, f.path(id, '/items/' + item.id + '/fulfillment'), 'POST', {
          operationKey: freshOperation(),
          expectedFulfillmentVersion: item.fulfillmentVersion,
          deliveredQuantity,
          assembledQuantity,
        }),
      )
    ).assignment;
  }
  return current;
}

export async function finishAcceptanceTeam(
  f: EvidenceFixture,
  ctx: EvidenceContext,
  index = 0,
  outcome: TerminalOutcome = 'COMPLETED',
  returnVisitRequired = false,
): Promise<CrewAssignmentDetail> {
  const actor = ctx.actors[index]![0]!,
    id = ctx.assignmentIds[index]!,
    current = await f.detail(actor, id);
  const response = await json<CrewAssignmentResponse>(
    await f.action(actor, id, 'finish', {
      operationKey: freshOperation(),
      expectedExecutionVersion: current.execution.version,
      outcome,
      summary: 'Fictional ' + outcome + ' acceptance fixture result',
      ...(outcome !== 'COMPLETED' || returnVisitRequired
        ? {
            reason: 'Fictional missing fitting',
            remainingWork: 'Finish remaining fixture assembly',
          }
        : {}),
      returnVisitRequired,
      ...(returnVisitRequired ? { returnReason: 'Bring missing fixture fitting' } : {}),
    }),
  );
  safeEvidence(response);
  return response.assignment;
}

export async function completedAcceptanceVisit(
  f: EvidenceFixture,
  crews = 1,
): Promise<EvidenceContext> {
  const ctx = await f.context({ crews });
  for (let index = 0; index < ctx.crews.length; index++) {
    const actor = ctx.actors[index]![0]!,
      id = ctx.assignmentIds[index]!;
    await f.start(ctx, index);
    await completeAcceptanceTasks(f, actor, id);
    if (index === 0) await setAcceptanceQuantities(f, actor, id);
    await finishAcceptanceTeam(f, ctx, index);
  }
  expect((await f.orders.detail(ctx.order.id)).workReadyForReview).toBe(true);
  return ctx;
}

/** Completes only the explicit confirmation workflow; it never closes an Order. */
export async function acknowledgeAcceptanceVisit(
  f: EvidenceFixture,
  ctx: EvidenceContext,
  customerAbsence = false,
  inspect?: (step: string) => Promise<void>,
): Promise<AcceptanceDocumentRecord> {
  const path = '/orders/' + ctx.order.id + '/appointments/' + ctx.appointmentId + '/acceptance';
  const prepared = await json<BackofficeAcceptanceResponse>(
    await f.call(f.dispatcher, path, 'POST', { operationKey: freshOperation() }),
  );
  const doc = prepared.acceptance.current!,
    png = await syntheticSignature();
  await inspect?.('prepare');
  for (const slot of doc.slots.filter((entry) => entry.kind === 'CREW')) {
    const index = ctx.assignmentIds.indexOf(slot.assignmentId!),
      actor = ctx.actors[index]![0]!;
    await json(
      await f.call(
        actor,
        '/acceptance/' + doc.snapshot.id + '/slots/' + slot.id + '/sign',
        'POST',
        signatureForm(
          { operationKey: freshOperation(), expectedVersion: doc.snapshot.version, consent: true },
          png,
        ),
      ),
    );
    await inspect?.('staff-sign');
  }
  const customer = doc.slots.find((slot) => slot.kind === 'CUSTOMER')!,
    actor = ctx.actors[0]![0]!,
    slotPath = '/acceptance/' + doc.snapshot.id + '/slots/' + customer.id;
  if (customerAbsence) {
    await json(
      await f.call(actor, slotPath + '/absence', 'POST', {
        operationKey: freshOperation(),
        expectedVersion: doc.snapshot.version,
        kind: 'ABSENT',
        reason: 'Synthetic customer representative absent after the visit',
      }),
    );
    await inspect?.('customer-absence');
    await json(
      await f.call(f.dispatcher, slotPath + '/review', 'POST', {
        operationKey: freshOperation(),
        expectedVersion: doc.snapshot.version,
        decision: 'APPROVED',
        reason: 'Dispatcher considered this one absent customer confirmation',
      }),
    );
    await inspect?.('exception-review');
  } else {
    await json(
      await f.call(
        actor,
        slotPath + '/sign',
        'POST',
        signatureForm(
          {
            operationKey: freshOperation(),
            expectedVersion: doc.snapshot.version,
            consent: true,
            customerName: 'Synthetic customer signer',
            customerRelation: 'Representative',
          },
          png,
        ),
      ),
    );
    await inspect?.('customer-sign');
  }
  const result = await json<BackofficeAcceptanceResponse>(await f.call(f.dispatcher, path));
  await inspect?.('read-acceptance');
  return result.acceptance.current!;
}
