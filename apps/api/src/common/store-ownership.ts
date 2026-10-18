import { ForbiddenException } from '@nestjs/common';
import type { FirestoreService } from '../firestore/firestore.service';

/** 판매자는 자기 매장만, 관리자는 모든 매장을 다룬다(products/hubs 서비스와 같은 기준). */
export async function assertStoreOwnerOrAdmin(
  firestore: FirestoreService,
  storeId: string,
  userId: string,
  role?: string,
): Promise<void> {
  if (role === 'admin') return;
  const snap = await firestore.doc(`stores/${storeId}`).get();
  if (!snap.exists || snap.data()?.['ownerId'] !== userId) {
    throw new ForbiddenException('권한이 없습니다.');
  }
}

/** 이름 가리기: "김그린" → "김*린", "김그" → "김*", 한 글자는 그대로 "*". */
export function maskDisplayName(name: unknown): string {
  const text = typeof name === 'string' ? name.trim() : '';
  const chars = [...text];
  if (chars.length === 0) return '구매자';
  if (chars.length === 1) return '*';
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${'*'.repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}
