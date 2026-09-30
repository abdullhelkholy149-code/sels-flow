/**
 * Server side data access layer with scoping (Section 4).
 *
 * The rule this file exists to enforce: **scoping happens in the server, on
 * every query, and is not left to the UI.** A screen may hide a button, but
 * hiding is never the control.
 *
 * Two conventions:
 *  - A user who may not see a record gets `notFound()`, never `forbidden()`.
 *    A 403 on a guessed id confirms the record exists (decision D-011).
 *  - `customerScope`, `repScope` and `ownerScope` return reusable `where`
 *    fragments, so list screens and single-record reads cannot drift apart.
 */
import { Role, type Prisma } from '@prisma/client';
import { forbidden, notFound } from 'next/navigation';

import { isValidEgyptianPhone, normalizePhone } from '@/lib/auth/identifiers';
import { PERMISSIONS, roleCan, type Permission } from '@/lib/auth/permissions';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/server/auth/session';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when the signed in user lacks a permission. */
export class PermissionDenied extends Error {
  readonly permission: Permission;
  constructor(permission: Permission) {
    super(`missing permission: ${permission}`);
    this.name = 'PermissionDenied';
    this.permission = permission;
  }
}

/** Thrown for input that is well formed but out of range. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ---------------------------------------------------------------------------
// Identity resolution
// ---------------------------------------------------------------------------

export interface Actor {
  userId: string;
  role: Role;
  /** Rep id, set only for REP users. */
  repId: string | null;
  /** Customer id, set only for CUSTOMER users. */
  customerId: string | null;
  displayName: string;
}

/**
 * Loads the full actor from the session user. The rep and customer ids are read
 * from their own tables rather than trusted from a cookie.
 */
export async function loadActor(session: SessionUser): Promise<Actor> {
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: {
      id: true,
      role: true,
      rep: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true } },
    },
  });
  if (!user) throw new PermissionDenied('users:read');
  return {
    userId: user.id,
    role: user.role,
    repId: user.rep?.id ?? null,
    customerId: user.customer?.id ?? null,
    displayName: user.rep?.name ?? user.customer?.name ?? user.id,
  };
}

