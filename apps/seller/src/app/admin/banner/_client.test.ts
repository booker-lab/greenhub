import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// AdminBannerClient는 '@/' alias를 사용하므로 vitest에서 직접 import할 수 없다.
// 따라서 이 focused test는 useAdminBanner 블록과 _client.tsx의 read/save 분기 배선을
// 소스에서 고정한다. API 계약 근거: AdminService.getBanner는 미설정 시 200 + null을
// 반환하고 조회 실패만 non-2xx throw이므로, null + error null이 genuine unset의 전부다
// (404 의미를 새로 정의하지 않는다).
const clientSource = readFileSync(new URL('./_client.tsx', import.meta.url), 'utf8');
const hookSource = readFileSync(new URL('../../../hooks/useAdmin.ts', import.meta.url), 'utf8');

const bannerBlock = hookSource.slice(
  hookSource.indexOf('export function useAdminBanner()'),
  hookSource.indexOf('export function useAdminInvite()'),
);
const beforeBannerBlock = hookSource.slice(
  0,
  hookSource.indexOf('export function useAdminBanner()'),
);

describe('AdminBanner read recovery wiring', () => {
  it('loading 상태를 표시한다', () => {
    expect(clientSource).toContain('if (loading)');
    expect(clientSource).toContain('불러오는 중...');
    expect(bannerBlock).toContain('setLoading(true)');
    expect(bannerBlock).toContain('setLoading(false)');
  });

  it('read success는 banner에 반영된다', () => {
    expect(bannerBlock).toContain('setBanner(await apiJson<AdminBanner | null>');
    expect(clientSource).toContain('hydratedRef');
    expect(clientSource).toContain('hydratedRef.current !== banner');
    expect(clientSource).toContain('setForm((prev) => ({ ...prev, ...banner }))');
  });

  it('read failure는 silent null이 아니라 error surface를 가진다', () => {
    expect(bannerBlock).toContain("setError('배너 조회 중 오류 발생')");
    expect(bannerBlock).toContain('error, saveError, save, reload');
    expect(clientSource).toContain('if (error !== null)');
    expect(clientSource).toContain('배너 정보를 불러오지 못했습니다.');
    expect(clientSource).toContain('{error}');
  });

  it('read failure에서 retry는 기존 reload를 호출한다', () => {
    expect(bannerBlock).toContain('reload: load');
    // retry는 load를 다시 수행하고 시작 시 error를 내려 retry 성공이 정상 form으로 복귀한다.
    expect(bannerBlock).toContain('setError(null)');
    expect(clientSource).toContain('<Button onClick={reload}');
    expect(clientSource).toContain('다시 조회');
    expect(clientSource).not.toContain('location.reload');
  });

  it('genuine unset은 API 계약 범위에서 failure와 구분된다', () => {
    // 미설정(null + error null)과 실패(null + error set)는 error 존재로만 구분된다.
    // catch에서 banner를 null로 덮어쓰지 않으므로 이전 성공 값이 실패 증거를 가리지 않는다.
    expect(bannerBlock).toContain('AdminBanner | null');
    expect(clientSource).toContain('banner === null');
    expect(clientSource).toContain('현재 설정된 배너가 없습니다.');
    // 우선순위: loading > fetch error > unset/success — error 분기가 unset 안내보다 먼저다.
    const loadingIdx = clientSource.indexOf('if (loading)');
    const errorIdx = clientSource.indexOf('if (error !== null)');
    const unsetIdx = clientSource.indexOf('banner === null');
    expect(loadingIdx).toBeGreaterThan(-1);
    expect(errorIdx).toBeGreaterThan(-1);
    expect(unsetIdx).toBeGreaterThan(-1);
    expect(loadingIdx).toBeLessThan(errorIdx);
    expect(errorIdx).toBeLessThan(unsetIdx);
  });

  it('read failure 상태에서 기본 빈 form을 편집/저장 경로로 노출하지 않는다', () => {
    const errorBranch = clientSource.slice(
      clientSource.indexOf('if (error !== null)'),
      clientSource.indexOf('banner === null'),
    );
    expect(errorBranch).not.toContain('<BannerImageSection');
    expect(errorBranch).not.toContain('<BannerTextSection');
    expect(errorBranch).not.toContain('<BannerCtaSection');
    expect(errorBranch).not.toContain('onClick={handleSave}');
    // Filters에 해당하는 편집 섹션은 성공 분기에서만 렌더된다.
    expect(clientSource.indexOf('<BannerImageSection')).toBeGreaterThan(
      clientSource.indexOf('banner === null'),
    );
  });
});

