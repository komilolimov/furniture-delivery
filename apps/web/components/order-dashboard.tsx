'use client';

import { RotateCw } from 'lucide-react';
import type { DashboardResponse } from '@furniture-delivery/contracts';
import type { CSSProperties } from 'react';
import { useId } from 'react';
import Link from 'next/link';
import { isDashboardResponse } from '../lib/order-guards';
import { formatCents } from '../lib/money';
import { useOrderResource } from '../lib/use-order-resource';
import { orderProgressLabel } from '../lib/execution-labels';

// Literal utilities keep Tailwind's source detection complete, including responsive states.
const styles = {
  root: 'tw:grid tw:min-w-0 tw:gap-7 tw:pt-2.5 tw:text-[#18372e] tw:max-[600px]:gap-[23px] tw:max-[600px]:pt-0 tw:[&_a:focus-visible]:outline-solid tw:[&_a:focus-visible]:outline-[3px] tw:[&_a:focus-visible]:outline-[#739b74] tw:[&_a:focus-visible]:outline-offset-[5px] tw:[&_button:focus-visible]:outline-solid tw:[&_button:focus-visible]:outline-[3px] tw:[&_button:focus-visible]:outline-[#739b74] tw:[&_button:focus-visible]:outline-offset-[5px]',
  header:
    'tw:flex tw:min-w-0 tw:items-end tw:justify-between tw:gap-6 tw:pt-2.5 tw:pb-1 tw:max-[1000px]:items-start tw:max-[600px]:flex-col tw:max-[600px]:gap-5 tw:max-[600px]:pt-1 tw:[&>div]:min-w-0',
  eyebrow:
    'tw:mt-0 tw:mb-3 tw:text-[10px] tw:leading-[1.5] tw:font-bold tw:tracking-[1.8px] tw:text-[#226347] tw:uppercase',
  title:
    'tw:m-0 tw:text-[clamp(32px,3.5vw,44px)] tw:leading-[1.12] tw:font-medium tw:tracking-[-1.8px] tw:max-[600px]:text-[35px] tw:max-[600px]:tracking-[-1.5px]',
  subtitle:
    'tw:mt-3 tw:mb-0 tw:max-w-[550px] tw:text-[13px] tw:leading-[1.7] tw:text-[#65716a] tw:max-[600px]:text-xs',
  actions:
    'tw:flex tw:shrink-0 tw:flex-wrap tw:items-center tw:justify-end tw:gap-2.5 tw:max-[1000px]:max-w-[220px] tw:max-[600px]:w-full tw:max-[600px]:max-w-none tw:max-[600px]:justify-start tw:[&_svg]:size-4 tw:[&_svg]:shrink-0 tw:[&>a]:gap-2 tw:[&>button]:gap-2 tw:[&>a]:rounded-[9px] tw:[&>button]:rounded-[9px] tw:[&>a]:px-[15px] tw:[&>button]:px-[15px] tw:max-[600px]:[&>a]:flex-[1_1_auto] tw:max-[600px]:[&>button]:flex-[1_1_auto]',
  secondaryButton:
    'tw:inline-flex tw:min-h-11 tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-[7px] tw:border tw:border-solid tw:border-[#cbd4c7] tw:bg-white tw:px-[17px] tw:py-[11px] tw:text-xs tw:leading-normal tw:font-bold tw:text-[#18372e] tw:no-underline tw:enabled:hover:bg-[#f1f3ee] tw:disabled:cursor-wait tw:disabled:opacity-60',
  primaryButton:
    'tw:inline-flex tw:min-h-11 tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-[7px] tw:border tw:border-solid tw:border-[#18372e] tw:bg-[#18372e] tw:px-[17px] tw:py-[11px] tw:text-xs tw:leading-normal tw:font-bold tw:text-white tw:no-underline tw:hover:bg-[#2b5142] tw:disabled:cursor-wait tw:disabled:opacity-60',
  notice: 'tw:m-0 tw:text-sm tw:leading-relaxed tw:text-[#65716a]',
  errorNotice: 'tw:grid tw:justify-items-start tw:gap-3',
  error:
    'tw:m-0 tw:w-full tw:rounded-[7px] tw:bg-[#fff0ed] tw:p-3 tw:text-xs tw:leading-[1.6] tw:text-[#97372a] tw:[overflow-wrap:anywhere]',
  metrics:
    'tw:grid tw:min-w-0 tw:grid-cols-4 tw:gap-4 tw:max-[850px]:grid-cols-2 tw:max-[600px]:gap-3 tw:max-[360px]:grid-cols-1',
  kpi: 'tw:flex tw:min-w-0 tw:flex-col tw:rounded-2xl tw:border tw:border-solid tw:border-[#e0e5da] tw:bg-[#fffefa] tw:px-[23px] tw:pt-[23px] tw:pb-[21px] tw:text-[#18372e] tw:no-underline tw:shadow-[0_4px_14px_#18372e03] tw:hover:border-[#a8bda7] tw:hover:shadow-[0_6px_18px_#18372e08] tw:max-[1000px]:p-5 tw:max-[600px]:px-4 tw:max-[600px]:py-[18px]',
  kpiFeatured:
    'tw:flex tw:min-w-0 tw:flex-col tw:rounded-2xl tw:border tw:border-solid tw:border-[#183d30] tw:bg-[#183d30] tw:px-[23px] tw:pt-[23px] tw:pb-[21px] tw:text-[#f8faf4] tw:no-underline tw:shadow-[0_7px_20px_#18372e10] tw:hover:border-[#335c45] tw:hover:bg-[#204735] tw:max-[1000px]:p-5 tw:max-[600px]:px-4 tw:max-[600px]:py-[18px]',
  kpiAmber:
    'tw:flex tw:min-w-0 tw:flex-col tw:rounded-2xl tw:border tw:border-solid tw:border-[#e9e1cd] tw:bg-[#fffcf5] tw:px-[23px] tw:pt-[23px] tw:pb-[21px] tw:text-[#18372e] tw:no-underline tw:shadow-[0_4px_14px_#18372e03] tw:hover:border-[#a8bda7] tw:hover:shadow-[0_6px_18px_#18372e08] tw:max-[1000px]:p-5 tw:max-[600px]:px-4 tw:max-[600px]:py-[18px]',
  kpiTop:
    'tw:flex tw:min-w-0 tw:items-center tw:justify-between tw:gap-3 tw:text-[11px] tw:leading-[1.5] tw:font-bold tw:text-[#65716a] tw:max-[600px]:gap-2 tw:max-[600px]:text-[10px]',
  kpiTopFeatured:
    'tw:flex tw:min-w-0 tw:items-center tw:justify-between tw:gap-3 tw:text-[11px] tw:leading-[1.5] tw:font-bold tw:text-[#d7e5d6] tw:max-[600px]:gap-2 tw:max-[600px]:text-[10px]',
  icon: 'tw:inline-flex tw:size-[35px] tw:shrink-0 tw:items-center tw:justify-center tw:rounded-[10px] tw:border tw:border-solid tw:border-[#e4e9df] tw:bg-[#f1f5ed] tw:text-[#526d53] tw:max-[600px]:size-[30px] tw:max-[600px]:rounded-[9px]',
  iconFeatured:
    'tw:inline-flex tw:size-[35px] tw:shrink-0 tw:items-center tw:justify-center tw:rounded-[10px] tw:border tw:border-solid tw:border-[#ffffff16] tw:bg-[#ffffff0e] tw:text-[#dfebd9] tw:max-[600px]:size-[30px] tw:max-[600px]:rounded-[9px]',
  iconMint:
    'tw:inline-flex tw:size-[35px] tw:shrink-0 tw:items-center tw:justify-center tw:rounded-[10px] tw:border tw:border-solid tw:border-[#d9e8d5] tw:bg-[#eaf3e6] tw:text-[#3d6948] tw:max-[600px]:size-[30px] tw:max-[600px]:rounded-[9px]',
  iconAmber:
    'tw:inline-flex tw:size-[35px] tw:shrink-0 tw:items-center tw:justify-center tw:rounded-[10px] tw:border tw:border-solid tw:border-[#efe3c7] tw:bg-[#fbf0d9] tw:text-[#9a692d] tw:max-[600px]:size-[30px] tw:max-[600px]:rounded-[9px]',
  kpiValue:
    'tw:mt-[25px] tw:block tw:text-[clamp(27px,3vw,38px)] tw:leading-[1.15] tw:font-medium tw:tracking-[-1.7px] tw:tabular-nums tw:[overflow-wrap:anywhere] tw:max-[600px]:mt-5 tw:max-[600px]:text-[30px] tw:max-[600px]:tracking-[-1.3px] tw:max-[360px]:text-[35px]',
  kpiCopy: 'tw:mt-2.5 tw:block tw:text-[10px] tw:leading-[1.65] tw:text-[#65716a]',
  kpiCopyFeatured: 'tw:mt-2.5 tw:block tw:text-[10px] tw:leading-[1.65] tw:text-[#bbceba]',
  insights:
    'tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)] tw:items-stretch tw:gap-[22px] tw:max-[850px]:grid-cols-1',
  panel:
    'tw:min-w-0 tw:rounded-[18px] tw:border tw:border-solid tw:border-[#e0e5da] tw:bg-[#fffefa] tw:px-7 tw:py-[27px] tw:max-[1000px]:p-6 tw:max-[600px]:rounded-2xl tw:max-[600px]:px-5 tw:max-[600px]:py-[22px]',
  payments:
    'tw:flex tw:min-w-0 tw:flex-col tw:rounded-[18px] tw:border tw:border-solid tw:border-[#183d30] tw:bg-[#183d30] tw:px-7 tw:py-[27px] tw:text-[#f6f8ef] tw:max-[1000px]:p-6 tw:max-[850px]:grid tw:max-[850px]:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] tw:max-[850px]:gap-x-[30px] tw:max-[600px]:flex tw:max-[600px]:rounded-2xl tw:max-[600px]:px-5 tw:max-[600px]:py-[22px]',
  panelHeading:
    'tw:flex tw:min-w-0 tw:items-start tw:justify-between tw:gap-4 tw:max-[600px]:gap-3',
  kicker:
    'tw:mt-0 tw:mb-2 tw:text-[9px] tw:leading-[1.5] tw:font-bold tw:tracking-[1.2px] tw:text-[#65716a] tw:uppercase',
  kickerPayment:
    'tw:mt-0 tw:mb-2 tw:text-[9px] tw:leading-[1.5] tw:font-bold tw:tracking-[1.2px] tw:text-[#b7c9b5] tw:uppercase',
  panelTitle:
    'tw:m-0 tw:text-[19px] tw:leading-[1.3] tw:font-medium tw:tracking-[-0.6px] tw:max-[600px]:text-[18px]',
  scope:
    'tw:inline-flex tw:h-fit tw:w-fit tw:max-w-full tw:items-center tw:gap-[7px] tw:rounded-[30px] tw:border tw:border-solid tw:border-[#dce2d7] tw:bg-[#fafbf7] tw:px-[11px] tw:py-[7px] tw:text-[10px] tw:leading-[1.5] tw:font-bold tw:text-[#647265] tw:[overflow-wrap:anywhere]',
  flowChart: 'tw:m-0 tw:min-w-0',
  flowSummary: 'tw:mt-[22px] tw:mb-[9px] tw:flex tw:flex-wrap tw:items-baseline tw:gap-3',
  flowTotal:
    'tw:text-[39px] tw:leading-[1.1] tw:font-medium tw:tracking-[-1.5px] tw:tabular-nums tw:[overflow-wrap:anywhere]',
  flowSummaryLabel: 'tw:text-[11px] tw:leading-[1.5] tw:text-[#65716a]',
  flowLegend: 'tw:flex tw:flex-wrap tw:gap-3 tw:text-[9px] tw:leading-[1.6] tw:text-[#667461]',
  flowBars: 'tw:mt-[17px] tw:grid tw:gap-[5px]',
  flowRow:
    'tw:grid tw:min-h-11 tw:min-w-0 tw:grid-cols-[minmax(135px,0.85fr)_minmax(0,1fr)_minmax(24px,auto)] tw:items-center tw:gap-[14px] tw:rounded-[7px] tw:py-[5px] tw:text-[#18372e] tw:no-underline tw:[--flow-color:#b5c7ad] tw:hover:bg-[#f5f7f0] tw:data-[tone=planned]:[--flow-color:#8eac8c] tw:data-[tone=assigned]:[--flow-color:#6a9472] tw:data-[tone=progress]:[--flow-color:#3f785b] tw:data-[tone=partial]:[--flow-color:#cda565] tw:data-[tone=attention]:[--flow-color:#bf8171] tw:data-[tone=review]:[--flow-color:#a5a17a] tw:data-[tone=complete]:[--flow-color:#214c36] tw:max-[1000px]:grid-cols-[minmax(128px,1fr)_minmax(0,1fr)_minmax(22px,auto)] tw:max-[1000px]:gap-[9px] tw:max-[600px]:grid-cols-[minmax(0,1fr)_minmax(30px,auto)] tw:max-[600px]:gap-x-3 tw:max-[600px]:gap-y-2 tw:max-[600px]:py-[9px]',
  flowLabel:
    'tw:flex tw:min-w-0 tw:items-center tw:gap-[9px] tw:text-[11px] tw:leading-[1.5] tw:max-[600px]:col-start-1 tw:max-[600px]:row-start-1',
  statusDot: 'tw:size-1.5 tw:shrink-0 tw:rounded-full tw:bg-[var(--flow-color)]',
  flowTrack:
    'tw:block tw:h-[7px] tw:min-w-0 tw:overflow-hidden tw:rounded-[10px] tw:bg-[#edf0e8] tw:max-[600px]:col-span-full tw:max-[600px]:row-start-2 tw:max-[600px]:ml-[15px]',
  flowFill: 'tw:block tw:h-full tw:max-w-full tw:rounded-[inherit] tw:bg-[var(--flow-color)]',
  flowCount:
    'tw:text-right tw:text-xs tw:font-bold tw:text-[#52634f] tw:tabular-nums tw:[overflow-wrap:anywhere] tw:max-[600px]:col-start-2 tw:max-[600px]:row-start-1',
  paymentVisual:
    'tw:mt-[27px] tw:mb-[25px] tw:flex tw:justify-center tw:max-[850px]:mb-0 tw:max-[850px]:items-center tw:max-[600px]:my-7',
  donut:
    "tw:relative tw:grid tw:size-44 tw:shrink-0 tw:place-items-center tw:rounded-full tw:bg-[conic-gradient(#c2daac_0_var(--collection-progress,0%),#ffffff17_var(--collection-progress,0%)_100%)] tw:before:absolute tw:before:inset-[15px] tw:before:rounded-full tw:before:bg-[#183d30] tw:before:content-['']",
  donutCenter: 'tw:relative tw:z-[1] tw:grid tw:max-w-[130px] tw:gap-1.5 tw:text-center',
  donutValue: 'tw:text-[35px] tw:leading-none tw:font-medium tw:tracking-[-1.5px] tw:tabular-nums',
  donutLabel: 'tw:text-[10px] tw:leading-[1.4] tw:text-[#bfcebb]',
  paymentSummary:
    'tw:mt-auto tw:max-[850px]:mt-[27px] tw:max-[850px]:self-center tw:max-[600px]:mt-0 tw:max-[600px]:w-full',
  paymentSummaryTitle:
    'tw:mt-0 tw:mb-[17px] tw:text-xs tw:leading-[1.5] tw:font-medium tw:text-[#eff4e8]',
  moneyList:
    'tw:m-0 tw:grid tw:gap-[14px] tw:[&>div]:grid tw:[&>div]:min-w-0 tw:[&>div]:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] tw:[&>div]:items-baseline tw:[&>div]:gap-[15px] tw:[&_dt]:text-[11px] tw:[&_dt]:leading-[1.5] tw:[&_dt]:text-[#b8cbb4] tw:[&_dd]:m-0 tw:[&_dd]:text-right tw:[&_dd]:text-[15px] tw:[&_dd]:leading-[1.5] tw:[&_dd]:font-medium tw:[&_dd]:text-[#f4f8ec] tw:[&_dd]:tabular-nums tw:[&_dd]:[overflow-wrap:anywhere] tw:[&>div:last-child]:[border-top:1px_solid_#ffffff19] tw:[&>div:last-child]:pt-[14px] tw:[&>div:last-child_dd]:text-[#d4e5bf]',
  paymentNote:
    'tw:mt-[22px] tw:mb-0 tw:[border-top:1px_solid_#ffffff19] tw:pt-4 tw:text-[10px] tw:leading-[1.7] tw:text-[#b9cbb4] tw:max-[850px]:col-span-full',
  priorities: 'tw:min-w-0',
  panelLink:
    'tw:mt-[5px] tw:inline-flex tw:min-h-11 tw:shrink-0 tw:items-center tw:justify-center tw:gap-[5px] tw:text-[10px] tw:leading-[1.4] tw:font-bold tw:text-[#52634f] tw:no-underline tw:hover:underline tw:hover:underline-offset-4 tw:max-[600px]:text-[9px] tw:[&_svg]:size-3.5 tw:[&_svg]:shrink-0',
  priorityGrid:
    'tw:mt-[18px] tw:grid tw:grid-cols-3 tw:gap-4 tw:max-[850px]:gap-3 tw:max-[600px]:grid-cols-1',
  priorityCard:
    'tw:flex tw:min-w-0 tw:flex-col tw:rounded-[14px] tw:border tw:border-solid tw:border-[#dfe5da] tw:bg-[#f9fbf5] tw:p-[22px] tw:text-[#18372e] tw:no-underline tw:[--priority-color:#386346] tw:[--priority-icon-border:#e0e8d6] tw:[--priority-icon-background:#edf3e4] tw:hover:border-[var(--priority-color)] tw:data-[tone=amber]:hover:border-[var(--priority-color)] tw:data-[tone=rose]:hover:border-[var(--priority-color)] tw:data-[tone=amber]:border-[#e9dfc8] tw:data-[tone=amber]:bg-[#fdf9ef] tw:data-[tone=amber]:[--priority-color:#936525] tw:data-[tone=amber]:[--priority-icon-border:#eee0bd] tw:data-[tone=amber]:[--priority-icon-background:#f8edd2] tw:data-[tone=rose]:border-[#ebdbd3] tw:data-[tone=rose]:bg-[#fcf6f1] tw:data-[tone=rose]:[--priority-color:#9c5d50] tw:data-[tone=rose]:[--priority-icon-border:#ecd7cb] tw:data-[tone=rose]:[--priority-icon-background:#f7e7de] tw:max-[850px]:p-[18px] tw:max-[600px]:p-[21px]',
  priorityTop: 'tw:flex tw:items-center tw:justify-between tw:gap-[14px]',
  priorityIcon:
    'tw:inline-flex tw:size-[35px] tw:shrink-0 tw:items-center tw:justify-center tw:rounded-[10px] tw:border tw:border-solid tw:border-[var(--priority-icon-border)] tw:bg-[var(--priority-icon-background)] tw:text-[color:var(--priority-color)] tw:max-[600px]:size-[30px] tw:max-[600px]:rounded-[9px]',
  priorityCount:
    'tw:text-[30px] tw:leading-[1.2] tw:font-medium tw:tracking-[-1px] tw:text-[color:var(--priority-color)] tw:tabular-nums tw:[overflow-wrap:anywhere]',
  priorityTitle:
    'tw:mt-5 tw:mb-2 tw:text-[13px] tw:leading-[1.5] tw:font-bold tw:tracking-[-0.1px] tw:max-[600px]:mt-4',
  priorityCopy: 'tw:m-0 tw:flex-1 tw:text-[11px] tw:leading-[1.7] tw:text-[#66715f]',
  priorityAction:
    'tw:mt-[15px] tw:inline-flex tw:min-h-11 tw:items-center tw:gap-[7px] tw:text-[10px] tw:leading-[1.5] tw:font-bold tw:text-[color:var(--priority-color)] tw:[&_svg]:size-3.5 tw:[&_svg]:shrink-0',
  footerNote:
    'tw:mt-[-7px] tw:mb-0 tw:text-[10px] tw:leading-[1.7] tw:text-[#65715f] tw:max-[600px]:mt-[-5px]',
  empty:
    'tw:grid tw:justify-items-center tw:gap-[13px] tw:rounded-2xl tw:border tw:border-dashed tw:border-[#cfd9c7] tw:bg-[#fafcf6] tw:px-6 tw:py-[38px] tw:text-center',
  emptyIcon:
    'tw:grid tw:size-12 tw:place-items-center tw:rounded-[14px] tw:bg-[#eaf1e2] tw:text-[#54764e] tw:[&_svg]:size-6',
  emptyTitle: 'tw:m-0 tw:text-xl tw:font-medium tw:tracking-[-0.5px]',
  emptyCopy: 'tw:m-0 tw:max-w-[380px] tw:text-xs tw:leading-[1.7] tw:text-[#65716a]',
  skeletonCard:
    "tw:grid tw:min-h-[179px] tw:min-w-0 tw:gap-[22px] tw:rounded-2xl tw:border tw:border-solid tw:border-[#e0e5da] tw:bg-[#fffefa] tw:px-[23px] tw:pt-[23px] tw:pb-[21px] tw:before:block tw:before:h-3 tw:before:w-[62%] tw:before:rounded-md tw:before:bg-[#edf0e8] tw:before:content-[''] tw:after:block tw:after:h-[38px] tw:after:w-[46%] tw:after:rounded-md tw:after:bg-[#edf0e8] tw:after:content-['']",
} as const;

