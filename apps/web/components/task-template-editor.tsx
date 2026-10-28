'use client';

import type { TaskTemplateListResponse, TaskTemplateRecord } from '@furniture-delivery/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownWideNarrow,
  CheckCheck,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Flag,
  Layers,
  ListChecks,
  LockKeyhole,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Truck,
  Wrench,
} from 'lucide-react';
import { isTaskTemplateListResponse } from '../lib/planning-guards';
import { useApiResource } from '../lib/use-api-resource';
import { useRealtimeCoordinator } from '../lib/realtime-context';
import { useCurrentUser } from './session-provider';
import { TaskTemplateForm } from './task-template-form';
import {
  TaskTemplateFilters,
  initialTemplateFilters,
  type TemplateFilterValue,
} from './task-template-filters';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import './task-templates.css';

const EMPTY_TEMPLATES: TaskTemplateRecord[] = [];
const cell = 'tw:align-top tw:max-[1000px]:p-0';
const mobileLabel =
  'tw:mb-2 tw:hidden tw:text-[10px] tw:font-semibold tw:tracking-wide tw:text-[#71806a] tw:uppercase tw:max-[1000px]:block';
const applicability = {
  ALL: { label: 'All services', icon: Layers },
  DELIVERY_ONLY: { label: 'Delivery only', icon: Truck },
  DELIVERY_AND_ASSEMBLY: { label: 'Delivery & assembly', icon: Wrench },
};
type Selection = { mode: 'create' } | { mode: 'edit'; id: string };

