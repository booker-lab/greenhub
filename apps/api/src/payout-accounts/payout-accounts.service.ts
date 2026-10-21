import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service';
import { assertStoreOwnerOrAdmin } from '../common/store-ownership';
import { FirestoreService } from '../firestore/firestore.service';
import type { UpsertPayoutAccountDto } from './dto/upsert-payout-account.dto';
import {
  STORE_PAYOUT_ACCOUNTS_COLLECTION,
  accountNumberLast4,
  readPayoutAccount,
  toMaskedPayoutAccount,
} from './payout-account.fields';

@Injectable()
export class PayoutAccountsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly audit: AuditService,
  ) {}

  /** 판매자 본인(또는 관리자)이 보는 계좌. 계좌번호는 끝 4자리 외를 가린다. */
  async getForStore(storeId: string, userId: string, role: string) {
    await assertStoreOwnerOrAdmin(this.firestore, storeId, userId, role);
    const snap = await this.firestore.doc(this.path(storeId)).get();
    return { account: snap.exists ? toMaskedPayoutAccount(snap.data()) : null };
  }

  /**
   * 판매자 본인(또는 관리자)이 계좌를 저장한다. 저장과 행동 기록을 한 트랜잭션에 쓴다.
   * 행동 기록에는 예금주·전체 계좌번호를 넣지 않고 은행과 끝 4자리만 남긴다.
   */
  async upsert(storeId: string, userId: string, role: string, dto: UpsertPayoutAccountDto) {
    await assertStoreOwnerOrAdmin(this.firestore, storeId, userId, role);
    const storeSnap = await this.firestore.doc(`stores/${storeId}`).get();
    if (!storeSnap.exists) throw new NotFoundException('스토어를 찾을 수 없습니다.');

    const next = {
      bankName: dto.bankName.trim(),
      accountHolder: dto.accountHolder.trim(),
      accountNumber: dto.accountNumber.trim(),
    };
    const ref = this.firestore.doc(this.path(storeId));
    const saved = await this.firestore.runTransaction(async (tx) => {
      const previous = readPayoutAccount((await tx.get(ref)).data());
      const now = this.firestore.Timestamp.now();
      const record = { storeId, ...next, updatedAt: now, updatedBy: userId };
      tx.set(ref, record);
      await this.audit.logAdmin(
        {
          action: 'store.payout_account.updated',
          actorId: userId,
          targetType: 'store',
          targetId: storeId,
          before: previous
            ? {
                bankName: previous.bankName,
                accountNumberLast4: accountNumberLast4(previous.accountNumber),
              }
            : null,
          after: { bankName: next.bankName, accountNumberLast4: accountNumberLast4(next.accountNumber) },
        },
        tx,
      );
      return record;
    });
    return { account: toMaskedPayoutAccount(saved) };
  }

  /** 관리자 지급용 — 전체 계좌번호를 보낸다. */
  async getForAdmin(storeId: string) {
    const snap = await this.firestore.doc(this.path(storeId)).get();
    const account = snap.exists ? readPayoutAccount(snap.data()) : null;
    return {
      account: account ? { ...account, updatedAt: snap.data()?.['updatedAt'] ?? null } : null,
    };
  }

  private path(storeId: string) {
    return `${STORE_PAYOUT_ACCOUNTS_COLLECTION}/${storeId}`;
  }
}
