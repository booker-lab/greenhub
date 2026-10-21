import { BeforeApplicationShutdown, Injectable, Logger, Optional } from '@nestjs/common';
import { OpsAlertService } from '../ops-alerts/ops-alert.service';

// 상태 전이 고객 알림을 응답 뒤에 보낸다. 알림톡 발송·멱등 기록(Firestore 트랜잭션 여러 번)과
// 알리고 재시도(최악 수십 초)를 판매자·기사가 기다리지 않게 하려는 것이다.
// - 같은 주문의 알림은 들어온 순서대로 하나씩 보낸다(배송 시작 → 배송 완료 순서 유지).
// - 알림 작업은 결정적인 멱등 키를 쓰므로(order-transition-notice.ts) 예외가 나면 짧게 다시 시도해도
//   중복 발송되지 않는다. 알리고 거절·연락처 없음 같은 결과는 예외가 아니라 알림 서비스가 운영 이슈로 남긴다.
// - 다시 시도해도 예외가 나면 오류 로그와 운영 알림(텔레그램)으로 남긴다. 상태 변경은 이미 끝났으므로
//   요청 결과를 바꾸지 않는다.
// - 서버 종료 신호를 받으면 남은 알림을 정해진 시간까지 기다린다. 그 뒤에 끝나는 요청의 알림은 응답 전에
//   보낸다(Nest는 HTTP 요청을 마무리한 다음 Firestore 연결을 닫으므로, 응답 뒤로 미루면 연결이 먼저 닫힌다).
export const ORDER_NOTICE_RETRY_DELAYS_MS: readonly number[] = [1_000, 4_000];
export const ORDER_NOTICE_SHUTDOWN_WAIT_MS = 30_000;

@Injectable()
export class OrderNoticeDispatcher implements BeforeApplicationShutdown {
  private readonly logger = new Logger(OrderNoticeDispatcher.name);
  private readonly tails = new Map<string, Promise<void>>();
  private readonly pending = new Set<Promise<void>>();
  private shuttingDown = false;

  constructor(@Optional() private readonly opsAlerts?: OpsAlertService) {}

  /**
   * 알림 작업을 맡긴다. 평소에는 바로 끝나는 Promise를 돌려주고, 종료 중에는 알림 처리가 끝날 때
   * 끝나는 Promise를 돌려준다. 어느 쪽도 reject하지 않는다.
   */
  dispatch(orderId: string, label: string, task: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(orderId) ?? Promise.resolve();
    const current = previous.then(() => this.runWithRetry(orderId, label, task));
    this.tails.set(orderId, current);
    this.pending.add(current);
    void current.finally(() => {
      this.pending.delete(current);
      if (this.tails.get(orderId) === current) this.tails.delete(orderId);
    });
    return this.shuttingDown ? current : Promise.resolve();
  }

  /** 지금까지 맡은 알림이 모두 끝날 때까지 기다린다(종료 처리·테스트용). */
  async drain(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.pending.size === 0) return;
    const count = this.pending.size;
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), ORDER_NOTICE_SHUTDOWN_WAIT_MS);
    });
    const finished = await Promise.race([this.drain().then(() => false), timedOut]);
    clearTimeout(timer);
    if (finished) {
      this.logger.error(
        `종료 대기 시간 안에 고객 알림을 다 보내지 못했습니다 (남은 주문 ${this.pending.size}건, 시작 ${count}건)`,
      );
    }
  }

  private async runWithRetry(
    orderId: string,
    label: string,
    task: () => Promise<void>,
  ): Promise<void> {
    const attempts = ORDER_NOTICE_RETRY_DELAYS_MS.length + 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await task();
        return;
      } catch (error) {
        const reason = describeError(error);
        if (attempt < attempts) {
          this.logger.warn(
            `고객 알림 처리 예외, 다시 시도합니다 (orderId=${orderId}, ${label}, ${attempt}/${attempts}, error=${reason})`,
          );
          await this.sleep(ORDER_NOTICE_RETRY_DELAYS_MS[attempt - 1]);
          continue;
        }
        // 주문 id·전이·오류 종류만 남긴다(고객 연락처·본문은 남기지 않는다).
        this.logger.error(
          `고객 알림을 보내지 못했습니다 (orderId=${orderId}, ${label}, error=${reason})`,
        );
        await this.alertFailure(orderId, label, reason);
      }
    }
  }

  private async alertFailure(orderId: string, label: string, reason: string) {
    if (!this.opsAlerts?.enabled) return;
    await this.opsAlerts
      .send({
        level: 'warning',
        title: '고객 상태 알림 발송 예외',
        lines: [
          `주문 ${orderId} · ${label}`,
          `오류 ${reason}`,
          '주문 상태는 바뀌었고 고객 알림만 못 갔을 수 있습니다. 알림 기록을 확인하세요.',
        ],
        dedupeKey: `order-notice:${orderId}:${label}`,
      })
      .catch(() => undefined);
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function describeError(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code !== undefined && code !== null) return String(code);
  return error instanceof Error ? error.name : 'unknown';
}
