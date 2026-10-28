import type { CrewSummary } from '@furniture-delivery/contracts';

export function Feedback({
  error,
  success,
}: Readonly<{ error: string | null; success?: string | null }>) {
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="form-success" role="status">
          {success}
        </p>
      )}
    </>
  );
}

export function ResourceNotice({
  pending,
  error,
  retry,
}: Readonly<{ pending: boolean; error: string | null; retry: () => void }>) {
  if (pending)
    return (
      <p className="resource-notice" role="status">
        Loading…
      </p>
    );
  if (error)
    return (
      <div className="resource-notice">
        <p className="form-error" role="alert">
          {error}
        </p>
        <button type="button" className="secondary-button" onClick={retry}>
          Retry
        </button>
      </div>
    );
  return null;
}

export function CrewFields({
  crew,
  create = false,
}: Readonly<{ crew?: CrewSummary; create?: boolean }>) {
  return (
    <>
      {create && (
        <label>
          Team code
          <input
            name="code"
            required
            minLength={3}
            maxLength={32}
            pattern="[A-Z][A-Z0-9_-]{2,31}"
            placeholder="TEAM-11"
          />
        </label>
      )}
      <label>
        Team name
        <input name="name" required maxLength={120} defaultValue={crew?.name} />
      </label>
      <label>
        Work environment
        <select name="workEnvironment" defaultValue={crew?.workEnvironment ?? 'INDOOR'}>
          <option value="INDOOR">Indoor</option>
          <option value="OUTDOOR">Outdoor</option>
        </select>
      </label>
      <label className="wide-field">
        Service area
        <textarea
          name="serviceArea"
          required
          maxLength={2000}
          rows={3}
          defaultValue={crew?.serviceArea}
        />
      </label>
      <label className="checkbox-field">
        <input name="active" type="checkbox" defaultChecked={crew?.active ?? true} />
        Team enabled
      </label>
    </>
  );
}

export function crewFormValues(form: HTMLFormElement) {
  const data = new FormData(form);
  return {
    name: String(data.get('name') ?? '').trim(),
    workEnvironment:
      data.get('workEnvironment') === 'OUTDOOR' ? ('OUTDOOR' as const) : ('INDOOR' as const),
    serviceArea: String(data.get('serviceArea') ?? '').trim(),
    active: data.get('active') === 'on',
  };
}
