import type { CrewAssignmentDetail, CrewAssignmentResponse } from '@furniture-delivery/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import { crewAssignmentFixture } from '../test/execution-fixture';
import { deferred } from '../test/realtime-fixture';
import { CrewAssignmentDetailView } from './crew-assignment-detail';

vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
vi.mock('./acceptance-panel', () => ({
  VisitAcceptancePanel: () => (
    <section aria-label="Retained acknowledgement">
      <canvas data-testid="signature-surface" />
      <input aria-label="Retained signature draft" />
    </section>
  ),
}));
vi.mock('./evidence-panel', () => ({
  EvidencePanel: ({ canAppend }: { canAppend: boolean }) => (
    <section aria-label="Retained evidence">
      <p>{canAppend ? 'Evidence additions allowed' : 'Saved evidence only'}</p>
    </section>
  ),
}));
const api = vi.mocked(apiRequest);
const working = (): CrewAssignmentDetail => {
  const a = structuredClone(crewAssignmentFixture);
  a.execution = {
    ...a.execution,
    status: 'IN_PROGRESS',
    version: 4,
    departedAt: '2030-01-07T08:00:00.000Z',
    arrivedAt: '2030-01-07T08:05:00.000Z',
    actualStartAt: '2030-01-07T08:10:00.000Z',
    actualEndAt: null,
  };
  a.allowedActions = ['FINISH'];
  a.canEditResults = true;
  a.canAppendEvidence = true;
  a.items = a.items.map((item) => ({
    ...item,
    quantity: 3,
    deliveredQuantity: 1,
    assembledQuantity: 0,
    requiresAssembly: true,
    fulfillmentVersion: 4,
    remainingDeliveryQuantity: 2,
    remainingAssemblyQuantity: 3,
  }));
  return a;
};
const response = (assignment: CrewAssignmentDetail): CrewAssignmentResponse => ({ assignment });
const posts = () => api.mock.calls.filter(([, options]) => options?.method === 'POST');
beforeEach(() => {
  api.mockReset();
});

