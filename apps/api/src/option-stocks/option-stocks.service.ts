import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../common/audit/audit.service';
import { assertStoreOwnerOrAdmin } from '../common/store-ownership';
import { FirestoreService } from '../firestore/firestore.service';
import type { CreateOptionStockDto, UpdateOptionStockDto } from './dto/option-stock.dto';
import {
  OPTION_STOCKS_COLLECTION,
  OPTION_STOCK_ID_PATTERN,
  optionStockPath,
  toOptionStock,
} from './option-stock.fields';

/**
 * 매장 옵션 재고 품목(예: 직접 출력한 화분)을 판매자가 관리한다.
 * 결제 중·결제 완료 수량(reservedQuantity·orderedQuantity)은 주문 예약(OrderCapacityService)만 바꾸고,
 * 여기서는 넣은 수량(stockQuantity)과 이름만 바꾼다.
 */
@Injectable()
export class OptionStocksService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly audit: AuditService,
  ) {}

  async list(storeId: string, userId: string, role: string) {
    await assertStoreOwnerOrAdmin(this.firestore, storeId, userId, role);
    const snap = await this.firestore
      .collection(OPTION_STOCKS_COLLECTION)
      .where('storeId', '==', storeId)
      .get();
    const stocks = snap.docs
      .map((doc) => toOptionStock(doc.id, doc.data()))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return { stocks };
  }

  async create(storeId: string, userId: string, role: string, dto: CreateOptionStockDto) {
    await assertStoreOwnerOrAdmin(this.firestore, storeId, userId, role);
    const storeSnap = await this.firestore.doc(`stores/${storeId}`).get();
    if (!storeSnap.exists) throw new NotFoundException('스토어를 찾을 수 없습니다.');

    const id = randomUUID();
    const ref = this.firestore.doc(optionStockPath(id));
    const record = await this.firestore.runTransaction(async (tx) => {
      // 주문 예약이 같은 문서에 ISO 문자열로 시각을 쓰므로 같은 형식을 쓴다.
      const now = this.nowIso();
      const next = {
        id,
        storeId,
        name: dto.name.trim(),
        stockQuantity: dto.quantity,
        reservedQuantity: 0,
        orderedQuantity: 0,
        createdAt: now,
        updatedAt: now,
        updatedBy: userId,
      };
      tx.set(ref, next);
      await this.audit.logAdmin(
        {
          action: 'store.option_stock.created',
          actorId: userId,
          targetType: 'store',
          targetId: storeId,
          before: null,
          after: { stockId: id, name: next.name, stockQuantity: next.stockQuantity },
        },
        tx,
      );
      return next;
    });
    return { stock: toOptionStock(id, record) };
  }

  async update(
    storeId: string,
    stockId: string,
    userId: string,
    role: string,
    dto: UpdateOptionStockDto,
  ) {
    await assertStoreOwnerOrAdmin(this.firestore, storeId, userId, role);
    if (dto.addQuantity !== undefined && dto.remainingQuantity !== undefined) {
      throw new BadRequestException('더할 수량과 남은 수량 중 하나만 보내 주세요.');
    }
    if (dto.name === undefined && dto.addQuantity === undefined && dto.remainingQuantity === undefined) {
      throw new BadRequestException('바꿀 내용이 없습니다.');
    }
    if (!OPTION_STOCK_ID_PATTERN.test(stockId)) {
      throw new NotFoundException('재고 품목을 찾을 수 없습니다.');
    }

    const ref = this.firestore.doc(optionStockPath(stockId));
    const saved = await this.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? (snap.data() as Record<string, unknown>) : undefined;
      if (!current || current['storeId'] !== storeId) {
        throw new NotFoundException('재고 품목을 찾을 수 없습니다.');
      }
      const before = toOptionStock(stockId, current);
      // 결제 중·결제 완료 수량이 숫자가 아니면 남은 수량을 맞출 수 없다(주문 예약 쪽과 같이 막는다).
      const counted = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
      if (
        !counted(current['stockQuantity']) ||
        !counted(current['reservedQuantity'] ?? 0) ||
        !counted(current['orderedQuantity'] ?? 0)
      ) {
        throw new ConflictException('재고 수량 상태가 올바르지 않아 처리할 수 없습니다.');
      }
      let stockQuantity = before.stockQuantity;
      if (dto.addQuantity !== undefined) stockQuantity += dto.addQuantity;
      if (dto.remainingQuantity !== undefined) {
        stockQuantity = dto.remainingQuantity + before.reservedQuantity + before.orderedQuantity;
      }
      const now = this.nowIso();
      const patch = {
        name: dto.name !== undefined ? dto.name.trim() : before.name,
        stockQuantity,
        updatedAt: now,
        updatedBy: userId,
      };
      tx.update(ref, patch);
      const after = toOptionStock(stockId, { ...current, ...patch });
      await this.audit.logAdmin(
        {
          action: 'store.option_stock.updated',
          actorId: userId,
          targetType: 'store',
          targetId: storeId,
          before: {
            stockId,
            name: before.name,
            stockQuantity: before.stockQuantity,
            remainingQuantity: before.remainingQuantity,
          },
          after: {
            stockId,
            name: after.name,
            stockQuantity: after.stockQuantity,
            remainingQuantity: after.remainingQuantity,
          },
        },
        tx,
      );
      return after;
    });
    return { stock: saved };
  }

  private nowIso(): string {
    const now: unknown = this.firestore.Timestamp.now();
    return (now instanceof Date ? now : (now as { toDate(): Date }).toDate()).toISOString();
  }
}

/**
 * 상품 옵션 선택지가 가리키는 재고 품목이 모두 이 매장 것인지 확인한다(상품 저장 때 쓴다).
 * 다른 매장 품목을 가리키면 그 매장 재고를 줄이게 되므로 막는다.
 */
export async function assertOptionStocksBelongToStore(
  firestore: FirestoreService,
  storeId: string,
  options: ReadonlyArray<{ choices: ReadonlyArray<{ stockId?: string }> }> | undefined,
): Promise<void> {
  const stockIds = [
    ...new Set(
      (options ?? []).flatMap((group) =>
        group.choices.map((choice) => choice.stockId).filter((id): id is string => !!id),
      ),
    ),
  ];
  if (stockIds.length === 0) return;
  const snaps = await Promise.all(stockIds.map((id) => firestore.doc(optionStockPath(id)).get()));
  if (snaps.some((snap) => !snap.exists || snap.data()?.['storeId'] !== storeId)) {
    throw new BadRequestException('옵션에 연결한 재고 품목을 찾을 수 없습니다.');
  }
}
