import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CrewAssignmentDetail,
  CrewAssignmentResponse,
  CrewWorkItem,
  FinishReportRecord,
} from '@furniture-delivery/contracts';
import { apiRequest, ApiError } from '../lib/api-client';
import { crewAssignmentFixture } from '../test/execution-fixture';
import { CrewAssignmentDetailView } from './crew-assignment-detail';
import {
  ExecutionActions,
  FinishWorkForm,
  FulfillmentForm,
  TaskResultForm,
} from './crew-execution-forms';
vi.mock('./evidence-panel', () => ({ EvidencePanel: () => null }));
vi.mock('./acceptance-panel', () => ({ VisitAcceptancePanel: () => null }));
vi.mock('../lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const apiMock = vi.mocked(apiRequest);
const deferred = <T,>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const response = (assignment: CrewAssignmentDetail): CrewAssignmentResponse => ({ assignment });
const working = (): CrewAssignmentDetail => {
  const a = structuredClone(crewAssignmentFixture);
  a.serviceType = 'DELIVERY_AND_ASSEMBLY';
  a.order.serviceType = 'DELIVERY_AND_ASSEMBLY';
  a.execution = {
    ...a.execution,
    status: 'IN_PROGRESS',
    version: 4,
    departedAt: '2030-01-07T08:00:00.000Z',
    arrivedAt: '2030-01-07T08:05:00.000Z',
    actualStartAt: '2030-01-07T08:10:00.000Z',
    actualEndAt: null,
    maybeDelayed: false,
  };
  a.allowedActions = ['FINISH'];
  a.canEditResults = true;
  a.canAppendEvidence = true;
  a.items = a.items.map((i) => ({
    ...i,
    quantity: 3,
    requiresAssembly: true,
    deliveredQuantity: 1,
    assembledQuantity: 0,
    fulfillmentVersion: 4,
    remainingDeliveryQuantity: 2,
    remainingAssemblyQuantity: 3,
  }));
  return a;
};
function completed(assignment: CrewAssignmentDetail): CrewAssignmentDetail {
  const end = '2030-01-07T10:00:00.000Z';
  const changedTasks = assignment.tasks.filter((task) => task.resultStatus !== 'DONE').length;
  const tasks = assignment.tasks.map((task) =>
    task.resultStatus === 'DONE'
      ? task
      : {
          ...task,
          resultStatus: 'DONE' as const,
          resultVersion: task.resultVersion + 1,
          doneBy: 'other-team-member',
          doneAt: end,
        },
  );
  const finishReport: FinishReportRecord = {
    id: 'completed-report',
    orderId: assignment.orderId,
    appointmentId: assignment.appointmentId,
    assignmentId: assignment.id,
    outcome: 'COMPLETED',
    summary: 'Saved completion by a team member',
    reason: null,
    remainingWork: null,
    quantityScope: 'ACCUMULATED_ORDER',
    taskResults: structuredClone(tasks),
    quantities: structuredClone(assignment.items),
    knownIssueIds: [],
    attachmentIds: [],
    authorId: 'other-team-member',
    actualEndAt: end,
    createdAt: end,
  };
  return {
    ...assignment,
    tasks,
    finishReport,
    execution: {
      ...assignment.execution,
      status: 'COMPLETED',
      version: assignment.execution.version + changedTasks + 1,
      actualEndAt: end,
    },
    allowedActions: [],
    canEditResults: false,
    canAppendEvidence: true,
  };
}
const posts = () => apiMock.mock.calls.filter(([, options]) => options?.method === 'POST');
const callbacks = () => ({ onSaved: vi.fn(), onReload: vi.fn(), onCancel: vi.fn() });
beforeEach(() => {
  apiMock.mockReset();
});

describe('M5 crew execution forms use frozen server versions and explicit outcomes', () => {
  it('submits departure once with the displayed appointment and execution versions', async () => {
    const a = structuredClone(crewAssignmentFixture);
    a.appointmentVersion = 7;
    const pending = deferred<CrewAssignmentResponse>(),
      onSaved = vi.fn(),
      onReload = vi.fn(),
      busy = vi.fn();
    apiMock.mockReturnValueOnce(pending.promise);
    render(
      <ExecutionActions
        assignment={a}
        onSaved={onSaved}
        onReload={onReload}
        disabled={false}
        onBusyChange={busy}
      />,
    );
    const button = screen.getByRole('button', { name: 'Depart' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(posts()).toHaveLength(1);
    expect(posts()[0]![0]).toBe('/crew/assignments/' + a.id + '/actions/depart');
    expect(posts()[0]![1]?.body).toMatchObject({
      expectedExecutionVersion: a.execution.version,
      expectedAppointmentVersion: 7,
    });
    expect(button).toBeDisabled();
    expect(busy).toHaveBeenLastCalledWith(true);
    await act(async () =>
      pending.resolve(
        response({
          ...a,
          execution: {
            ...a.execution,
            status: 'ON_THE_WAY',
            version: 2,
            departedAt: '2030-01-07T08:00:00.000Z',
          },
          allowedActions: ['ARRIVE', 'FINISH'],
        }),
      ),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(busy).toHaveBeenLastCalledWith(false);
  });
  it('never offers Skip for required tasks and requires reasons for optional skip or reversing a completed result', () => {
    const a = working(),
      task = a.tasks.find((t) => t.required)!,
      props = callbacks();
    const first = render(<TaskResultForm assignmentId={a.id} task={task} {...props} />);
    expect(screen.queryByRole('option', { name: 'Skipped' })).not.toBeInTheDocument();
    first.unmount();
    const optional = { ...a.tasks.find((t) => !t.required)!, resultStatus: 'PENDING' as const },
      second = render(<TaskResultForm assignmentId={a.id} task={optional} {...props} />);
    fireEvent.change(screen.getByLabelText('Task result'), { target: { value: 'SKIPPED' } });
    expect(screen.getByLabelText('Reason for checklist change')).toBeRequired();
    expect(screen.getByRole('form')).toBeInvalid();
    second.unmount();
    render(
      <TaskResultForm assignmentId={a.id} task={{ ...task, resultStatus: 'DONE' }} {...props} />,
    );
    fireEvent.change(screen.getByLabelText('Task result'), { target: { value: 'PENDING' } });
    expect(screen.getByLabelText('Reason for checklist change')).toBeRequired();
    expect(posts()).toHaveLength(0);
  });
  it.each([400, 409])(
    'keeps task draft and pinned version after definite HTTP %s, including a newer background snapshot',
    async (status) => {
      const a = working(),
        task = { ...a.tasks[0]!, resultVersion: 4 },
        props = callbacks();
      apiMock.mockRejectedValue(new ApiError(status, 'Task conflict fixture'));
      const view = render(<TaskResultForm assignmentId={a.id} task={task} {...props} />);
      fireEvent.change(screen.getByLabelText('Task result'), { target: { value: 'DONE' } });
      fireEvent.change(screen.getByLabelText('Reason for checklist change'), {
        target: { value: 'Preserve this explanation' },
      });
      fireEvent.submit(screen.getByRole('form'));
      await screen.findByText('Task conflict fixture');
      expect(screen.getByLabelText('Reason for checklist change')).toHaveValue(
        'Preserve this explanation',
      );
      expect(screen.getByRole('button', { name: 'Discard draft' })).not.toBeDisabled();
      expect(posts()[0]![1]?.body).toMatchObject({ expectedTaskVersion: 4, resultStatus: 'DONE' });
      fireEvent.click(screen.getByRole('button', { name: 'Read current assignment' }));
      expect(props.onReload).toHaveBeenCalledTimes(1);
      view.rerender(
        <TaskResultForm
          assignmentId={a.id}
          task={{ ...task, resultVersion: 9, resultStatus: 'PENDING' }}
          {...props}
        />,
      );
      fireEvent.submit(screen.getByRole('form'));
      await waitFor(() => expect(posts()).toHaveLength(2));
      expect(posts()[1]![1]?.body).toMatchObject({
        expectedTaskVersion: 4,
        resultStatus: 'DONE',
        reason: 'Preserve this explanation',
      });
      expect(props.onSaved).not.toHaveBeenCalled();
    },
  );
  it('locks an unknown task result and retries the original key/payload despite later prop changes', async () => {
    const a = working(),
      task = a.tasks[0]!,
      props = callbacks();
    apiMock
      .mockRejectedValueOnce(new ApiError(0, 'Response lost fixture'))
      .mockResolvedValueOnce(response(a));
    const view = render(<TaskResultForm assignmentId={a.id} task={task} {...props} />);
    fireEvent.change(screen.getByLabelText('Task result'), { target: { value: 'DONE' } });
    fireEvent.change(screen.getByLabelText('Reason for checklist change'), {
      target: { value: 'Original task explanation' },
    });
    fireEvent.submit(screen.getByRole('form'));
    await screen.findByRole('button', { name: 'Retry original request' });
    expect(screen.getByLabelText('Task result')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard draft' })).toBeDisabled();
    const original = structuredClone(posts()[0]![1]?.body);
    view.rerender(
      <TaskResultForm assignmentId={a.id} task={{ ...task, resultVersion: 20 }} {...props} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry original request' }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledTimes(1));
    expect(posts()).toHaveLength(2);
    expect(posts()[1]![1]?.body).toEqual(original);
  });
  it('sends both accumulated quantities and preserves the untouched assembled field and original version after 409', async () => {
    const a = working(),
      item: CrewWorkItem = { ...a.items[0]!, deliveredQuantity: 2, assembledQuantity: 1 },
      props = callbacks();
    apiMock.mockRejectedValue(new ApiError(409, 'Quantity conflict fixture'));
    const view = render(<FulfillmentForm assignmentId={a.id} item={item} {...props} />);
    fireEvent.change(screen.getByLabelText('Delivered in total'), { target: { value: '3' } });
    fireEvent.submit(screen.getByRole('form'));
    await screen.findByText('Quantity conflict fixture');
    expect(posts()[0]![1]?.body).toMatchObject({
      deliveredQuantity: 3,
      assembledQuantity: 1,
      expectedFulfillmentVersion: 4,
    });
    expect(screen.getByLabelText('Delivered in total')).toHaveValue(3);
    expect(screen.getByLabelText('Assembled in total')).toHaveValue(1);
    view.rerender(
      <FulfillmentForm
        assignmentId={a.id}
        item={{ ...item, fulfillmentVersion: 8, assembledQuantity: 2 }}
        {...props}
      />,
    );
    expect(screen.getByLabelText('Assembled in total')).toHaveValue(1);
    fireEvent.submit(screen.getByRole('form'));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(posts()[1]![1]?.body).toMatchObject({
      expectedFulfillmentVersion: 4,
      deliveredQuantity: 3,
      assembledQuantity: 1,
    });
    fireEvent.change(screen.getByLabelText('Delivered in total'), { target: { value: '1' } });
    expect(screen.getByLabelText('Reason for quantity correction')).toBeRequired();
  });
  it('requires partial and return-visit details, keeps a finish draft after 409, and never calls an order-completion endpoint', async () => {
    const a = working(),
      props = callbacks();
    apiMock.mockRejectedValue(new ApiError(409, 'Execution conflict fixture'));
    const view = render(<FinishWorkForm assignment={a} currentOpenIssueCount={2} {...props} />);
    const form = screen.getByRole('form', { name: "Finish my team's visit" });
    fireEvent.change(screen.getByLabelText('Outcome'), {
      target: { value: 'PARTIALLY_COMPLETED' },
    });
    fireEvent.click(screen.getByLabelText('Another visit is required'));
    expect(screen.getByLabelText('Reason for partial or blocked result')).toBeRequired();
    expect(screen.getByLabelText('Remaining work')).toBeRequired();
    expect(screen.getByLabelText('Reason for another visit')).toBeRequired();
    expect(form).toBeInvalid();
    fireEvent.click(within(form).getByRole('button', { name: "Finish my team's visit" }));
    expect(posts()).toHaveLength(0);
    for (const [label, value] of [
      ['Result summary', 'Delivered some furniture'],
      ['Reason for partial or blocked result', 'Fittings missing'],
      ['Remaining work', 'Assemble remaining furniture'],
      ['Reason for another visit', 'Bring fittings'],
    ])
      fireEvent.change(screen.getByLabelText(label!), { target: { value } });
    expect(form).toBeValid();
    fireEvent.submit(form);
    await screen.findByText('Execution conflict fixture');
    expect(screen.getByLabelText('Result summary')).toHaveValue('Delivered some furniture');
    expect(screen.getByLabelText('Another visit is required')).toBeChecked();
    expect(posts()[0]![0]).toBe('/crew/assignments/' + a.id + '/actions/finish');
    expect(posts()[0]![1]?.body).toMatchObject({
      expectedExecutionVersion: 4,
      outcome: 'PARTIALLY_COMPLETED',
      remainingWork: 'Assemble remaining furniture',
      returnVisitRequired: true,
      returnReason: 'Bring fittings',
    });
    view.rerender(
      <FinishWorkForm
        assignment={{ ...a, execution: { ...a.execution, version: 10 } }}
        currentOpenIssueCount={3}
        {...props}
      />,
    );
    fireEvent.submit(form);
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(posts()[1]![1]?.body).toMatchObject({ expectedExecutionVersion: 4 });
    expect(posts().every(([path]) => path.endsWith('/actions/finish'))).toBe(true);
    expect(screen.getByText(/does not sign or close the order/)).toBeInTheDocument();
  });
});

describe('M5 assignment detail keeps work drafts and isolates navigation', () => {
  it('preserves an open finish draft on focus and financial-change refresh without silently adopting the new execution version', async () => {
    let canonical = working();
    apiMock.mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') throw new ApiError(409, 'Stale execution fixture');
      return response(canonical);
    });
    render(<CrewAssignmentDetailView assignmentId={canonical.id} />);
    fireEvent.click(await screen.findByRole('button', { name: "Finish my team's visit" }));
    const form = screen.getByRole('form', { name: "Finish my team's visit" }),
      input = within(form).getByLabelText('Result summary');
    fireEvent.change(input, { target: { value: 'Keep my finish draft' } });
    canonical = {
      ...canonical,
      execution: { ...canonical.execution, version: 99 },
      openIssueCount: 2,
    };
    await act(async () => window.dispatchEvent(new Event('focus')));
    await waitFor(() =>
      expect(within(form).getByText(/2 visible open issues/)).toBeInTheDocument(),
    );
    await act(async () => window.dispatchEvent(new Event('fd:orders-changed')));
    expect(screen.getByRole('form', { name: "Finish my team's visit" })).toBe(form);
    expect(input).toHaveValue('Keep my finish draft');
    fireEvent.submit(form);
    await screen.findByText('Stale execution fixture');
    expect(posts()[0]![1]?.body).toMatchObject({
      expectedExecutionVersion: 4,
      summary: 'Keep my finish draft',
    });
  });
  it('retains the finish draft on a failed background read but removes protected content after access loss', async () => {
    const canonical = working();
    apiMock.mockResolvedValue(response(canonical));
    render(<CrewAssignmentDetailView assignmentId={canonical.id} />);
    fireEvent.click(await screen.findByRole('button', { name: "Finish my team's visit" }));
    const form = screen.getByRole('form', { name: "Finish my team's visit" }),
      input = within(form).getByLabelText('Result summary');
    fireEvent.change(input, { target: { value: 'Unsent explanation' } });
    apiMock.mockRejectedValue(new ApiError(503, 'Temporary read failure'));
    await act(async () => window.dispatchEvent(new Event('focus')));
    await screen.findByText('Temporary read failure');
    expect(screen.getByRole('form', { name: "Finish my team's visit" })).toBe(form);
    expect(input).toHaveValue('Unsent explanation');
    apiMock.mockRejectedValue(new ApiError(403, 'Membership revoked'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('form', { name: "Finish my team's visit" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('heading', { name: canonical.customerName })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
  });
  it('ignores a late action result after navigating to a different assignment', async () => {
    const a = working(),
      b = {
        ...structuredClone(crewAssignmentFixture),
        id: 'new-assignment',
        customerName: 'Different assignment customer',
      },
      save = deferred<CrewAssignmentResponse>();
    apiMock.mockImplementation(async (path, options) => {
      if (options?.method === 'POST') return save.promise;
      return response(path.endsWith('/' + b.id) ? b : a);
    });
    const view = render(<CrewAssignmentDetailView assignmentId={a.id} />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Update task: ' + a.tasks[0]!.name }),
    );
    const form = screen.getByRole('form', { name: 'Edit task ' + a.tasks[0]!.name });
    fireEvent.change(within(form).getByLabelText('Task result'), { target: { value: 'DONE' } });
    fireEvent.submit(form);
    expect(posts()).toHaveLength(1);
    view.rerender(<CrewAssignmentDetailView assignmentId={b.id} />);
    await screen.findByRole('heading', { name: b.customerName });
    await act(async () => save.resolve(response({ ...a, customerName: 'Late old customer' })));
    expect(screen.getByRole('heading', { name: b.customerName })).toBeInTheDocument();
    expect(screen.queryByText('Late old customer')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Saved. The result below was read from the server.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
  it.each(['finish', 'task', 'item'] as const)(
    'retains an open %s draft as readonly when focus refresh observes terminal execution',
    async (kind) => {
      let canonical = working();
      const a = structuredClone(canonical);
      apiMock.mockImplementation(async () => response(canonical));
      render(<CrewAssignmentDetailView assignmentId={a.id} />);
      const buttonName =
        kind === 'finish'
          ? "Finish my team's visit"
          : kind === 'task'
            ? 'Update task: ' + a.tasks[0]!.name
            : 'Update quantities: ' + a.items[0]!.description;
      fireEvent.click(await screen.findByRole('button', { name: buttonName }));
      const formName =
        kind === 'finish'
          ? "Finish my team's visit"
          : kind === 'task'
            ? 'Edit task ' + a.tasks[0]!.name
            : 'Edit quantities ' + a.items[0]!.description;
      const form = screen.getByRole('form', { name: formName });
      const input = within(form).getByLabelText(
        kind === 'finish'
          ? 'Result summary'
          : kind === 'task'
            ? 'Reason for checklist change'
            : 'Delivered in total',
      );
      const draft = kind === 'item' ? '2' : 'Preserved unsent editor draft';
      fireEvent.change(input, { target: { value: draft } });
      canonical = completed(a);
      await act(async () => window.dispatchEvent(new Event('focus')));
      await screen.findByRole('region', { name: 'Saved finish report', hidden: true });
      expect(screen.getByRole('form', { name: formName })).toBe(form);
      expect(input).toBeDisabled();
      expect(input).toHaveValue(kind === 'item' ? 2 : draft);
      expect(within(form).getByText(/no longer permits a new result/)).toBeInTheDocument();
      const submitName =
        kind === 'finish'
          ? "Finish my team's visit"
          : kind === 'task'
            ? 'Save task result'
            : 'Save accumulated quantities';
      expect(within(form).getByRole('button', { name: submitName })).toBeDisabled();
      expect(within(form).getByRole('button', { name: 'Discard draft' })).not.toBeDisabled();
      fireEvent.submit(form);
      expect(posts()).toHaveLength(0);
    },
  );
  it('still permits the exact original unknown finish retry after a terminal refresh makes new submissions readonly', async () => {
    let canonical = working();
    canonical.tasks = canonical.tasks.map((task) => ({
      ...task,
      resultStatus: 'DONE',
      doneBy: 'fixture-actor',
      doneAt: '2030-01-07T08:15:00.000Z',
    }));
    const a = structuredClone(canonical);
    let submissions = 0;
    apiMock.mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') {
        submissions++;
        if (submissions === 1) {
          canonical = completed(a);
          throw new ApiError(0, 'Finish response lost fixture');
        }
      }
      return response(canonical);
    });
    render(<CrewAssignmentDetailView assignmentId={a.id} />);
    fireEvent.click(await screen.findByRole('button', { name: "Finish my team's visit" }));
    const form = screen.getByRole('form', { name: "Finish my team's visit" });
    fireEvent.change(within(form).getByLabelText('Result summary'), {
      target: { value: 'Original finish result' },
    });
    fireEvent.submit(form);
    await screen.findByRole('button', { name: 'Retry original request' });
    const original = structuredClone(posts()[0]![1]?.body);
    await act(async () => window.dispatchEvent(new Event('focus')));
    await screen.findByRole('region', { name: 'Saved finish report', hidden: true });
    expect(within(form).getByLabelText('Result summary')).toHaveValue('Original finish result');
    expect(within(form).getByRole('button', { name: "Finish my team's visit" })).toBeDisabled();
    expect(within(form).getByRole('button', { name: 'Discard draft' })).toBeDisabled();
    expect(within(form).getByRole('button', { name: 'Retry original request' })).not.toBeDisabled();
    fireEvent.submit(form);
    expect(posts()).toHaveLength(1);
    fireEvent.click(within(form).getByRole('button', { name: 'Retry original request' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('form', { name: "Finish my team's visit" }),
      ).not.toBeInTheDocument(),
    );
    expect(posts()).toHaveLength(2);
    expect(posts()[1]![1]?.body).toEqual(original);
    expect(screen.getByRole('region', { name: 'Saved finish report' })).toBeInTheDocument();
  });
  it('renders terminal results readonly and distinguishes frozen finish quantities from the live accumulated order state', async () => {
    const a = working(),
      end = '2030-01-07T10:00:00.000Z';
    const snapshot: FinishReportRecord = {
      id: 'finish-fixture',
      orderId: a.orderId,
      appointmentId: a.appointmentId,
      assignmentId: a.id,
      outcome: 'COMPLETED',
      summary: 'My team delivered its part',
      reason: null,
      remainingWork: null,
      quantityScope: 'ACCUMULATED_ORDER',
      taskResults: a.tasks.map((t) => ({ ...t, resultStatus: 'DONE' })),
      quantities: structuredClone(a.items),
      knownIssueIds: [],
      attachmentIds: [],
      authorId: 'fixture-author',
      actualEndAt: end,
      createdAt: end,
    };
    const terminal: CrewAssignmentDetail = {
      ...a,
      execution: { ...a.execution, status: 'COMPLETED', version: 9, actualEndAt: end },
      allowedActions: [],
      canEditResults: false,
      finishReport: snapshot,
      items: a.items.map((i) => ({
        ...i,
        deliveredQuantity: 3,
        assembledQuantity: 2,
        remainingDeliveryQuantity: 0,
        remainingAssemblyQuantity: 1,
      })),
    };
    apiMock.mockResolvedValue(response(terminal));
    render(<CrewAssignmentDetailView assignmentId={a.id} />);
    const report = await screen.findByRole('region', { name: 'Saved finish report' }),
      live = screen.getByRole('region', { name: 'Order quantities' });
    expect(within(live).getByText(/Delivered 3\/3/)).toBeInTheDocument();
    expect(within(live).getByText(/Assembled 2\/3/)).toBeInTheDocument();
    expect(within(report).getByRole('cell', { name: '1/3' })).toBeInTheDocument();
    expect(within(report).getByRole('cell', { name: '0/3' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: /Update task|Update quantities|Finish my team's visit/,
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/This report is frozen/)).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });
});
