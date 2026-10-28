import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import { useOrderResource } from '../lib/use-order-resource';
import { deferred, FakeEventSource, realtimeUser, settle } from '../test/realtime-fixture';
import { orderFixture } from '../test/order-fixture';
import { SessionProvider } from './session-provider';
import { OrderDetailScreen } from './order-detail';
import { CrewEditor } from './crew-editor';
import { AccountsPanel } from './accounts-panel';
const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
vi.mock('./backoffice-execution-panel', () => ({
  BackofficeExecutionPanel: () => null,
  AppointmentExecutionReadout: () => null,
}));
vi.mock('./completion-panel', () => ({ CompletionPanel: () => null }));
vi.mock('./order-appointments', () => ({ OrderAppointments: () => null }));
vi.mock('./evidence-panel', () => ({ EvidencePanel: () => null }));
vi.mock('./crew-planning-editor', () => ({ CrewPlanningEditor: () => null }));
const api = vi.mocked(apiRequest);
let sources: FakeEventSource[];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2030-01-07T09:00:00.000Z'));
  api.mockReset();
  navigation.replace.mockReset();
  navigation.refresh.mockReset();
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
  vi.unstubAllGlobals();
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
const valid = (v: unknown): v is { value: string } =>
  typeof v === 'object' && v !== null && 'value' in v && typeof v.value === 'string';
function Probe() {
  const resource = useOrderResource('/orders/probe', valid, { retainDataOnRefresh: true });
  return (
    <>
      <p>{resource.data?.value ?? 'No data'}</p>
      <input aria-label="Memory draft" defaultValue="Original draft" />
      <button onClick={() => void resource.refresh()}>Manual data refresh</button>
    </>
  );
}
describe('One authenticated live coordinator without remounting ordinary drafts', () => {
  it('uses one stream in StrictMode, refetches on hints and keeps inputs without router refresh', async () => {
    let current = 'First canonical';
    api.mockImplementation(async (path) =>
      path === '/auth/me' ? { user: realtimeUser } : { value: current },
    );
    render(
      <StrictMode>
        <SessionProvider user={realtimeUser}>
          <Probe />
        </SessionProvider>
      </StrictMode>,
    );
    await flush();
    expect(sources.filter((source) => source.closeCount === 0)).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Memory draft'), {
      target: { value: 'Keep dirty text' },
    });
    current = 'Second canonical';
    sources.at(-1)!.invalidate(['orders']);
    await tick(2000);
    expect(screen.getByText('Second canonical')).toBeInTheDocument();
    expect(screen.getByLabelText('Memory draft')).toHaveValue('Keep dirty text');
    expect(navigation.refresh).not.toHaveBeenCalled();
  });
  it('clears private fields before scope refresh and rejects late old-user HTTP results', async () => {
    const old = deferred<unknown>();
    let reads = 0;
    api.mockImplementation(async (path) =>
      path === '/auth/me'
        ? { user: realtimeUser }
        : ++reads === 1
          ? old.promise
          : { value: 'New authorized read' },
    );
    render(
      <SessionProvider user={realtimeUser}>
        <Probe />
      </SessionProvider>,
    );
    await flush();
    fireEvent.change(screen.getByLabelText('Memory draft'), {
      target: { value: 'Private old draft' },
    });
    sources[0]!.emit('access-reset', {
      eventId: 'scope-change',
      emittedAt: new Date().toISOString(),
      reason: 'SCOPE_CHANGED',
    });
    await flush();
    old.resolve({ value: 'Old forbidden response' });
    await flush();
    expect(screen.queryByText('Old forbidden response')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Private old draft')).not.toBeInTheDocument();
    expect(screen.getByText('New authorized read')).toBeInTheDocument();
    expect(navigation.refresh).toHaveBeenCalledTimes(1);
  });
  it('retains an editable draft on reconnect/API failure and restores data only after successful session sync', async () => {
    let offline = false;
    api.mockImplementation(async (path) => {
      if (offline) throw new ApiError(503, 'Temporary offline');
      return path === '/auth/me' ? { user: realtimeUser } : { value: 'Canonical work' };
    });
    render(
      <SessionProvider user={realtimeUser}>
        <Probe />
      </SessionProvider>,
    );
    await flush();
    fireEvent.change(screen.getByLabelText('Memory draft'), { target: { value: 'Still working' } });
    offline = true;
    sources[0]!.error();
    await tick(1000);
    expect(screen.getByLabelText('Memory draft')).toHaveValue('Still working');
    expect(screen.getByLabelText('Data connection')).toHaveTextContent('Unavailable');
    expect(navigation.replace).not.toHaveBeenCalled();
    offline = false;
    await tick(2000);
    expect(screen.getByText('Canonical work')).toBeInTheDocument();
    expect(screen.getByLabelText('Memory draft')).toHaveValue('Still working');
  });
});

