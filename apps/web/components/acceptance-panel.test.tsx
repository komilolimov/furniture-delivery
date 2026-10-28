import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BackofficeAcceptanceResponse,
  CrewAcceptanceResponse,
} from '@furniture-delivery/contracts';
import { apiRequest, ApiError } from '../lib/api-client';
import {
  absenceConfirmationFixture,
  acceptanceDocumentFixture,
  backofficeAcceptanceFixture,
  crewAcceptanceFixture,
} from '../test/acceptance-fixture';
import { fixtureActorId } from '../test/planning-fixture';
import { crewAssignmentFixture } from '../test/execution-fixture';
import { returnDetailFixture } from '../test/return-fixture';
import { canvasMocks } from '../test/signature-canvas-mocks';
import { VisitAcceptancePanel } from './acceptance-panel';
import { CrewAssignmentDetailView } from './crew-assignment-detail';
import { LogoutButton } from './logout-button';
const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
vi.mock('./evidence-panel', () => ({ EvidencePanel: () => null }));
vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const mock = vi.mocked(apiRequest);
let canvas: ReturnType<typeof canvasMocks>;
beforeEach(() => {
  mock.mockReset();
  navigation.replace.mockReset();
  navigation.refresh.mockReset();
  canvas = canvasMocks();
});
afterEach(() => {
  cleanup();
  canvas.restoreDialog();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const scope = {
  orderId: acceptanceDocumentFixture.snapshot.orderId,
  appointmentId: acceptanceDocumentFixture.snapshot.appointmentId,
};
const posts = () => mock.mock.calls.filter(([, options]) => options?.method === 'POST');
const bytes = (blob: Blob) =>
  new Promise<number[]>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(Array.from(new Uint8Array(reader.result as ArrayBuffer)));
    reader.readAsArrayBuffer(blob);
  });
function drawSignature(root: HTMLElement) {
  const pad = within(root).getByLabelText('Signature drawing area');
  fireEvent.pointerDown(pad, { pointerId: 4, pointerType: 'touch', clientX: 50, clientY: 30 });
  fireEvent.pointerMove(pad, { pointerId: 4, clientX: 250, clientY: 130 });
  fireEvent.pointerUp(pad, { pointerId: 4, clientX: 300, clientY: 100 });
}
async function customerDraft() {
  fireEvent.click(await screen.findByRole('button', { name: 'Open customer signing mode' }));
  const dialog = screen.getByRole('dialog', { name: 'Customer acknowledgement' });
  fireEvent.change(within(dialog).getByLabelText('Customer or representative name'), {
    target: { value: 'Fictional customer signer' },
  });
  drawSignature(dialog);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Preview drawing' }));
  await within(dialog).findByAltText('Your unsaved signature preview');
  return dialog;
}
function signed(response: BackofficeAcceptanceResponse): BackofficeAcceptanceResponse {
  const next = structuredClone(response),
    slot = next.acceptance.current!.slots[0]!;
  slot.status = 'SIGNED';
  slot.maySign = false;
  slot.mayReportAbsence = false;
  slot.canReadImage = true;
  slot.confirmation = {
    ...absenceConfirmationFixture,
    method: 'SIGNED',
    signerName: 'Fictional customer signer',
    imageDigest: 'b'.repeat(64),
    width: 1024,
    height: 360,
    sizeBytes: 80,
    absenceKind: null,
    absenceReason: null,
  };
  next.acceptance.history = [next.acceptance.current!];
  return next;
}

