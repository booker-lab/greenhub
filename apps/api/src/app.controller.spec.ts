import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FirestoreService } from './firestore/firestore.service';

describe('AppController', () => {
  let appController: AppController;
  const healthGet = jest.fn();
  const firestoreMock = {
    doc: jest.fn(() => ({ get: healthGet })),
  };

  beforeEach(async () => {
    healthGet.mockReset().mockResolvedValue({ exists: false });
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: FirestoreService, useValue: firestoreMock }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('returns ok status with ISO timestamp', async () => {
      const result = await appController.health();
      expect(result.status).toBe('ok');
      expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
      expect(firestoreMock.doc).toHaveBeenCalledWith('_health/ping');
    });

    it('Firestore를 읽지 못하면 503으로 응답하고 오류 내용은 싣지 않는다', async () => {
      healthGet.mockRejectedValue(new Error('14 UNAVAILABLE: 비밀 연결 정보'));
      const error = await appController.health().then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const response = (error as ServiceUnavailableException).getResponse();
      expect(response).toMatchObject({ status: 'unavailable', firestore: 'error' });
      expect(JSON.stringify(response)).not.toContain('UNAVAILABLE');
    });

    it('Firestore 읽기가 제한 시간을 넘기면 503으로 응답한다', async () => {
      jest.useFakeTimers();
      try {
        healthGet.mockReturnValue(new Promise(() => undefined));
        const pending = appController.health().then(
          () => null,
          (e: unknown) => e,
        );
        await jest.advanceTimersByTimeAsync(5_000);
        expect(await pending).toBeInstanceOf(ServiceUnavailableException);
      } finally {
        jest.useRealTimers();
      }
    });

    it('배포 커밋 SHA를 알 때만 commit에 싣는다', async () => {
      const previous = process.env.RAILWAY_GIT_COMMIT_SHA;
      try {
        process.env.RAILWAY_GIT_COMMIT_SHA = '0bcceaea1234567890abcdef1234567890abcdef';
        expect((await appController.health()).commit).toBe(
          '0bcceaea1234567890abcdef1234567890abcdef',
        );
        process.env.RAILWAY_GIT_COMMIT_SHA = 'not a sha';
        expect((await appController.health()).commit).toBeNull();
        delete process.env.RAILWAY_GIT_COMMIT_SHA;
        expect((await appController.health()).commit).toBeNull();
      } finally {
        if (previous === undefined) delete process.env.RAILWAY_GIT_COMMIT_SHA;
        else process.env.RAILWAY_GIT_COMMIT_SHA = previous;
      }
    });
  });
});
