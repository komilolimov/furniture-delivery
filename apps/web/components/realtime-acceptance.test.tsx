import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../lib/api-client';
import { ApiError } from '../lib/api-client';
import { useOrderResource } from '../lib/use-order-resource';
import { backofficeAcceptanceFixture } from '../test/acceptance-fixture';
import { canvasMocks } from '../test/signature-canvas-mocks';
import { deferred, FakeEventSource, realtimeUser, settle } from '../test/realtime-fixture';
import { SessionProvider } from './session-provider';
import { VisitAcceptancePanel } from './acceptance-panel';
const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const api = vi.mocked(apiRequest);
let canvas: ReturnType<typeof canvasMocks>, sources: FakeEventSource[];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2030-01-07T09:00:00.000Z'));
  api.mockReset();
  navigation.refresh.mockReset();
  navigation.replace.mockReset();
  canvas = canvasMocks();
  sources = [];
  vi.stubGlobal(
    'EventSource',
    class extends FakeEventSource {
      constructor(url: string) {
        super(url);
        sources.push(this);
      }
    },
  );
});
afterEach(() => {
  cleanup();
  canvas.restoreDialog();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const flush = async () => {
  await act(async () => settle());
};
const tick = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await settle();
  });
};
const scope = {
  orderId: backofficeAcceptanceFixture.acceptance.current!.snapshot.orderId,
  appointmentId: backofficeAcceptanceFixture.acceptance.appointmentId,
};
const sideValid = (value: unknown): value is { text: string } =>
  typeof value === 'object' && value !== null && 'text' in value && typeof value.text === 'string';