describe('Visit acknowledgement server state and presentation', () => {
  it('integrates the real acknowledgement panel in its own terminal crew assignment with a route-aware API', async () => {
    let acknowledgement: CrewAcceptanceResponse = {
      acceptance: {
        ...crewAcceptanceFixture.acceptance,
        current: null,
        history: [],
        canPrepare: false,
        preparationBlockedReason:
          'All participating teams must finish before preparing the common visit result.',
      },
    };
    const assignment = {
      ...crewAssignmentFixture,
      execution: {
        ...crewAssignmentFixture.execution,
        status: 'PARTIALLY_COMPLETED' as const,
        actualEndAt: '2030-01-07T10:00:00.000Z',
      },
      allowedActions: [],
      canEditResults: false,
      finishReport: { ...returnDetailFixture.sourceReport },
    };
    mock.mockImplementation(async (path) => {
      if (path === `/crew/assignments/${assignment.id}`) return { assignment };
      if (path === `/crew/assignments/${assignment.id}/acceptance`) return acknowledgement;
      throw new Error('Unexpected route in isolated acknowledgement integration');
    });
    render(<CrewAssignmentDetailView assignmentId={assignment.id} />);
    await screen.findByRole('region', { name: 'Saved finish report' });
    await screen.findByText(
      'All participating teams must finish before preparing the common visit result.',
    );
    expect(screen.getByRole('button', { name: 'Prepare recorded visit result' })).toBeDisabled();
    expect(mock).toHaveBeenCalledWith(
      `/crew/assignments/${assignment.id}/acceptance`,
      expect.anything(),
    );
    acknowledgement = crewAcceptanceFixture;
    await act(async () => window.dispatchEvent(new Event('focus')));
    await screen.findByRole('button', { name: 'Sign my team’s result' });
    expect(screen.getByText(/Your team’s part/)).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });
  it('shows loading/error/Retry and explains why a second unfinished team blocks preparation', async () => {
    mock.mockRejectedValueOnce(new ApiError(503, 'Acknowledgement unavailable'));
    mock.mockResolvedValue({
      acceptance: {
        ...backofficeAcceptanceFixture.acceptance,
        current: null,
        history: [],
        canPrepare: false,
        preparationBlockedReason:
          'All participating teams must finish before preparing the common visit result.',
      },
    });
    render(<VisitAcceptancePanel scope={scope} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(await screen.findByRole('alert')).toHaveTextContent('Acknowledgement unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText(
      'All participating teams must finish before preparing the common visit result.',
    );
    expect(screen.getByRole('button', { name: 'Prepare recorded visit result' })).toBeDisabled();
    expect(posts()).toHaveLength(0);
  });
  it('prepares only on explicit submit and does not treat GET as acknowledgement', async () => {
    let canonical: BackofficeAcceptanceResponse = {
      acceptance: {
        ...backofficeAcceptanceFixture.acceptance,
        current: null,
        history: [],
        canPrepare: true,
      },
    };
    mock.mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') canonical = backofficeAcceptanceFixture;
      return canonical;
    });
    render(<VisitAcceptancePanel scope={scope} />);
    const button = await screen.findByRole('button', { name: 'Prepare recorded visit result' });
    expect(posts()).toHaveLength(0);
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByRole('heading', { name: 'Recorded visit result · revision 1' });
    expect(posts()).toHaveLength(1);
    expect(posts()[0]![1]?.body).toEqual({ operationKey: expect.any(String) });
  });
  it('shows partial team snapshots and separate accumulated values without adding them', async () => {
    mock.mockResolvedValue(backofficeAcceptanceFixture);
    render(<VisitAcceptancePanel scope={scope} />);
    await screen.findByText('One cabinet delivered; assembly remains');
    expect(screen.getByText(/delivered 1\/2; assembled 0\/2/)).toBeInTheDocument();
    expect(screen.getByText(/delivered 2\/2; assembled 2\/2/)).toBeInTheDocument();
    expect(screen.getByText(/These values are not added together/)).toBeInTheDocument();
    expect(screen.getByText('Reason: Missing hinge')).toBeInTheDocument();
    expect(
      screen.getAllByRole('heading', { name: 'Recorded visit result · revision 1' }),
    ).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Sign my team’s result' })).not.toBeInTheDocument();
  });
  it('offers only the current crew slot and customer capture, keeping other-team metadata hidden', async () => {
    mock.mockResolvedValue(crewAcceptanceFixture);
    render(<VisitAcceptancePanel scope={{ assignmentId: crewAssignmentFixture.id }} />);
    await screen.findByRole('button', { name: 'Sign my team’s result' });
    expect(screen.getAllByRole('button', { name: 'Sign my team’s result' })).toHaveLength(1);
    expect(
      screen.queryByRole('button', { name: 'Invalidate recorded document with reason' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Your team’s part/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review this absence' })).not.toBeInTheDocument();
  });
});

describe('Signature capture and frozen retries', () => {
  it('clears a drawing and preview after confirmed logout even when navigation does not unmount', async () => {
    let confirmLogout!: () => void;
    const logoutResult = new Promise<void>((resolve) => {
      confirmLogout = resolve;
    });
    mock.mockImplementation(async (path) =>
      path === '/auth/logout' ? logoutResult : crewAcceptanceFixture,
    );
    const eventOrder: string[] = [];
    const expired = () => {
      eventOrder.push('clear');
    };
    window.addEventListener('fd:session-expired', expired);
    navigation.replace.mockImplementation(() => {
      eventOrder.push('navigate');
    });
    try {
      render(
        <>
          <LogoutButton />
          <VisitAcceptancePanel scope={{ assignmentId: crewAssignmentFixture.id }} />
        </>,
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Sign my team’s result' }));
      const form = screen.getByRole('form', { name: 'Team signature' });
      drawSignature(form);
      fireEvent.click(within(form).getByRole('button', { name: 'Preview drawing' }));
      await within(form).findByAltText('Your unsaved signature preview');
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      expect(screen.getByRole('form', { name: 'Team signature' })).toBeInTheDocument();
      expect(screen.getByAltText('Your unsaved signature preview')).toBeInTheDocument();
      await act(async () => confirmLogout());
      await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/login'));
      expect(eventOrder).toEqual(['clear', 'navigate']);
      expect(navigation.refresh).toHaveBeenCalled();
      expect(screen.queryByRole('form', { name: 'Team signature' })).not.toBeInTheDocument();
      expect(screen.queryByAltText('Your unsaved signature preview')).not.toBeInTheDocument();
      expect(canvas.revoke).toHaveBeenCalledWith('blob:test-only-signature');
      expect(screen.getByRole('heading', { name: 'Visit acknowledgement' })).toBeInTheDocument();
    } finally {
      window.removeEventListener('fd:session-expired', expired);
    }
  });
  it('opens a native customer modal, requires name/drawing/explicit consent and saves PNG separately', async () => {
    let canonical = structuredClone(backofficeAcceptanceFixture);
    mock.mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') canonical = signed(canonical);
      return canonical;
    });
    render(<VisitAcceptancePanel scope={scope} />);
    const dialog = await customerDraft();
    expect(canvas.show).toHaveBeenCalledTimes(1);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).queryByRole('navigation')).not.toBeInTheDocument();
    const consent = within(dialog).getByLabelText(
      'I have read and acknowledge this recorded visit result',
    );
    expect(consent).not.toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Save this signature' })).toBeDisabled();
    fireEvent.click(consent);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save this signature' }));
    await screen.findByText(/Fictional customer signer · recorded/);
    const body = posts()[0]![1]!.body as FormData;
    expect(JSON.parse(String(body.get('payload')))).toMatchObject({
      expectedVersion: 1,
      consent: true,
      customerName: 'Fictional customer signer',
      operationKey: expect.any(String),
    });
    expect(body.get('signature')).toBeInstanceOf(Blob);
    expect((body.get('signature') as Blob).type).toBe('image/png');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Revoking the preview URL happens in the passive unmount effect, after the DOM commit.
    await waitFor(() => expect(canvas.revoke).toHaveBeenCalledWith('blob:test-only-signature'));
  });
  it('retains the exact original metadata and PNG on an unknown outcome', async () => {
    let canonical = structuredClone(backofficeAcceptanceFixture),
      writes = 0;
    mock.mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') {
        writes++;
        canonical = signed(canonical);
        if (writes === 1) throw new ApiError(0, 'Response lost');
      }
      return canonical;
    });
    render(<VisitAcceptancePanel scope={scope} />);
    const dialog = await customerDraft();
    fireEvent.click(
      within(dialog).getByLabelText('I have read and acknowledge this recorded visit result'),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save this signature' }));
    const retry = await within(dialog).findByRole('button', { name: 'Retry same signature' });
    expect(within(dialog).getByLabelText('Customer or representative name')).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Back to staff view' })).toBeDisabled();
    fireEvent.click(retry);
    await screen.findByText(/Fictional customer signer · recorded/);
    const first = posts()[0]![1]!.body as FormData,
      second = posts()[1]![1]!.body as FormData;
    expect(second.get('payload')).toBe(first.get('payload'));
    expect((second.get('signature') as Blob).size).toBe((first.get('signature') as Blob).size);
    expect((second.get('signature') as Blob).type).toBe((first.get('signature') as Blob).type);
    expect(await bytes(second.get('signature') as Blob)).toEqual(
      await bytes(first.get('signature') as Blob),
    );
    expect(canvas.exports).toHaveLength(1);
  });
  it('keeps the old drawing and revision on 409/refetch without rebinding to a new snapshot', async () => {
    let canonical = structuredClone(backofficeAcceptanceFixture);
    mock.mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') throw new ApiError(409, 'Snapshot invalidated');
      return canonical;
    });
    render(<VisitAcceptancePanel scope={scope} />);
    const dialog = await customerDraft();
    fireEvent.click(
      within(dialog).getByLabelText('I have read and acknowledge this recorded visit result'),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save this signature' }));
    await within(dialog).findByText('Snapshot invalidated');
    canonical = structuredClone(backofficeAcceptanceFixture);
    canonical.acceptance.current!.snapshot.id = 'new-snapshot';
    canonical.acceptance.current!.snapshot.version = 2;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Read current acknowledgement' }));
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Recorded visit result · revision 2' }),
      ).toBeInTheDocument(),
    );
    expect(within(dialog).getByText('Signature for document revision 1')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Customer or representative name')).toHaveValue(
      'Fictional customer signer',
    );
    expect(within(dialog).getByAltText('Your unsaved signature preview')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save this signature' })).toBeDisabled();
    expect(
      JSON.parse(String((posts()[0]![1]!.body as FormData).get('payload'))).expectedVersion,
    ).toBe(1);
  });
  it('clears sensitive names, image previews and modal state when access is lost', async () => {
    mock.mockResolvedValue(backofficeAcceptanceFixture);
    render(<VisitAcceptancePanel scope={scope} />);
    await customerDraft();
    await act(async () => window.dispatchEvent(new Event('fd:session-expired')));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Fictional customer signer')).not.toBeInTheDocument();
    expect(screen.queryByAltText('Your unsaved signature preview')).not.toBeInTheDocument();
    expect(canvas.revoke).toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Sensitive drafts and previews were cleared',
    );
  });
  it('discards the old document draft and object URL when navigating to another visit', async () => {
    mock.mockResolvedValue(backofficeAcceptanceFixture);
    const view = render(<VisitAcceptancePanel scope={scope} />);
    await customerDraft();
    const next = structuredClone(backofficeAcceptanceFixture);
    next.acceptance.appointmentId = 'another-visit';
    next.acceptance.current!.snapshot.appointmentId = 'another-visit';
    next.acceptance.current!.snapshot.payload.order.customerName = 'Another fictional customer';
    mock.mockResolvedValue(next);
    view.rerender(<VisitAcceptancePanel scope={{ ...scope, appointmentId: 'another-visit' }} />);
    await screen.findByText(/Another fictional customer/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Fictional customer signer')).not.toBeInTheDocument();
    expect(screen.queryByAltText('Your unsaved signature preview')).not.toBeInTheDocument();
    expect(canvas.revoke).toHaveBeenCalledWith('blob:test-only-signature');
  });
});

