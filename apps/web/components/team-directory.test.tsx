import type {
  CrewDetail,
  CrewListResponse,
  CrewResponse,
  CrewSummary,
} from '@furniture-delivery/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import { chooseSelectOption } from '../test/select-option';
import { CrewList } from './crew-list';

vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const api = vi.mocked(apiRequest);
const instant = '2030-01-07T08:00:00.000Z';
const teams: CrewSummary[] = [
  {
    id: 'team-aurora',
    code: 'TEST-01',
    name: 'Aurora',
    active: true,
    workEnvironment: 'INDOOR',
    serviceArea: 'North',
    createdAt: instant,
    updatedAt: instant,
  },
  {
    id: 'team-birch',
    code: 'TEST-02',
    name: 'Birch',
    active: true,
    workEnvironment: 'OUTDOOR',
    serviceArea: 'South',
    createdAt: instant,
    updatedAt: instant,
  },
  {
    id: 'team-cedar',
    code: 'TEST-03',
    name: 'Cedar',
    active: false,
    workEnvironment: 'OUTDOOR',
    serviceArea: 'North',
    createdAt: instant,
    updatedAt: instant,
  },
];
const newTeam: CrewDetail = {
  id: 'new-test-team',
  code: 'TEST-11',
  name: 'Synthetic new team',
  active: true,
  workEnvironment: 'OUTDOOR',
  serviceArea: 'West',
  createdAt: instant,
  updatedAt: instant,
  members: [],
  contacts: [],
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const metric = (label: string) =>
  within(screen.getByLabelText('Team directory summary')).getByText(label).nextElementSibling;
function fillNewTeam() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Team code' }), {
    target: { value: 'TEST-11' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Team name' }), {
    target: { value: 'Synthetic new team' },
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'Work environment' }), {
    target: { value: 'OUTDOOR' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Service area' }), {
    target: { value: 'West' },
  });
}

beforeEach(() => {
  api.mockReset();
});