async function draft() {
  fireEvent.click(screen.getByRole('button', { name: 'Open customer signing mode' }));
  const dialog = screen.getByRole('dialog'),
    pad = within(dialog).getByLabelText('Signature drawing area');
  fireEvent.change(within(dialog).getByLabelText('Customer or representative name'), {
    target: { value: 'Private in-memory signer' },
  });
  fireEvent.pointerDown(pad, { pointerId: 1, clientX: 20, clientY: 20 });
  fireEvent.pointerMove(pad, { pointerId: 1, clientX: 200, clientY: 120 });
  fireEvent.pointerUp(pad, { pointerId: 1, clientX: 300, clientY: 100 });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Preview drawing' }));
  await flush();
  expect(within(dialog).getByAltText('Your unsaved signature preview')).toBeInTheDocument();
  return dialog;
}
describe('Realtime preserves acknowledgements until actual scope loss', () => {
  it('clears a loaded acknowledgement immediately on 404 even while an unrelated old read remains in flight', async () => {
    const late = deferred<unknown>();
    let acceptanceReads = 0,
      sideReads = 0;
    function SideRead() {
      const resource = useOrderResource('/orders/side', sideValid);
      return <p>{resource.data?.text}</p>;
    }
    api.mockImplementation(async (path) => {
      if (path === '/auth/me') return { user: realtimeUser };
      if (path === '/orders/side')
        return ++sideReads === 1 ? late.promise : { text: 'Fresh permitted side read' };
      if (++acceptanceReads === 1) return backofficeAcceptanceFixture;
      throw new ApiError(404, 'Record unavailable');
    });
    render(
      <SessionProvider user={realtimeUser}>
        <VisitAcceptancePanel scope={scope} />
        <SideRead />
      </SessionProvider>,
    );
    await flush();
    await draft();
    sources[0]!.invalidate(['acceptance']);
    await tick(2000);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Private in-memory signer')).not.toBeInTheDocument();
    expect(canvas.revoke).toHaveBeenCalled();
    late.resolve({ text: 'Late forbidden side read' });
    await flush();
    expect(screen.queryByText('Late forbidden side read')).not.toBeInTheDocument();
    expect(screen.getByText('Fresh permitted side read')).toBeInTheDocument();
    const settledReads = acceptanceReads;
    expect(settledReads).toBeGreaterThanOrEqual(3);
    await tick(10000);
    expect(acceptanceReads).toBe(settledReads);
    expect(navigation.refresh).toHaveBeenCalledTimes(1);
  });
  it('keeps drawing/name/Blob through ordinary hints and blocks reuse when another snapshot becomes current', async () => {
    let canonical = structuredClone(backofficeAcceptanceFixture);
    api.mockImplementation(async (path) =>
      path === '/auth/me' ? { user: realtimeUser } : canonical,
    );
    render(
      <SessionProvider user={realtimeUser}>
        <VisitAcceptancePanel scope={scope} />
      </SessionProvider>,
    );
    await flush();
    const dialog = await draft();
    canonical = structuredClone(backofficeAcceptanceFixture);
    const staff = canonical.acceptance.current!.slots[2]!;
    staff.status = 'SIGNED';
    staff.mayReportAbsence = false;
    staff.canReadImage = true;
    staff.confirmation = {
      id: 'other-staff-signature',
      slotId: staff.id,
      snapshotId: staff.snapshotId,
      snapshotHash: canonical.acceptance.current!.snapshot.hash,
      method: 'SIGNED',
      signerName: 'Other fictional team representative',
      signerRelation: null,
      capturedByUserId: 'other-actor',
      recordedAt: '2030-01-07T09:00:00.000Z',
      imageDigest: 'b'.repeat(64),
      width: 1024,
      height: 360,
      sizeBytes: 100,
      absenceKind: null,
      absenceReason: null,
    };
    sources[0]!.invalidate(['acceptance']);
    await tick(2000);
    expect(within(dialog).getByLabelText('Customer or representative name')).toHaveValue(
      'Private in-memory signer',
    );
    expect(within(dialog).getByAltText('Your unsaved signature preview')).toBeInTheDocument();
    expect(canvas.exports).toHaveLength(1);
    const next = structuredClone(canonical.acceptance.current!);
    next.snapshot.id = 'next-document';
    next.snapshot.version = 2;
    next.snapshot.hash = 'c'.repeat(64);
    canonical = { acceptance: { ...canonical.acceptance, current: next, history: [next] } };
    sources[0]!.invalidate(['acceptance']);
    await tick(2000);
    expect(within(dialog).getByText('Signature for document revision 1')).toBeInTheDocument();
    expect(within(dialog).getByAltText('Your unsaved signature preview')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save this signature' })).toBeDisabled();
    expect(api.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
    expect(navigation.refresh).not.toHaveBeenCalled();
  });
  it('clears canvas/Blob/name and ignores an in-flight old read after access-reset', async () => {
    const late = deferred<unknown>();
    let reads = 0;
    api.mockImplementation(async (path) =>
      path === '/auth/me'
        ? { user: realtimeUser }
        : ++reads === 2
          ? late.promise
          : backofficeAcceptanceFixture,
    );
    render(
      <SessionProvider user={realtimeUser}>
        <VisitAcceptancePanel scope={scope} />
      </SessionProvider>,
    );
    await flush();
    await draft();
    sources[0]!.invalidate(['acceptance']);
    await tick(2000);
    sources[0]!.emit('access-reset', {
      eventId: 'scope-changed',
      emittedAt: new Date().toISOString(),
      reason: 'SCOPE_CHANGED',
    });
    await flush();
    const forbidden = structuredClone(backofficeAcceptanceFixture);
    forbidden.acceptance.current!.snapshot.payload.order.customerName = 'Late forbidden customer';
    late.resolve(forbidden);
    await flush();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Private in-memory signer')).not.toBeInTheDocument();
    expect(screen.queryByAltText('Your unsaved signature preview')).not.toBeInTheDocument();
    expect(screen.queryByText(/Late forbidden customer/)).not.toBeInTheDocument();
    expect(canvas.revoke).toHaveBeenCalled();
  });
});