describe('Absence, review and invalidation', () => {
  it('records refusal as pending review without inventing a signature', async () => {
    const canonical = structuredClone(backofficeAcceptanceFixture);
    mock.mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') {
        const slot = canonical.acceptance.current!.slots[0]!;
        slot.confirmation = absenceConfirmationFixture;
        slot.status = 'PENDING_REVIEW';
        slot.maySign = false;
        slot.mayReportAbsence = false;
        slot.mayReview = true;
      }
      return canonical;
    });
    render(<VisitAcceptancePanel scope={scope} />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Record missing customer signature' }),
    );
    fireEvent.change(screen.getByLabelText('Absence type'), { target: { value: 'REFUSED' } });
    fireEvent.change(screen.getByLabelText('Explanation'), {
      target: { value: 'Customer asked dispatcher to review the missing part' },
    });
    fireEvent.click(
      screen.getByLabelText('Confirm this explicit action for this document and requirement'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save absence for review' }));
    await screen.findByText('Absence recorded · dispatcher review pending');
    expect(posts()[0]![1]!.body).toMatchObject({
      expectedVersion: 1,
      kind: 'REFUSED',
      reason: 'Customer asked dispatcher to review the missing part',
    });
    expect(
      screen.queryByRole('button', { name: 'Open protected signature image' }),
    ).not.toBeInTheDocument();
  });
  it('reviews exactly one absence with an explicit decision and keeps it labelled as no signature', async () => {
    const canonical = structuredClone(backofficeAcceptanceFixture);
    const slot = canonical.acceptance.current!.slots[0]!;
    slot.confirmation = absenceConfirmationFixture;
    slot.status = 'PENDING_REVIEW';
    slot.maySign = false;
    slot.mayReportAbsence = false;
    slot.mayReview = true;
    mock.mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') {
        const slot = canonical.acceptance.current!.slots[0]!;
        slot.status = 'EXCEPTION_APPROVED';
        slot.mayReview = false;
        slot.exception = {
          id: 'review',
          slotId: slot.id,
          confirmationId: absenceConfirmationFixture.id,
          decision: 'APPROVED',
          reason: 'Reviewed this refusal',
          reviewedByUserId: fixtureActorId,
          reviewedAt: '2030-01-07T12:00:00.000Z',
        };
      }
      return canonical;
    });
    render(<VisitAcceptancePanel scope={scope} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review this absence' }));
    fireEvent.change(screen.getByLabelText('Explanation'), {
      target: { value: 'Reviewed this refusal' },
    });
    fireEvent.click(
      screen.getByLabelText('Confirm this explicit action for this document and requirement'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save exception decision' }));
    await screen.findByText('Absence reviewed and approved · no signature');
    expect(posts()[0]![0]).toBe(
      `/acceptance/${acceptanceDocumentFixture.snapshot.id}/slots/${acceptanceDocumentFixture.slots[0]!.id}/review`,
    );
    expect(posts()[0]![1]!.body).toMatchObject({ decision: 'APPROVED', expectedVersion: 1 });
    expect(screen.getAllByText('Confirmation missing')).toHaveLength(2);
  });
  it('invalidates explicitly and preserves the old document without automatically preparing another', async () => {
    let canonical = structuredClone(backofficeAcceptanceFixture);
    mock.mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') {
        const old = structuredClone(canonical.acceptance.current!);
        old.snapshot.invalidatedAt = '2030-01-07T12:00:00.000Z';
        old.snapshot.invalidatedBy = fixtureActorId;
        old.snapshot.invalidationReason = 'Correct the recorded document';
        canonical = {
          acceptance: { ...canonical.acceptance, current: null, history: [old], canPrepare: true },
        };
      }
      return canonical;
    });
    render(<VisitAcceptancePanel scope={scope} />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Invalidate recorded document with reason' }),
    );
    fireEvent.change(screen.getByLabelText('Explanation'), {
      target: { value: 'Correct the recorded document' },
    });
    expect(
      screen.getByText(/If the order is closed, this action also reopens it/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByLabelText('Confirm this explicit action for this document and requirement'),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Invalidate document and preserve history' }),
    );
    await screen.findByText('Historical document revision 1 · invalidated');
    expect(screen.getByRole('button', { name: 'Prepare recorded visit result' })).toBeEnabled();
    expect(posts()).toHaveLength(1);
  });
  it('omits all dispatcher review/invalidation actions in crew response', async () => {
    const canonical: CrewAcceptanceResponse = structuredClone(crewAcceptanceFixture),
      slot = canonical.acceptance.current!.slots[0]!;
    slot.status = 'PENDING_REVIEW';
    slot.confirmation = absenceConfirmationFixture;
    slot.maySign = false;
    slot.mayReportAbsence = false;
    mock.mockResolvedValue(canonical);
    render(<VisitAcceptancePanel scope={{ assignmentId: crewAssignmentFixture.id }} />);
    await screen.findByText('Absence recorded · dispatcher review pending');
    expect(screen.queryByRole('button', { name: 'Review this absence' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Invalidate recorded document with reason' }),
    ).not.toBeInTheDocument();
  });
});
