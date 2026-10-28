import type { CrewDetail, CrewMembership, PublicUser } from '@furniture-delivery/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import { CrewEditor } from './crew-editor';
import CrewDetailPage from '../app/backoffice/crews/[id]/page';

const mocks = vi.hoisted(() => ({ availabilityRenders: vi.fn() }));
vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
vi.mock('./crew-planning-editor', () => ({
  CrewPlanningEditor: ({ crewId }: { crewId: string }) => {
    mocks.availabilityRenders();
    return (
      <label>
        Working hours draft
        <input data-crew={crewId} defaultValue="" />
      </label>
    );
  },
}));
const apiMock = vi.mocked(apiRequest);
const stamp = '2026-10-25T10:00:00.000Z';
const user = (id: string, name: string, active = true): PublicUser => ({
  id,
  username: id,
  displayName: name,
  role: 'CREW_MEMBER',
  active,
});
const member = (id: string, person: PublicUser, active = true): CrewMembership => ({
  id,
  userId: person.id,
  crewId: 'crew-one',
  active,
  createdAt: stamp,
  updatedAt: stamp,
  user: person,
});
const fixture: CrewDetail = {
  id: 'crew-one',
  code: 'TEAM-01',
  name: 'Aurora',
  active: true,
  workEnvironment: 'INDOOR',
  serviceArea: 'North area',
  createdAt: stamp,
  updatedAt: stamp,
  members: [
    member('member-alice', user('alice', 'Alice Worker')),
    member('member-bob', user('bob', 'Bob Worker'), false),
    member('member-charlie', user('charlie', 'Charlie Worker', false)),
  ],
  contacts: [],
};
const candidates = [
  user('dana', 'Dana Candidate'),
  user('disabled-person', 'Disabled Candidate', false),
];
let current: CrewDetail;
let readError: ApiError | null;
function tab(name: string) {
  const element = screen.getByRole('tab', { name });
  fireEvent.mouseDown(element, { button: 0, ctrlKey: false });
  fireEvent.click(element);
}
async function ready() {
  return screen.findByRole('heading', { level: 1, name: current.name });
}
beforeEach(() => {
  apiMock.mockReset();
  mocks.availabilityRenders.mockReset();
  current = fixture;
  readError = null;
  apiMock.mockImplementation((path) => {
    if (path === '/crews/member-candidates') return Promise.resolve({ users: candidates } as never);
    if (readError) return Promise.reject(readError);
    return Promise.resolve({ crew: current } as never);
  });
});

