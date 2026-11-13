import CompletedTodayClient from './_client';

// 오늘 완료 내역·사진 다시 보기. 손님 문의에 답할 때 오늘(서울 날짜) 마친 배송과 완료 사진을 다시 본다.
// 내역·사진 주소는 화면에서 조회한다(브라우저 API는 effect 안에서만 쓴다). 로그인 검사는 proxy의 /board 경로가 맡는다.
export default function CompletedTodayPage() {
  return <CompletedTodayClient />;
}
