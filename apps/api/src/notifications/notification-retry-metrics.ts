import type { ProviderErrorClass } from './aligo.client';

export type NotificationRetryMetricsChannel = 'alimtalk' | 'sms';

export type NotificationRetryDelayStats = {
  count: number;
  totalMs: number;
  minMs: number | null;
  maxMs: number | null;
  lastMs: number | null;
};

export type NotificationRetryChannelMetrics = {
  errorClassCounts: Record<ProviderErrorClass, number>;
  appliedRetryDelay: NotificationRetryDelayStats;
};

export type NotificationRetryMetricsSnapshot = {
  channels: Record<NotificationRetryMetricsChannel, NotificationRetryChannelMetrics>;
};

const NOTIFICATION_RETRY_METRICS_CHANNELS: readonly NotificationRetryMetricsChannel[] = [
  'alimtalk',
  'sms',
];

const NOTIFICATION_RETRY_METRICS_ERROR_CLASSES: readonly ProviderErrorClass[] = [
  'RATE_LIMITED',
  'RETRYABLE',
  'PERMANENT',
  'UNKNOWN',
];

type NotificationRetryMetricsState = {
  errorClassCounts: Record<ProviderErrorClass, number>;
  appliedRetryDelay: NotificationRetryDelayStats;
};

function emptyErrorClassCounts(): Record<ProviderErrorClass, number> {
  return { RATE_LIMITED: 0, RETRYABLE: 0, PERMANENT: 0, UNKNOWN: 0 };
}

function emptyDelayStats(): NotificationRetryDelayStats {
  return { count: 0, totalMs: 0, minMs: null, maxMs: null, lastMs: null };
}

// In-process 관측 recorder. 알림톡/SMS 전달 경로가 채널별 provider 오류 분류
// counter와 재시도 사이 적용 지연을 기록·노출한다. 관측 기록은 채널·오류 분류·
// 지연 밀리초만 담고 전화번호·본문·provider receipt 등 PII는 기록하지 않는다.
// 관측이 전달 경로를 깨지 않도록 잘못된 입력은 예외 없이 무시한다.
export class NotificationRetryMetricsRecorder {
  private readonly state = new Map<NotificationRetryMetricsChannel, NotificationRetryMetricsState>(
    NOTIFICATION_RETRY_METRICS_CHANNELS.map((channel) => [
      channel,
      { errorClassCounts: emptyErrorClassCounts(), appliedRetryDelay: emptyDelayStats() },
    ]),
  );

  recordProviderErrorClassification(
    channel: NotificationRetryMetricsChannel,
    errorClass: ProviderErrorClass,
  ): void {
    const entry = this.state.get(channel);
    if (!entry) return;
    if (!NOTIFICATION_RETRY_METRICS_ERROR_CLASSES.includes(errorClass)) return;
    entry.errorClassCounts[errorClass] += 1;
  }

  recordAppliedRetryDelay(channel: NotificationRetryMetricsChannel, delayMs: number): void {
    const entry = this.state.get(channel);
    if (!entry) return;
    if (typeof delayMs !== 'number' || !Number.isFinite(delayMs) || delayMs < 0) return;
    const stats = entry.appliedRetryDelay;
    stats.count += 1;
    stats.totalMs += delayMs;
    stats.minMs = stats.minMs === null ? delayMs : Math.min(stats.minMs, delayMs);
    stats.maxMs = stats.maxMs === null ? delayMs : Math.max(stats.maxMs, delayMs);
    stats.lastMs = delayMs;
  }

  snapshot(): NotificationRetryMetricsSnapshot {
    const channels = {} as Record<NotificationRetryMetricsChannel, NotificationRetryChannelMetrics>;
    for (const [channel, entry] of this.state) {
      channels[channel] = {
        errorClassCounts: { ...entry.errorClassCounts },
        appliedRetryDelay: { ...entry.appliedRetryDelay },
      };
    }
    return { channels };
  }
}

// Process 공유 기본 instance. AligoClient는 별도 recorder를 주입하지 않으면
// 이 instance에 기록하며, in-process 관측 노출도 이 instance로 읽는다.
export const notificationRetryMetrics = new NotificationRetryMetricsRecorder();