const stages = [
  { progress: 'INBOX', field: 'inboxCount', tone: 'inbox' },
  { progress: 'PLANNED', field: 'plannedCount', tone: 'planned' },
  { progress: 'ASSIGNED', field: 'assignedCount', tone: 'assigned' },
  { progress: 'IN_PROGRESS', field: 'inProgressCount', tone: 'progress' },
  { progress: 'PARTIALLY_COMPLETED', field: 'partiallyCompletedCount', tone: 'partial' },
  { progress: 'REQUIRES_ATTENTION', field: 'requiresAttentionCount', tone: 'attention' },
  { progress: 'AWAITING_REVIEW', field: 'awaitingReviewCount', tone: 'review' },
  { progress: 'COMPLETED', field: 'completedCount', tone: 'complete' },
] as const;
const counts = new Intl.NumberFormat('en-IE');

function share(value: bigint, total: bigint): number {
  if (total === 0n) return 0;
  // Only the bounded visual percentage becomes a Number; money stays in integer cents.
  return Number((value * 10_000n) / total) / 100;
}
function shareLabel(value: bigint, total: bigint): string {
  if (total === 0n) return '—';
  const whole = (value * 100n) / total;
  return value > 0n && whole === 0n ? '<1%' : `${whole}%`;
}
const iconPaths = {
  orders: ['M7 3h10l4 4v14H3V7z', 'M3 7h18', 'M9 3v4', 'M15 3v4', 'M8 12h8', 'M8 16h5'],
  activity: ['M3 12h4l3-7 4 14 3-7h4'],
  review: ['M9 3H5v18h14V3h-4', 'M9 2h6v4H9z', 'm8 13 3 3 5-6'],
  balance: ['M3 5h17v15H3z', 'M3 9h17', 'M15 12h6v5h-6z'],
  arrow: ['M5 12h14', 'm13 6 6 6-6 6'],
  plus: ['M12 5v14', 'M5 12h14'],
  calendar: ['M4 5h16v16H4z', 'M8 2v6', 'M16 2v6', 'M4 10h16'],
  issues: ['m12 3 10 18H2z', 'M12 9v5', 'M12 17h.01'],
  returns: ['M4 10h10a6 6 0 0 1 0 12', 'm9 5-5 5 5 5'],
} as const;
function DashboardIcon({ name }: Readonly<{ name: keyof typeof iconPaths }>) {
  return (
    <svg
      className="tw:size-[17px] tw:shrink-0 tw:max-[600px]:size-[15px]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}

export function OrderDashboard() {
  const resource = useOrderResource<DashboardResponse>('/dashboard', isDashboardResponse, {
    retainDataOnRefresh: true,
  });
  const id = useId();
  const data = resource.data;
  const buckets = data ? stages.map((stage) => ({ ...stage, count: data[stage.field] })) : [];
  const total = buckets.reduce((sum, stage) => sum + BigInt(stage.count), 0n);
  const maximum = buckets.reduce(
    (max, stage) => (BigInt(stage.count) > max ? BigInt(stage.count) : max),
    0n,
  );
  const totalValue = BigInt(data?.orderTotalCents ?? 0);
  const paid = BigInt(data?.paidCents ?? 0);
  const collectionLabel = shareLabel(paid, totalValue);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Delivery operations</p>
          <h1 className={styles.title}>Dashboard</h1>
          <p className={styles.subtitle}>
            Your orders, the work ahead, and a clear view of every payment.
          </p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondaryButton}
            aria-label="Refresh dashboard"
            disabled={resource.pending}
            onClick={() => void resource.refresh()}
          >
            <RotateCw
              aria-hidden="true"
              size={17}
              strokeWidth={1.75}
              className="tw:size-[17px] tw:shrink-0 tw:max-[600px]:size-[15px]"
            />{' '}
            Refresh
          </button>
          <Link className={styles.primaryButton} href="/backoffice/orders/new">
            <DashboardIcon name="plus" /> Create order
          </Link>
        </div>
      </header>

      {resource.pending ? (
        <p className={styles.notice} role="status">
          Loading…
        </p>
      ) : resource.error ? (
        <div className={styles.errorNotice}>
          <p className={styles.error} role="alert">
            {resource.error}
          </p>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => void resource.refresh()}
          >
            Retry
          </button>
        </div>
      ) : null}
      {!data && resource.pending && (
        <div className={styles.metrics} aria-hidden="true">
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className={styles.skeletonCard} />
          ))}
        </div>
      )}

      {data && (
        <>
          <div className={styles.metrics} aria-label="Key metrics">
            <Link
              href="/backoffice/orders"
              className={styles.kpiFeatured}
              aria-label={`Total orders ${total}`}
            >
              <div className={styles.kpiTopFeatured}>
                <span>Total orders</span>
                <span className={styles.iconFeatured}>
                  <DashboardIcon name="orders" />
                </span>
              </div>
              <strong className={styles.kpiValue}>{counts.format(total)}</strong>
              <span className={styles.kpiCopyFeatured}>
                {counts.format(data.completedCount)} completed ·{' '}
                {counts.format(total - BigInt(data.completedCount))} open
              </span>
            </Link>
            <Link
              href="/backoffice/orders?progress=IN_PROGRESS"
              className={styles.kpi}
              aria-label={`View in-progress orders ${data.inProgressCount}`}
            >
              <div className={styles.kpiTop}>
                <span>In progress</span>
                <span className={styles.iconMint}>
                  <DashboardIcon name="activity" />
                </span>
              </div>
              <strong className={styles.kpiValue}>{counts.format(data.inProgressCount)}</strong>
              <span className={styles.kpiCopy}>On the way, arrived or working</span>
            </Link>
            <Link
              href="/backoffice/orders?progress=AWAITING_REVIEW"
              className={styles.kpiAmber}
              aria-label={`Review orders ${data.awaitingReviewCount}`}
            >
              <div className={styles.kpiTop}>
                <span>Awaiting review</span>
                <span className={styles.iconAmber}>
                  <DashboardIcon name="review" />
                </span>
              </div>
              <strong className={styles.kpiValue}>{counts.format(data.awaitingReviewCount)}</strong>
              <span className={styles.kpiCopy}>Check confirmations and readiness</span>
            </Link>
            <div className={styles.kpi}>
              <div className={styles.kpiTop}>
                <span>Outstanding balance</span>
                <span className={styles.icon}>
                  <DashboardIcon name="balance" />
                </span>
              </div>
              <strong className={styles.kpiValue}>{formatCents(data.balanceCents)}</strong>
              <span className={styles.kpiCopy}>Order value less recorded payments</span>
            </div>
          </div>

          <div className={styles.insights}>
            <section className={styles.panel} aria-labelledby={`${id}-flow`}>
              <div className={styles.panelHeading}>
                <div>
                  <p className={styles.kicker}>The big picture</p>
                  <h2 className={styles.panelTitle} id={`${id}-flow`}>
                    Order flow
                  </h2>
                </div>
                <span className={styles.scope}>All time</span>
              </div>
              <figure className={styles.flowChart} aria-label={`Order flow: ${total} total orders`}>
                <figcaption className="tw:sr-only">
                  Current order counts by stage. Select a stage to open its orders.
                </figcaption>
                <div className={styles.flowSummary}>
                  <strong className={styles.flowTotal}>{counts.format(total)}</strong>
                  <span className={styles.flowSummaryLabel}>orders across every stage</span>
                </div>
                <div className={styles.flowLegend}>
                  <span>
                    {shareLabel(BigInt(data.completedCount), total)}
                    {total > 0n ? ' completed' : ' No orders recorded'}
                  </span>
                  <span>One stage per order</span>
                </div>
                <div className={styles.flowBars}>
                  {buckets.map((stage) => (
                    <Link
                      key={stage.progress}
                      href={`/backoffice/orders?progress=${stage.progress}`}
                      className={styles.flowRow}
                      data-tone={stage.tone}
                      aria-label={`${orderProgressLabel(stage.progress)} ${stage.count}`}
                    >
                      <span className={styles.flowLabel}>
                        <span className={styles.statusDot} aria-hidden="true" />
                        {orderProgressLabel(stage.progress)}
                      </span>
                      <span className={styles.flowTrack} aria-hidden="true">
                        <span
                          className={styles.flowFill}
                          style={{ width: `${share(BigInt(stage.count), maximum)}%` }}
                        />
                      </span>
                      <strong className={styles.flowCount}>{counts.format(stage.count)}</strong>
                    </Link>
                  ))}
                </div>
              </figure>
            </section>

            <section className={styles.payments} aria-labelledby={`${id}-payments`}>
              <div className={`${styles.panelHeading} tw:max-[850px]:col-span-full`}>
                <div>
                  <p className={styles.kickerPayment}>Manual payment journal</p>
                  <h2 className={styles.panelTitle} id={`${id}-payments`}>
                    Payment overview
                  </h2>
                </div>
              </div>
              <div className={styles.paymentVisual}>
                <div
                  className={styles.donut}
                  role="img"
                  aria-label={
                    totalValue > 0n
                      ? `Recorded payments: ${collectionLabel} of order value`
                      : 'No order value to compare'
                  }
                  style={
                    { '--collection-progress': `${share(paid, totalValue)}%` } as CSSProperties
                  }
                >
                  <div className={styles.donutCenter}>
                    <strong className={styles.donutValue}>{collectionLabel}</strong>
                    <small className={styles.donutLabel}>
                      {totalValue > 0n ? 'recorded' : 'No order value'}
                    </small>
                  </div>
                </div>
              </div>
              <div className={styles.paymentSummary}>
                <h3 className={styles.paymentSummaryTitle}>Order value and recorded payments</h3>
                <dl className={styles.moneyList}>
                  <div>
                    <dt>Order total</dt>
                    <dd>{formatCents(data.orderTotalCents)}</dd>
                  </div>
                  <div>
                    <dt>Recorded payments</dt>
                    <dd>{formatCents(data.paidCents)}</dd>
                  </div>
                  <div>
                    <dt>Outstanding balance</dt>
                    <dd>{formatCents(data.balanceCents)}</dd>
                  </div>
                </dl>
              </div>
              <p className={styles.paymentNote}>
                Payments and work progress are independent. A completed order may still have an
                outstanding balance.
              </p>
            </section>
          </div>

          <section className={styles.priorities} aria-labelledby={`${id}-priorities`}>
            <div className={styles.panelHeading}>
              <div>
                <p className={styles.kicker}>Your next move</p>
                <h2 className={styles.panelTitle} id={`${id}-priorities`}>
                  Keep things moving
                </h2>
              </div>
              <Link href="/backoffice/planning" className={styles.panelLink}>
                <DashboardIcon name="calendar" /> Open planning calendar
              </Link>
            </div>
            <div className={styles.priorityGrid}>
              <Link
                href="/backoffice/issues?status=OPEN"
                className={styles.priorityCard}
                data-tone="rose"
                aria-label={`Open issues ${data.openIssueCount}`}
              >
                <div className={styles.priorityTop}>
                  <span className={styles.priorityIcon}>
                    <DashboardIcon name="issues" />
                  </span>
                  <strong className={styles.priorityCount}>
                    {counts.format(data.openIssueCount)}
                  </strong>
                </div>
                <h3 className={styles.priorityTitle}>Open issues</h3>
                <p className={styles.priorityCopy}>
                  Review unresolved problems and decide the next action.
                </p>
                <span className={styles.priorityAction}>
                  Review issues <DashboardIcon name="arrow" />
                </span>
              </Link>
              <div className={styles.priorityCard} data-tone="amber">
                <div className={styles.priorityTop}>
                  <span className={styles.priorityIcon}>
                    <DashboardIcon name="returns" />
                  </span>
                  <strong className={styles.priorityCount}>
                    {counts.format(data.returnVisitRequiredCount)}
                  </strong>
                </div>
                <h3 className={styles.priorityTitle}>Orders requiring a return visit</h3>
                <p className={styles.priorityCopy}>
                  Orders with open or planned requests. More than one request can belong to an
                  order.
                </p>
                <Link href="/backoffice/return-requests?status=" className={styles.priorityAction}>
                  View return requests <DashboardIcon name="arrow" />
                </Link>
              </div>
              <Link
                href="/backoffice/orders?progress=INBOX"
                className={styles.priorityCard}
                data-tone="green"
                aria-label={`Plan inbox orders ${data.inboxCount}`}
              >
                <div className={styles.priorityTop}>
                  <span className={styles.priorityIcon}>
                    <DashboardIcon name="calendar" />
                  </span>
                  <strong className={styles.priorityCount}>{counts.format(data.inboxCount)}</strong>
                </div>
                <h3 className={styles.priorityTitle}>Ready to plan</h3>
                <p className={styles.priorityCopy}>
                  Inbox orders are waiting for a scheduled visit.
                </p>
                <span className={styles.priorityAction}>
                  Plan the next delivery <DashboardIcon name="arrow" />
                </span>
              </Link>
            </div>
          </section>

          {total === 0n && (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}>
                <DashboardIcon name="orders" />
              </span>
              <h2 className={styles.emptyTitle}>No orders yet</h2>
              <p className={styles.emptyCopy}>
                Create your first order to bring this overview to life.
              </p>
            </div>
          )}
          <p className={styles.footerNote}>
            All orders · EUR · totals include recorded payments only. These are order and payment
            totals, not accounting revenue.
          </p>
          <Link className={styles.secondaryButton} href="/backoffice/orders">
            View all orders
          </Link>
        </>
      )}
    </div>
  );
}
