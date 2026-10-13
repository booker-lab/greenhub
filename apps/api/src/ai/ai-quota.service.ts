import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirestoreService } from '../firestore/firestore.service';

export const AI_USAGE_COLLECTION = 'aiUsage';
export const DEFAULT_AI_DAILY_LIMIT = 30;
export const AI_DAILY_LIMIT_ENV = 'AI_DAILY_GENERATION_LIMIT';
export const AI_QUOTA_EXCEEDED_MESSAGE =
  '오늘 사용할 수 있는 AI 생성 횟수를 모두 사용했습니다. 내일 다시 시도해주세요.';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST 기준 날짜(YYYY-MM-DD). 일일 한도는 KST 자정에 초기화된다. */
export function kstDateKey(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 사용자별 AI 생성 일일 한도.
 * aiUsage/{uid}_{KST 날짜} 문서의 count를 트랜잭션으로 증가시키고,
 * 한도에 도달하면 Gemini 호출 전에 429를 반환한다.
 */
@Injectable()
export class AiQuotaService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly config: ConfigService,
  ) {}

  dailyLimit(): number {
    const raw = Number(this.config.get<string>(AI_DAILY_LIMIT_ENV));
    return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_AI_DAILY_LIMIT;
  }

  async consume(uid: string, now: Date = new Date()): Promise<number> {
    const limit = this.dailyLimit();
    const date = kstDateKey(now);
    const ref = this.firestore.collection(AI_USAGE_COLLECTION).doc(`${uid}_${date}`);

    return this.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? Number(snap.data()?.count ?? 0) : 0;
      if (current >= limit) {
        throw new HttpException(AI_QUOTA_EXCEEDED_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
      }
      const count = current + 1;
      tx.set(ref, { uid, date, count, updatedAt: now.toISOString() });
      return count;
    });
  }
}
