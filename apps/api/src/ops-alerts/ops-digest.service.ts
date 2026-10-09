import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FirestoreService } from '../firestore/firestore.service';
import { OpsAlertService } from './ops-alert.service';

const STALE_PENDING_MS = 20 * 60_000;

function millis(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (value && typeof value === 'object') {
    const record = value as { toMillis?: () => number; _seconds?: number; seconds?: number };
    if (typeof record.toMillis === 'function') return record.toMillis();
    const seconds = record._seconds ?? record.seconds;
    if (typeof seconds === 'number') return seconds * 1000;
  }
  return null;
}

export interface OpsDigest {
  openIssues: { critical: number; warning: number; info: number };
  stalePendingOrders: number;
  heldOrders: number;
  confirmedSettlements: { count: number; netAmount: number };
}

// 매일 아침 운영 요약(건수만, 개인정보 없음). 이상이 없어도 보내 알림 경로가 살아 있음을 확인한다.
@Injectable()
export class OpsDigestService {
  private readonly logger = new Logger(OpsDigestService.name);

  constructor(
    private readonly firestore: FirestoreService,
    private readonly alerts: OpsAlertService,
  ) {}

  async collect(nowMillis = Date.now()): Promise<OpsDigest> {
    const [issues, pending, held, confirmed] = await Promise.all([
      this.firestore.collection('operationIssues').where('status', '==', 'OPEN').get(),
      this.firestore.collection('orders').where('status', '==', 'PENDING').get(),
      this.firestore.collection('orders').where('status', '==', 'DELIVERY_HELD').get(),
      this.firestore.collection('settlements').where('status', '==', 'confirmed').get(),
    ]);
    const openIssues = { critical: 0, warning: 0, info: 0 };
    for (const doc of issues.docs) {
      const severity = doc.data()['severity'];
      if (severity === 'critical' || severity === 'warning' || severity === 'info') {
        openIssues[severity] += 1;
      }
    }
    const stalePendingOrders = pending.docs.filter((doc: any) => {
      const created = millis(doc.data()['createdAt']);
      return created !== null && nowMillis - created > STALE_PENDING_MS;
    }).length;
    const netAmount = confirmed.docs.reduce(
      (sum: number, doc: any) => sum + (Number(doc.data()['netAmount']) || 0),
      0,
    );
    return {
      openIssues,
      stalePendingOrders,
      heldOrders: held.size,
      confirmedSettlements: { count: confirmed.size, netAmount },
    };
  }

  static format(digest: OpsDigest): { level: 'critical' | 'warning' | 'info'; lines: string[] } {
    const { openIssues } = digest;
    const totalIssues = openIssues.critical + openIssues.warning + openIssues.info;
    const lines = [
      `운영 확인 필요 ${totalIssues}건 (긴급 ${openIssues.critical} · 주의 ${openIssues.warning})`,
      `결제 대기 20분 넘은 주문 ${digest.stalePendingOrders}건`,
      `배송 보류 주문 ${digest.heldOrders}건`,
      `지급 대기 정산 ${digest.confirmedSettlements.count}건 · ${digest.confirmedSettlements.netAmount.toLocaleString('ko-KR')}원`,
    ];
    const level =
      openIssues.critical > 0 || digest.stalePendingOrders > 0
        ? 'critical'
        : totalIssues > 0 || digest.heldOrders > 0
          ? 'warning'
          : 'info';
    return { level, lines };
  }

  @Cron('30 8 * * *', { timeZone: 'Asia/Seoul' })
  async sendDailyDigest(): Promise<void> {
    if (!this.alerts.enabled) return;
    try {
      const { level, lines } = OpsDigestService.format(await this.collect());
      await this.alerts.send({ level, title: '아침 운영 요약', lines });
    } catch (error) {
      this.logger.error(
        `[OpsDigest] 요약 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.alerts.send({
        level: 'warning',
        title: '아침 운영 요약을 만들지 못했습니다',
        lines: ['서버 로그를 확인하세요.'],
      });
    }
  }
}
