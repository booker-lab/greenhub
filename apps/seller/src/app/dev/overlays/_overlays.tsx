'use client';

import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@greenhub/ui/components/sheet';

// 소비자 OptionSheet(apps/consumer/src/components/benchmark/OptionSheet.tsx)가 옮겨 갈 설정(아래쪽 시트, 머리·본문).
export function OverlayCheck() {
  return (
    <main style={{ padding: 16 }}>
      <Sheet>
        <SheetTrigger className="rounded-[8px] border border-solid border-[#ced4da] bg-white px-4 py-2">
          시트 열기
        </SheetTrigger>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle className="text-lg leading-none font-extrabold">옵션 고르기</SheetTitle>
          </SheetHeader>
          <SheetBody>
            <SheetDescription className="text-black">
              화분 종류와 문구를 고르면 가격이 바로 바뀝니다. 고른 옵션은 장바구니와 주문 내역에
              그대로 남습니다.
            </SheetDescription>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </main>
  );
}
