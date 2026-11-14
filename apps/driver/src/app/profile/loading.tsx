import { Spinner } from '@/components/spinner';

// 내 정보는 서버에서 진행 중 주문 수(로그아웃 확인용)를 최대 3초 기다린 뒤 그린다.
// 그동안 탭을 누른 반응이 없어 보이지 않게 목록 화면과 같은 가운데 스피너를 보인다.
export default function ProfileLoading() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100dvh',
      }}
    >
      <Spinner />
    </div>
  );
}
