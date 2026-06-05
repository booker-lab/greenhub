import type { FirestoreService } from '../firestore/firestore.service';

export interface QueryAdminInvitesInput {
  q?: string;
  limit?: number;
  cursor?: string;
}

const DEFAULT_INVITES_LIMIT = 50;
const MAX_INVITES_LIMIT = 100;
const MIN_SEARCH_PREFIX_LENGTH = 4;

function inviteQueryLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_INVITES_LIMIT;
  return Math.max(1, Math.min(MAX_INVITES_LIMIT, Math.trunc(limit ?? DEFAULT_INVITES_LIMIT)));
}

function invitePrefix(q?: string): string | null {
  const prefix = q?.trim().toUpperCase();
  return prefix && prefix.length >= MIN_SEARCH_PREFIX_LENGTH ? prefix : null;
}

function toInviteCreatedAtCursor(value: unknown): string | null {
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const toDate = (value as { toDate?: unknown }).toDate;
    if (typeof toDate === 'function') return toDate().toISOString();
  }
  if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

export function createInviteTokenPrefixes(token: string): string[] {
  const normalized = token.trim().toUpperCase();
  const prefixes = new Set<string>();
  for (let length = MIN_SEARCH_PREFIX_LENGTH; length <= normalized.length; length += 1) {
    prefixes.add(normalized.slice(0, length));
  }
  return [...prefixes];
}

export async function getInvitesPage(firestore: FirestoreService, input: QueryAdminInvitesInput) {
  const limit = inviteQueryLimit(input.limit);
  const prefix = invitePrefix(input.q);
  let query = firestore.collection('invites') as any;

  if (prefix) {
    query = query.where('tokenPrefixes', 'array-contains', prefix).orderBy('createdAt', 'desc');
    if (input.cursor) {
      query = query.startAfter(firestore.Timestamp.fromDate(new Date(input.cursor)));
    }
  } else {
    query = query.orderBy('createdAt', 'desc');
    if (input.cursor) {
      query = query.startAfter(firestore.Timestamp.fromDate(new Date(input.cursor)));
    }
  }

  const snap = await query.limit(limit + 1).get();
  const docs = snap.docs.slice(0, limit);
  const nextDoc = snap.docs.length > limit ? docs.at(-1) : null;

  return {
    invites: docs.map((d: any) => d.data()),
    nextCursor: nextDoc ? toInviteCreatedAtCursor(nextDoc.data()?.createdAt) : null,
  };
}
