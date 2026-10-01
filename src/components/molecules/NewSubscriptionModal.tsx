'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useHydrated } from '@/hooks/useHydrated';
import { CHANNEL_LABEL, TIER_LABEL } from '@/lib/chartUtils';
import { formatCurrencyFromCents } from '@/lib/utils';
import type {
  AcquisitionChannel,
  AddCustomerPayload,
  BillingInterval,
  SubscriptionTier,
} from '@/types/analytics';

/**
 * New-subscription dialog.
 *
 * The annual flow is the fiddly part: the form collects the price the customer
 * is actually billed (per year) and normalises to a monthly MRR here, once, so
 * nothing downstream has to remember which number it is holding.
 *
 * Errors are shown live per field and the submit button is disabled while the
 * request is in flight, so a double tap cannot create two accounts.
 */

export interface NewSubscriptionModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: AddCustomerPayload) => Promise<string | null>;
  /** Emails already in use, so the form can flag a duplicate before submitting. */
  takenEmails: ReadonlySet<string>;
}

interface FormState {
  organizationName: string;
  email: string;
  tier: SubscriptionTier;
  status: 'active' | 'trialing';
  billingInterval: BillingInterval;
  /** Price in dollars as billed: monthly for monthly, yearly for annual. */
  price: string;
  channel: AcquisitionChannel;
  countryCode: string;
  seatCount: string;
  apiCalls30d: string;
}

const EMPTY_FORM: FormState = {
  organizationName: '',
  email: '',
  tier: 'pro',
  status: 'active',
  billingInterval: 'monthly',
  price: '99',
  channel: 'direct',
  countryCode: 'US',
  seatCount: '5',
  apiCalls30d: '0',
};

