import { createInMemoryFirestore } from '../../test/helpers/in-memory-firestore';
import { OpsDigestService } from './ops-digest.service';

const LEASE_PATH = 'jobLeases/ops-daily-digest';

function enabledAlerts() {
  return { enabled: true, send: jest.fn().mockResolvedValue(true) };
}

describe('아침 운영 요약 회차 lease', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: new Date('2026-11-01T23:30:00.000Z'),
      doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('두 인스턴스가 같은 아침에 동시에 실행해도 요약은 한 번만 보낸다', async () => {
    const memory = createInMemoryFirestore({
      'operationIssues/a': { status: 'OPEN', severity: 'warning' },
    });
    const alertsA = enabledAlerts();
    const alertsB = enabledAlerts();
    const serviceA = new OpsDigestService(memory.firestore as never, alertsA as never);
    const serviceB = new OpsDigestService(memory.firestore as never, alertsB as never);

    await Promise.all([serviceA.sendDailyDigest(), serviceB.sendDailyDigest()]);

    const sent = [...alertsA.send.mock.calls, ...alertsB.send.mock.calls];
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toMatchObject({ level: 'warning', title: '아침 운영 요약' });
    expect(memory.read(LEASE_PATH)).toMatchObject({
      holderId: null,
      lastCompletedSlot: '2026-11-02',
    });
  });

  it('같은 날 다시 실행되면 보내지 않고, 다음 날에는 다시 보낸다', async () => {
    const memory = createInMemoryFirestore();
    const alerts = enabledAlerts();
    const service = new OpsDigestService(memory.firestore as never, alerts as never);

    await service.sendDailyDigest();
    await service.sendDailyDigest();
    expect(alerts.send).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date('2026-11-02T23:30:00.000Z'));
    await service.sendDailyDigest();
    expect(alerts.send).toHaveBeenCalledTimes(2);
    expect(alerts.send.mock.calls[1][0]).toMatchObject({ level: 'info', title: '아침 운영 요약' });
  });

  it('요약 집계가 실패하면 기존처럼 실패 알림을 한 번 보내고 그 회차를 마친다', async () => {
    const memory = createInMemoryFirestore();
    const alerts = enabledAlerts();
    const service = new OpsDigestService(memory.firestore as never, alerts as never);
    jest.spyOn(service, 'collect').mockRejectedValue(new Error('query failed'));

    await service.sendDailyDigest();
    await service.sendDailyDigest();

    expect(alerts.send).toHaveBeenCalledTimes(1);
    expect(alerts.send).toHaveBeenCalledWith({
      level: 'warning',
      title: '아침 운영 요약을 만들지 못했습니다',
      lines: ['서버 로그를 확인하세요.'],
    });
  });

  it('lease 저장소를 읽지 못하면 throw하지 않고 실패 알림을 보낸다', async () => {
    const firestore = {
      doc: (path: string) => ({ path }),
      collection: jest.fn(),
      runTransaction: jest.fn().mockRejectedValue(new Error('UNAVAILABLE')),
    };
    const alerts = enabledAlerts();
    const service = new OpsDigestService(firestore as never, alerts as never);

    await expect(service.sendDailyDigest()).resolves.toBeUndefined();

    expect(firestore.collection).not.toHaveBeenCalled();
    expect(alerts.send).toHaveBeenCalledTimes(1);
    expect(alerts.send).toHaveBeenCalledWith(
      expect.objectContaining({ title: '아침 운영 요약을 만들지 못했습니다' }),
    );
  });

  it('다른 실행이 lease를 가지고 있으면 조회도 전송도 하지 않는다', async () => {
    const memory = createInMemoryFirestore({
      [LEASE_PATH]: {
        holderId: 'other-instance',
        slotKey: '2026-11-02',
        expiresAt: Date.now() + 60_000,
      },
    });
    const alerts = enabledAlerts();
    const service = new OpsDigestService(memory.firestore as never, alerts as never);
    const collect = jest.spyOn(service, 'collect');

    await service.sendDailyDigest();

    expect(collect).not.toHaveBeenCalled();
    expect(alerts.send).not.toHaveBeenCalled();
  });
});
