import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { FirestoreService } from '../firestore/firestore.service';

/**
 * 정해진 시각에 도는 작업(cron)이 여러 API 인스턴스(배포 겹침·복제본)에서 같은 회차에 한 번만
 * 실행되도록 잡는 lease. 서버 전용 문서 `jobLeases/{jobName}`에 보유자·만료 시각·마지막 완료 회차를
 * 트랜잭션으로 기록한다. 클라이언트 접근은 firestore.rules 기본 거부가 막는다.
 *
 * lease 획득·완료 기록은 절대 throw하지 않는다(로그만 남기고 결과로 알린다). 작업 자체의 오류는
 * 호출자가 기존대로 다룬다.
 */
export const JOB_LEASE_COLLECTION = 'jobLeases';

const JOB_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type JobLeaseFirestore = Pick<FirestoreService, 'doc' | 'runTransaction'>;

export interface JobLease {
  jobName: string;
  slotKey: string;
  holderId: string;
}

export type JobLeaseAcquireResult =
  | { status: 'ACQUIRED'; lease: JobLease }
  /** 같은 회차가 이미 끝났다. */
  | { status: 'ALREADY_DONE' }
  /** 다른 실행이 유효한 lease를 가지고 있다. */
  | { status: 'HELD' }
  /** lease 문서를 읽거나 쓰지 못했다(저장소 장애 등). */
  | { status: 'UNAVAILABLE' };

export interface AcquireJobLeaseInput {
  jobName: string;
  slotKey: string;
  ttlMs: number;
  now?: () => number;
  logger?: Pick<Logger, 'log' | 'warn' | 'error'>;
}

const defaultLogger = new Logger('JobLease');

/** 서울 기준 날짜(YYYY-MM-DD). 하루 한 번 도는 작업의 회차 키로 쓴다. */
export function seoulDailySlotKey(now: Date = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function acquireJobLease(
  firestore: JobLeaseFirestore,
  input: AcquireJobLeaseInput,
): Promise<JobLeaseAcquireResult> {
  const logger = input.logger ?? defaultLogger;
  const now = input.now ?? Date.now;
  if (!JOB_NAME_PATTERN.test(input.jobName) || input.slotKey.length === 0) {
    logger.error(`[JobLease] 작업 이름 또는 회차 키 형식이 올바르지 않습니다: ${input.jobName}`);
    return { status: 'UNAVAILABLE' };
  }
  const holderId = randomUUID();
  try {
    const ref = firestore.doc(`${JOB_LEASE_COLLECTION}/${input.jobName}`);
    // 커밋된 시도의 반환값만으로 결정한다(재시도된 트랜잭션의 중간 판단이 새지 않게).
    const status = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const data = (snapshot.exists ? snapshot.data() : undefined) ?? {};
      if (data['lastCompletedSlot'] === input.slotKey) return 'ALREADY_DONE' as const;
      const currentAt = now();
      if (
        typeof data['holderId'] === 'string' &&
        typeof data['expiresAt'] === 'number' &&
        data['expiresAt'] > currentAt
      ) {
        return 'HELD' as const;
      }
      transaction.set(
        ref,
        {
          holderId,
          slotKey: input.slotKey,
          expiresAt: currentAt + input.ttlMs,
          acquiredAt: new Date(currentAt),
        },
        { merge: true },
      );
      return 'ACQUIRED' as const;
    });
    if (status === 'ACQUIRED') {
      return { status, lease: { jobName: input.jobName, slotKey: input.slotKey, holderId } };
    }
    logger.log(`[JobLease] ${input.jobName} ${input.slotKey} 건너뜀: ${status}`);
    return { status };
  } catch (error) {
    logger.error(`[JobLease] ${input.jobName} lease 획득 실패: ${errorMessage(error)}`);
    return { status: 'UNAVAILABLE' };
  }
}

/**
 * 작업이 끝나면 lease를 푼다. 성공이면 회차를 완료로 기록해 같은 회차가 다시 돌지 않게 하고,
 * 실패면 lease만 풀어 다른 실행이 다시 시도할 수 있게 한다. 이미 다른 보유자에게 넘어간 lease는
 * 건드리지 않는다. 기록 실패는 throw하지 않고 false를 돌려준다(lease는 만료로 풀린다).
 */
export async function completeJobLease(
  firestore: JobLeaseFirestore,
  lease: JobLease,
  options: {
    succeeded: boolean;
    now?: () => number;
    logger?: Pick<Logger, 'log' | 'warn' | 'error'>;
  },
): Promise<boolean> {
  const logger = options.logger ?? defaultLogger;
  const now = options.now ?? Date.now;
  try {
    const ref = firestore.doc(`${JOB_LEASE_COLLECTION}/${lease.jobName}`);
    const released = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const data = (snapshot.exists ? snapshot.data() : undefined) ?? {};
      if (data['holderId'] !== lease.holderId) return false;
      transaction.set(
        ref,
        options.succeeded
          ? {
              holderId: null,
              expiresAt: null,
              lastCompletedSlot: lease.slotKey,
              completedAt: new Date(now()),
            }
          : { holderId: null, expiresAt: null },
        { merge: true },
      );
      return true;
    });
    if (!released) {
      logger.warn(
        `[JobLease] ${lease.jobName} ${lease.slotKey} lease가 이미 다른 실행에 넘어갔습니다.`,
      );
    }
    return released;
  } catch (error) {
    logger.error(`[JobLease] ${lease.jobName} lease 해제 실패: ${errorMessage(error)}`);
    return false;
  }
}
