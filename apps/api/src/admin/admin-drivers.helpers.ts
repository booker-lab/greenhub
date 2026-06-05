import type { FirestoreService } from '../firestore/firestore.service';
import { toIsoCursor } from './admin-settlements.helpers';
import type { QueryAdminDriversDto } from './dto/admin.dto';

export type DriverRow = {
  id: string;
  name: string;
  email: string | null;
  phone?: string | null;
  vehicleType?: string | null;
  vehicleNumber?: string | null;
  driverApproved: boolean;
  suspended?: boolean;
  createdAt: unknown;
};

export function adminDriversLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? 100, 1), 500);
}

export function adminDriversSort(sort?: QueryAdminDriversDto['sort']): 'asc' | 'desc' {
  return sort === 'createdAt_asc' ? 'asc' : 'desc';
}

export function applyDriverStatusQuery(query: any, status?: QueryAdminDriversDto['status']) {
  if (status === 'pending') {
    return query.where('driverApproved', '==', false);
  }
  if (status === 'approved') {
    return query.where('driverApproved', '==', true);
  }
  if (status === 'suspended') {
    return query.where('suspended', '==', true);
  }
  return query;
}

export function driverCursorDate(cursor?: string): Date | null {
  if (!cursor) return null;
  const date = new Date(cursor);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function sanitizeDriverRow(row: DriverRow & { passwordHash?: unknown }): DriverRow {
  const { passwordHash: _passwordHash, ...user } = row;
  return {
    ...user,
    phone: user.phone ?? null,
    vehicleType: user.vehicleType ?? null,
    vehicleNumber: user.vehicleNumber ?? null,
  };
}

function matchesDriverStatus(row: DriverRow, status?: QueryAdminDriversDto['status']) {
  if (status === 'pending') return !row.driverApproved && !row.suspended;
  if (status === 'approved') return row.driverApproved && !row.suspended;
  if (status === 'suspended') return !!row.suspended;
  return true;
}

export async function getDriversPage(firestore: FirestoreService, dto: QueryAdminDriversDto) {
  const limit = adminDriversLimit(dto.limit);
  const sortDirection = adminDriversSort(dto.sort);
  let query = firestore.collection('users').where('role', '==', 'driver') as any;

  query = applyDriverStatusQuery(query, dto.status);
  query = query.orderBy('createdAt', sortDirection);

  let cursorDate = driverCursorDate(dto.cursor);
  const filteredDocs: { data: () => DriverRow & { passwordHash?: unknown } }[] = [];

  while (filteredDocs.length < limit + 1) {
    let pageQuery = query;
    if (cursorDate) {
      pageQuery = pageQuery.startAfter(firestore.Timestamp.fromDate(cursorDate));
    }

    const snap = await pageQuery.limit(limit + 1).get();
    if (snap.docs.length === 0) break;

    for (const doc of snap.docs as { data: () => DriverRow & { passwordHash?: unknown } }[]) {
      if (matchesDriverStatus(doc.data(), dto.status)) filteredDocs.push(doc);
      if (filteredDocs.length >= limit + 1) break;
    }

    const lastScanned = snap.docs.at(-1);
    const nextScanCursor = lastScanned ? toIsoCursor(lastScanned.data()?.createdAt) : null;
    if (snap.docs.length < limit + 1 || !nextScanCursor) break;
    cursorDate = new Date(nextScanCursor);
  }

  const docs = filteredDocs.slice(0, limit);
  const nextDoc = filteredDocs.length > limit ? docs.at(-1) : null;
  const drivers: DriverRow[] = docs.map(
    (d: { data: () => DriverRow & { passwordHash?: unknown } }) => sanitizeDriverRow(d.data()),
  );

  return {
    drivers,
    total: drivers.length,
    nextCursor: nextDoc ? toIsoCursor(nextDoc.data()?.createdAt) : null,
  };
}
