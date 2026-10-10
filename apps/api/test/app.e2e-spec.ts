import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AppService } from './../src/app.service';
import { RETRYABLE_FIRESTORE_MESSAGE } from './../src/common/filters/firestore-retryable-error.filter';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer()).get('/').expect(200).expect('Hello World!');
  });
});

describe('일시적인 Firestore 실패 응답 (e2e)', () => {
  let app: INestApplication<App>;

  async function startWith(error: Error) {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AppService)
      .useValue({
        getHello: () => {
          throw error;
        },
      })
      .compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  }

  afterEach(async () => {
    await app?.close();
  });

  it('트랜잭션 경합(ABORTED)은 503과 다시 시도 안내로 응답한다', async () => {
    await startWith(
      Object.assign(new Error('10 ABORTED: Too much contention on these documents.'), {
        code: 10,
      }),
    );

    const res = await request(app.getHttpServer()).get('/').expect(503);
    expect(res.body).toEqual({
      statusCode: 503,
      error: 'Service Unavailable',
      message: RETRYABLE_FIRESTORE_MESSAGE,
      retryable: true,
    });
  });

  it('그 밖의 예상치 못한 오류는 기존처럼 500으로 응답한다', async () => {
    await startWith(new Error('unexpected'));

    const res = await request(app.getHttpServer()).get('/').expect(500);
    expect(res.body).toEqual({ statusCode: 500, message: 'Internal server error' });
  });
});