describe('Team detail workspace', () => {
  it('shows truthful membership/account states and keeps disabled candidate options disabled', async () => {
    render(<CrewEditor crewId={fixture.id} />);
    await ready();
    const summary = screen.getByRole('region', { name: 'Team summary' });
    expect(summary).toHaveTextContent('Active memberships');
    expect(summary).toHaveTextContent('of 3 recorded memberships');
    expect(summary).toHaveTextContent('TEAM-01');
    tab('Members');
    const roster = screen.getByRole('list', { name: 'Team composition' });
    const disabledAccount = within(roster).getByText('Charlie Worker').closest('li')!;
    expect(disabledAccount).toHaveTextContent('Active membership');
    expect(disabledAccount).toHaveTextContent('Account disabled');
    const inactive = within(roster).getByText('Bob Worker').closest('li')!;
    expect(inactive).toHaveTextContent('Inactive membership');
    expect(within(inactive).getByRole('button', { name: 'Reactivate membership' })).toBeEnabled();
    const selector = screen.getByLabelText('Add employee');
    expect(
      within(selector).getByRole('option', {
        name: 'Disabled Candidate (disabled-person) · Account disabled',
      }),
    ).toBeDisabled();
    expect(within(selector).getByRole('option', { name: 'Dana Candidate (dana)' })).toBeEnabled();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  });

  it('shows a contacts-only team separately from employee memberships without inventing accounts', async () => {
    current = {
      ...fixture,
      code: 'TEAM-11',
      members: [],
      contacts: Array.from({ length: 4 }, (_, index) => ({
        id: `contact-${index}`,
        crewId: fixture.id,
        name: `Synthetic specialist ${index}`,
        specialty: 'Supplier',
        phone: null,
        email: null,
        active: true,
        createdAt: stamp,
        updatedAt: stamp,
      })),
    };
    apiMock.mockImplementation((path) =>
      Promise.resolve(
        (path === '/crews/member-candidates' ? { users: [] } : { crew: current }) as never,
      ),
    );
    render(<CrewEditor crewId={fixture.id} />);
    await ready();
    const membersTab = screen.getByRole('tab', { name: 'Members' });
    const specialistsTab = screen.getByRole('tab', { name: 'Specialists' });
    expect(membersTab).toHaveTextContent('0');
    expect(specialistsTab).toHaveTextContent('4');
    tab('Members');
    expect(screen.getByRole('heading', { name: 'No team members yet.' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Team composition' })).not.toBeInTheDocument();
    expect(
      screen.getByText(/4 external specialist contacts are saved under Specialists/),
    ).toBeInTheDocument();
    expect(screen.getByText(/No employee accounts are available to add/)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Add team member' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View specialists' }));
    expect(specialistsTab).toHaveAttribute('aria-selected', 'true');
    for (const contact of current.contacts)
      expect(
        screen.getByText(`${contact.name} · ${contact.specialty}`, { selector: 'summary' }),
      ).toBeVisible();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  });

  it('sends the existing team update payload while the stable code stays unchanged', async () => {
    render(<CrewEditor crewId={fixture.id} />);
    await ready();
    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'Renamed Aurora' } });
    fireEvent.change(screen.getByLabelText('Work environment'), { target: { value: 'OUTDOOR' } });
    fireEvent.change(screen.getByLabelText('Service area'), { target: { value: 'South area' } });
    fireEvent.click(screen.getByLabelText('Team enabled'));
    current = {
      ...fixture,
      name: 'Renamed Aurora',
      workEnvironment: 'OUTDOOR',
      serviceArea: 'South area',
      active: false,
    };
    fireEvent.submit(screen.getByRole('form', { name: 'Team details' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        '/crews/crew-one',
        expect.objectContaining({
          method: 'PATCH',
          body: {
            name: 'Renamed Aurora',
            workEnvironment: 'OUTDOOR',
            serviceArea: 'South area',
            active: false,
          },
        }),
      ),
    );
    expect(await screen.findByText('Team details saved.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Renamed Aurora' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Team code')).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Team record' })).toHaveTextContent('TEAM-01');
  });

  it('adds and deactivates a member through the current endpoints and refreshes candidates', async () => {
    render(<CrewEditor crewId={fixture.id} />);
    await ready();
    tab('Members');
    fireEvent.change(screen.getByLabelText('Add employee'), { target: { value: 'dana' } });
    current = { ...fixture, members: [...fixture.members, member('member-dana', candidates[0]!)] };
    fireEvent.submit(screen.getByRole('form', { name: 'Add team member' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        '/crews/crew-one/members',
        expect.objectContaining({ method: 'POST', body: { userId: 'dana' } }),
      ),
    );
    expect(await screen.findByText('Dana Candidate')).toBeInTheDocument();
    expect(apiMock.mock.calls.filter(([path]) => path === '/crews/member-candidates')).toHaveLength(
      2,
    );
    const row = screen.getByRole('list', { name: 'Team composition' }).querySelector('li')!;
    current = {
      ...current,
      members: current.members.map((person) =>
        person.id === 'member-alice' ? { ...person, active: false } : person,
      ),
    };
    fireEvent.click(within(row).getByRole('button', { name: 'Deactivate membership' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        '/crews/crew-one/members/member-alice',
        expect.objectContaining({ method: 'PATCH', body: { active: false } }),
      ),
    );
    expect(
      await within(row).findByRole('button', { name: 'Reactivate membership' }),
    ).toBeInTheDocument();
    expect(apiMock.mock.calls.filter(([path]) => path === '/crews/member-candidates')).toHaveLength(
      3,
    );
  });

  it('keeps a rejected membership choice and reports the server conflict without changing the roster', async () => {
    render(<CrewEditor crewId={fixture.id} />);
    await ready();
    tab('Members');
    fireEvent.change(screen.getByLabelText('Add employee'), { target: { value: 'dana' } });
    apiMock.mockImplementation((path, options) =>
      options?.method === 'POST'
        ? Promise.reject(new ApiError(409, 'Employee already belongs to another team.'))
        : Promise.resolve(
            (path === '/crews/member-candidates'
              ? { users: candidates }
              : { crew: current }) as never,
          ),
    );
    fireEvent.submit(screen.getByRole('form', { name: 'Add team member' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Employee already belongs to another team.',
    );
    expect(screen.getByLabelText('Add employee')).toHaveValue('dana');
    expect(screen.getByRole('list', { name: 'Team composition' })).not.toHaveTextContent(
      'Dana Candidate',
    );
    expect(screen.getByRole('button', { name: 'Add member' })).toBeEnabled();
  });

  it('preserves profile and availability drafts across tab navigation and same-record refresh', async () => {
    render(<CrewEditor crewId={fixture.id} />);
    await ready();
    const name = screen.getByLabelText('Team name');
    fireEvent.change(name, { target: { value: 'Unsent team draft' } });
    tab('Availability');
    const working = screen.getByLabelText('Working hours draft');
    fireEvent.change(working, { target: { value: 'Unsent hours draft' } });
    const renders = mocks.availabilityRenders.mock.calls.length;
    tab('Members');
    tab('Specialists');
    tab('Overview');
    expect(mocks.availabilityRenders).toHaveBeenCalledTimes(renders);
    expect(screen.getByLabelText('Team name')).toBe(name);
    expect(name).toHaveValue('Unsent team draft');
    current = { ...fixture, name: 'Server saved team', updatedAt: '2026-10-26T10:00:00.000Z' };
    fireEvent.click(screen.getByRole('button', { name: 'Refresh team' }));
    await screen.findByRole('heading', { level: 1, name: 'Server saved team' });
    expect(screen.getByLabelText('Team name')).toBe(name);
    expect(name).toHaveValue('Unsent team draft');
    tab('Availability');
    expect(screen.getByLabelText('Working hours draft')).toBe(working);
    expect(working).toHaveValue('Unsent hours draft');
    expect(mocks.availabilityRenders).toHaveBeenCalledTimes(renders);
  });

  it('filters the member roster locally without requests or availability renders', async () => {
    render(<CrewEditor crewId={fixture.id} />);
    await ready();
    tab('Members');
    const requests = apiMock.mock.calls.length,
      renders = mocks.availabilityRenders.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Search team members'), { target: { value: 'bob' } });
    const roster = screen.getByRole('list', { name: 'Team composition' });
    expect(roster).toHaveTextContent('Bob Worker');
    expect(roster).not.toHaveTextContent('Alice Worker');
    expect(apiMock).toHaveBeenCalledTimes(requests);
    expect(mocks.availabilityRenders).toHaveBeenCalledTimes(renders);
  });

  it('clears the team and all mounted tabs when refreshed access is revoked', async () => {
    render(<CrewEditor crewId={fixture.id} />);
    await ready();
    tab('Availability');
    readError = new ApiError(403, 'Access revoked.');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Refresh team' })));
    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
    expect(screen.queryByRole('heading', { level: 1, name: 'Aurora' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Team sections' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Working hours draft')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Team name')).not.toBeInTheDocument();
  });

  it('starts a new form and availability scope when navigating to a different team route', async () => {
    const view = render(await CrewDetailPage({ params: Promise.resolve({ id: fixture.id }) }));
    await ready();
    fireEvent.change(screen.getByLabelText('Team name'), {
      target: { value: 'Old team unsent draft' },
    });
    tab('Availability');
    fireEvent.change(screen.getByLabelText('Working hours draft'), {
      target: { value: 'Old hours' },
    });
    current = {
      ...fixture,
      id: 'crew-two',
      code: 'TEAM-02',
      name: 'Birch',
      members: [],
      contacts: [],
    };
    view.rerender(await CrewDetailPage({ params: Promise.resolve({ id: 'crew-two' }) }));
    await ready();
    expect(screen.getByLabelText('Team name')).toHaveValue('Birch');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('data-state', 'active');
    tab('Availability');
    expect(screen.getByLabelText('Working hours draft')).toHaveValue('');
    expect(screen.getByLabelText('Working hours draft')).toHaveAttribute('data-crew', 'crew-two');
  });
});
