import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import { planningTemplates } from '../test/planning-fixture';
import { realtimeUser } from '../test/realtime-fixture';
import { TaskTemplateEditor } from './task-template-editor';

vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
vi.mock('./session-provider', () => ({ useCurrentUser: () => realtimeUser }));
const api = vi.mocked(apiRequest);
const template = planningTemplates[0]!;
beforeEach(() => {
  api.mockReset();
});

async function openDraft() {
  fireEvent.click(await screen.findByText(template.name));
  const form = screen.getByRole('form', { name: `Edit template ${template.code}` });
  fireEvent.change(within(form).getByLabelText('Task description'), {
    target: { value: 'Private unsaved template draft' },
  });
  return form;
}

describe('Task template access and refresh retention', () => {
  it.each([401, 403, 404])(
    'clears the private catalog and editor after access status %s',
    async (status) => {
      let accessLost = false;
      api.mockImplementation(async () => {
        if (accessLost) throw new ApiError(status, 'Template access changed');
        return { templates: [template] };
      });
      render(<TaskTemplateEditor />);
      await openDraft();
      accessLost = true;
      await act(async () => {
        fireEvent.focus(window);
      });
      await screen.findByRole('alert', { hidden: true });
      await waitFor(() => expect(screen.queryByText(template.name)).not.toBeInTheDocument());
      expect(screen.queryByDisplayValue('Private unsaved template draft')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('form', { name: `Edit template ${template.code}`, hidden: true }),
      ).not.toBeInTheDocument();
      expect(api.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
    },
  );

  it('retains the mounted editor and unsaved input during a transient 503 refresh failure', async () => {
    let unavailable = false;
    api.mockImplementation(async () => {
      if (unavailable) throw new ApiError(503, 'Templates temporarily unavailable');
      return { templates: [template] };
    });
    render(<TaskTemplateEditor />);
    const form = await openDraft();
    const description = within(form).getByLabelText('Task description');
    unavailable = true;
    await act(async () => {
      fireEvent.focus(window);
    });
    await screen.findByRole('alert', { hidden: true });
    expect(screen.getByRole('form', { name: `Edit template ${template.code}` })).toBe(form);
    expect(within(form).getByLabelText('Task description')).toBe(description);
    expect(description).toHaveValue('Private unsaved template draft');
    expect(screen.getByText(template.name)).toBeInTheDocument();
    expect(api.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  });
});