describe('Crew visit mobile workspace', () => {
  it('keeps planned, actual and shared order quantities distinct with crew contact links', async () => {
    const a = working();
    a.order.contactName = 'Fixture contact';
    a.order.email = 'fixture@example.test';
    api.mockResolvedValue(response(a));
    const { container } = render(<CrewAssignmentDetailView assignmentId={a.id} />);
    await screen.findByRole('heading', { name: a.customerName });
    const execution = screen.getByRole('region', { name: 'Visit execution' });
    expect(
      within(execution).getByRole('heading', { name: 'Planned window · Europe/Rome' }),
    ).toBeInTheDocument();
    expect(within(execution).getByRole('heading', { name: 'Actual progress' })).toBeInTheDocument();
    expect(within(execution).getByText('Planned start')).toBeInTheDocument();
    expect(within(execution).getByText('Actual finish')).toBeInTheDocument();
    const quantities = screen.getByRole('region', { name: 'Order quantities' });
    expect(within(quantities).getByText('Delivered 1/3')).toBeInTheDocument();
    expect(within(quantities).getByText('Assembled 0/3')).toBeInTheDocument();
    expect(
      within(quantities).getByText(/including other teams and earlier visits/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: a.order.phoneNumbers[0]! })).toHaveAttribute(
      'href',
      `tel:${a.order.phoneNumbers[0]}`,
    );
    expect(screen.getByRole('link', { name: 'fixture@example.test' })).toHaveAttribute(
      'href',
      'mailto:fixture@example.test',
    );
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(15);
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0]![0]).toBe(`/crew/assignments/${a.id}`);
  });
  it('offers section anchors without replacing acknowledgement/evidence nodes or their draft while an editor opens', async () => {
    let canonical = working();
    api.mockImplementation(async () => response(canonical));
    render(<CrewAssignmentDetailView assignmentId={canonical.id} />);
    await screen.findByRole('heading', { name: canonical.customerName });
    const canvas = screen.getByTestId('signature-surface');
    const signature = screen.getByLabelText('Retained signature draft');
    const evidence = screen.getByRole('region', { name: 'Retained evidence' });
    fireEvent.change(signature, { target: { value: 'Retained synthetic signing context' } });
    for (const label of [
      'Visit',
      'Contact',
      'Furniture',
      'Checklist',
      'Result',
      'Photos & notes',
    ]) {
      const link = within(screen.getByRole('navigation', { name: 'Visit sections' })).getByRole(
        'link',
        { name: label },
      );
      expect(link.getAttribute('href')).toMatch(/^#crew-/);
      expect(document.getElementById(link.getAttribute('href')!.slice(1))).not.toBeNull();
    }
    fireEvent.click(
      screen.getByRole('button', { name: `Update task: ${canonical.tasks[0]!.name}` }),
    );
    expect(screen.getByRole('dialog', { name: 'Update checklist task' })).toBeInTheDocument();
    canonical = { ...canonical, openIssueCount: 1 };
    await act(async () => {
      fireEvent.focus(window);
    });
    expect(screen.getByTestId('signature-surface')).toBe(canvas);
    expect(screen.getByLabelText('Retained signature draft')).toBe(signature);
    expect(signature).toHaveValue('Retained synthetic signing context');
    expect(screen.getByRole('region', { name: 'Retained evidence', hidden: true })).toBe(evidence);
    expect(posts()).toHaveLength(0);
  });
  it('keeps a quantity editor and its original version through a failed read and a newer saved response', async () => {
    let canonical = working();
    let unavailable = false;
    api.mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') return response(canonical);
      if (unavailable) throw new ApiError(503, 'Assignment read unavailable');
      return response(canonical);
    });
    render(<CrewAssignmentDetailView assignmentId={canonical.id} />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: `Update quantities: ${canonical.items[0]!.description}`,
      }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Update order quantities' });
    const form = within(dialog).getByRole('form');
    const delivered = within(form).getByLabelText('Delivered in total');
    fireEvent.change(delivered, { target: { value: '2' } });
    unavailable = true;
    await act(async () => {
      fireEvent.focus(window);
    });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Assignment read unavailable',
    );
    expect(screen.getByRole('form')).toBe(form);
    expect(delivered).toHaveValue(2);
    unavailable = false;
    canonical = {
      ...canonical,
      items: canonical.items.map((item) => ({
        ...item,
        fulfillmentVersion: 9,
        deliveredQuantity: 3,
      })),
    };
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument());
    expect(delivered).toHaveValue(2);
    fireEvent.submit(form);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]![1]?.body).toMatchObject({
      expectedFulfillmentVersion: 4,
      deliveredQuantity: 2,
      assembledQuantity: 0,
    });
  });
  it('protects a pending and unknown task command from Sheet closing and retries exactly the original request', async () => {
    const a = working();
    const pending = deferred<CrewAssignmentResponse>();
    let count = 0;
    api.mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') {
        count++;
        return count === 1 ? pending.promise : response(a);
      }
      return response(a);
    });
    render(<CrewAssignmentDetailView assignmentId={a.id} />);
    fireEvent.click(
      await screen.findByRole('button', { name: `Update task: ${a.tasks[0]!.name}` }),
    );
    const dialog = screen.getByRole('dialog');
    const form = within(dialog).getByRole('form');
    fireEvent.change(within(form).getByLabelText('Task result'), { target: { value: 'DONE' } });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Close work editor' })).toBeDisabled(),
    );
    expect(within(form).getByRole('button', { name: 'Discard draft' })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    expect(screen.getByRole('dialog')).toBe(dialog);
    await act(async () => pending.reject(new ApiError(0, 'Original result not confirmed')));
    const retry = await within(form).findByRole('button', { name: 'Retry original request' });
    expect(within(dialog).getByRole('button', { name: 'Close work editor' })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    expect(screen.getByRole('dialog')).toBe(dialog);
    const original = structuredClone(posts()[0]![1]?.body);
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(posts()).toHaveLength(2);
    expect(posts()[1]![0]).toBe(posts()[0]![0]);
    expect(posts()[1]![1]?.body).toEqual(original);
  });
  it('closes protected editor and clears its draft after membership access is lost', async () => {
    const a = working();
    let denied = false;
    api.mockImplementation(async () => {
      if (denied) throw new ApiError(403, 'Membership access revoked');
      return response(a);
    });
    render(<CrewAssignmentDetailView assignmentId={a.id} />);
    fireEvent.click(await screen.findByRole('button', { name: "Finish my team's visit" }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Result summary'), {
      target: { value: 'Private unfinished result' },
    });
    denied = true;
    await act(async () => {
      fireEvent.focus(window);
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
    expect(screen.queryByDisplayValue('Private unfinished result')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: a.customerName })).not.toBeInTheDocument();
    expect(screen.queryByTestId('signature-surface')).not.toBeInTheDocument();
  });
  it('starts a clean request scope and ignores a late previous assignment read', async () => {
    const a = working();
    const b = { ...working(), id: 'next-assignment', customerName: 'Next fixture customer' };
    const late = deferred<CrewAssignmentResponse>();
    let oldReads = 0;
    api.mockImplementation(async (path) => {
      if (path.endsWith('/' + b.id)) return response(b);
      oldReads++;
      return oldReads === 1 ? response(a) : late.promise;
    });
    const view = render(<CrewAssignmentDetailView assignmentId={a.id} />);
    fireEvent.click(
      await screen.findByRole('button', { name: `Update task: ${a.tasks[0]!.name}` }),
    );
    fireEvent.change(screen.getByLabelText('Reason for checklist change'), {
      target: { value: 'Old draft text' },
    });
    await act(async () => {
      fireEvent.focus(window);
    });
    view.rerender(<CrewAssignmentDetailView assignmentId={b.id} />);
    await screen.findByRole('heading', { name: b.customerName });
    await act(async () => late.resolve(response(a)));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Old draft text')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: a.customerName })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: b.customerName })).toBeInTheDocument();
  });
  it('uses server action flags even with complete-looking results and never presents backoffice/private values', async () => {
    const base = working();
    const a = {
      ...base,
      allowedActions: [],
      canEditResults: false,
      canAppendEvidence: false,
      items: base.items.map((item) => ({ ...item, deliveredQuantity: 3, assembledQuantity: 3 })),
      order: {
        ...base.order,
        internalNotes: 'Do not render private finance note',
        orderTotalCents: 87654321,
      },
    };
    api.mockResolvedValue(response(a));
    render(<CrewAssignmentDetailView assignmentId={a.id} />);
    await screen.findByRole('heading', { name: a.customerName });
    expect(
      screen.queryByRole('button', {
        name: /Update task|Update quantities|Finish my team's visit|Complete order/,
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Saved evidence only')).toBeInTheDocument();
    expect(screen.queryByText('Do not render private finance note')).not.toBeInTheDocument();
    expect(screen.queryByText(/87654321/)).not.toBeInTheDocument();
    expect(
      api.mock.calls.every(
        ([path, options]) => path === `/crew/assignments/${a.id}` && !options?.method,
      ),
    ).toBe(true);
  });
  it('returns focus to the item control when an unlocked editor is discarded', async () => {
    const a = working();
    api.mockResolvedValue(response(a));
    render(<CrewAssignmentDetailView assignmentId={a.id} />);
    const trigger = await screen.findByRole('button', {
      name: `Update quantities: ${a.items[0]!.description}`,
    });
    fireEvent.click(trigger);
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard draft' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
