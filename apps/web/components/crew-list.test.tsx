import type { CrewDetail } from '@furniture-delivery/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../lib/api-client';
import { CrewList } from './crew-list';

vi.mock('../lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const apiMock = vi.mocked(apiRequest);
const crew: CrewDetail = {
  id: 'crew-1',
  code: 'TEAM-11',
  name: 'New team',
  active: true,
  workEnvironment: 'OUTDOOR',
  serviceArea: 'South',
  createdAt: '2026-10-25T00:00:00Z',
  updatedAt: '2026-10-25T00:00:00Z',
  members: [],
  contacts: [],
};
beforeEach(() => {
  apiMock.mockReset();
});

describe('team management form', () => {
  it('creates a team through the API and refreshes the persisted list', async () => {
    apiMock
      .mockResolvedValueOnce({ crews: [] })
      .mockResolvedValueOnce({ crew })
      .mockResolvedValue({ crews: [crew] });
    render(<CrewList />);
    await screen.findByText('No teams yet');
    fireEvent.click(screen.getByText('Add a team'));
    fireEvent.change(screen.getByLabelText('Team code'), { target: { value: 'TEAM-11' } });
    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'New team' } });
    fireEvent.change(screen.getByLabelText('Work environment'), { target: { value: 'OUTDOOR' } });
    fireEvent.change(screen.getByLabelText('Service area'), { target: { value: 'South' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Create team' }).closest('form')!);
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        '/crews',
        expect.objectContaining({
          method: 'POST',
          body: {
            code: 'TEAM-11',
            name: 'New team',
            workEnvironment: 'OUTDOOR',
            serviceArea: 'South',
            active: true,
          },
        }),
      ),
    );
    expect(await screen.findByRole('link', { name: 'New team' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New team' })).toHaveAttribute(
      'href',
      '/backoffice/crews/crew-1',
    );
  });
});
