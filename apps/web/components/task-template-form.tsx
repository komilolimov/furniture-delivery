'use client';

import type { TaskTemplateRecord, TaskTemplateResponse } from '@furniture-delivery/contracts';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ClipboardList, Layers, ListOrdered, Save, ShieldCheck, Sparkles } from 'lucide-react';
import { apiRequest, describeError } from '../lib/api-client';
import { isTaskTemplateResponse } from '../lib/planning-guards';
import { DraftChangeNotice } from './draft-change-notice';
import { Feedback } from './form-parts';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { NativeSelect } from './ui/native-select';
import { Textarea } from './ui/textarea';

const field = 'tw:grid tw:min-w-0 tw:gap-2 tw:text-xs tw:font-semibold tw:text-[#52654f]';
const hint = 'tw:m-0 tw:text-[11px] tw:leading-relaxed tw:font-normal tw:text-[#73816b]';
const heading = 'tw:m-0 tw:flex tw:items-center tw:gap-2 tw:text-sm tw:font-semibold';
const paths = ['/task-templates'];

export function TaskTemplateForm({
  template,
  onSaved,
  onPendingChange,
  onCancel,
}: Readonly<{
  template?: TaskTemplateRecord;
  onSaved: (template: TaskTemplateRecord) => void;
  onPendingChange?: (pending: boolean) => void;
  onCancel?: () => void;
}>) {
  // The owning drawer keys by ID/create; refresh must not rebase an open editor.
  const [base] = useState(template);
  const id = useId();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const pendingCallback = useRef(onPendingChange);
  pendingCallback.current = onPendingChange;
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingCallback.current?.(false);
    };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    busy.current = true;
    setPending(true);
    pendingCallback.current?.(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await apiRequest<TaskTemplateResponse>(
        `/task-templates${base ? '/' + base.id : ''}`,
        {
          method: base ? 'PATCH' : 'POST',
          body: {
            ...(!base ? { code: String(data.get('code') ?? '').trim() } : {}),
            name: String(data.get('name') ?? '').trim(),
            description: String(data.get('description') ?? '').trim(),
            active: data.get('active') === 'on',
            required: data.get('required') === 'on',
            severity: String(data.get('severity') ?? 'MEDIUM'),
            defaultPriority: Number(data.get('defaultPriority')),
            applicability: String(data.get('applicability') ?? 'ALL'),
          },
          validate: isTaskTemplateResponse,
        },
      );
      if (!mounted.current) return;
      if (!base) form.reset();
      setSuccess(
        base
          ? 'Task template updated. Existing assignment snapshots were preserved.'
          : 'Task template created.',
      );
      onSaved(response.template);
      window.dispatchEvent(new Event('fd:planning-changed'));
    } catch (failure) {
      if (mounted.current) setError(describeError(failure));
    } finally {
      busy.current = false;
      if (mounted.current) {
        setPending(false);
        pendingCallback.current?.(false);
      }
    }
  }

  return (
    <form
      className="task-template-form tw:grid tw:min-w-0 tw:gap-6"
      aria-label={base ? `Edit template ${base.code}` : 'Create task template'}
      onSubmit={(event) => void save(event)}
    >
      <DraftChangeNotice paths={paths} />
      <fieldset
        disabled={pending}
        className="tw:m-0 tw:grid tw:min-w-0 tw:gap-6 tw:border-0 tw:p-0"
      >
        <section aria-labelledby={`${id}-identity`} className="tw:grid tw:min-w-0 tw:gap-4">
          <h3 id={`${id}-identity`} className={heading}>
            <ClipboardList size={17} aria-hidden="true" className="tw:text-[#69835e]" />
            Task details
          </h3>
          <label className={field} htmlFor={`${id}-code`}>
            Stable template code
            <Input
              id={`${id}-code`}
              name={base ? undefined : 'code'}
              required={!base}
              minLength={3}
              maxLength={64}
              pattern="[A-Z][A-Z0-9_-]{2,63}"
              autoCapitalize="characters"
              spellCheck={false}
              defaultValue={base?.code}
              readOnly={!!base}
              autoComplete="off"
              aria-describedby={`${id}-code-help`}
              className={base ? 'tw:bg-[#f4f7ef] tw:text-[#73816b]' : undefined}
            />
          </label>
          <p id={`${id}-code-help`} className={hint}>
            {base
              ? 'This code stays unchanged. Edit the task details below.'
              : 'Use 3–64 characters: uppercase letters, numbers, hyphens or underscores. Start with a letter.'}
          </p>
          <label className={field} htmlFor={`${id}-name`}>
            Task name
            <Input
              id={`${id}-name`}
              name="name"
              required
              maxLength={200}
              defaultValue={base?.name}
              placeholder="For example, check furniture condition"
            />
          </label>
          <label className={field} htmlFor={`${id}-description`}>
            Task description
            <Textarea
              id={`${id}-description`}
              name="description"
              maxLength={4000}
              rows={4}
              defaultValue={base?.description}
              placeholder="Explain what the team should check or do."
            />
          </label>
        </section>

        <section
          aria-labelledby={`${id}-defaults`}
          className="tw:grid tw:min-w-0 tw:gap-4 tw:border-x-0 tw:border-b-0 tw:border-t tw:border-solid tw:border-[#e2e8db] tw:pt-5"
        >
          <h3 id={`${id}-defaults`} className={heading}>
            <ListOrdered size={17} aria-hidden="true" className="tw:text-[#69835e]" />
            Task defaults
          </h3>
          <p className={hint}>
            Severity highlights importance. Priority controls the default order of tasks.
          </p>
          <div className="tw:grid tw:min-w-0 tw:grid-cols-2 tw:gap-4 tw:max-[420px]:grid-cols-1">
            <label className={field} htmlFor={`${id}-severity`}>
              Default severity
              <NativeSelect
                id={`${id}-severity`}
                name="severity"
                defaultValue={base?.severity ?? 'MEDIUM'}
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
              </NativeSelect>
            </label>
            <label className={field} htmlFor={`${id}-priority`}>
              Default priority
              <Input
                id={`${id}-priority`}
                name="defaultPriority"
                type="number"
                required
                min={0}
                max={9999}
                step={1}
                defaultValue={base?.defaultPriority ?? 0}
                aria-describedby={`${id}-priority-help`}
              />
            </label>
          </div>
          <p id={`${id}-priority-help`} className={hint}>
            Use a whole number from 0 to 9999. Lower numbers appear first.
          </p>
        </section>

        <section
          aria-labelledby={`${id}-usage`}
          className="tw:grid tw:min-w-0 tw:gap-4 tw:border-x-0 tw:border-b-0 tw:border-t tw:border-solid tw:border-[#e2e8db] tw:pt-5"
        >
          <h3 id={`${id}-usage`} className={heading}>
            <Layers size={17} aria-hidden="true" className="tw:text-[#69835e]" />
            Where it applies
          </h3>
          <label className={field} htmlFor={`${id}-applicability`}>
            Applies to
            <NativeSelect
              id={`${id}-applicability`}
              name="applicability"
              defaultValue={base?.applicability ?? 'ALL'}
            >
              <option value="ALL">All services</option>
              <option value="DELIVERY_ONLY">Delivery only</option>
              <option value="DELIVERY_AND_ASSEMBLY">Delivery and assembly</option>
            </NativeSelect>
          </label>
          <div className="tw:grid tw:gap-4 tw:rounded-xl tw:border tw:border-solid tw:border-[#dfe7d7] tw:bg-[#f6f9f1] tw:p-4">
            <label
              className="tw:flex tw:min-h-11 tw:min-w-0 tw:cursor-pointer tw:items-start tw:gap-3 tw:text-xs tw:leading-relaxed tw:font-medium tw:text-[#405b40]"
              htmlFor={`${id}-required`}
            >
              <input
                id={`${id}-required`}
                name="required"
                type="checkbox"
                defaultChecked={base?.required ?? false}
                className="tw:mt-0.5 tw:size-4 tw:min-h-4 tw:shrink-0 tw:p-0 tw:accent-[#416b43]"
              />
              Required for new matching assignments
            </label>
            <label
              className="tw:flex tw:min-h-11 tw:min-w-0 tw:cursor-pointer tw:items-start tw:gap-3 tw:text-xs tw:leading-relaxed tw:font-medium tw:text-[#405b40]"
              htmlFor={`${id}-active`}
            >
              <input
                id={`${id}-active`}
                name="active"
                type="checkbox"
                defaultChecked={base?.active ?? true}
                className="tw:mt-0.5 tw:size-4 tw:min-h-4 tw:shrink-0 tw:p-0 tw:accent-[#416b43]"
              />
              Template enabled
            </label>
          </div>
          <p className={hint}>
            Enabled, required templates are included in new matching assignments. Disabling keeps
            this template in history and stops future use.
          </p>
        </section>
      </fieldset>
      <div className="tw:flex tw:items-start tw:gap-2.5 tw:rounded-xl tw:bg-[#eef4e8] tw:p-4">
        <ShieldCheck
          size={17}
          aria-hidden="true"
          className="tw:mt-0.5 tw:shrink-0 tw:text-[#6d865a]"
        />
        <p className="tw:m-0 tw:text-[11px] tw:leading-relaxed tw:text-[#65765c]">
          Changes apply to future assignments. Existing task snapshots keep their saved names,
          requirements and results.
        </p>
      </div>
      <Feedback error={error} success={success} />
      <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-3 tw:border-x-0 tw:border-b-0 tw:border-t tw:border-solid tw:border-[#e2e8db] tw:pt-5">
        {onCancel && (
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            {base ? 'Close' : 'Cancel'}
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {base ? <Save aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
          {pending ? 'Saving…' : base ? 'Save task template' : 'Create task template'}
        </Button>
      </div>
    </form>
  );
}
