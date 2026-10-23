import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describeListCap, readCappedList } from './useAdmin.listCap';

describe('상한이 있는 관리자 목록 응답', () => {
  it('상한에 닿았으면(hasMore) 목록과 상한 건수를 읽는다', () => {
    expect(readCappedList({ invites: [{ token: 'A' }], hasMore: true, limit: 50 }, 'invites')).toEqual({
      items: [{ token: 'A' }],
      cap: 50,
    });
  });

  it('더 없으면 상한 안내를 하지 않는다', () => {
    expect(readCappedList({ reviews: [], hasMore: false, limit: 200 }, 'reviews')).toEqual({
      items: [],
      cap: null,
    });
  });

  it('옛 API(배열 응답)도 목록은 그대로 보여 준다', () => {
    expect(readCappedList([{ token: 'A' }], 'invites')).toEqual({ items: [{ token: 'A' }], cap: null });
  });

  it('형식이 틀리면 빈 목록·안내 없음으로 읽는다', () => {
    expect(readCappedList(null, 'invites')).toEqual({ items: [], cap: null });
    expect(readCappedList({ invites: 'x', hasMore: true, limit: '50' }, 'invites')).toEqual({
      items: [],
      cap: null,
    });
  });

  it('안내 문구', () => {
    expect(describeListCap(200)).toBe('최근 200건만 보여요.');
  });
});

// 화면은 '@/' alias를 써서 vitest에서 직접 import할 수 없어 배선을 소스로 고정한다.
describe('상한 안내 화면 배선', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

  it('초대 내역은 서버 상한 신호(invites)를 읽어 발급 내역 아래에 안내한다', () => {
    expect(read('./useAdmin.invite.ts')).toContain("readCappedList<InviteToken>(data, 'invites')");
    expect(read('../app/admin/invite/_client.tsx')).toContain('{describeListCap(cap)}');
  });

  it('숨긴 후기는 서버 상한 신호(reviews)를 읽어 목록 위에 안내한다', () => {
    const page = read('../app/admin/reviews/page.tsx');
    expect(page).toContain("'reviews',");
    expect(page).toContain('readCappedList<AdminHiddenReview>(');
    expect(page).toContain('{describeListCap(cap)}');
  });
});
