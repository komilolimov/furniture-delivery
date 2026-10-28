import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CrewReturnContext } from '@furniture-delivery/contracts';
import { CrewReturnSummary } from './crew-return-context';
import { isCrewAssignmentDetail } from '../lib/execution-guards';
import { crewAssignmentFixture } from '../test/execution-fixture';
const context: CrewReturnContext = {
  requestId: 'return-fixture',
  sourceAppointmentId: 'old-visit',
  reason: 'Missing fitting',
  remainingWork: 'Assemble the remaining cabinet',
  scope: {
    tasks: [
      {
        key: 'scope-fixture',
        sourceTaskId: 'source-pending',
        sourceAssignmentId: 'old-assignment',
        name: 'Assembly',
        description: 'Only unfinished work',
        required: true,
        severity: 'HIGH',
        priority: 1,
        crewId: crewAssignmentFixture.crewId,
        addedReason: null,
      },
    ],
    itemTargets: [],
  },
  sourceTasks: [{ id: 'source-pending', name: 'Assembly', resultStatus: 'PENDING' }],
};
describe('M6 safe crew follow-up context', () => {
  it('shows remaining work and read-only source context without inserting old tasks into the checklist', () => {
    render(<CrewReturnSummary context={context} />);
    expect(screen.getByRole('heading', { name: 'Follow-up work' })).toBeInTheDocument();
    expect(screen.getByText('Assemble the remaining cabinet')).toBeInTheDocument();
    expect(screen.getByText(/accumulated for the whole order/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
  it('accepts safe context but rejects malformed metadata and nested financial or internal fields', () => {
    const a = { ...crewAssignmentFixture, returnContext: context };
    expect(isCrewAssignmentDetail(a)).toBe(true);
    for (const key of ['payments', 'internalNotes', 'storageKey', 'tokenHash'])
      expect(
        isCrewAssignmentDetail({
          ...a,
          returnContext: { ...context, extra: { [key]: 'private' } },
        }),
      ).toBe(false);
    expect(
      isCrewAssignmentDetail({
        ...a,
        returnContext: {
          ...context,
          scope: { tasks: [{ ...context.scope.tasks[0], required: 'true' }], itemTargets: [] },
        },
      }),
    ).toBe(false);
    expect(
      isCrewAssignmentDetail({ ...a, execution: { ...a.execution, estimateVersion: 0 } }),
    ).toBe(false);
    expect(
      isCrewAssignmentDetail({
        ...a,
        execution: { ...a.execution, estimatedFinishAt: '2030-01-07T12:00' },
      }),
    ).toBe(false);
  });
});
