import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// 운영자 휴대폰 알림(텔레그램 봇). 알리고(고객 알림톡)와 다른 경로라 알리고 잔액·IP 문제도 알릴 수 있다.
// OPS_TELEGRAM_BOT_TOKEN·OPS_TELEGRAM_CHAT_ID가 둘 다 있을 때만 보내고, 없으면 아무것도 하지 않는다.
// 알림 실패는 업무 흐름을 막지 않는다(로그만 남김). 고객 이름·전화·주소는 싣지 않는다.

const TELEGRAM_API = 'https://api.telegram.org';
const SEND_TIMEOUT_MS = 5_000;
const DEFAULT_DEDUPE_WINDOW_MS = 30 * 60_000;
const MAX_TEXT_LENGTH = 3_500;

export type OpsAlertLevel = 'critical' | 'warning' | 'info';

const LEVEL_MARK: Record<OpsAlertLevel, string> = {
  critical: '🔴',
  warning: '🟡',
  info: '🟢',
};

@Injectable()
export class OpsAlertService {
  private readonly logger = new Logger(OpsAlertService.name);
  private readonly token: string;
  private readonly chatId: string;
  private readonly disabledReason: string | null;
  private readonly environmentLabel: string;
  private readonly recent = new Map<string, number>();

  constructor(
    config: ConfigService,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.token = config.get<string>('OPS_TELEGRAM_BOT_TOKEN', '')?.trim() ?? '';
    this.chatId = config.get<string>('OPS_TELEGRAM_CHAT_ID', '')?.trim() ?? '';
    const outboundDenied =
      config.get<string>('GREENHUB_LOCAL_PROVIDER_OUTBOUND_POLICY', '') ===
      'DENY_ALL_EXTERNAL_PROVIDER_DISPATCH';
    const e2e = config.get<string>('ROUND_DIRECT_E2E_ENABLED', 'false') === 'true';
    this.disabledReason =
      !this.token || !this.chatId
        ? 'not_configured'
        : outboundDenied
          ? 'local_outbound_denied'
          : e2e
            ? 'e2e_runtime'
            : null;
    const environment = config.get<string>('RAILWAY_ENVIRONMENT_NAME', '')?.trim();
    this.environmentLabel = environment && environment !== 'production' ? ` [${environment}]` : '';
  }

  get enabled(): boolean {
    return this.disabledReason === null;
  }

  /**
   * 알림 한 건. dedupeKey가 같으면 기본 30분 안에는 한 번만 보낸다(같은 장애가 매분 반복될 때).
   * 절대 throw하지 않는다.
   */
  async send(input: {
    level: OpsAlertLevel;
    title: string;
    lines?: string[];
    dedupeKey?: string;
    dedupeWindowMs?: number;
  }): Promise<boolean> {
    if (!this.enabled) return false;
    if (input.dedupeKey) {
      const last = this.recent.get(input.dedupeKey);
      const window = input.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
      if (last !== undefined && this.now() - last < window) return false;
      this.recent.set(input.dedupeKey, this.now());
      if (this.recent.size > 500) this.recent.delete(this.recent.keys().next().value as string);
    }
    const text = [
      `${LEVEL_MARK[input.level]} 그린러브${this.environmentLabel} · ${input.title}`,
      ...(input.lines ?? []),
    ]
      .join('\n')
      .slice(0, MAX_TEXT_LENGTH);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(`${TELEGRAM_API}/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(`[OpsAlert] 텔레그램 응답 ${res.status}`);
        return false;
      }
      return true;
    } catch (error) {
      // 토큰이 든 URL을 로그에 남기지 않는다.
      this.logger.warn(
        `[OpsAlert] 텔레그램 전송 실패: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
