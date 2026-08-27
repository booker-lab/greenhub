'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import type { SavedAddress } from '@greenhub/shared';
import { getApiBaseUrl } from '@/lib/api-base-url';

const API_URL = getApiBaseUrl();

export interface AddressFormData {
  label: string;
  address: string;
  addressDetail: string;
  zipCode: string;
}

interface UseAddressesResult {
  addresses: SavedAddress[];
  loading: boolean;
  error: string | null;
  addAddress: (data: AddressFormData) => Promise<void>;
  updateAddress: (id: string, data: AddressFormData) => Promise<void>;
  deleteAddress: (id: string) => Promise<void>;
  setDefaultAddress: (id: string) => Promise<void>;
  refetch: () => void;
}

export function useAddresses(): UseAddressesResult {
  const { data: session } = useSession();
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [_tick, setTick] = useState(0);

  const token = session?.user?.accessToken;

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    async function fetchAddresses() {
      try {
        const res = await fetch(`${API_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (!res.ok) throw new Error(`조회 오류: ${res.status}`);
        const data = await res.json();
        setAddresses(data.savedAddresses ?? []);
        setError(null);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAddresses();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const addAddress = useCallback(
    async (data: AddressFormData) => {
      const res = await fetch(`${API_URL}/auth/me/addresses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('배송지 추가에 실패했습니다.');
      setTick((t) => t + 1);
    },
    [token],
  );

  const updateAddress = useCallback(
    async (id: string, data: AddressFormData) => {
      const res = await fetch(`${API_URL}/auth/me/addresses/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('배송지 수정에 실패했습니다.');
      setTick((t) => t + 1);
    },
    [token],
  );

  const deleteAddress = useCallback(
    async (id: string) => {
      const res = await fetch(`${API_URL}/auth/me/addresses/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('배송지 삭제에 실패했습니다.');
      setTick((t) => t + 1);
    },
    [token],
  );

  const setDefaultAddress = useCallback(
    async (id: string) => {
      const res = await fetch(`${API_URL}/auth/me/addresses/${id}/default`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('기본 배송지 설정에 실패했습니다.');
      setTick((t) => t + 1);
    },
    [token],
  );

  return {
    addresses,
    loading,
    error,
    addAddress,
    updateAddress,
    deleteAddress,
    setDefaultAddress,
    refetch: () => setTick((t) => t + 1),
  };
}
