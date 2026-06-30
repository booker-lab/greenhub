import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BannerQueryService } from './banners/banner-query.service';
import { FirestoreService } from './firestore/firestore.service';

describe('AppController', () => {
  let appController: AppController;
  const firestoreMock = {
    doc: jest.fn(),
  };
  const bannerQueryMock = {
    getActiveBanners: jest.fn(),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: FirestoreService, useValue: firestoreMock },
        { provide: BannerQueryService, useValue: bannerQueryMock },
      ],
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
  });
});
