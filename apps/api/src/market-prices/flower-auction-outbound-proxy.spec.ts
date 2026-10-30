// aT 호출의 고정 IP 프록시 경로: 설정이 있으면 그 프록시로만, 형식이 틀리면 직접 호출로 우회하지 않는다.
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

const proxyAgentConstructor = jest.fn();
const undiciFetch = jest.fn();

jest.mock('undici', () => ({
  ProxyAgent: jest.fn().mockImplementation((url: string) => {
    proxyAgentConstructor(url);
    return { kind: 'proxy-agent' };
  }),
  fetch: (...args: unknown[]) => undiciFetch(...args),
}));

import {
  FLOWER_AUCTION_FETCH,
  FLOWER_AUCTION_PROXY_CONFIG_ERROR,
  FlowerAuctionClient,
  type FlowerAuctionFetch,
  resolveFlowerAuctionFetch,
} from './flower-auction.client';
import { flowerAuctionFetchProvider } from './market-prices.module';

const proxyUrl = 'http://fixie:proxy-password@proxy.example.test:80'; // trufflehog:ignore
const okResponse = { ok: true, status: 200, text: async () => JSON.stringify({ response: { items: [] } }) };

describe('aT 송신 고정 IP 프록시', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    proxyAgentConstructor.mockReset();
    undiciFetch.mockReset().mockResolvedValue(okResponse);
    global.fetch = jest.fn().mockResolvedValue(okResponse);
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  async function clientWith(config: Record<string, string>) {
    const module = await Test.createTestingModule({
      providers: [
        FlowerAuctionClient,
        flowerAuctionFetchProvider,
        { provide: ConfigService, useValue: new ConfigService({ FLOWER_AUCTION_API_KEY: 'key', ...config }) },
      ],
    }).compile();
    return module.get(FlowerAuctionClient);
  }

  it('설정이 없으면 직접 호출한다', async () => {
    await (await clientWith({})).fetchDay('2026-10-26', 3);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(undiciFetch).not.toHaveBeenCalled();
    expect(proxyAgentConstructor).not.toHaveBeenCalled();
  });

  it.each([
    proxyUrl,
    'https://fixie:proxy-password@proxy.example.test:443', // trufflehog:ignore
  ])('프록시(%s)가 있으면 aT 호출을 그 프록시로만 보낸다', async (allowed) => {
    await (await clientWith({ FLOWER_AUCTION_OUTBOUND_PROXY_URL: allowed })).fetchDay('2026-10-26', 3);

    expect(proxyAgentConstructor).toHaveBeenCalledWith(allowed);
    expect(undiciFetch).toHaveBeenCalledTimes(1);
    const [url, init] = undiciFetch.mock.calls[0];
    expect(new URL(url).hostname).toBe('flower.at.or.kr');
    expect(init).toEqual(expect.objectContaining({ dispatcher: { kind: 'proxy-agent' }, signal: expect.any(AbortSignal) }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([
    'not a url',
    'ftp://fixie:proxy-password@proxy.example.test:21', // trufflehog:ignore
    'socks5://fixie:proxy-password@proxy.example.test:1080', // trufflehog:ignore
  ])('형식이 틀린 설정(%s)이면 직접 호출로 우회하지 않고 거부하며, 인증 정보를 남기지 않는다', async (invalid) => {
    const error = await (await clientWith({ FLOWER_AUCTION_OUTBOUND_PROXY_URL: invalid }))
      .fetchDay('2026-10-26', 3)
      .catch((e: Error) => e);

    expect((error as Error).message).toBe(FLOWER_AUCTION_PROXY_CONFIG_ERROR);
    expect((error as Error).message).not.toContain('proxy-password');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(undiciFetch).not.toHaveBeenCalled();
  });

  it('공백만 있는 설정은 없는 것으로 본다', async () => {
    const fetcher: FlowerAuctionFetch = resolveFlowerAuctionFetch('   ');
    await fetcher('https://flower.at.or.kr/api/returnData.api', { signal: new AbortController().signal });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('모듈은 이 경로를 aT 클라이언트에 넣는다', () => {
    expect(flowerAuctionFetchProvider).toEqual(expect.objectContaining({ provide: FLOWER_AUCTION_FETCH }));
  });
});
