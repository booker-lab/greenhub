import { createHash, timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveE2EProviderMode } from '../common/e2e-provider-mode';
import { PortoneError } from './portone.client';

type E2EPaymentFixture = {
  amount: number;
  status?: 'PAID' | 'PENDING' | 'FAILED' | 'CANCELLED';
  lookupStatuses?: Array<'PAID' | 'PENDING' | 'FAILED' | 'CANCELLED'>;
  refundResult?: 'success' | 'failure';
};

type PaymentData = {
  id: string;
  transactionId: string;
  amount: { total: number };
  status: string;
  method: { type: string };
};

type ProviderCall = {
  action: 'getPayment' | 'refund';
  paymentId: string;
  sequence: number;
  result: string;
};

function parseFixtures(raw: string): Record<string, E2EPaymentFixture> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('PortOne E2E fixture JSON을 해석할 수 없습니다.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('PortOne E2E fixture는 객체여야 합니다.');
  }
  return parsed as Record<string, E2EPaymentFixture>;
}

function secretMatches(received: string, expected: string): boolean {
  const receivedDigest = createHash('sha256').update(received).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(receivedDigest, expectedDigest);
}

@Injectable()
export class E2EPortoneClient {
  private readonly runId: string;
  private readonly sharedSecret: string;
  private readonly fixtures: Record<string, E2EPaymentFixture>;
  private readonly lookupCounts = new Map<string, number>();
  private readonly cancelled = new Set<string>();
  private readonly calls: ProviderCall[] = [];

  constructor(config: ConfigService) {
    const mode = resolveE2EProviderMode(config);
    if (!mode.enabled) {
      throw new Error('PortOne E2E 대역은 검증된 stub mode에서만 생성할 수 있습니다.');
    }
    this.runId = mode.runId;
    this.sharedSecret = config.get<string>('ROUND_DIRECT_E2E_SHARED_SECRET', '');
    this.fixtures = parseFixtures(
      config.get<string>('ROUND_DIRECT_E2E_PORTONE_FIXTURES_JSON', '{}'),
    );
  }

  verifyWebhookSignature(
    webhookId: string,
    webhookTimestamp: string,
    _rawBody: Buffer,
    signatureHeader: string,
  ): void {
    if (
      !webhookId.startsWith(`round-direct-e2e-${this.runId}-`) ||
      !/^[0-9]+$/.test(webhookTimestamp) ||
      !secretMatches(signatureHeader, this.sharedSecret)
    ) {
      throw new UnauthorizedException('E2E 웹훅 인증 정보가 올바르지 않습니다.');
    }
  }

  async getPayment(paymentId: string): Promise<PaymentData> {
    const fixture = this.getFixture(paymentId);
    const count = this.lookupCounts.get(paymentId) ?? 0;
    const lookupStatuses = fixture.lookupStatuses ?? [];
    const status = this.cancelled.has(paymentId)
      ? 'CANCELLED'
      : (lookupStatuses[Math.min(count, lookupStatuses.length - 1)] ??
        fixture.status ??
        'PAID');
    this.lookupCounts.set(paymentId, count + 1);
    this.record('getPayment', paymentId, status);
    return {
      id: paymentId,
      transactionId: `e2e-${this.runId}-${count + 1}`,
      amount: { total: fixture.amount },
      status,
      method: { type: 'E2E_STUB' },
    };
  }

  async refund(paymentId: string, amount: number, _reason: string): Promise<void> {
    const fixture = this.getFixture(paymentId);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > fixture.amount) {
      this.record('refund', paymentId, 'invalid_amount');
      throw new PortoneError(400, 'E2E_INVALID_REFUND_AMOUNT', 'E2E 환불 금액이 올바르지 않습니다.');
    }
    if (fixture.refundResult === 'failure') {
      this.record('refund', paymentId, 'failure');
      throw new PortoneError(503, 'E2E_REFUND_FAILED', 'E2E 환불 실패 fixture입니다.');
    }
    this.cancelled.add(paymentId);
    this.record('refund', paymentId, 'success');
  }

  getCallEvidence(): readonly ProviderCall[] {
    return this.calls.map((call) => ({ ...call }));
  }

  private getFixture(paymentId: string): E2EPaymentFixture {
    if (!paymentId.startsWith(`round-direct-e2e-${this.runId}-`)) {
      throw new PortoneError(404, 'E2E_PAYMENT_OUT_OF_SCOPE', 'E2E 실행 범위 밖 결제입니다.');
    }
    const fixture = this.fixtures[paymentId];
    if (
      !fixture ||
      !Number.isSafeInteger(fixture.amount) ||
      fixture.amount <= 0
    ) {
      throw new PortoneError(404, 'PAYMENT_NOT_FOUND', 'E2E 결제 fixture를 찾을 수 없습니다.');
    }
    return fixture;
  }

  private record(action: ProviderCall['action'], paymentId: string, result: string): void {
    this.calls.push({
      action,
      paymentId,
      sequence: this.calls.length + 1,
      result,
    });
  }
}