export function isAdmin(actor: Actor): boolean {
  return actor.role === Role.ADMIN;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * Screen level guard. A missing capability on a whole screen is a genuine 403,
 * rendered by the app's `forbidden()` page, so a rep cannot open the admin
 * screen by URL and see a blank shell.
 *
 * This is deliberately the screen level case only. A record the user may not see
 * resolves to `notFound()` instead, so a guessed id never confirms that the
 * record exists (decision D-011).
 */
export function requirePermission(actor: Actor, permission: Permission): void {
  if (!roleCan(actor.role, permission)) {
    logger.warn(
      { userId: actor.userId, role: actor.role, permission },
      'permission denied on screen',
    );
    forbidden();
  }
}

/** Throws instead of redirecting; used inside actions and route handlers. */
export function assertPermission(actor: Actor, permission: Permission): void {
  if (!roleCan(actor.role, permission)) {
    throw new PermissionDenied(permission);
  }
}

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

/** A uuid that no row can ever have, used to express "matches nothing". */
const NO_ROW = '00000000-0000-0000-0000-000000000000';

/**
 * A rep sees only his own customers; a customer sees only himself; a role that
 * holds `customers:read_all` sees all. Rep ownership itself arrives in Phase 3
 * with `customer_rep_assignments`; until then a rep sees nothing, which is the
 * safe direction to fail in.
 *
 * The decision is made by permission rather than by role name, so the map in
 * `lib/auth/permissions` stays the only place that answers "who may see what".
 */
export function customerScope(actor: Actor): Prisma.CustomerWhereInput {
  if (roleCan(actor.role, PERMISSIONS.CUSTOMERS_READ_ALL)) {
    return { deletedAt: null };
  }
  if (actor.role === Role.CUSTOMER) {
    return { id: actor.customerId ?? NO_ROW, deletedAt: null };
  }
  if (actor.role === Role.REP) {
    // Phase 3 replaces this with the assignment table lookup.
    return { id: NO_ROW, deletedAt: null };
  }
  return { id: NO_ROW, deletedAt: null };
}

/** Reps see their own row; a role that holds `reps:read_all` sees all. */
export function repScope(actor: Actor): Prisma.RepWhereInput {
  if (roleCan(actor.role, PERMISSIONS.REPS_READ_ALL)) {
    return { deletedAt: null };
  }
  if (actor.role === Role.REP) {
    return { id: actor.repId ?? NO_ROW, deletedAt: null };
  }
  return { id: NO_ROW, deletedAt: null };
}

/** A customer sees only documents addressed to him. */
export function customerDocumentScope(actor: Actor): { customerId: string } {
  if (actor.role === Role.CUSTOMER) {
    return { customerId: actor.customerId ?? NO_ROW };
  }
  if (actor.role === Role.REP) {
    // Phase 3 replaces the sentinel with the assignment subquery.
    return { customerId: NO_ROW };
  }
  return { customerId: NO_ROW };
}

/** A rep sees documents that belong to one of his customers. */
export function repDocumentScope(actor: Actor): { repId?: string; customerId?: string } {
  if (actor.role === Role.REP) {
    return { repId: actor.repId ?? NO_ROW };
  }
  if (actor.role === Role.CUSTOMER) {
    return { customerId: actor.customerId ?? NO_ROW };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Single record reads - the ID guessing defence
// ---------------------------------------------------------------------------

/**
 * Reads one customer by id, applying `customerScope`. A customer that exists
 * but is out of scope is indistinguishable from one that does not exist.
 */
export async function getCustomerScoped(actor: Actor, id: string) {
  const customer = await prisma.customer.findFirst({
    where: { AND: [{ id }, customerScope(actor)] },
  });
  if (!customer) notFound();
  return customer;
}

export async function getRepScoped(actor: Actor, id: string) {
  const rep = await prisma.rep.findFirst({ where: { AND: [{ id }, repScope(actor)] } });
  if (!rep) notFound();
  return rep;
}

/**
 * Generic guard for documents that do not exist yet (invoices, orders, ...).
 * The scope fragment is supplied by the phase that owns the table, and this
 * function guarantees the 404-on-out-of-scope behaviour is identical
 * everywhere. Later phases pass their own `where` and reuse this.
 */
export async function getScopedOrNotFound<T>(find: () => Promise<T | null>): Promise<T> {
  const record = await find();
  if (record === null || record === undefined) notFound();
  return record;
}

// ---------------------------------------------------------------------------
// Pagination, search, sorting (Section 3: on every list screen)
// ---------------------------------------------------------------------------

export const PAGE_SIZE = 25;

export interface ListQuery {
  page?: number;
  pageSize?: number;
  sort?: string;
  direction?: 'asc' | 'desc';
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export function pageFromQuery(query: ListQuery): {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
} {
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(5, Math.floor(query.pageSize ?? PAGE_SIZE)));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export async function paginate<T>(
  query: ListQuery,
  count: () => Promise<number>,
  find: (page: { skip: number; take: number }) => Promise<T[]>,
): Promise<Page<T>> {
  const { page, pageSize, skip, take } = pageFromQuery(query);
  const [total, rows] = await Promise.all([count(), find({ skip, take })]);
  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Only allow columns the screen declares; blocks sort injection. */
export function safeOrderBy<T extends string>(
  allowed: readonly T[],
  requested: string | undefined,
  direction: 'asc' | 'desc' | undefined,
  fallback: Record<string, 'asc' | 'desc'>,
): Record<string, 'asc' | 'desc'> {
  if (requested && (allowed as readonly string[]).includes(requested)) {
    return { [requested]: direction === 'asc' ? 'asc' : 'desc' };
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Validation helpers used by every write path
// ---------------------------------------------------------------------------

export function requirePhone(raw: string): string {
  if (!isValidEgyptianPhone(raw)) {
    throw new ValidationError('phone must be a valid Egyptian mobile number');
  }
  return normalizePhone(raw);
}

export function requireOneOf<T extends string>(value: string, allowed: readonly T[]): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`value must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

export function requireId(value: string, label = 'id'): string {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(value)) {
    // An id that is not a uuid never reaches the database, which keeps
    // malformed input out of the query planner.
    throw new ValidationError(`${label} is malformed`);
  }
  return value;
}