describe('AdminBanner save recovery wiring', () => {
  it('save success는 reload reconciliation 후 confirmed success를 반환한다', () => {
    expect(bannerBlock).toContain('await load()');
    expect(bannerBlock).toContain('return true');
    expect(clientSource).toContain('const ok = await save(form)');
    expect(clientSource).toContain('if (ok)');
    expect(clientSource).toContain('setSaved(true)');
  });

  it('save failure는 사용자 feedback을 제공하고 성공 상태로 보이지 않는다', () => {
    expect(bannerBlock).toContain("setSaveError('배너 저장 중 오류 발생')");
    // save 재시도 시작 시 이전 failure를 내려 성공/실패가 잔류 상태로 붕괴하지 않는다.
    expect(bannerBlock).toContain('setSaveError(null)');
    expect(bannerBlock).toContain('return false');
    expect(clientSource).toContain('saveError !== null');
    expect(clientSource).toContain('배너 저장에 실패했습니다.');
    expect(clientSource).toContain('{saveError}');
    // "저장 완료" 표시는 ok confirmed success에서만 설정된다.
    const handleSaveSrc = clientSource.slice(
      clientSource.indexOf('const handleSave'),
      clientSource.indexOf('if (loading)'),
    );
    expect(handleSaveSrc).toContain('if (ok)');
    // action error 표면은 read error 분기 이후(성공 분기)에 있어 read/action collapse가 없다.
    expect(clientSource.indexOf('saveError !== null')).toBeGreaterThan(
      clientSource.indexOf('if (error !== null)'),
    );
    expect(clientSource.indexOf('uploadError !== null')).toBeGreaterThan(
      clientSource.indexOf('if (error !== null)'),
    );
  });

  it('failed save는 form 입력을 보존한다', () => {
    const handleSaveSrc = clientSource.slice(
      clientSource.indexOf('const handleSave'),
      clientSource.indexOf('if (loading)'),
    );
    // 실패 경로에서 form을 초기화·덮어쓰기하지 않는다.
    expect(handleSaveSrc).not.toContain('setForm');
    // hydrate는 banner 갱신 시에만 반영되어 편집 중 입력을 덮어쓰지 않는다.
    expect(clientSource).toContain('}, [banner]);');
    expect(clientSource).not.toContain('[banner, form]');
  });

  it('upload failure는 최소 recovery 표면을 가진다', () => {
    // Firebase upload 계약 자체는 재설계하지 않고 silent만 닫는다.
    expect(clientSource).toContain('banners/main_hero/');
    expect(clientSource).toContain('setUploadError(null)');
    expect(clientSource).toContain('이미지 업로드 중 오류 발생');
    expect(clientSource).toContain('{uploadError}');
    const uploadSrc = clientSource.slice(
      clientSource.indexOf('const handleImageUpload'),
      clientSource.indexOf('const handleSave'),
    );
    // 실패해도 기존 form 입력(imageUrl 포함)은 그대로 보존된다.
    expect(uploadSrc).toContain('catch');
    expect(uploadSrc).not.toContain("imageUrl: ''");
    // uploading은 finally에서 정상 해제되어 action 상태가 고착되지 않는다.
    expect(uploadSrc).toContain('finally');
    expect(uploadSrc).toContain('setUploading(false)');
    // 실제 storage 성공(getDownloadURL) 전에는 URL을 변경하지 않는다.
    expect(uploadSrc.indexOf('getDownloadURL')).toBeGreaterThan(-1);
    expect(uploadSrc.indexOf('setForm')).toBeGreaterThan(uploadSrc.indexOf('getDownloadURL'));
  });

  it('기존 CTA/text/image schema와 섹션 배선을 유지한다', () => {
    expect(clientSource).toContain('<BannerImageSection');
    expect(clientSource).toContain('<BannerTextSection');
    expect(clientSource).toContain('<BannerCtaSection');
    expect(clientSource).toContain('배너 활성화');
    expect(clientSource).toContain("saving ? '저장 중...'");
  });
});

describe('AdminBanner unrelated useAdmin blocks unchanged', () => {
  it('다른 useAdmin hook export가 그대로 존재한다', () => {
    for (const name of [
      'useAdminStores',
      'useAdminUsers',
      'useAdminOrders',
      'useAdminSettlements',
      'useAdminDrivers',
      'useAdminInvite',
    ]) {
      expect(hookSource).toContain(`export function ${name}(`);
    }
    expect(hookSource).toContain('function useAdminList<T>(');
  });

  it('banner error 상태가 다른 블록에 스며들지 않았다', () => {
    expect(beforeBannerBlock).not.toContain('saveError');
    expect(beforeBannerBlock).not.toContain('배너 조회 중 오류 발생');
    expect(beforeBannerBlock).not.toContain('배너 저장 중 오류 발생');
  });
});
