'use client';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { NativeSelect } from './ui/native-select';
import { Button } from './ui/button';
import { ArrowUp, ArrowDown, Plus, Trash2 } from 'lucide-react';
import { DraftChangeNotice } from './draft-change-notice';

import type {
  CreateOrderRequest,
  OrderDetail,
  OrderItemInput,
  OrderResponse,
  ServiceType,
} from '@furniture-delivery/contracts';
import { useState, type FormEvent } from 'react';
import { apiRequest, ApiError, describeError } from '../lib/api-client';
import { centsInput, parseEuroCents } from '../lib/money';
import { isOrderResponse } from '../lib/order-guards';
import { ordersChanged } from '../lib/use-order-resource';
import { Feedback } from './form-parts';

type EditableItem = OrderItemInput & { key: string };
const blankItem = (): EditableItem => ({
  key: crypto.randomUUID(),
  description: '',
  quantity: 1,
  configuration: '',
  ambient: '',
  notes: '',
  requiresAssembly: false,
  sortOrder: 0,
});
const nullable = (value: FormDataEntryValue | null): string | null =>
  String(value ?? '').trim() || null;
const booleanValue = (value: FormDataEntryValue | null): boolean | null =>
  value === 'yes' ? true : value === 'no' ? false : null;

export function OrderForm({
  order,
  onSaved,
  onReload,
}: Readonly<{
  order?: OrderDetail;
  onSaved: (order: OrderDetail) => void;
  onReload?: () => void;
}>) {
  const [serviceType, setServiceType] = useState<ServiceType>(
    order?.serviceType ?? 'DELIVERY_ONLY',
  );
  const [items, setItems] = useState<EditableItem[]>(() =>
    order
      ? order.items.filter((item) => item.active).map((item) => ({ ...item, key: item.id }))
      : [blankItem()],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moneyError, setMoneyError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  function updateItem(index: number, fields: Partial<EditableItem>) {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...fields } : item)));
  }
  function moveItem(index: number, delta: number) {
    setItems((current) => {
      const next = [...current];
      const item = next[index];
      const adjacent = next[index + delta];
      if (item && adjacent) {
        next[index] = adjacent;
        next[index + delta] = item;
      }
      return next;
    });
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError(null);
    setMoneyError(null);
    setConflict(false);
    let orderTotalCents: number;
    try {
      orderTotalCents = parseEuroCents(String(data.get('orderTotal') ?? ''));
    } catch (error) {
      setMoneyError(error instanceof Error ? error.message : 'Invalid amount.');
      return;
    }
    if (items.length === 0) {
      setError('Add at least one item.');
      return;
    }
    const body: CreateOrderRequest = {
      customerName: String(data.get('customerName') ?? '').trim(),
      contactName: nullable(data.get('contactName')),
      phoneNumbers: String(data.get('phoneNumbers') ?? '')
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean),
      email: nullable(data.get('email')),
      address: String(data.get('address') ?? '').trim(),
      city: String(data.get('city') ?? '').trim(),
      country: String(data.get('country') ?? '').trim(),
      postalCode: nullable(data.get('postalCode')),
      serviceType,
      workDescription: String(data.get('workDescription') ?? '').trim(),
      estimatedDurationMinutes: Number(data.get('estimatedDurationMinutes')),
      floor: nullable(data.get('floor')),
      hasElevator: booleanValue(data.get('hasElevator')),
      easyAccess: booleanValue(data.get('easyAccess')),
      parkingAvailable: booleanValue(data.get('parkingAvailable')),
      accessRestrictions: String(data.get('accessRestrictions') ?? '').trim(),
      accessNotes: String(data.get('accessNotes') ?? '').trim(),
      internalNotes: String(data.get('internalNotes') ?? '').trim(),
      crewNotes: String(data.get('crewNotes') ?? '').trim(),
      orderTotalCents,
      items: items.map((item, index) => ({
        ...('id' in item && item.id ? { id: item.id } : {}),
        description: item.description.trim(),
        quantity: item.quantity,
        configuration: item.configuration.trim(),
        ambient: item.ambient.trim(),
        notes: item.notes.trim(),
        requiresAssembly: item.requiresAssembly,
        sortOrder: index,
      })),
    };
    if (body.phoneNumbers.length < 1 || body.phoneNumbers.length > 5) {
      setError('Provide between one and five phone numbers, one per line.');
      return;
    }
    setSaving(true);
    try {
      const response = await apiRequest<OrderResponse>(order ? `/orders/${order.id}` : '/orders', {
        method: order ? 'PATCH' : 'POST',
        body: order ? { ...body, expectedVersion: order.version } : body,
        validate: isOrderResponse,
      });
      ordersChanged();
      onSaved(response.order);
    } catch (error) {
      setError(describeError(error));
      setConflict(error instanceof ApiError && error.status === 409);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="order-form tw:grid tw:min-w-0 tw:gap-6" onSubmit={(event) => void save(event)}>
      {order && <DraftChangeNotice paths={[`/orders/${order.id}`]} />}
      {order && order.appointments.some((appointment) => appointment.status === 'SCHEDULED') && (
        <p className="resource-notice">
          Changing delivery conditions or furniture resets client confirmation. Review duration and
          task snapshots and agree the visit again. Changing the estimated duration does not move
          existing visits.
        </p>
      )}
      <fieldset disabled={saving} className="tw:m-0 tw:min-w-0 tw:border-0 tw:p-0">
        <h2 className="tw:m-0 tw:text-lg tw:font-semibold tw:tracking-[-0.3px]">
          Customer and delivery address
        </h2>
        <div className="form-grid tw:mt-5 tw:mb-7 tw:grid tw:min-w-0 tw:grid-cols-2 tw:gap-x-5 tw:gap-y-4 tw:max-[700px]:grid-cols-1">
          <label>
            Customer name
            <Input
              name="customerName"
              required
              maxLength={200}
              defaultValue={order?.customerName}
            />
          </label>
          <label>
            Contact name
            <Input name="contactName" maxLength={200} defaultValue={order?.contactName ?? ''} />
          </label>
          <label>
            Phone numbers
            <Textarea
              aria-label="Phone numbers"
              name="phoneNumbers"
              required
              rows={3}
              maxLength={205}
              defaultValue={order?.phoneNumbers.join('\n')}
            />
            <small>One per line; one to five numbers, up to 40 characters each.</small>
          </label>
          <label>
            Email
            <Input name="email" type="email" maxLength={254} defaultValue={order?.email ?? ''} />
          </label>
          <label className="wide-field tw:col-span-full">
            Address
            <Textarea
              name="address"
              required
              rows={2}
              maxLength={500}
              defaultValue={order?.address}
            />
          </label>
          <label>
            City
            <Input name="city" required maxLength={120} defaultValue={order?.city} />
          </label>
          <label>
            Country
            <Input
              name="country"
              required
              maxLength={120}
              defaultValue={order?.country ?? 'Italy'}
            />
          </label>
          <label>
            Postal code
            <Input name="postalCode" maxLength={24} defaultValue={order?.postalCode ?? ''} />
          </label>
        </div>
        <h2 className="tw:mt-8 tw:mb-0 tw:text-lg tw:font-semibold tw:tracking-[-0.3px]">
          Service and access
        </h2>
        <div className="form-grid tw:mt-5 tw:mb-7 tw:grid tw:min-w-0 tw:grid-cols-2 tw:gap-x-5 tw:gap-y-4 tw:max-[700px]:grid-cols-1">
          <label>
            Service type
            <NativeSelect
              name="serviceType"
              value={serviceType}
              onChange={(event) => {
                const value = event.target.value as ServiceType;
                setServiceType(value);
                if (value === 'DELIVERY_ONLY')
                  setItems((current) =>
                    current.map((item) => ({ ...item, requiresAssembly: false })),
                  );
              }}
            >
              <option value="DELIVERY_ONLY">Delivery only</option>
              <option value="DELIVERY_AND_ASSEMBLY">Delivery and assembly</option>
            </NativeSelect>
          </label>
          <label>
            Estimated duration (minutes)
            <Input
              name="estimatedDurationMinutes"
              type="number"
              required
              min={1}
              max={10080}
              step={1}
              defaultValue={order?.estimatedDurationMinutes ?? 60}
            />
          </label>
          <label className="wide-field tw:col-span-full">
            Work description
            <Textarea
              name="workDescription"
              required
              rows={3}
              maxLength={4000}
              defaultValue={order?.workDescription}
            />
          </label>
          <label>
            Floor
            <Input name="floor" maxLength={40} defaultValue={order?.floor ?? ''} />
          </label>
          {(
            [
              { name: 'hasElevator', label: 'Elevator' },
              { name: 'easyAccess', label: 'Easy access' },
              { name: 'parkingAvailable', label: 'Parking available' },
            ] as const
          ).map((field) => (
            <label key={field.name}>
              {field.label}
              <NativeSelect
                name={field.name}
                defaultValue={
                  order?.[field.name] === true ? 'yes' : order?.[field.name] === false ? 'no' : ''
                }
              >
                <option value="">Unknown / not confirmed</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </NativeSelect>
            </label>
          ))}
          <label className="wide-field tw:col-span-full">
            Access restrictions
            <Textarea
              name="accessRestrictions"
              rows={2}
              maxLength={4000}
              defaultValue={order?.accessRestrictions}
            />
          </label>
          <label className="wide-field tw:col-span-full">
            Access notes
            <Textarea
              name="accessNotes"
              rows={2}
              maxLength={4000}
              defaultValue={order?.accessNotes}
            />
          </label>
          <label>
            Internal dispatcher notes
            <Textarea
              name="internalNotes"
              rows={3}
              maxLength={4000}
              defaultValue={order?.internalNotes}
            />
          </label>
          <label>
            Notes for the crew
            <Textarea name="crewNotes" rows={3} maxLength={4000} defaultValue={order?.crewNotes} />
          </label>
        </div>
        <h2 className="tw:mt-8 tw:mb-0 tw:text-lg tw:font-semibold tw:tracking-[-0.3px]">Items</h2>
        <p className="section-copy">
          At least one item. Removing an existing item keeps its history. Item assembly is available
          with delivery and assembly service.
        </p>
        {items.map((item, index) => (
          <section
            className="item-editor tw:mb-4 tw:min-w-0 tw:rounded-xl tw:border tw:border-solid tw:border-[#e0e7d9] tw:bg-[#f8faf4] tw:p-5 tw:max-[600px]:p-4"
            key={item.key}
            aria-label={`Item ${index + 1}`}
          >
            <div className="card-line tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
              <h3 className="tw:m-0 tw:text-sm tw:font-semibold">Item {index + 1}</h3>
              <div className="button-row tw:flex tw:flex-wrap tw:gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Move item ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => moveItem(index, -1)}
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Move item ${index + 1} down`}
                  disabled={index === items.length - 1}
                  onClick={() => moveItem(index, 1)}
                >
                  <ArrowDown aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                >
                  <Trash2 aria-hidden="true" /> Remove item {index + 1}
                </Button>
              </div>
            </div>
            <div className="form-grid tw:mt-5 tw:mb-7 tw:grid tw:min-w-0 tw:grid-cols-2 tw:gap-x-5 tw:gap-y-4 tw:max-[700px]:grid-cols-1">
              <label>
                Description
                <Input
                  required
                  maxLength={1000}
                  value={item.description}
                  onChange={(event) => updateItem(index, { description: event.target.value })}
                />
              </label>
              <label>
                Quantity
                <Input
                  type="number"
                  required
                  min={1}
                  max={10000}
                  step={1}
                  value={item.quantity}
                  onChange={(event) => updateItem(index, { quantity: Number(event.target.value) })}
                />
              </label>
              <label>
                Configuration
                <Textarea
                  maxLength={2000}
                  rows={2}
                  value={item.configuration}
                  onChange={(event) => updateItem(index, { configuration: event.target.value })}
                />
              </label>
              <label>
                Room / ambient
                <Input
                  maxLength={120}
                  value={item.ambient}
                  onChange={(event) => updateItem(index, { ambient: event.target.value })}
                />
              </label>
              <label className="wide-field tw:col-span-full">
                Item notes
                <Textarea
                  rows={2}
                  maxLength={2000}
                  value={item.notes}
                  onChange={(event) => updateItem(index, { notes: event.target.value })}
                />
              </label>
              <label className="checkbox-field tw:flex tw:min-h-11 tw:items-center tw:gap-2.5 tw:font-medium">
                <input
                  className="tw:size-4 tw:min-h-4 tw:shrink-0 tw:accent-[#28543b]"
                  type="checkbox"
                  checked={item.requiresAssembly}
                  disabled={serviceType === 'DELIVERY_ONLY'}
                  onChange={(event) =>
                    updateItem(index, { requiresAssembly: event.target.checked })
                  }
                />
                Requires assembly
              </label>
            </div>
          </section>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={items.length >= 100}
          onClick={() => setItems((current) => [...current, blankItem()])}
        >
          <Plus aria-hidden="true" /> Add item
        </Button>
        <h2 className="tw:mt-8 tw:mb-0 tw:text-lg tw:font-semibold tw:tracking-[-0.3px]">
          Order value
        </h2>
        <div className="form-grid tw:mt-5 tw:mb-7 tw:grid tw:min-w-0 tw:grid-cols-2 tw:gap-x-5 tw:gap-y-4 tw:max-[700px]:grid-cols-1">
          <label>
            Total (EUR)
            <Input
              aria-label="Total (EUR)"
              name="orderTotal"
              inputMode="decimal"
              required
              maxLength={12}
              aria-invalid={Boolean(moneyError)}
              aria-describedby={moneyError ? 'total-error' : undefined}
              defaultValue={centsInput(order?.orderTotalCents ?? 0)}
            />
            <small>Manual total; not calculated from items. Maximum €20,000,000.00.</small>
            {moneyError && (
              <span id="total-error" className="field-error" role="alert">
                {moneyError}
              </span>
            )}
          </label>
        </div>
      </fieldset>
      <Feedback error={error} />
      {conflict && (
        <div className="conflict-notice">
          <p>
            The order changed or conflicts with recorded payments. Review the current order before
            saving again.
          </p>
          {onReload && (
            <Button type="button" variant="outline" onClick={onReload}>
              Discard this form and reload order
            </Button>
          )}
        </div>
      )}
      <Button type="submit" disabled={saving}>
        {saving ? 'Saving…' : order ? 'Save order' : 'Create order'}
      </Button>
    </form>
  );
}
