import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CompletionHistoryResponse,
  CompletionOperationResponse,
  CompletionReadinessRecord,
} from '@furniture-delivery/contracts';
import { apiRequest, ApiError } from '../lib/api-client';
import {
  completionHistoryFixture,
  completionReadinessFixture,
  completedReadinessFixture,
  completionRecordFixture,
} from '../test/completion-fixture';
import { orderFixture } from '../test/order-fixture';
import { CompletionPanel } from './completion-panel';
import { OrderDetailScreen } from './order-detail';
vi.mock('./order-appointments', () => ({ OrderAppointments: () => null }));
vi.mock('./payment-journal', () => ({ PaymentJournal: () => null }));
vi.mock('./backoffice-execution-panel', () => ({ BackofficeExecutionPanel: () => null }));
vi.mock('./evidence-panel', () => ({ EvidencePanel: () => null }));
vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const api = vi.mocked(apiRequest),
  posts = () => api.mock.calls.filter(([, options]) => options?.method === 'POST');
beforeEach(() => {
  api.mockReset();
});
const receipt = {
  id: 'operation-1',
  action: 'ORDER_COMPLETE',
  resultId: completionRecordFixture.id,
  createdAt: completionRecordFixture.createdAt,
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
function serve(
  state: { current: CompletionReadinessRecord; history?: CompletionHistoryResponse },
  mutate?: (path: string, body: unknown) => Promise<CompletionOperationResponse>,
) {
  api.mockImplementation(async <T,>(path: string, options?: Parameters<typeof apiRequest>[1]) => {
    if (options?.method === 'POST') return (await mutate!(path, options.body)) as T;
    if (path.endsWith('/completion-history'))
      return (state.history ?? completionHistoryFixture) as T;
    if (path.endsWith('/completion-readiness')) return { readiness: state.current } as T;
    if (path === '/orders/' + orderFixture.id)
      return {
        order: {
          ...orderFixture,
          version: state.current.orderVersion,
          progress: state.current.currentCompletion ? 'COMPLETED' : 'AWAITING_REVIEW',
          orderTotalCents: 100000,
          paidCents: 0,
          balanceCents: 100000,
          paymentStatus: 'UNPAID',
        },
      } as T;
    throw new Error('Unexpected test route');
  });
}
async function openCompletion() {
  fireEvent.click(await screen.findByRole('button', { name: 'Review completion' }));
}
function fillCompletion() {
  fireEvent.change(screen.getByLabelText('Complete order reason'), {
    target: { value: 'Reviewed fictional work and acknowledgements' },
  });
  fireEvent.click(screen.getByLabelText('I reviewed this closure decision and its consequences'));
}

describe('M7 explicit operational closure and immutable previews', () => {
  it.each(['complete', 'reopen'] as const)(
    'clears an unsent %s draft when changing the order identity, even with the same revision',
    async (kind) => {
      const state = {
        current: kind === 'complete' ? completionReadinessFixture : completedReadinessFixture,
      };
      serve(state);
      const view = render(<CompletionPanel orderId={orderFixture.id} />);
      fireEvent.click(
        await screen.findByRole('button', {
          name: kind === 'complete' ? 'Review completion' : 'Review reopening',
        }),
      );
      fireEvent.change(
        screen.getByLabelText(
          kind === 'complete' ? 'Complete order reason' : 'Reopen order reason',
        ),
        { target: { value: 'Private draft for the previous order only' } },
      );
      state.current = {
        ...completionReadinessFixture,
        orderId: 'other-order',
        orderVersion: state.current.orderVersion,
      };
      view.rerender(<CompletionPanel orderId="other-order" />);
      expect(screen.queryByRole('form')).not.toBeInTheDocument();
      fireEvent.click(await screen.findByRole('button', { name: 'Review completion' }));
      expect(screen.getByLabelText('Complete order reason')).toHaveValue('');
      expect(
        screen.queryByDisplayValue('Private draft for the previous order only'),
      ).not.toBeInTheDocument();
      expect(
        api.mock.calls.some(([path]) => path === '/orders/other-order/completion-readiness'),
      ).toBe(true);
      expect(posts()).toHaveLength(0);
    },
  );
  it('shows loading, real empty history and independent readiness before an explicit preview', async () => {
    const waiting = deferred<{ readiness: CompletionReadinessRecord }>();
    api.mockImplementation(<T,>(path: string) =>
      path.endsWith('/completion-history')
        ? Promise.resolve(completionHistoryFixture as T)
        : (waiting.promise as Promise<T>),
    );
    render(<CompletionPanel orderId={orderFixture.id} />);
    expect(screen.getAllByRole('status').some((node) => node.textContent === 'Loading…')).toBe(
      true,
    );
    await act(async () => waiting.resolve({ readiness: completionReadinessFixture }));
    expect(await screen.findAllByText('Ready', { selector: 'dd' })).toHaveLength(2);
    expect(screen.getByText('No final completion recorded.')).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
  it('lists server blockers with actionable record links and does not equate full payment with physical readiness', async () => {
    serve({
      current: {
        ...completionReadinessFixture,
        canComplete: false,
        physicalReady: false,
        confirmationsReady: false,
        blockers: [
          { code: 'OPEN_ISSUES', message: 'Inspect the damage', issueId: 'issue-1' },
          {
            code: 'MISSING_SNAPSHOT',
            message: 'Prepare the visit result',
            appointmentId: 'visit-1',
          },
          { code: 'RETURN_REQUIRED', message: 'Resolve remaining work', requestId: 'return-1' },
        ],
      },
    });
    render(<CompletionPanel orderId={orderFixture.id} />);
    expect(await screen.findByText(/Inspect the damage/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review completion' })).toBeDisabled();
    const links = screen
      .getAllByRole('link', { name: 'Review related record' })
      .map((link) => link.getAttribute('href'));
    expect(links).toContain('/backoffice/orders/' + orderFixture.id + '#evidence-issue-issue-1');
    expect(links).toContain('/backoffice/return-requests/return-1');
    expect(links).toContain(
      '/backoffice/planning/orders/' + orderFixture.id + '/appointments/visit-1',
    );
  });
  it('requires explicit review and reason, then renders current server state without changing payment data', async () => {
    const state = { current: completionReadinessFixture },
      changed = vi.fn();
    serve(state, async () => {
      state.current = completedReadinessFixture;
      return { readiness: state.current, receipt };
    });
    render(<CompletionPanel orderId={orderFixture.id} onChanged={changed} />);
    await openCompletion();
    expect(screen.getByRole('button', { name: 'Confirm completion' })).toBeDisabled();
    expect(posts()).toHaveLength(0);
    fillCompletion();
    fireEvent.submit(screen.getByRole('form', { name: 'Complete order preview' }));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(posts()[0]![1]!.body).toMatchObject({
      expectedVersion: 12,
      reason: 'Reviewed fictional work and acknowledgements',
    });
    expect(posts()[0]![1]!.body).not.toHaveProperty('paidCents');
    expect(await screen.findByText('COMPLETED · revision 13')).toBeInTheDocument();
    expect(
      screen.getByText(/Work, acknowledgements and payments remain separate/),
    ).toBeInTheDocument();
  });
  it('prevents double-submit while the decision is pending', async () => {
    const pending = deferred<CompletionOperationResponse>(),
      state = { current: completionReadinessFixture };
    serve(state, () => pending.promise);
    render(<CompletionPanel orderId={orderFixture.id} />);
    await openCompletion();
    fillCompletion();
    const form = screen.getByRole('form', { name: 'Complete order preview' });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(posts()).toHaveLength(1);
    state.current = completedReadinessFixture;
    await act(async () => pending.resolve({ readiness: state.current, receipt }));
    await screen.findByText('COMPLETED · revision 13');
  });
  it('retains reason and original revision after 409 and a refresh without silently replacing the preview', async () => {
    const state = { current: completionReadinessFixture };
    serve(state, async () => {
      state.current = { ...completionReadinessFixture, orderVersion: 14 };
      throw new ApiError(409, 'The decision changed');
    });
    render(<CompletionPanel orderId={orderFixture.id} />);
    await openCompletion();
    fillCompletion();
    fireEvent.submit(screen.getByRole('form', { name: 'Complete order preview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The decision changed');
    fireEvent.click(screen.getByRole('button', { name: 'Read current closure conditions' }));
    await screen.findByText('Open · revision 14');
    expect(screen.getByText(/Draft order revision 12/)).toBeInTheDocument();
    expect(screen.getByLabelText('Complete order reason')).toHaveValue(
      'Reviewed fictional work and acknowledgements',
    );
    expect(screen.getByRole('button', { name: 'Confirm completion' })).toBeDisabled();
    expect(posts()[0]![1]!.body).toMatchObject({ expectedVersion: 12 });
  });
  it('retries an unknown original complete after reopen while showing the actual open state rather than a false closure', async () => {
    const state: { current: CompletionReadinessRecord; history: CompletionHistoryResponse } = {
      current: completionReadinessFixture,
      history: {
        ...completionHistoryFixture,
        completions: [completionRecordFixture],
        currentCompletionId: completionRecordFixture.id,
      },
    };
    let count = 0;
    serve(state, async () => {
      if (++count === 1) {
        state.current = { ...completionReadinessFixture, orderVersion: 16 };
        throw new ApiError(0, 'Response lost');
      }
      return { readiness: state.current, receipt };
    });
    render(<CompletionPanel orderId={orderFixture.id} />);
    await openCompletion();
    fillCompletion();
    fireEvent.submit(screen.getByRole('form', { name: 'Complete order preview' }));
    const retry = await screen.findByRole('button', { name: 'Retry original closure request' });
    fireEvent(window, new Event('focus'));
    await screen.findByText('Open · revision 16');
    expect(screen.getByLabelText('Complete order reason')).toBeDisabled();
    fireEvent.click(retry);
    await screen.findByText(/The server confirmed operation operation-1/);
    expect(posts()).toHaveLength(2);
    expect(posts()[1]![1]!.body).toEqual(posts()[0]![1]!.body);
    expect(screen.getByText('Open · revision 16')).toBeInTheDocument();
    expect(screen.getByText('Historical completion')).toBeInTheDocument();
    expect(screen.queryByText('Current completion')).not.toBeInTheDocument();
  });
  it('reopens only the captured current completion with a reason and keeps completion history', async () => {
    const state = {
      current: completedReadinessFixture,
      history: {
        ...completionHistoryFixture,
        currentCompletionId: completionRecordFixture.id,
        completions: [completionRecordFixture],
      },
    };
    serve(state, async () => {
      state.current = { ...completionReadinessFixture, orderVersion: 14 };
      return {
        readiness: state.current,
        receipt: { ...receipt, action: 'ORDER_REOPEN', resultId: 'reopen-event' },
      };
    });
    render(<CompletionPanel orderId={orderFixture.id} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review reopening' }));
    fireEvent.change(screen.getByLabelText('Reopen order reason'), {
      target: { value: 'Arrange new review of the remaining obligation' },
    });
    fireEvent.click(
      screen.getByLabelText('I reviewed this reopening decision and its consequences'),
    );
    fireEvent.submit(screen.getByRole('form', { name: 'Reopen order preview' }));
    await screen.findByText('Open · revision 14');
    expect(posts()[0]![0]).toBe('/orders/' + orderFixture.id + '/reopen');
    expect(posts()[0]![1]!.body).toMatchObject({
      expectedVersion: 13,
      expectedCompletionId: completionRecordFixture.id,
    });
    expect(screen.getByText('Historical completion')).toBeInTheDocument();
  });
  it('keeps a reopen preview bound to its original completion when another completion becomes current', async () => {
    const state = { current: completedReadinessFixture };
    serve(state);
    render(<CompletionPanel orderId={orderFixture.id} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review reopening' }));
    fireEvent.change(screen.getByLabelText('Reopen order reason'), {
      target: { value: 'Preserved reopening draft' },
    });
    state.current = {
      ...completedReadinessFixture,
      orderVersion: 18,
      currentCompletion: { ...completionRecordFixture, id: 'completion-2' },
    };
    fireEvent(window, new Event('focus'));
    await screen.findByText('COMPLETED · revision 18');
    expect(screen.getByText(/Draft order revision 13/)).toBeInTheDocument();
    expect(screen.getByLabelText('Reopen order reason')).toHaveValue('Preserved reopening draft');
    expect(screen.getByRole('button', { name: 'Confirm reopening' })).toBeDisabled();
    expect(posts()).toHaveLength(0);
  });
  it('exposes failed GET Retry as a button without submitting an enclosing form', async () => {
    const submitted = vi.fn();
    let fail = true;
    api.mockImplementation(async <T,>(path: string) => {
      if (path.endsWith('/completion-history')) return completionHistoryFixture as T;
      if (fail) {
        fail = false;
        throw new ApiError(503, 'Readiness unavailable');
      }
      return { readiness: completionReadinessFixture } as T;
    });
    render(
      <form onSubmit={submitted}>
        <CompletionPanel orderId={orderFixture.id} />
      </form>,
    );
    await screen.findByRole('alert');
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry).toHaveAttribute('type', 'button');
    fireEvent.click(retry);
    await screen.findByRole('button', { name: 'Review completion' });
    expect(submitted).not.toHaveBeenCalled();
    expect(posts()).toHaveLength(0);
  });
  it('clears the sensitive decision draft when authority is lost', async () => {
    let lost = false;
    api.mockImplementation(async <T,>(path: string, options?: Parameters<typeof apiRequest>[1]) => {
      if (options?.method === 'POST') {
        lost = true;
        throw new ApiError(403, 'Access denied');
      }
      if (lost) throw new ApiError(403, 'Access denied');
      return (
        path.endsWith('/completion-history')
          ? completionHistoryFixture
          : { readiness: completionReadinessFixture }
      ) as T;
    });
    render(<CompletionPanel orderId={orderFixture.id} />);
    await openCompletion();
    fillCompletion();
    fireEvent.submit(screen.getByRole('form', { name: 'Complete order preview' }));
    await waitFor(() =>
      expect(screen.queryByLabelText('Complete order reason')).not.toBeInTheDocument(),
    );
    expect(posts()).toHaveLength(1);
  });
  it('integrates canonical closure into the order screen while retaining its unpaid balance', async () => {
    const state = { current: completionReadinessFixture };
    serve(state, async () => {
      state.current = completedReadinessFixture;
      return { readiness: state.current, receipt };
    });
    render(<OrderDetailScreen orderId={orderFixture.id} />);
    await screen.findByRole('heading', { name: orderFixture.customerName });
    const execution = screen.getByRole('tab', { name: 'Execution' });
    fireEvent.mouseDown(execution, { button: 0, ctrlKey: false });
    fireEvent.click(execution);
    await openCompletion();
    fillCompletion();
    fireEvent.submit(screen.getByRole('form', { name: 'Complete order preview' }));
    await screen.findByText('COMPLETED · revision 13');
    expect(screen.getByText('Payment status').parentElement).toHaveTextContent('Unpaid');
    expect(screen.getByText('Balance').parentElement).toHaveTextContent('€1,000.00');
  });
});
