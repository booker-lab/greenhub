'use client';

import { Box, Stack, Text } from '@mantine/core';
import Script from 'next/script';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type DriverMapOrder,
  getMapCenter,
  getMapOrderAddress,
  getMappableOrders,
  type MappableDriverMapOrder,
} from '../_lib';

type KakaoLatLng = {
  getLat: () => number;
  getLng: () => number;
};

type KakaoMap = {
  setBounds: (bounds: KakaoLatLngBounds) => void;
};

type KakaoLatLngBounds = {
  extend: (latLng: KakaoLatLng) => void;
};

type KakaoMaps = {
  LatLng: new (lat: number, lng: number) => KakaoLatLng;
  LatLngBounds: new () => KakaoLatLngBounds;
  Map: new (container: HTMLElement, options: { center: KakaoLatLng; level: number }) => KakaoMap;
  Marker: new (options: { map: KakaoMap; position: KakaoLatLng; title?: string }) => unknown;
  Polyline: new (options: {
    map: KakaoMap;
    path: KakaoLatLng[];
    strokeWeight: number;
    strokeColor: string;
    strokeOpacity: number;
    strokeStyle: string;
  }) => unknown;
  load: (callback: () => void) => void;
};

declare global {
  interface Window {
    kakao?: {
      maps?: KakaoMaps;
    };
  }
}

interface KakaoRouteMapProps {
  orders: DriverMapOrder[];
}

function MapFallback({ message, detail }: { message: string; detail?: string }) {
  return (
    <Box
      mx="md"
      mt="md"
      h={192}
      style={{
        borderRadius: 16,
        backgroundColor: 'var(--color-surface-muted)',
        border: 'var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Stack align="center" gap={4}>
        <svg
          width="40"
          height="40"
          fill="none"
          stroke="var(--color-text-disabled)"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
          />
        </svg>
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
          {message}
        </Text>
        {detail && (
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            {detail}
          </Text>
        )}
      </Stack>
    </Box>
  );
}

function renderMap(container: HTMLElement, orders: MappableDriverMapOrder[]) {
  const maps = window.kakao?.maps;
  if (!maps || orders.length === 0) return;

  const center = getMapCenter(orders);
  const map = new maps.Map(container, {
    center: new maps.LatLng(center.lat, center.lng),
    level: 5,
  });
  const bounds = new maps.LatLngBounds();
  const path = orders.map((order) => {
    const position = new maps.LatLng(order.lat, order.lng);
    bounds.extend(position);
    new maps.Marker({
      map,
      position,
      title: `${order.buyerName ?? '배송지'} · ${getMapOrderAddress(order)}`,
    });
    return position;
  });

  if (path.length > 1) {
    new maps.Polyline({
      map,
      path,
      strokeWeight: 4,
      strokeColor: '#2f9e44',
      strokeOpacity: 0.85,
      strokeStyle: 'solid',
    });
    map.setBounds(bounds);
  }
}

export function KakaoRouteMap({ orders }: KakaoRouteMapProps) {
  const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const mappableOrders = useMemo(() => getMappableOrders(orders), [orders]);

  useEffect(() => {
    if (!loaded || !containerRef.current || mappableOrders.length === 0) return;
    window.kakao?.maps?.load(() => {
      if (containerRef.current) renderMap(containerRef.current, mappableOrders);
    });
  }, [loaded, mappableOrders]);

  if (!appKey) {
    return (
      <MapFallback
        message="카카오맵 SDK 연동 후 활성화"
        detail="NEXT_PUBLIC_KAKAO_MAP_KEY 설정 필요"
      />
    );
  }

  if (mappableOrders.length === 0) {
    return (
      <MapFallback
        message="지도에 표시할 좌표가 없습니다"
        detail="배송지 목록은 아래에서 확인하세요"
      />
    );
  }

  if (failed) {
    return (
      <MapFallback message="카카오맵을 불러오지 못했습니다" detail="잠시 후 다시 시도해주세요" />
    );
  }

  return (
    <>
      <Script
        src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&autoload=false`}
        strategy="afterInteractive"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
      <Box
        ref={containerRef}
        aria-label="오늘 배송 경로 지도"
        mx="md"
        mt="md"
        h={224}
        style={{
          borderRadius: 16,
          border: 'var(--border)',
          overflow: 'hidden',
          backgroundColor: 'var(--color-surface-muted)',
        }}
      />
    </>
  );
}
