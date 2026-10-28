import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import { isTaskTemplateResponse } from '../lib/planning-guards';
import { planningTemplates } from '../test/planning-fixture';
import { deferred } from '../test/realtime-fixture';
import { TaskTemplateForm } from './task-template-form';

vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const api = vi.mocked(apiRequest);
const template = planningTemplates[0]!;
beforeEach(() => {
  api.mockReset();
});

function createFields() {
  fireEvent.change(screen.getByLabelText('Stable template code'), {
    target: { value: 'STAIR_CHECK' },
  });
  fireEvent.change(screen.getByLabelText('Task name'), { target: { value: '  Check stairs  ' } });
}

describe('Task template form', () => {
  it('creates the same public payload, confirms the canonical record and resets the creation form', async () => {
    const saved = vi.fn();
    const emitted = vi.spyOn(window, 'dispatchEvent');
    const record = { ...template, code: 'STAIR_CHECK', name: 'Check stairs' };
    api.mockResolvedValue({ template: record });
    render(<TaskTemplateForm onSaved={saved} />);
    createFields();
    fireEvent.change(screen.getByLabelText('Task description'), {
      target: { value: '  Inspect the access route  ' },
    });
    fireEvent.change(screen.getByLabelText('Applies to'), { target: { value: 'DELIVERY_ONLY' } });
    fireEvent.change(screen.getByLabelText('Default severity'), { target: { value: 'HIGH' } });
    fireEvent.change(screen.getByLabelText('Default priority'), { target: { value: '7' } });
    fireEvent.click(screen.getByLabelText('Required for new matching assignments'));
    fireEvent.submit(screen.getByRole('form', { name: 'Create task template' }));
    await screen.findByText('Task template created.');
    expect(api).toHaveBeenCalledWith('/task-templates', {
      method: 'POST',
      body: {
        code: 'STAIR_CHECK',
        name: 'Check stairs',
        description: 'Inspect the access route',
        active: true,
        required: true,
        severity: 'HIGH',
        defaultPriority: 7,
        applicability: 'DELIVERY_ONLY',
      },
      validate: isTaskTemplateResponse,
    });
    expect(saved).toHaveBeenCalledWith(record);
    expect(emitted.mock.calls.some(([event]) => event.type === 'fd:planning-changed')).toBe(true);
    expect(screen.getByLabelText('Task name')).toHaveValue('');
    expect(screen.getByLabelText('Stable template code')).toHaveValue('');
    expect(screen.getByLabelText('Template enabled')).toBeChecked();
    expect(screen.getByLabelText('Required for new matching assignments')).not.toBeChecked();
  });

  it('keeps the edit code readonly and excludes it from PATCH while preserving unchecked flags', async () => {
    const saved = vi.fn();
    api.mockResolvedValue({
      template: { ...template, name: 'Edited task', active: false, required: false },
    });
    render(<TaskTemplateForm template={template} onSaved={saved} />);
    expect(screen.getByLabelText('Stable template code')).toHaveAttribute('readonly');
    fireEvent.change(screen.getByLabelText('Task name'), { target: { value: 'Edited task' } });
    fireEvent.click(screen.getByLabelText('Template enabled'));
    fireEvent.click(screen.getByLabelText('Required for new matching assignments'));
    fireEvent.submit(screen.getByRole('form', { name: `Edit template ${template.code}` }));
    await screen.findByText('Task template updated. Existing assignment snapshots were preserved.');
    expect(api).toHaveBeenCalledWith(
      `/task-templates/${template.id}`,
      expect.objectContaining({
        method: 'PATCH',
        body: {
          name: 'Edited task',
          description: template.description,
          active: false,
          required: false,
          severity: template.severity,
          defaultPriority: template.defaultPriority,
          applicability: template.applicability,
        },
      }),
    );
    expect(api.mock.calls[0]![1]?.body).not.toHaveProperty('code');
    expect(screen.getByLabelText('Task name')).toHaveValue('Edited task');
  });

  it('retains failed input and permits an explicit retry without inventing an idempotency contract', async () => {
    const saved = vi.fn();
    api
      .mockRejectedValueOnce(new ApiError(500, 'Template service unavailable'))
      .mockResolvedValueOnce({ template });
    render(<TaskTemplateForm template={template} onSaved={saved} />);
    fireEvent.change(screen.getByLabelText('Task name'), {
      target: { value: 'Unsent edited task' },
    });
    const form = screen.getByRole('form', { name: `Edit template ${template.code}` });
    fireEvent.submit(form);
    expect(await screen.findByRole('alert')).toHaveTextContent('Template service unavailable');
    expect(screen.getByLabelText('Task name')).toHaveValue('Unsent edited task');
    expect(saved).not.toHaveBeenCalled();
    fireEvent.submit(form);
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(api.mock.calls[1]![1]?.body).toEqual(api.mock.calls[0]![1]?.body);
    expect(api.mock.calls[0]![1]?.body).not.toHaveProperty('idempotencyKey');
  });

  it('blocks a duplicate submission and cancellation while pending and reports pending to its owner', async () => {
    const waiting = deferred<unknown>();
    const pending = vi.fn();
    const cancel = vi.fn();
    api.mockReturnValue(waiting.promise);
    render(<TaskTemplateForm onSaved={vi.fn()} onPendingChange={pending} onCancel={cancel} />);
    createFields();
    const form = screen.getByRole('form', { name: 'Create task template' });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(api).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Task name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancel).not.toHaveBeenCalled();
    expect(pending).toHaveBeenLastCalledWith(true);
    await act(async () => waiting.resolve({ template }));
    await waitFor(() => expect(pending).toHaveBeenLastCalledWith(false));
    expect(screen.getByLabelText('Task name')).not.toBeDisabled();
  });

  it('preserves limits, defaults and accessible native fields in the three form sections', () => {
    const { container } = render(<TaskTemplateForm onSaved={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Task details' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Task defaults' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Where it applies' })).toBeInTheDocument();
    const code = screen.getByLabelText('Stable template code');
    expect(code).toHaveAttribute('minlength', '3');
    expect(code).toHaveAttribute('maxlength', '64');
    expect(code).toHaveAttribute('pattern', '[A-Z][A-Z0-9_-]{2,63}');
    expect(screen.getByLabelText('Task name')).toHaveAttribute('maxlength', '200');
    expect(screen.getByLabelText('Task description')).toHaveAttribute('maxlength', '4000');
    expect(screen.getByLabelText('Default priority')).toHaveAttribute('min', '0');
    expect(screen.getByLabelText('Default priority')).toHaveAttribute('max', '9999');
    expect(screen.getByLabelText('Default priority')).toHaveAttribute('step', '1');
    expect(screen.getByLabelText('Default severity')).toHaveValue('MEDIUM');
    expect(screen.getByLabelText('Applies to')).toHaveValue('ALL');
    expect(screen.getByRole('button', { name: 'Create task template' })).toHaveAttribute(
      'type',
      'submit',
    );
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(4);
    expect(api).not.toHaveBeenCalled();
  });

  it('does not rebase an open draft when the same saved template refreshes', async () => {
    api.mockResolvedValue({ template });
    const props = { onSaved: vi.fn(), template };
    const view = render(<TaskTemplateForm {...props} />);
    fireEvent.change(screen.getByLabelText('Task name'), { target: { value: 'My unsent name' } });
    view.rerender(
      <TaskTemplateForm
        {...props}
        template={{
          ...template,
          name: 'New server name',
          description: 'New server description',
          required: false,
          defaultPriority: 99,
        }}
      />,
    );
    expect(screen.getByLabelText('Task name')).toHaveValue('My unsent name');
    expect(screen.getByLabelText('Task description')).toHaveValue(template.description);
    expect(screen.getByLabelText('Required for new matching assignments')).toBeChecked();
    expect(screen.getByLabelText('Default priority')).toHaveValue(template.defaultPriority);
    fireEvent.submit(screen.getByRole('form', { name: `Edit template ${template.code}` }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    expect(api.mock.calls[0]![1]?.body).toMatchObject({
      name: 'My unsent name',
      description: template.description,
      required: true,
      defaultPriority: template.defaultPriority,
    });
  });

  it('opens a clean form for a different keyed template and keeps cancel separate from saving', () => {
    const cancel = vi.fn();
    const other = planningTemplates[1]!;
    const view = render(
      <TaskTemplateForm
        key={template.id}
        template={template}
        onSaved={vi.fn()}
        onCancel={cancel}
      />,
    );
    fireEvent.change(screen.getByLabelText('Task name'), { target: { value: 'Old unsent name' } });
    view.rerender(
      <TaskTemplateForm key={other.id} template={other} onSaved={vi.fn()} onCancel={cancel} />,
    );
    expect(screen.queryByDisplayValue('Old unsent name')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Task name')).toHaveValue(other.name);
    const form = screen.getByRole('form', { name: `Edit template ${other.code}` });
    fireEvent.click(within(form).getByRole('button', { name: 'Close' }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(api).not.toHaveBeenCalled();
  });

  it('ignores a late mutation response after unmount and releases the owner pending lock', async () => {
    const waiting = deferred<unknown>();
    const saved = vi.fn();
    const pending = vi.fn();
    const emitted = vi.spyOn(window, 'dispatchEvent');
    api.mockReturnValue(waiting.promise);
    const view = render(<TaskTemplateForm onSaved={saved} onPendingChange={pending} />);
    createFields();
    fireEvent.submit(screen.getByRole('form', { name: 'Create task template' }));
    expect(pending).toHaveBeenLastCalledWith(true);
    view.unmount();
    expect(pending).toHaveBeenLastCalledWith(false);
    await act(async () => waiting.resolve({ template }));
    expect(saved).not.toHaveBeenCalled();
    expect(emitted.mock.calls.some(([event]) => event.type === 'fd:planning-changed')).toBe(false);
  });
});