describe('modern team directory', () => {
  it('shows initial loading, an API error and Retry before the genuine empty directory', async () => {
    const initial = deferred<CrewListResponse>();
    api.mockReturnValueOnce(initial.promise).mockResolvedValue({ crews: [] });
    render(<CrewList />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(metric('Total teams')).toHaveTextContent('—');
    expect(screen.queryByText('No teams yet')).not.toBeInTheDocument();
    await act(async () => initial.reject(new ApiError(503, 'Synthetic directory outage.')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic directory outage.');
    expect(screen.queryByRole('table', { name: 'Teams' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'No teams yet' })).toBeInTheDocument();
    expect(metric('Total teams')).toHaveTextContent('0');
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('searches and filters the complete returned list locally, discards drafts and keeps true directory totals', async () => {
    api.mockResolvedValue({ crews: teams });
    render(<CrewList />);
    const table = await screen.findByRole('table', { name: 'Teams' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(metric('Total teams')).toHaveTextContent('3');
    expect(metric('Enabled teams')).toHaveTextContent('2');
    expect(metric('Disabled teams')).toHaveTextContent('1');
    expect(metric('Outdoor teams')).toHaveTextContent('2');

    fireEvent.change(screen.getByRole('textbox', { name: 'Search teams' }), {
      target: { value: 'North' },
    });
    expect(table).toHaveTextContent('Birch');
    expect(api).toHaveBeenCalledTimes(1);
    fireEvent.submit(screen.getByRole('search', { name: 'Search teams' }));
    expect(within(table).getByRole('link', { name: 'Aurora' })).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'Cedar' })).toBeInTheDocument();
    expect(within(table).queryByRole('link', { name: 'Birch' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Filter teams' }));
    await chooseSelectOption('Team status', 'Disabled');
    await chooseSelectOption('Team environment', 'Outdoor');
    expect(table).toHaveTextContent('Aurora');
    fireEvent.click(screen.getByRole('button', { name: 'Close team filters' }));
    expect(within(table).getByRole('link', { name: 'Aurora' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Filter teams' }));
    expect(screen.getByRole('combobox', { name: 'Team status' })).toHaveTextContent('All statuses');
    expect(screen.getByRole('combobox', { name: 'Team environment' })).toHaveTextContent(
      'All environments',
    );
    await chooseSelectOption('Team status', 'Disabled');
    await chooseSelectOption('Team environment', 'Outdoor');
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(within(table).getByRole('link', { name: 'Cedar' })).toHaveAttribute(
      'href',
      '/backoffice/crews/team-cedar',
    );
    expect(within(table).queryByRole('link', { name: 'Aurora' })).not.toBeInTheDocument();
    expect(screen.getByText(/Showing 1 of 3 teams/)).toBeInTheDocument();
    expect(metric('Total teams')).toHaveTextContent('3');
    expect(metric('Enabled teams')).toHaveTextContent('2');
    expect(metric('Disabled teams')).toHaveTextContent('1');
    expect(metric('Outdoor teams')).toHaveTextContent('2');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(screen.getByRole('textbox', { name: 'Search teams' })).toHaveValue('');
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith(
      '/crews',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(api.mock.calls.every(([path, options]) => path === '/crews' && !options?.method)).toBe(
      true,
    );
  });

  it('keeps a rejected creation draft available for correction with the same values', async () => {
    api.mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') throw new ApiError(400, 'Synthetic team code conflict.');
      return { crews: teams };
    });
    render(<CrewList />);
    await screen.findByRole('table', { name: 'Teams' });
    fireEvent.click(screen.getByRole('button', { name: 'Add a team' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a team' });
    fillNewTeam();
    fireEvent.submit(within(dialog).getByRole('form', { name: 'Create team' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Synthetic team code conflict.',
    );
    expect(within(dialog).getByRole('textbox', { name: 'Team code' })).toHaveValue('TEST-11');
    expect(within(dialog).getByRole('textbox', { name: 'Team name' })).toHaveValue(
      'Synthetic new team',
    );
    expect(within(dialog).getByRole('combobox', { name: 'Work environment' })).toHaveValue(
      'OUTDOOR',
    );
    expect(within(dialog).getByRole('textbox', { name: 'Service area' })).toHaveValue('West');
    expect(within(dialog).getByRole('button', { name: 'Create team' })).toBeEnabled();
    expect(api).toHaveBeenCalledWith(
      '/crews',
      expect.objectContaining({
        method: 'POST',
        body: {
          code: 'TEST-11',
          name: 'Synthetic new team',
          workEnvironment: 'OUTDOOR',
          serviceArea: 'West',
          active: true,
        },
      }),
    );
  });

  it('prevents closing a pending create by Escape or close button, then displays the persisted team', async () => {
    const pending = deferred<CrewResponse>();
    let created = false;
    api.mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') return pending.promise;
      return { crews: created ? [...teams, newTeam] : teams };
    });
    render(<CrewList />);
    await screen.findByRole('table', { name: 'Teams' });
    fireEvent.click(screen.getByRole('button', { name: 'Add a team' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a team' });
    fillNewTeam();
    fireEvent.submit(within(dialog).getByRole('form', { name: 'Create team' }));
    expect(within(dialog).getByRole('button', { name: 'Creating…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Close add team' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close add team' }));
    expect(screen.getByRole('dialog', { name: 'Add a team' })).toBe(dialog);
    await act(async () => {
      created = true;
      pending.resolve({ crew: newTeam });
    });
    expect(await screen.findByRole('link', { name: 'Synthetic new team' })).toHaveAttribute(
      'href',
      '/backoffice/crews/new-test-team',
    );
    expect(screen.queryByRole('dialog', { name: 'Add a team' })).not.toBeInTheDocument();
    expect(screen.getByText('Team created.')).toBeInTheDocument();
    expect(metric('Total teams')).toHaveTextContent('4');
    expect(api.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  });

  it('clears loaded team names and totals when a later directory read is forbidden', async () => {
    api
      .mockResolvedValueOnce({ crews: teams })
      .mockRejectedValue(new ApiError(403, 'Synthetic access revoked.'));
    render(<CrewList />);
    await screen.findByRole('table', { name: 'Teams' });
    const refresh = screen.getByRole('button', { name: 'Refresh teams' });
    await waitFor(() => expect(refresh).toBeEnabled());
    fireEvent.click(refresh);
    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
    expect(screen.queryByRole('table', { name: 'Teams' })).not.toBeInTheDocument();
    for (const name of ['Aurora', 'Birch', 'Cedar'])
      expect(document.body).not.toHaveTextContent(name);
    expect(metric('Total teams')).toHaveTextContent('—');
    expect(screen.queryByRole('heading', { name: 'No teams yet' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
