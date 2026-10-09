import { ConfigService } from '@nestjs/config';
import { createInMemoryFirestore } from '../../test/helpers/in-memory-firestore';
import { OperationIssueWriterService } from '../operations/operation-issue-writer.service';
import { OpsAlertService } from './ops-alert.service';
import { OpsDigestService } from './ops-digest.service';

function config(values: Record<string, string>) {
  return new ConfigService(values);
}

const configured = { OPS_TELEGRAM_BOT_TOKEN: 'bot-token', OPS_TELEGRAM_CHAT_ID: '12345' };

function okFetch() {
  return jest.fn(async () => new Response('{}', { status: 200 })) as unknown as jest.Mock;
}

describe('OpsAlertService', () => {
  it('토큰·채팅 ID가 없거나 로컬·E2E 실행이면 보내지 않는다', async () => {
    for (const values of [
      {},
      { OPS_TELEGRAM_BOT_TOKEN: 'bot-token' },
      {
        ...configured,
        GREENHUB_LOCAL_PROVIDER_OUTBOUND_POLICY: 'DENY_ALL_EXTERNAL_PROVIDER_DISPATCH',
      },
      { ...configured, ROUND_DIRECT_E2E_ENABLED: 'true' },
    ]) {
      const fetchImpl = okFetch();
      const service = new OpsAlertService(config(values), fetchImpl as never);
      expect(service.enabled).toBe(false);
      await expect(service.send({ level: 'info', title: 't' })).resolves.toBe(false);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it('텔레그램 sendMessage로 제목·본문을 보내고 운영 외 환경은 이름을 붙인다', async () => {
    const fetchImpl = okFetch();
    const service = new OpsAlertService(
      config({ ...configured, RAILWAY_ENVIRONMENT_NAME: 'staging' }),
      fetchImpl as never,
    );
    await expect(
      service.send({ level: 'critical', title: '알리고 잔액 부족', lines: ['충전하세요.'] }),
    ).resolves.toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botbot-token/sendMessage');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ chat_id: '12345', disable_web_page_preview: true });
    expect(body.text).toBe('🔴 그린러브 [staging] · 알리고 잔액 부족\n충전하세요.');
  });

  it('같은 dedupeKey는 창 안에서 한 번만 보내고 창이 지나면 다시 보낸다', async () => {
    const fetchImpl = okFetch();
    let now = 1_000_000;
    const service = new OpsAlertService(config(configured), fetchImpl as never, () => now);
    await service.send({ level: 'warning', title: 'a', dedupeKey: 'k' });
    await service.send({ level: 'warning', title: 'a', dedupeKey: 'k' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now += 31 * 60_000;
    await service.send({ level: 'warning', title: 'a', dedupeKey: 'k' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('전송 실패·오류 응답은 throw하지 않고 false를 돌려준다', async () => {
    const failing = new OpsAlertService(
      config(configured),
      jest.fn(async () => {
        throw new Error('network');
      }) as never,
    );
    await expect(failing.send({ level: 'info', title: 't' })).resolves.toBe(false);
    const rejected = new OpsAlertService(
      config(configured),
      jest.fn(async () => new Response('', { status: 401 })) as never,
    );
    await expect(rejected.send({ level: 'info', title: 't' })).resolves.toBe(false);
  });
});

describe('운영 기록이 열릴 때 알림', () => {
  function setup() {
    const memory = createInMemoryFirestore();
    const alerts = { enabled: true, send: jest.fn().mockResolvedValue(true) };
    const writer = new OperationIssueWriterService(memory.firestore as never, alerts as never);
    return { memory, alerts, writer };
  }
  const issue = {
    storeId: 'store-1',
    orderId: 'order-1',
    type: 'PAYMENT_LOOKUP_FAILED',
    severity: 'critical',
    title: '결제 조회 최종 실패',
    message: '결제 상태를 확인하지 못해 운영 확인이 필요합니다.',
    idempotencyKey: 'payment-lookup-failed:order-1',
  };
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('새 기록은 알리고, 열린 기록에 합쳐질 때는 다시 알리지 않는다', async () => {
    const { writer, alerts } = setup();
    await writer.createOrMergeIssue(issue);
    await flush();
    expect(alerts.send).toHaveBeenCalledTimes(1);
    expect(alerts.send.mock.calls[0][0]).toMatchObject({
      level: 'critical',
      title: '운영 확인: 결제 조회 최종 실패',
    });
    await writer.createOrMergeIssue(issue);
    await flush();
    expect(alerts.send).toHaveBeenCalledTimes(1);
  });

  it('해결된 기록이 다시 열리면 알린다', async () => {
    const { writer, alerts, memory } = setup();
    const created = await writer.createOrMergeIssue(issue);
    await flush();
    memory.records.set(`operationIssues/${created.id}`, { ...created, status: 'RESOLVED' });
    await writer.createOrMergeIssue(issue);
    await flush();
    expect(alerts.send).toHaveBeenCalledTimes(2);
  });

  it('info 기록과 호출자 트랜잭션 안의 기록은 알리지 않는다', async () => {
    const { writer, alerts, memory } = setup();
    await writer.createOrMergeIssue({ ...issue, severity: 'info', idempotencyKey: 'info-1' });
    await memory.firestore.runTransaction((tx: any) =>
      writer.createOrMergeIssue({ ...issue, idempotencyKey: 'tx-1' }, tx),
    );
    await flush();
    expect(alerts.send).not.toHaveBeenCalled();
  });

  it('알림 서비스가 없어도 기록은 그대로 저장된다', async () => {
    const memory = createInMemoryFirestore();
    const writer = new OperationIssueWriterService(memory.firestore as never);
    await expect(writer.createOrMergeIssue(issue)).resolves.toMatchObject({ status: 'OPEN' });
  });
});

describe('아침 운영 요약', () => {
  it('열린 운영 기록·오래된 결제 대기·배송 보류·지급 대기 정산을 센다', async () => {
    const now = Date.parse('2026-11-02T00:00:00.000Z');
    const memory = createInMemoryFirestore({
      'operationIssues/a': { status: 'OPEN', severity: 'critical' },
      'operationIssues/b': { status: 'OPEN', severity: 'warning' },
      'operationIssues/c': { status: 'RESOLVED', severity: 'critical' },
      'orders/p1': { status: 'PENDING', createdAt: new Date(now - 30 * 60_000) },
      'orders/p2': { status: 'PENDING', createdAt: new Date(now - 5 * 60_000) },
      'orders/h1': { status: 'DELIVERY_HELD' },
      'settlements/s1': { status: 'confirmed', netAmount: 28500 },
      'settlements/s2': { status: 'confirmed', netAmount: 23750 },
      'settlements/s3': { status: 'pending', netAmount: 1000 },
    });
    const service = new OpsDigestService(memory.firestore as never, { enabled: true } as never);
    const digest = await service.collect(now);
    expect(digest).toEqual({
      openIssues: { critical: 1, warning: 1, info: 0 },
      stalePendingOrders: 1,
      heldOrders: 1,
      confirmedSettlements: { count: 2, netAmount: 52250 },
    });
    const formatted = OpsDigestService.format(digest);
    expect(formatted.level).toBe('critical');
    expect(formatted.lines[0]).toBe('운영 확인 필요 2건 (긴급 1 · 주의 1)');
    expect(formatted.lines[3]).toBe('지급 대기 정산 2건 · 52,250원');
  });

  it('이상이 없으면 info 수준으로 보낸다', () => {
    expect(
      OpsDigestService.format({
        openIssues: { critical: 0, warning: 0, info: 0 },
        stalePendingOrders: 0,
        heldOrders: 0,
        confirmedSettlements: { count: 0, netAmount: 0 },
      }).level,
    ).toBe('info');
  });

  it('알림이 꺼져 있으면 조회하지 않는다', async () => {
    const firestore = { collection: jest.fn() };
    const service = new OpsDigestService(firestore as never, { enabled: false } as never);
    await service.sendDailyDigest();
    expect(firestore.collection).not.toHaveBeenCalled();
  });
});

describe('알리고 계정 수준 실패 알림', () => {
  // NotificationsService의 다른 의존성은 이 경로에서 쓰지 않는다.
  function makeService(alerts: unknown) {
    const { NotificationsService } = require('../notifications/notifications.service');
    return new NotificationsService({} as never, {} as never, {} as never, {} as never, alerts);
  }

  it.each([
    ['INSUFFICIENT_BALANCE', '알리고 잔액 부족'],
    ['UNAUTHORIZED_IP', '알리고 허용 IP 아님'],
    ['AUTH_FAILED', '알리고 인증 실패'],
    ['SENDER_NOT_REGISTERED', '발신번호 미등록'],
  ])('%s는 critical로 1시간에 한 번 알린다', async (reason, title) => {
    const alerts = { enabled: true, send: jest.fn().mockResolvedValue(true) };
    await makeService(alerts).alertAccountLevelFailure(reason);
    expect(alerts.send).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'critical',
        title: `알림톡 발송 막힘: ${title}`,
        dedupeKey: `aligo-account:${reason}`,
        dedupeWindowMs: 60 * 60_000,
      }),
    );
  });

  it('주문·번호 단위 실패나 사유 없음은 알리지 않는다', async () => {
    const alerts = { enabled: true, send: jest.fn() };
    const service = makeService(alerts);
    await service.alertAccountLevelFailure('INVALID_RECIPIENT');
    await service.alertAccountLevelFailure(null);
    expect(alerts.send).not.toHaveBeenCalled();
  });
});
