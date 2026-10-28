'use client';

import type { CrewSummary } from '@furniture-delivery/contracts';
import { memo, useId } from 'react';
import { Input } from './ui/input';
import { NativeSelect } from './ui/native-select';
import { Textarea } from './ui/textarea';

/** Preserve the existing CrewFields names and native FormData semantics. */
export const TeamFields = memo(function TeamFields({
  crew,
  create = false,
}: Readonly<{ crew?: CrewSummary; create?: boolean }>) {
  const hintId = useId();
  return (
    <div className="team-profile-fields tw:col-span-full tw:grid tw:min-w-0 tw:grid-cols-2 tw:gap-5 tw:max-[650px]:grid-cols-1">
      {create && (
        <label className="team-field">
          Team code
          <Input
            aria-label="Team code"
            aria-describedby={hintId}
            name="code"
            required
            minLength={3}
            maxLength={32}
            pattern="[A-Z][A-Z0-9_-]{2,31}"
            placeholder="TEAM-11"
          />
          <span id={hintId} className="team-field-hint">
            A stable identifier that stays with this team’s history.
          </span>
        </label>
      )}
      <label className="team-field">
        Team name
        <Input
          name="name"
          required
          maxLength={120}
          defaultValue={crew?.name}
          placeholder="Team name"
        />
      </label>
      <label className="team-field">
        Work environment
        <NativeSelect name="workEnvironment" defaultValue={crew?.workEnvironment ?? 'INDOOR'}>
          <option value="INDOOR">Indoor</option>
          <option value="OUTDOOR">Outdoor</option>
        </NativeSelect>
      </label>
      <label className="team-field tw:col-span-full">
        Service area
        <Textarea
          name="serviceArea"
          required
          maxLength={2000}
          rows={3}
          defaultValue={crew?.serviceArea}
          placeholder="Cities, regions or service coverage"
        />
      </label>
      <label className="tw:col-span-full tw:flex tw:min-h-11 tw:cursor-pointer tw:items-center tw:gap-3 tw:rounded-xl tw:border tw:border-solid tw:border-[#dfe6d8] tw:bg-[#f7f9f3] tw:p-4 tw:text-xs tw:font-medium">
        <input
          name="active"
          type="checkbox"
          defaultChecked={crew?.active ?? true}
          className="tw:size-4 tw:shrink-0 tw:accent-[#28543b]"
        />
        Team enabled
      </label>
    </div>
  );
});