function TemplateCatalog() {
  const live = useRealtimeCoordinator();
  const resource = useApiResource<TaskTemplateListResponse>(
    '/task-templates',
    isTaskTemplateListResponse,
    { retainDataOnRefresh: true },
  );
  const [filters, setFilters] = useState<TemplateFilterValue>(initialTemplateFilters);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [busy, setBusy] = useState(false);
  const [createdNotice, setCreatedNotice] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const data = resource.data;
  const templates = data?.templates ?? EMPTY_TEMPLATES;
  const selected =
    selection?.mode === 'edit'
      ? templates.find((template) => template.id === selection.id)
      : undefined;
  const open = Boolean(data && selection && (selection.mode === 'create' || selected));
  useEffect(() => {
    const refresh = () => void resource.refresh();
    if (live) return;
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [resource.refresh, live]);
  useEffect(() => {
    if (
      selection &&
      ((!data && !resource.pending) || (data && selection.mode === 'edit' && !selected))
    ) {
      setSelection(null);
      setBusy(false);
    }
  }, [data, resource.pending, selection, selected]);
  const summary = useMemo(
    () => ({
      enabled: templates.filter((template) => template.active).length,
      required: templates.filter((template) => template.active && template.required).length,
    }),
    [templates],
  );
  const filtered = useMemo(() => {
    const search = filters.search.toLocaleLowerCase('en-GB');
    return templates.filter(
      (template) =>
        (!search ||
          `${template.name} ${template.code} ${template.description}`
            .toLocaleLowerCase('en-GB')
            .includes(search)) &&
        (filters.status === 'all' || template.active === (filters.status === 'enabled')) &&
        (filters.required === 'all' || template.required === (filters.required === 'required')) &&
        (filters.applicability === 'all' || template.applicability === filters.applicability) &&
        (filters.severity === 'all' || template.severity === filters.severity),
    );
  }, [templates, filters]);
  function saved(template: TaskTemplateRecord) {
    resource.setData((current) => ({
      templates: [
        ...(current?.templates ?? []).filter((row) => row.id !== template.id),
        template,
      ].sort((a, b) => a.defaultPriority - b.defaultPriority || a.code.localeCompare(b.code)),
    }));
    setBusy(false);
    if (selection?.mode === 'create') {
      setCreatedNotice(true);
      setSelection(null);
    }
    void resource.refresh();
  }
  const errorNotice = resource.error && (
    <div className="tw:grid tw:justify-items-start tw:gap-3 tw:rounded-xl tw:border tw:border-solid tw:border-[#ead7cf] tw:bg-[#fcf3ee] tw:p-4">
      <p role="alert" className="tw:m-0 tw:text-sm tw:leading-relaxed tw:text-[#97372a]">
        {resource.error}
      </p>
      <Button variant="outline" onClick={() => void resource.refresh()}>
        Retry
      </Button>
    </div>
  );
  return (
    <div className="templates-theme tw:grid tw:min-w-0 tw:gap-6 tw:text-[#18372e]">
      <header className="tw:flex tw:flex-wrap tw:items-end tw:justify-between tw:gap-5">
        <div className="tw:min-w-0">
          <p className="tw:mt-0 tw:mb-3 tw:text-[10px] tw:font-bold tw:tracking-[1.8px] tw:text-[#226347] tw:uppercase">
            Planning configuration
          </p>
          <h1
            ref={heading}
            tabIndex={-1}
            className="tw:m-0 tw:text-[40px] tw:leading-[1.15] tw:font-medium tw:tracking-[-1.5px] tw:max-[600px]:text-[34px]"
          >
            Task templates
          </h1>
          <p className="tw:mt-3 tw:mb-0 tw:max-w-[620px] tw:text-sm tw:leading-relaxed tw:text-[#65716a]">
            Build a consistent checklist for new team assignments.
          </p>
        </div>
        <div className="tw:flex tw:flex-wrap tw:gap-2">
          <Button
            variant="outline"
            disabled={resource.pending}
            onClick={() => void resource.refresh()}
          >
            <RefreshCw aria-hidden="true" />
            Refresh templates
          </Button>
          <Button
            ref={createButton}
            disabled={!data}
            onClick={(event) => {
              returnFocus.current = event.currentTarget;
              setCreatedNotice(false);
              setSelection({ mode: 'create' });
            }}
          >
            <Plus aria-hidden="true" />
            Create a task template
          </Button>
        </div>
      </header>
      <section
        aria-label="Template overview"
        className="tw:grid tw:grid-cols-3 tw:gap-3 tw:max-[700px]:grid-cols-1"
      >
        {[
          {
            title: 'Total templates',
            hint: 'Full catalog, including disabled templates',
            value: data ? templates.length : undefined,
            icon: ClipboardList,
            tone: 'tw:bg-[#edf2e5] tw:text-[#557244]',
          },
          {
            title: 'Enabled templates',
            hint: 'Available for matching new assignments',
            value: data ? summary.enabled : undefined,
            icon: Power,
            tone: 'tw:bg-[#e6f0ed] tw:text-[#3b7766]',
          },
          {
            title: 'Required & enabled',
            hint: 'Included in matching new assignments',
            value: data ? summary.required : undefined,
            icon: ClipboardCheck,
            tone: 'tw:bg-[#fff1df] tw:text-[#a46b2a]',
          },
        ].map(({ title, hint, value, icon: Icon, tone }) => (
          <div
            key={title}
            className="tw:flex tw:min-w-0 tw:items-center tw:gap-4 tw:rounded-2xl tw:border tw:border-solid tw:border-[#e0e7d9] tw:bg-white tw:p-5"
          >
            <span
              className={`tw:flex tw:size-11 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-xl ${tone}`}
            >
              <Icon size={21} strokeWidth={1.75} aria-hidden="true" />
            </span>
            <div className="tw:min-w-0">
              <p className="tw:m-0 tw:text-xs tw:font-medium tw:text-[#65716a]">{title}</p>
              <p className="tw:my-1 tw:text-[26px] tw:leading-tight tw:font-medium tw:tabular-nums">
                {value ?? '—'}
              </p>
              <p className="tw:m-0 tw:text-[11px] tw:leading-relaxed tw:text-[#7a8871]">{hint}</p>
            </div>
          </div>
        ))}
      </section>
      <TaskTemplateFilters value={filters} onApply={setFilters} />
      {createdNotice && data && (
        <p
          role="status"
          className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:rounded-xl tw:border tw:border-solid tw:border-[#d4e4cb] tw:bg-[#eff6e9] tw:p-4 tw:text-xs tw:text-[#3b6240]"
        >
          <CheckCircle2 size={16} aria-hidden="true" />
          Task template created.
        </p>
      )}
      {!open && resource.pending && (
        <p role="status" className="tw:m-0 tw:text-xs tw:text-[#65716a]">
          {data ? 'Refreshing templates…' : 'Loading templates…'}
        </p>
      )}
      {!open && !resource.pending && errorNotice}
      {data && (
        <section
          aria-label="Template directory"
          className="tw:min-w-0 tw:overflow-hidden tw:rounded-2xl tw:border tw:border-solid tw:border-[#dce4d5] tw:bg-white"
        >
          <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:border-x-0 tw:border-t-0 tw:border-b tw:border-solid tw:border-[#e3e9dd] tw:px-5 tw:py-4">
            <div className="tw:flex tw:items-center tw:gap-2.5">
              <h2 className="tw:m-0 tw:text-sm tw:font-semibold">Checklist library</h2>
              <Badge variant="outline">{filtered.length}</Badge>
            </div>
            <p className="tw:m-0 tw:flex tw:items-center tw:gap-1.5 tw:text-[11px] tw:text-[#71806a]">
              <ArrowDownWideNarrow size={14} aria-hidden="true" />
              Priority, then code
            </p>
          </div>
          {filtered.length === 0 ? (
            <div className="tw:grid tw:justify-items-center tw:gap-3 tw:px-6 tw:py-14 tw:text-center">
              <span className="tw:flex tw:size-14 tw:items-center tw:justify-center tw:rounded-2xl tw:bg-[#f0f5e9] tw:text-[#6e8a5a]">
                <ListChecks size={26} aria-hidden="true" />
              </span>
              <h3 className="tw:m-0 tw:text-lg tw:font-medium">
                {templates.length ? 'No matching templates' : 'No task templates yet'}
              </h3>
              <p className="tw:m-0 tw:max-w-[410px] tw:text-sm tw:leading-relaxed tw:text-[#65716a]">
                {templates.length
                  ? 'Change your search or filters to see more templates.'
                  : 'Create a template before preparing assignment tasks.'}
              </p>
              {templates.length > 0 && (
                <Button variant="outline" onClick={() => setFilters(initialTemplateFilters)}>
                  Show all templates
                </Button>
              )}
            </div>
          ) : (
            <Table className="task-template-table tw:table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="tw:w-[35%]">Task template</TableHead>
                  <TableHead className="tw:w-[20%]">Applies to</TableHead>
                  <TableHead className="tw:w-[17%]">Defaults</TableHead>
                  <TableHead className="tw:w-[16%]">Availability</TableHead>
                  <TableHead className="tw:w-[12%]">Edit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((template) => {
                  const ServiceIcon = applicability[template.applicability].icon;
                  return (
                    <TableRow
                      key={template.id}
                      className="tw:max-[1000px]:border tw:max-[1000px]:border-solid tw:max-[1000px]:border-[#e1e8d9]"
                    >
                      <TableCell className={cell}>
                        <div className="tw:flex tw:min-w-0 tw:items-start tw:gap-3">
                          <span className="tw:mt-0.5 tw:flex tw:size-10 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-xl tw:bg-[#edf3e4] tw:text-[#648153]">
                            {template.required ? (
                              <ClipboardCheck size={19} aria-hidden="true" />
                            ) : (
                              <ListChecks size={19} aria-hidden="true" />
                            )}
                          </span>
                          <div className="tw:min-w-0">
                            <button
                              type="button"
                              aria-label={`Edit template ${template.code}`}
                              className="tw:block tw:w-full tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:text-[13px] tw:leading-relaxed tw:font-semibold tw:text-[#18372e] tw:hover:text-[#39714d] tw:wrap-anywhere"
                              onClick={(event) => {
                                returnFocus.current = event.currentTarget;
                                setCreatedNotice(false);
                                setSelection({ mode: 'edit', id: template.id });
                              }}
                            >
                              {template.name}
                            </button>
                            <p className="tw:mt-1.5 tw:mb-0 tw:font-mono tw:text-[10px] tw:leading-relaxed tw:text-[#7a8871] tw:wrap-anywhere">
                              {template.code}
                            </p>
                            <p className="tw:mt-2 tw:mb-0 tw:line-clamp-2 tw:whitespace-pre-wrap tw:text-[11px] tw:leading-relaxed tw:text-[#71806a] tw:wrap-anywhere">
                              {template.description || 'No description provided.'}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className={cell}>
                        <span className={mobileLabel}>Applies to</span>
                        <p className="tw:mt-0 tw:mb-0 tw:flex tw:items-start tw:gap-2 tw:text-xs tw:leading-relaxed tw:text-[#52654f]">
                          <ServiceIcon
                            size={15}
                            className="tw:mt-0.5 tw:shrink-0"
                            aria-hidden="true"
                          />
                          {applicability[template.applicability].label}
                        </p>
                      </TableCell>
                      <TableCell className={cell}>
                        <span className={mobileLabel}>Defaults</span>
                        <div className="tw:grid tw:justify-items-start tw:gap-2">
                          <Badge
                            variant={
                              template.severity === 'HIGH'
                                ? 'warning'
                                : template.severity === 'LOW'
                                  ? 'outline'
                                  : 'secondary'
                            }
                          >
                            <ShieldAlert size={13} className="tw:size-[13px]" aria-hidden="true" />
                            {template.severity === 'HIGH'
                              ? 'High'
                              : template.severity === 'LOW'
                                ? 'Low'
                                : 'Medium'}{' '}
                            severity
                          </Badge>
                          <span className="tw:flex tw:items-center tw:gap-1.5 tw:text-[11px] tw:text-[#71806a]">
                            <Flag size={13} aria-hidden="true" />
                            Priority {template.defaultPriority}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className={cell}>
                        <span className={mobileLabel}>Availability</span>
                        <div className="tw:flex tw:flex-wrap tw:gap-2">
                          <Badge variant={template.active ? 'success' : 'outline'}>
                            <Power size={13} className="tw:size-[13px]" aria-hidden="true" />
                            {template.active ? 'Enabled' : 'Disabled'}
                          </Badge>
                          <Badge variant={template.required ? 'default' : 'secondary'}>
                            {template.required ? (
                              <CheckCheck size={13} className="tw:size-[13px]" aria-hidden="true" />
                            ) : (
                              <Sparkles size={13} className="tw:size-[13px]" aria-hidden="true" />
                            )}
                            {template.required ? 'Required' : 'Optional'}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className={cell}>
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Edit ${template.code} settings`}
                          onClick={(event) => {
                            returnFocus.current = event.currentTarget;
                            setCreatedNotice(false);
                            setSelection({ mode: 'edit', id: template.id });
                          }}
                        >
                          <Pencil aria-hidden="true" />
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <footer className="tw:border-x-0 tw:border-b-0 tw:border-t tw:border-solid tw:border-[#e3e9dd] tw:px-5 tw:py-4 tw:text-[11px] tw:leading-relaxed tw:text-[#71806a]">
            Showing {filtered.length} of {templates.length} templates · Search and filters apply to
            the full catalog.
          </footer>
        </section>
      )}
      <div className="tw:flex tw:items-start tw:gap-3 tw:rounded-xl tw:border tw:border-solid tw:border-[#e2e7d9] tw:bg-[#f5f8ef] tw:p-4">
        <LockKeyhole
          size={18}
          className="tw:mt-0.5 tw:shrink-0 tw:text-[#6d865a]"
          aria-hidden="true"
        />
        <p className="tw:m-0 tw:text-[11px] tw:leading-relaxed tw:text-[#65716a]">
          Required matching templates are included by the server in new assignments. Changes here
          never rewrite prepared task snapshots or add tasks to existing assignments. Disable a
          template to stop future use while keeping its history.
        </p>
      </div>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next && !busy) setSelection(null);
        }}
      >
        {open && selection && (
          <SheetContent
            className="templates-theme tw:max-w-[650px]"
            closeLabel="Close template editor"
            closeDisabled={busy}
            onEscapeKeyDown={(event) => {
              if (busy) event.preventDefault();
            }}
            onInteractOutside={(event) => {
              if (busy) event.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (
                returnFocus.current?.isConnected &&
                !(returnFocus.current instanceof HTMLButtonElement && returnFocus.current.disabled)
              )
                returnFocus.current.focus();
              else if (createButton.current && !createButton.current.disabled)
                createButton.current.focus();
              else heading.current?.focus();
            }}
          >
            <SheetHeader>
              <p className="tw:mt-0 tw:mb-1 tw:flex tw:items-center tw:gap-2 tw:text-[10px] tw:font-bold tw:tracking-[1.5px] tw:text-[#7a8871] tw:uppercase">
                <ClipboardList size={14} aria-hidden="true" />
                Checklist library
              </p>
              <SheetTitle>
                {selection.mode === 'create' ? 'Create task template' : 'Edit task template'}
              </SheetTitle>
              <SheetDescription>
                Set defaults for future assignments. Existing task snapshots keep their saved
                values.
              </SheetDescription>
            </SheetHeader>
            {resource.pending && (
              <p role="status" className="tw:m-0 tw:text-xs tw:text-[#65716a]">
                Refreshing template catalog…
              </p>
            )}
            {!resource.pending && errorNotice}
            <TaskTemplateForm
              key={selection.mode === 'create' ? 'create' : selection.id}
              template={selection.mode === 'edit' ? selected : undefined}
              onSaved={saved}
              onPendingChange={setBusy}
              onCancel={() => setSelection(null)}
            />
          </SheetContent>
        )}
      </Sheet>
    </div>
  );
}
export function TaskTemplateEditor() {
  const user = useCurrentUser();
  if (user.role !== 'ADMIN' && user.role !== 'DISPATCHER')
    return <p role="alert">Access denied. Task templates are available to backoffice users.</p>;
  return <TemplateCatalog />;
}
