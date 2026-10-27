export const PUBLIC_BUSINESS_INFO = {
  brand: '그린러브',
  businessName: '디어 오키드',
  representative: '조정연',
  registrationNumber: '505-28-01702',
  address: '경기도 이천시 백사면 도지리 543-2',
  phone: '010-4452-2104',
  phoneHref: 'tel:01044522104',
  email: 'support@greenlove.co.kr',
  emailHref: 'mailto:support@greenlove.co.kr',
  hostingProvider: 'Vercel Inc.',
  // 2026-10-21 이천시 발급 통신판매업신고증 번호(제 2026-경기이천-0718 호). 빈 값이면 footer에 칸을 그리지 않는다.
  mailOrderRegistrationNumber: '2026-경기이천-0718' as string,
  supportHours: '09:00~18:00 (점심시간 12:00~13:00)',
  relationship: '그린러브는 디어 오키드가 운영하는 화훼 쇼핑몰입니다.',
  // KB 발급 공개값. KB 원본 폼(GET)을 쿼리스트링으로 바꾼 확인 URL이고, 마크는 로컬 사본을 쓴다(http 핫링크 금지).
  escrow: {
    provider: '국민은행',
    serviceName: 'KB에스크로이체',
    verifyUrl:
      'https://okbfex.kbstar.com/quics?page=C021590&cc=b034066:b035526&mHValue=da53475d2a0b3ac6d609b85c86745b67',
    markImage: '/images/kb-escrow-mark.gif',
  },
  kakaoChannel: {
    name: '그린러브',
    url: 'https://pf.kakao.com/_vGfjX',
  },
  featuredProducts: [
    {
      name: '오렌지 글로우',
      url: 'https://greenlove.co.kr/products/49b0a370-e0ab-4f19-b8e6-2de0e9b2e867',
    },
    {
      name: '빅립',
      url: 'https://greenlove.co.kr/products/19009e23-33e4-463f-9953-5be860fe56b6',
    },
    {
      name: '만천홍',
      url: 'https://greenlove.co.kr/products/0a96f85d-b906-439c-a38c-f469a21e1dbf',
    },
  ],
} as const;
