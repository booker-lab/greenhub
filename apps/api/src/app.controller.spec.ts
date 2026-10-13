import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FirestoreService } from './firestore/firestore.service';

describe('AppController', () => {
  let appController: AppController;
  const firestoreMock = {
    doc: jest.fn(),
  };

  beforeEach(async () => {
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
    it('returns ok status with ISO timestamp', () => {
      const result = appController.health();
      expect(result.status).toBe('ok');
      expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
    });

    it('배포 커밋 SHA를 알 때만 commit에 싣는다', () => {
      const previous = process.env.RAILWAY_GIT_COMMIT_SHA;
      try {
        process.env.RAILWAY_GIT_COMMIT_SHA = '0bcceaea1234567890abcdef1234567890abcdef';
        expect(appController.health().commit).toBe('0bcceaea1234567890abcdef1234567890abcdef');
        process.env.RAILWAY_GIT_COMMIT_SHA = 'not a sha';
        expect(appController.health().commit).toBeNull();
        delete process.env.RAILWAY_GIT_COMMIT_SHA;
        expect(appController.health().commit).toBeNull();
      } finally {
        if (previous === undefined) delete process.env.RAILWAY_GIT_COMMIT_SHA;
        else process.env.RAILWAY_GIT_COMMIT_SHA = previous;
      }
    });
  });
});
