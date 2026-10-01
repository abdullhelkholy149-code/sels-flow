'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import type { ActionResult, FormErrors } from '@/server/auth/actions';
import { CSRF_COOKIE, CSRF_FIELD } from '@/lib/auth/cookies';
import { cn } from '@/lib/cn';

/**
 * Double submit half of the CSRF token.
 *
 * The readable `sf_csrf` cookie is copied into a hidden field, and the server
 * compares the field against the token stored with the session. A cross site
 * form can send the cookie but cannot read it, so it cannot fill this field.
 *
 * Rendered at submit time rather than at mount: the cookie is replaced when a
 * password change rotates the token, and a value captured during render would
 * be stale.
 */
export function CsrfField() {
  return (
    <input
      type="hidden"
      name={CSRF_FIELD}
      ref={(node) => {
        if (!node) return;
        node.value = readCookie(CSRF_COOKIE);
      }}
    />
  );
}

function readCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export function Field({
  label,
  name,
  type = 'text',
  placeholder,
  autoComplete,
  required = true,
  error,
  defaultValue,
  inputMode,
  dir,
  maxLength,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  error?: string;
  defaultValue?: string;
  inputMode?: 'text' | 'tel' | 'numeric' | 'decimal' | 'email';
  dir?: 'ltr' | 'rtl';
  maxLength?: number;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        defaultValue={defaultValue}
        inputMode={inputMode}
        dir={dir}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
        className={cn(
          'rounded-card border bg-white px-3 py-2.5 text-sm text-ink outline-none transition',
          'focus:border-brand-500 focus:ring-2 focus:ring-brand-100',
          error ? 'border-danger' : 'border-surface-border',
        )}
      />
      {error ? (
        <span id={`${name}-error`} className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function SelectField({
  label,
  name,
  options,
  defaultValue,
  error,
}: {
  label: string;
  name: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  defaultValue?: string;
  error?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        className={cn(
          'rounded-card border bg-white px-3 py-2.5 text-sm text-ink outline-none transition',
          'focus:border-brand-500 focus:ring-2 focus:ring-brand-100',
          error ? 'border-danger' : 'border-surface-border',
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </label>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary: 'border border-surface-border bg-white text-ink hover:bg-surface-muted',
  danger: 'bg-danger text-white hover:opacity-90',
};

export function SubmitButton({
  children,
  pendingLabel,
  className,
  variant = 'primary',
  disabled,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  variant?: ButtonVariant;
  /**
   * A rule the screen can already see, e.g. "this rep still owns customers".
   * Disabling is a courtesy to the operator; the service re-checks the same rule
   * inside the transaction, because a button reflects a moment and the write
   * happens later.
   */
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-card px-4 py-2.5 text-sm font-semibold transition',
        'disabled:cursor-not-allowed disabled:opacity-60',
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

/** Submit button for tiny inline forms; shows an ellipsis while submitting. */
export function InlineSubmitButton({
  children,
  className,
  variant = 'secondary',
  disabled,
}: {
  children: React.ReactNode;
  className?: string;
  variant?: ButtonVariant;
  disabled?: boolean;
}) {
  return (
    <SubmitButton variant={variant} className={className} pendingLabel="..." disabled={disabled}>
      {children}
    </SubmitButton>
  );
}

export function FormMessage({ result }: { result: ActionResult<unknown> | null }) {
  if (!result) return null;
  if (result.ok) {
    if (!result.message) return null;
    return (
      <p
        role="status"
        className="rounded-card border border-success/30 bg-success-soft p-3 text-sm text-success"
      >
        {result.message}
      </p>
    );
  }
  if (!result.message) return null;
  return (
    <p
      role="alert"
      className="rounded-card border border-danger/30 bg-danger-soft p-3 text-sm text-danger"
    >
      {result.message}
    </p>
  );
}

export function FieldErrors({ errors }: { errors: FormErrors }) {
  const entries = Object.entries(errors).filter(([, value]) => Boolean(value));
  if (entries.length === 0) return null;
  return (
    <ul
      role="alert"
      className="flex flex-col gap-1 rounded-card border border-danger/30 bg-danger-soft p-3 text-sm text-danger"
    >
      {entries.map(([key, value]) => (
        <li key={key}>{value}</li>
      ))}
    </ul>
  );
}

export type { ActionResult };

/** Convenience wrapper: server action + pending state + error rendering. */
export function useActionForm<State extends ActionResult<unknown>>(
  action: (state: State | null, formData: FormData) => Promise<State>,
) {
  const [state, formAction] = useActionState(action, null);
  return { state, formAction };
}
