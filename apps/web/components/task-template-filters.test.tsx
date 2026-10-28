import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseSelectOption } from '../test/select-option';
import {
  initialTemplateFilters,
  TaskTemplateFilters,
  type TemplateFilterValue,
} from './task-template-filters';
const applied = vi.fn();
function Harness({
  initial = initialTemplateFilters,
}: Readonly<{ initial?: TemplateFilterValue }>) {
  const [value, setValue] = useState(initial);
  return (
    <TaskTemplateFilters
      value={value}
      onApply={(next) => {
        applied(next);
        setValue(next);
      }}
    />
  );
}
async function openFilters() {
  fireEvent.click(screen.getByRole('button', { name: 'Filter templates' }));
  return screen.findByRole('dialog', { name: 'Template filters' });
}
async function dismiss() {
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Template filters' })).not.toBeInTheDocument(),
  );
}
beforeEach(() => {
  applied.mockReset();
});
describe('Task template catalog filters', () => {
  it('submits normalized search explicitly without changing committed advanced criteria', () => {
    const initial: TemplateFilterValue = {
      ...initialTemplateFilters,
      status: 'enabled',
      severity: 'HIGH',
    };
    render(<Harness initial={initial} />);
    const input = screen.getByRole('textbox', { name: 'Search templates' });
    fireEvent.change(input, { target: { value: '  Hinge inspection  ' } });
    expect(applied).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Search templates' }));
    expect(applied).toHaveBeenCalledExactlyOnceWith({ ...initial, search: 'Hinge inspection' });
    expect(input).toHaveValue('Hinge inspection');
  });
  it('applies all advanced choices without committing an unfinished search draft', async () => {
    const initial = { ...initialTemplateFilters, search: 'Saved criteria' };
    render(<Harness initial={initial} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search templates' }), {
      target: { value: 'Unsent criteria' },
    });
    const panel = await openFilters();
    await chooseSelectOption('Template status', 'Disabled');
    await chooseSelectOption('Task requirement', 'Required');
    await chooseSelectOption('Service applicability', 'All-service templates');
    await chooseSelectOption('Template severity', 'High');
    expect(applied).not.toHaveBeenCalled();
    fireEvent.submit(within(panel).getByRole('form', { name: 'Template filters' }));
    expect(applied).toHaveBeenCalledExactlyOnceWith({
      search: 'Saved criteria',
      status: 'disabled',
      required: 'required',
      applicability: 'ALL',
      severity: 'HIGH',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: 'Search templates' })).toHaveValue(
      'Unsent criteria',
    );
    expect(
      within(screen.getByRole('button', { name: 'Filter templates' })).getByText('4'),
    ).toBeInTheDocument();
  });
  it('discards advanced drafts on Escape and Close and returns focus while preserving unsent search', async () => {
    const initial: TemplateFilterValue = { ...initialTemplateFilters, status: 'enabled' };
    render(<Harness initial={initial} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search templates' }), {
      target: { value: 'Unsent task' },
    });
    const trigger = screen.getByRole('button', { name: 'Filter templates' });
    trigger.focus();
    await openFilters();
    await chooseSelectOption('Template status', 'Disabled');
    await dismiss();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(applied).not.toHaveBeenCalled();
    const panel = await openFilters();
    expect(within(panel).getByRole('combobox', { name: 'Template status' })).toHaveTextContent(
      'Enabled',
    );
    await chooseSelectOption('Task requirement', 'Optional');
    fireEvent.click(within(panel).getByRole('button', { name: 'Close template filters' }));
    expect(applied).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Search templates' })).toHaveValue('Unsent task');
    fireEvent.submit(screen.getByRole('search', { name: 'Search templates' }));
    expect(applied).toHaveBeenCalledExactlyOnceWith({ ...initial, search: 'Unsent task' });
  });
  it('keeps reset local until Apply and distinguishes any applicability from all-service templates', async () => {
    const initial: TemplateFilterValue = {
      search: 'Saved task',
      status: 'disabled',
      required: 'required',
      applicability: 'ALL',
      severity: 'HIGH',
    };
    render(<Harness initial={initial} />);
    const panel = await openFilters();
    expect(
      within(panel).getByRole('combobox', { name: 'Service applicability' }),
    ).toHaveTextContent('All-service templates');
    fireEvent.click(within(panel).getByRole('button', { name: 'Reset selection' }));
    expect(
      within(panel).getByRole('combobox', { name: 'Service applicability' }),
    ).toHaveTextContent('Any service applicability');
    expect(within(panel).getByRole('combobox', { name: 'Task requirement' })).toHaveTextContent(
      'Any requirement',
    );
    expect(applied).not.toHaveBeenCalled();
    fireEvent.submit(within(panel).getByRole('form', { name: 'Template filters' }));
    expect(applied).toHaveBeenCalledExactlyOnceWith({
      ...initialTemplateFilters,
      search: 'Saved task',
    });
  });
  it('removes one applied criterion independently and clears all committed criteria and drafts explicitly', () => {
    const initial: TemplateFilterValue = {
      search: 'Inspection',
      status: 'enabled',
      required: 'required',
      applicability: 'DELIVERY_ONLY',
      severity: 'LOW',
    };
    render(<Harness initial={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove template service filter' }));
    expect(applied).toHaveBeenLastCalledWith({ ...initial, applicability: 'all' });
    expect(
      screen.getByRole('button', { name: 'Remove template severity filter' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove template search filter' }));
    expect(screen.getByRole('textbox', { name: 'Search templates' })).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search templates' }), {
      target: { value: 'Unsent search' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clear template filters' }));
    expect(applied).toHaveBeenLastCalledWith(initialTemplateFilters);
    expect(screen.getByRole('textbox', { name: 'Search templates' })).toHaveValue('');
    expect(screen.queryByLabelText('Applied template filters')).not.toBeInTheDocument();
  });
  it('preserves unsaved drafts during background rerender and adopts an explicit parent search clear', async () => {
    const initial = { ...initialTemplateFilters, search: 'Saved task' };
    const view = render(<TaskTemplateFilters value={initial} onApply={applied} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search templates' }), {
      target: { value: 'Unsent updated task' },
    });
    const panel = await openFilters();
    await chooseSelectOption('Template severity', 'Medium');
    view.rerender(<TaskTemplateFilters value={{ ...initial }} onApply={applied} />);
    expect(within(panel).getByRole('combobox', { name: 'Template severity' })).toHaveTextContent(
      'Medium',
    );
    expect(applied).not.toHaveBeenCalled();
    await dismiss();
    expect(screen.getByRole('textbox', { name: 'Search templates' })).toHaveValue(
      'Unsent updated task',
    );
    view.rerender(<TaskTemplateFilters value={{ ...initialTemplateFilters }} onApply={applied} />);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Search templates' })).toHaveValue(''),
    );
    expect(applied).not.toHaveBeenCalled();
  });
});
