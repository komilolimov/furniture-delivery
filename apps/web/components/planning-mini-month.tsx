'use client';

import { memo, useEffect, useState } from 'react';
import { Temporal } from 'temporal-polyfill';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { BUSINESS_ZONE, businessToday } from '../lib/business-time';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

function monthLabel(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: BUSINESS_ZONE,
  }).format(new Date(value + 'T12:00:00Z'));
}

export const PlanningMiniMonth = memo(function PlanningMiniMonth({
  date,
  onSelect,
}: Readonly<{ date: string; onSelect: (date: string) => void }>) {
  const [month, setMonth] = useState(() => date.slice(0, 7) + '-01');
  useEffect(() => setMonth(date.slice(0, 7) + '-01'), [date]);
  const first = Temporal.PlainDate.from(month);
  const start = first.subtract({ days: first.dayOfWeek - 1 });
  const today = businessToday();
  return (
    <section aria-label="Quick date picker" className="tw:min-w-0">
      <div className="tw:mb-3 tw:flex tw:items-center tw:justify-between tw:gap-1">
        <h2 className="tw:m-0 tw:text-xs tw:font-semibold">{monthLabel(month)}</h2>
        <div className="tw:flex">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous picker month"
            disabled={first.year === 1900 && first.month === 1}
            onClick={() => setMonth(first.subtract({ months: 1 }).toString())}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next picker month"
            disabled={first.year === 9999 && first.month === 12}
            onClick={() => setMonth(first.add({ months: 1 }).toString())}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="tw:grid tw:grid-cols-7 tw:gap-0.5 tw:text-center">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => (
          <span
            key={index}
            aria-hidden="true"
            className="tw:py-2 tw:text-[10px] tw:font-semibold tw:text-[#7b8872]"
          >
            {day}
          </span>
        ))}
        {Array.from({ length: 42 }, (_, index) => {
          const day = start.add({ days: index }),
            value = day.toString();
          return (
            <button
              key={value}
              type="button"
              aria-label={`Choose ${value}`}
              aria-pressed={value === date}
              aria-current={value === today ? 'date' : undefined}
              disabled={day.year < 1900 || day.year > 9999}
              onClick={() => onSelect(value)}
              className={cn(
                'tw:aspect-square tw:min-h-8 tw:cursor-pointer tw:rounded-full tw:border-0 tw:bg-transparent tw:p-0 tw:text-[11px] tw:tabular-nums tw:transition-colors tw:hover:bg-[#e9f0e3] tw:focus-visible:outline-2 tw:focus-visible:outline-[#739b74] tw:focus-visible:outline-offset-1 tw:disabled:opacity-30',
                day.month !== first.month ? 'tw:text-[#a5ad9e]' : 'tw:text-[#40543c]',
                value === today && 'tw:font-bold tw:underline tw:underline-offset-4',
                value === date &&
                  'tw:bg-[#21533b] tw:font-semibold tw:text-white tw:hover:bg-[#21533b]',
              )}
            >
              {day.day}
            </button>
          );
        })}
      </div>
    </section>
  );
});