describe('Concrete business forms retain their own baseline across live reads', () => {
  it('warns inside an order draft while retaining its old version and unsaved fields', async () => {
    let canonical = structuredClone(orderFixture);
    api.mockImplementation(async (path, options) => {
      if (path === '/auth/me') return { user: realtimeUser };
      if (options?.method === 'PATCH') throw new ApiError(409, 'Order changed');
      return { order: canonical };
    });
    render(
      <SessionProvider user={realtimeUser}>
        <OrderDetailScreen orderId={canonical.id} />
      </SessionProvider>,
    );
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Edit order' }));
    fireEvent.change(screen.getByLabelText('Customer name'), {
      target: { value: 'Unsaved customer edit' },
    });
    canonical = { ...canonical, version: 9, customerName: 'Remote saved name' };
    sources[0]!.invalidate(['orders']);
    await tick(2000);
    const form = screen.getByLabelText('Customer name').closest('form')!;
    expect(within(form).getByText(/Saved data changed since this form opened/)).toBeInTheDocument();
    expect(screen.getByLabelText('Customer name')).toHaveValue('Unsaved customer edit');
    fireEvent.submit(form);
    await flush();
    const write = api.mock.calls.find(([, options]) => options?.method === 'PATCH');
    expect(write?.[1]?.body).toMatchObject({
      expectedVersion: orderFixture.version,
      customerName: 'Unsaved customer edit',
    });
  });
  it('keeps an unknown payment key and amount after a live journal refresh', async () => {
    let canonical = structuredClone(orderFixture),
      writes = 0;
    api.mockImplementation(async (path, options) => {
      if (path === '/auth/me') return { user: realtimeUser };
      if (options?.method === 'POST') {
        writes++;
        if (writes === 1) throw new ApiError(0, 'Response lost');
        return { order: canonical, payment: { status: 'RECORDED' } };
      }
      return { order: canonical };
    });
    render(
      <SessionProvider user={realtimeUser}>
        <OrderDetailScreen orderId={canonical.id} />
      </SessionProvider>,
    );
    await flush();
    const paymentsTab = screen.getByRole('tab', { name: 'Payments' });
    fireEvent.mouseDown(paymentsTab, { button: 0, ctrlKey: false });
    fireEvent.click(paymentsTab);
    fireEvent.change(screen.getByLabelText('Payment amount (EUR)'), { target: { value: '10.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await flush();
    const first = api.mock.calls.find(([, options]) => options?.method === 'POST')![1]!.body;
    canonical = {
      ...canonical,
      version: 2,
      paidCents: 1000,
      balanceCents: canonical.orderTotalCents - 1000,
    };
    sources[0]!.invalidate(['orders']);
    await tick(2000);
    const form = screen.getByLabelText('Payment amount (EUR)').closest('form')!;
    expect(within(form).getByText(/Saved data changed/)).toBeInTheDocument();
    expect(screen.getByLabelText('Payment amount (EUR)')).toHaveValue('10.00');
    expect(writes).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry same payment' }));
    await flush();
    const calls = api.mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(calls[1]![1]!.body).toEqual(first);
  });
  it('keeps dirty team/contact controls mounted during pending and changed team metadata', async () => {
    let crew = {
      id: 'team',
      code: 'TEAM-01',
      name: 'Saved team',
      active: true,
      workEnvironment: 'INDOOR',
      serviceArea: 'Fixture region',
      createdAt: '2030-01-07T09:00:00.000Z',
      updatedAt: '2030-01-07T09:00:00.000Z',
      members: [],
      contacts: [],
    };
    const pending = deferred<unknown>();
    let second = false;
    api.mockImplementation(async (path) =>
      path === '/auth/me'
        ? { user: realtimeUser }
        : path.endsWith('member-candidates')
          ? { users: [] }
          : second
            ? pending.promise
            : { crew },
    );
    render(
      <SessionProvider user={realtimeUser}>
        <CrewEditor crewId="team" />
      </SessionProvider>,
    );
    await flush();
    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'Unsent team name' } });
    second = true;
    sources[0]!.invalidate(['crews']);
    await tick(2000);
    expect(screen.getByLabelText('Team name')).toHaveValue('Unsent team name');
    crew = { ...crew, name: 'Another saved team name', updatedAt: '2030-01-07T10:00:00.000Z' };
    pending.resolve({ crew });
    await flush();
    expect(screen.getByLabelText('Team name')).toHaveValue('Unsent team name');
    expect(screen.getAllByText(/Saved data changed/).length).toBeGreaterThan(0);
  });
  it('keeps an administrator password/name draft mounted through account updates', async () => {
    const admin = { ...realtimeUser, role: 'ADMIN' as const },
      pending = deferred<unknown>();
    let second = false;
    api.mockImplementation(async (path) =>
      path === '/auth/me' ? { user: admin } : second ? pending.promise : { users: [admin] },
    );
    render(
      <SessionProvider user={admin}>
        <AccountsPanel />
      </SessionProvider>,
    );
    await flush();
    fireEvent.click(screen.getByRole('button', { name: `Edit account ${admin.username}` }));
    const form = screen.getByRole('button', { name: 'Save account' }).closest('form')!;
    fireEvent.change(within(form).getByLabelText('Display name'), {
      target: { value: 'Unsent account name' },
    });
    fireEvent.change(within(form).getByLabelText('New password (optional)'), {
      target: { value: 'test-only-unsent-secret' },
    });
    second = true;
    sources[0]!.invalidate(['accounts']);
    await tick(2000);
    expect(within(form).getByLabelText('Display name')).toHaveValue('Unsent account name');
    pending.resolve({ users: [{ ...admin, displayName: 'Remote saved name' }] });
    await flush();
    expect(within(form).getByLabelText('New password (optional)')).toHaveValue(
      'test-only-unsent-secret',
    );
    expect(within(form).getByText(/Saved data changed/)).toBeInTheDocument();
  });
});