function parseDollars(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '' || !/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function NewSubscriptionModal({
  open,
  onClose,
  onSubmit,
  takenEmails,
}: NewSubscriptionModalProps) {
  const hydrated = useHydrated();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const portalTarget = hydrated ? document.getElementById('drawer-root') : null;

  useEffect(() => {
    if (!open) {
      return;
    }
    firstFieldRef.current?.focus();
    const appRoot = document.getElementById('app-root');
    appRoot?.setAttribute('inert', '');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !submitting) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      );
      if (nodes === undefined || nodes.length === 0) {
        return;
      }
      const first = nodes.item(0);
      const last = nodes.item(nodes.length - 1);
      if (first === undefined || last === undefined) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      appRoot?.removeAttribute('inert');
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, open, submitting]);

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  /** Monthly MRR, normalised from the billed price exactly once. */
  const monthlyMrrCents = useMemo(() => {
    const dollars = parseDollars(form.price);
    if (dollars === null) {
      return null;
    }
    const annual = form.billingInterval === 'annual';
    return annual ? Math.round(toCents(dollars) / 12) : toCents(dollars);
  }, [form.billingInterval, form.price]);

  const validate = useCallback((): Record<string, string> => {
    const next: Record<string, string> = {};
    const organizationName = form.organizationName.trim();
    if (organizationName.length < 1 || organizationName.length > 80) {
      next['organizationName'] = 'Enter a name of 1 to 80 characters.';
    }

    const email = form.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      next['email'] = 'Enter a valid email address.';
    } else if (takenEmails.has(email)) {
      next['email'] = 'That email already belongs to a customer.';
    }

    if (!/^[A-Z]{2}$/.test(form.countryCode.trim())) {
      next['countryCode'] = 'Use a two-letter ISO country code.';
    }

    const seats = Number(form.seatCount);
    if (!Number.isInteger(seats) || seats < 1 || seats > 10_000) {
      next['seatCount'] = 'Seats must be a whole number between 1 and 10,000.';
    }

    const calls = Number(form.apiCalls30d);
    if (!Number.isInteger(calls) || calls < 0) {
      next['apiCalls30d'] = 'API calls must be zero or a positive whole number.';
    }

    if (form.status === 'trialing') {
      if (monthlyMrrCents === null || monthlyMrrCents < 0) {
        next['price'] = 'Enter a valid price.';
      }
    } else if (monthlyMrrCents === null || monthlyMrrCents < 1) {
      next['price'] = 'A paying subscription needs an MRR of at least $0.01.';
    } else if (monthlyMrrCents > 50_000_000) {
      next['price'] = 'MRR must be $500,000 or less.';
    }

    return next;
  }, [form, monthlyMrrCents, takenEmails]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) {
      return;
    }
    const validation = validate();
    setErrors(validation);
    if (Object.keys(validation).length > 0) {
      return;
    }
    if (monthlyMrrCents === null) {
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      const payload: AddCustomerPayload = {
        organizationName: form.organizationName.trim(),
        email: form.email.trim().toLowerCase(),
        tier: form.tier,
        status: form.status,
        billingInterval: form.billingInterval,
        mrrCents: form.status === 'trialing' ? 0 : monthlyMrrCents,
        channel: form.channel,
        countryCode: form.countryCode.trim().toUpperCase(),
        seatCount: Number(form.seatCount),
        apiCalls30d: Number(form.apiCalls30d),
      };
      const error = await onSubmit(payload);
      if (error !== null) {
        setFormError(error);
        return;
      }
      setForm(EMPTY_FORM);
      setErrors({});
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  if (!open || portalTarget === null) {
    return null;
  }

  const fieldClass = (field: string): string =>
    [
      'mt-1 block min-h-11 w-full min-w-0 rounded-lg border px-3 py-2 text-base',
      'placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
      'dark:bg-zinc-900',
      errors[field] === undefined
        ? 'border-zinc-300 dark:border-zinc-700'
        : 'border-rose-500 dark:border-rose-700',
    ].join(' ');

  const labelClass = 'block min-w-0 text-sm font-medium text-zinc-700 dark:text-zinc-200';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-zinc-950/40 backdrop-blur-[2px] dark:bg-black/60"
        onClick={submitting ? undefined : onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-testid="new-subscription-modal"
        className="relative flex max-h-[90vh] w-full max-w-lg min-w-0 flex-col rounded-t-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 sm:rounded-2xl"
      >
        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
            <h2 id={titleId} className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Add customer
            </h2>
            <p id={descriptionId} className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Annual prices are normalised to a monthly MRR before they are stored.
            </p>

            <div className="mt-4 flex flex-col gap-4">
            <div>
              <label className={labelClass} htmlFor="new-org">
                Organization
              </label>
              <input
                id="new-org"
                ref={firstFieldRef}
                value={form.organizationName}
                onChange={(event) => update('organizationName', event.target.value)}
                aria-invalid={errors['organizationName'] !== undefined}
                aria-describedby={errors['organizationName'] === undefined ? undefined : 'err-org'}
                className={fieldClass('organizationName')}
              />
              {errors['organizationName'] !== undefined && (
                <p id="err-org" className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                  {errors['organizationName']}
                </p>
              )}
            </div>

            <div>
              <label className={labelClass} htmlFor="new-email">
                Billing email
              </label>
              <input
                id="new-email"
                type="email"
                value={form.email}
                onChange={(event) => update('email', event.target.value)}
                aria-invalid={errors['email'] !== undefined}
                aria-describedby={errors['email'] === undefined ? undefined : 'err-email'}
                className={fieldClass('email')}
              />
              {errors['email'] !== undefined && (
                <p id="err-email" className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                  {errors['email']}
                </p>
              )}
            </div>

            <div className="grid min-w-0 grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="new-tier">
                  Tier
                </label>
                <select
                  id="new-tier"
                  value={form.tier}
                  onChange={(event) => update('tier', event.target.value as SubscriptionTier)}
                  className={fieldClass('tier')}
                >
                  {(Object.keys(TIER_LABEL) as SubscriptionTier[]).map((tier) => (
                    <option key={tier} value={tier}>
                      {TIER_LABEL[tier]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelClass} htmlFor="new-status">
                  Status
                </label>
                <select
                  id="new-status"
                  value={form.status}
                  onChange={(event) => update('status', event.target.value as 'active' | 'trialing')}
                  className={fieldClass('status')}
                >
                  <option value="active">Active</option>
                  <option value="trialing">Trialing</option>
                </select>
              </div>
            </div>

            <div className="grid min-w-0 grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="new-interval">
                  Billing
                </label>
                <select
                  id="new-interval"
                  value={form.billingInterval}
                  onChange={(event) =>
                    update('billingInterval', event.target.value as BillingInterval)
                  }
                  className={fieldClass('billingInterval')}
                >
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual</option>
                </select>
              </div>

              <div>
                <label className={labelClass} htmlFor="new-price">
                  {form.billingInterval === 'annual' ? 'Annual price (USD)' : 'Monthly price (USD)'}
                </label>
                <input
                  id="new-price"
                  inputMode="decimal"
                  value={form.price}
                  onChange={(event) => update('price', event.target.value)}
                  aria-invalid={errors['price'] !== undefined}
                  aria-describedby={errors['price'] === undefined ? undefined : 'err-price'}
                  className={fieldClass('price')}
                />
                {errors['price'] !== undefined && (
                  <p id="err-price" className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                    {errors['price']}
                  </p>
                )}
                {form.status === 'active' && monthlyMrrCents !== null && (
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Stored MRR: {formatCurrencyFromCents(monthlyMrrCents)}
                    {form.billingInterval === 'annual' ? ' (annual ÷ 12, rounded)' : ''}
                  </p>
                )}
              </div>
            </div>

            <div className="grid min-w-0 grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="new-channel">
                  Channel
                </label>
                <select
                  id="new-channel"
                  value={form.channel}
                  onChange={(event) => update('channel', event.target.value as AcquisitionChannel)}
                  className={fieldClass('channel')}
                >
                  {(Object.keys(CHANNEL_LABEL) as AcquisitionChannel[]).map((channel) => (
                    <option key={channel} value={channel}>
                      {CHANNEL_LABEL[channel]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelClass} htmlFor="new-country">
                  Country
                </label>
                <input
                  id="new-country"
                  value={form.countryCode}
                  maxLength={2}
                  onChange={(event) => update('countryCode', event.target.value.toUpperCase())}
                  aria-invalid={errors['countryCode'] !== undefined}
                  aria-describedby={
                    errors['countryCode'] === undefined ? undefined : 'err-country'
                  }
                  className={fieldClass('countryCode')}
                />
                {errors['countryCode'] !== undefined && (
                  <p id="err-country" className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                    {errors['countryCode']}
                  </p>
                )}
              </div>
            </div>

            <div className="grid min-w-0 grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="new-seats">
                  Seats
                </label>
                <input
                  id="new-seats"
                  inputMode="numeric"
                  value={form.seatCount}
                  onChange={(event) => update('seatCount', event.target.value)}
                  aria-invalid={errors['seatCount'] !== undefined}
                  aria-describedby={errors['seatCount'] === undefined ? undefined : 'err-seats'}
                  className={fieldClass('seatCount')}
                />
                {errors['seatCount'] !== undefined && (
                  <p id="err-seats" className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                    {errors['seatCount']}
                  </p>
                )}
              </div>

              <div>
                <label className={labelClass} htmlFor="new-calls">
                  API calls (30d)
                </label>
                <input
                  id="new-calls"
                  inputMode="numeric"
                  value={form.apiCalls30d}
                  onChange={(event) => update('apiCalls30d', event.target.value)}
                  aria-invalid={errors['apiCalls30d'] !== undefined}
                  aria-describedby={
                    errors['apiCalls30d'] === undefined ? undefined : 'err-calls'
                  }
                  className={fieldClass('apiCalls30d')}
                />
                {errors['apiCalls30d'] !== undefined && (
                  <p id="err-calls" className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                    {errors['apiCalls30d']}
                  </p>
                )}
              </div>
            </div>

            {formError !== null && (
              <p
                role="alert"
                className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
              >
                {formError}
              </p>
            )}
            </div>
          </div>

          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-zinc-200 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="min-h-11 min-w-11 rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            data-testid="submit-new-customer"
            className="min-h-11 min-w-11 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {submitting ? 'Saving\u2026' : 'Add customer'}
          </button>
          </div>
        </form>
      </div>
    </div>,
    portalTarget,
  );
}

export default NewSubscriptionModal;