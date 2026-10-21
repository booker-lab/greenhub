import { Logger } from '@nestjs/common';
import {
  ORDER_NOTICE_RETRY_DELAYS_MS,
  ORDER_NOTICE_SHUTDOWN_WAIT_MS,
  OrderNoticeDispatcher,
} from './order-notice-dispatcher';

// 재시도 대기 시간을 기록만 하고 바로 넘어가는 실행기.
class RecordingDispatcher extends OrderNoticeDispatcher {
  readonly sleeps: number[] = [];
  protected override sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    return Promise.resolve();
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('OrderNoticeDispatcher — 상태 전이 고객 알림을 응답 뒤에 보낸다', () => {
  let errorLog: jest.SpyInstance;
  let warnLog: jest.SpyInstance;

  beforeEach(() => {
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    warnLog = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('dispatch는 알림 작업을 기다리지 않고 바로 돌아온다', async () => {
    const dispatcher = new RecordingDispatcher();
    const gate = deferred();
    const task = jest.fn(() => gate.promise);

    let returned = false;
    void dispatcher.dispatch('order-1', 'PREPARING→DELIVERING', task).then(() => (returned = true));
    await flush();
    expect(task).toHaveBeenCalledTimes(1);
    expect(returned).toBe(true);

    let drained = false;
    const draining = dispatcher.drain().then(() => (drained = true));
    await flush();
    expect(drained).toBe(false);
    gate.resolve();
    await draining;
    expect(drained).toBe(true);
  });

  it('같은 주문의 알림은 앞 알림이 끝난 뒤에 순서대로 보낸다', async () => {
    const dispatcher = new RecordingDispatcher();
    const order: string[] = [];
    const first = deferred();

    dispatcher.dispatch('order-1', 'PREPARING→DELIVERING', async () => {
      order.push('배송 시작 시작');
      await first.promise;
      order.push('배송 시작 끝');
    });
    dispatcher.dispatch('order-1', 'DELIVERING→DELIVERED', async () => {
      order.push('배송 완료');
    });
    await flush();
    expect(order).toEqual(['배송 시작 시작']);

    first.resolve();
    await dispatcher.drain();
    expect(order).toEqual(['배송 시작 시작', '배송 시작 끝', '배송 완료']);
  });

  it('다른 주문의 알림은 서로 기다리지 않는다', async () => {
    const dispatcher = new RecordingDispatcher();
    const blocked = deferred();
    const other = jest.fn().mockResolvedValue(undefined);

    dispatcher.dispatch('order-1', 'PREPARING→DELIVERING', () => blocked.promise);
    dispatcher.dispatch('order-2', 'PREPARING→DELIVERING', other);
    await flush();
    expect(other).toHaveBeenCalledTimes(1);

    blocked.resolve();
    await dispatcher.drain();
  });

  it('예외가 나면 정해진 간격으로 다시 시도하고 성공하면 운영 알림을 보내지 않는다', async () => {
    const opsAlerts = { enabled: true, send: jest.fn().mockResolvedValue(true) };
    const dispatcher = new RecordingDispatcher(opsAlerts as never);
    const task = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('일시 오류'), { code: 14 }))
      .mockResolvedValueOnce(undefined);

    dispatcher.dispatch('order-1', 'DELIVERING→DELIVERED', task);
    await dispatcher.drain();

    expect(task).toHaveBeenCalledTimes(2);
    expect(dispatcher.sleeps).toEqual([ORDER_NOTICE_RETRY_DELAYS_MS[0]]);
    expect(warnLog).toHaveBeenCalledWith(expect.stringContaining('orderId=order-1'));
    expect(warnLog).toHaveBeenCalledWith(expect.stringContaining('error=14'));
    expect(errorLog).not.toHaveBeenCalled();
    expect(opsAlerts.send).not.toHaveBeenCalled();
  });

  it('끝까지 실패하면 오류 로그와 운영 알림을 남기고 다음 알림은 계속 보낸다', async () => {
    const opsAlerts = { enabled: true, send: jest.fn().mockResolvedValue(true) };
    const dispatcher = new RecordingDispatcher(opsAlerts as never);
    const failing = jest.fn().mockRejectedValue(new TypeError('연결 끊김'));
    const next = jest.fn().mockResolvedValue(undefined);

    dispatcher.dispatch('order-1', 'PREPARING→DELIVERY_HELD', failing);
    dispatcher.dispatch('order-1', 'DELIVERY_HELD→PREPARING', next);
    await dispatcher.drain();

    expect(failing).toHaveBeenCalledTimes(ORDER_NOTICE_RETRY_DELAYS_MS.length + 1);
    expect(dispatcher.sleeps).toEqual([...ORDER_NOTICE_RETRY_DELAYS_MS]);
    expect(next).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(errorLog.mock.calls[0][0]).toContain('orderId=order-1');
    expect(errorLog.mock.calls[0][0]).toContain('error=TypeError');
    expect(opsAlerts.send).toHaveBeenCalledTimes(1);
    expect(opsAlerts.send).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        dedupeKey: 'order-notice:order-1:PREPARING→DELIVERY_HELD',
      }),
    );
  });

  it('운영 알림이 꺼져 있으면 오류 로그만 남긴다', async () => {
    const opsAlerts = { enabled: false, send: jest.fn() };
    const dispatcher = new RecordingDispatcher(opsAlerts as never);

    dispatcher.dispatch('order-1', 'PREPARING→DELIVERING', () =>
      Promise.reject(new Error('실패')),
    );
    await dispatcher.drain();

    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(opsAlerts.send).not.toHaveBeenCalled();
  });

  it('종료 신호를 받으면 남은 알림이 끝날 때까지 기다린다', async () => {
    const dispatcher = new RecordingDispatcher();
    const gate = deferred();
    const task = jest.fn(() => gate.promise);
    dispatcher.dispatch('order-1', 'PREPARING→DELIVERING', task);

    let finished = false;
    const shutdown = dispatcher.beforeApplicationShutdown().then(() => (finished = true));
    await flush();
    expect(finished).toBe(false);

    gate.resolve();
    await shutdown;
    expect(task).toHaveBeenCalledTimes(1);
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('종료 신호 뒤에 맡긴 알림은 처리가 끝날 때 돌아와 응답 전에 보낸다', async () => {
    const dispatcher = new RecordingDispatcher();
    await dispatcher.beforeApplicationShutdown();
    const gate = deferred();

    let returned = false;
    const dispatched = dispatcher
      .dispatch('order-1', 'DELIVERING→DELIVERED', () => gate.promise)
      .then(() => (returned = true));
    await flush();
    expect(returned).toBe(false);

    gate.resolve();
    await dispatched;
    expect(returned).toBe(true);
  });

  it('종료 중 알림이 끝까지 실패해도 요청 쪽으로 예외를 던지지 않는다', async () => {
    const dispatcher = new RecordingDispatcher();
    await dispatcher.beforeApplicationShutdown();

    await expect(
      dispatcher.dispatch('order-1', 'DELIVERING→DELIVERED', () => Promise.reject(new Error('닫힘'))),
    ).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it('종료 대기 시간을 넘기면 남은 건수를 오류로 남기고 종료를 막지 않는다', async () => {
    jest.useFakeTimers();
    const dispatcher = new RecordingDispatcher();
    dispatcher.dispatch('order-1', 'PREPARING→DELIVERING', () => new Promise<void>(() => {}));

    const shutdown = dispatcher.beforeApplicationShutdown();
    await jest.advanceTimersByTimeAsync(ORDER_NOTICE_SHUTDOWN_WAIT_MS);
    await shutdown;

    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('남은 주문 1건'));
  });
});
