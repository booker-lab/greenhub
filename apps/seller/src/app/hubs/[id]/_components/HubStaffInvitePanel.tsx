'use client';

import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Copy, Link as LinkIcon, Trash2, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { ApiError, apiJson } from '@/lib/api';

interface HubStaffInvitePanelProps {
  hubId: string;
  storeId: string;
  token: string;
}

const EXPIRY_OPTIONS = [
  { value: '3', label: '3일' },
  { value: '7', label: '7일' },
  { value: '14', label: '14일' },
  { value: '30', label: '30일' },
];

interface HubStaff {
  id: string;
  name: string | null;
  email: string | null;
  suspended: boolean;
}

interface HubStaffCandidate {
  id: string;
  name: string | null;
  email: string | null;
  hubIds: string[];
}

interface HubStaffInvite {
  token: string;
  inviteUrl: string;
  expiresAt: string | null;
  createdAt: string | null;
  usedAt: string | null;
  revokedAt: string | null;
}

export function HubStaffInvitePanel({ hubId, storeId, token }: HubStaffInvitePanelProps) {
  const [expiresInDays, setExpiresInDays] = useState('7');
  const [inviteUrl, setInviteUrl] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [staff, setStaff] = useState<HubStaff[]>([]);
  const [candidates, setCandidates] = useState<HubStaffCandidate[]>([]);
  const [invites, setInvites] = useState<HubStaffInvite[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [staffLoading, setStaffLoading] = useState(false);
  const [assignLoading, setAssignLoading] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<HubStaff | null>(null);
  const [revokeLoading, setRevokeLoading] = useState(false);
  const [inviteCancelTarget, setInviteCancelTarget] = useState<HubStaffInvite | null>(null);
  const [inviteCancelLoading, setInviteCancelLoading] = useState(false);

  const fetchStaff = useCallback(async () => {
    setStaffLoading(true);
    try {
      const [staffResult, candidateResult, inviteResult] = await Promise.all([
        apiJson<{ staff: HubStaff[] }>(`/stores/${storeId}/hubs/${hubId}/staff`, token),
        apiJson<{ staff: HubStaffCandidate[] }>(
          `/stores/${storeId}/hubs/${hubId}/staff-candidates`,
          token,
        ),
        apiJson<{ invites: HubStaffInvite[] }>(
          `/stores/${storeId}/hubs/${hubId}/staff-invites`,
          token,
        ),
      ]);
      setStaff(staffResult.staff);
      setCandidates(candidateResult.staff);
      setInvites(inviteResult.invites);
      setSelectedStaffId((current) =>
        current && candidateResult.staff.some((item) => item.id === current) ? current : null,
      );
    } catch (error) {
      notifications.show({
        color: 'red',
        message:
          error instanceof ApiError
            ? error.message
            : '스태프 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.',
      });
    } finally {
      setStaffLoading(false);
    }
  }, [hubId, storeId, token]);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  const generateInvite = async () => {
    setLoading(true);
    try {
      const result = await apiJson<{ token: string; inviteUrl: string; expiresAt: string }>(
        `/stores/${storeId}/hubs/${hubId}/staff-invite`,
        token,
        {
          method: 'POST',
          body: JSON.stringify({ expiresInDays: Number(expiresInDays) }),
        },
      );
      setInviteUrl(result.inviteUrl);
      setExpiresAt(result.expiresAt);
      await fetchStaff();
      notifications.show({ color: 'green', message: '스태프 초대 링크를 발급했습니다.' });
    } catch (error) {
      notifications.show({
        color: 'red',
        message:
          error instanceof ApiError
            ? error.message
            : '스태프 초대 링크 발급에 실패했습니다. 잠시 후 다시 시도해주세요.',
      });
    } finally {
      setLoading(false);
    }
  };

  const assignStaff = async () => {
    if (!selectedStaffId) return;
    setAssignLoading(true);
    try {
      await apiJson(`/stores/${storeId}/hubs/${hubId}/staff`, token, {
        method: 'POST',
        body: JSON.stringify({ staffId: selectedStaffId }),
      });
      notifications.show({ color: 'green', message: '기존 스태프를 이 거점에 배정했습니다.' });
      setSelectedStaffId(null);
      await fetchStaff();
    } catch (error) {
      notifications.show({
        color: 'red',
        message:
          error instanceof ApiError
            ? error.message
            : '스태프 배정에 실패했습니다. 잠시 후 다시 시도해 주세요.',
      });
    } finally {
      setAssignLoading(false);
    }
  };

  const copyInviteUrl = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      notifications.show({ color: 'green', message: '초대 링크를 복사했습니다.' });
    } catch {
      notifications.show({ color: 'red', message: '복사 권한이 없어 링크를 직접 선택해주세요.' });
    }
  };

  const cancelInvite = async () => {
    if (!inviteCancelTarget) return;
    setInviteCancelLoading(true);
    try {
      await apiJson(
        `/stores/${storeId}/hubs/${hubId}/staff-invites/${inviteCancelTarget.token}`,
        token,
        { method: 'DELETE' },
      );
      notifications.show({ color: 'green', message: '스태프 초대를 취소했습니다.' });
      setInviteCancelTarget(null);
      await fetchStaff();
    } catch (error) {
      notifications.show({
        color: 'red',
        message:
          error instanceof ApiError
            ? error.message
            : '스태프 초대 취소에 실패했습니다. 잠시 후 다시 시도해 주세요.',
      });
    } finally {
      setInviteCancelLoading(false);
    }
  };

  const revokeStaff = async () => {
    if (!revokeTarget) return;
    setRevokeLoading(true);
    try {
      await apiJson(`/stores/${storeId}/hubs/${hubId}/staff/${revokeTarget.id}`, token, {
        method: 'DELETE',
      });
      notifications.show({ color: 'green', message: '스태프 권한을 회수했습니다.' });
      setRevokeTarget(null);
      await fetchStaff();
    } catch (error) {
      notifications.show({
        color: 'red',
        message:
          error instanceof ApiError
            ? error.message
            : '스태프 권한 회수에 실패했습니다. 잠시 후 다시 시도해주세요.',
      });
    } finally {
      setRevokeLoading(false);
    }
  };

  return (
    <>
      <Paper radius="lg" px="md" py="md" shadow="xs">
        <Stack gap="md">
          <Stack gap={4}>
            <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }}>
              거점 스태프
            </Text>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              이 거점의 픽업 대기 주문을 볼 수 있는 스태프를 초대하고 관리합니다.
            </Text>
          </Stack>

          <Group align="end" gap="sm" wrap="nowrap">
            <Select
              label="만료"
              data={EXPIRY_OPTIONS}
              value={expiresInDays}
              onChange={(value) => setExpiresInDays(value ?? '7')}
              radius="md"
              w={110}
            />
            <Button
              leftSection={<LinkIcon size={16} />}
              loading={loading}
              onClick={generateInvite}
              radius="md"
              style={{ flex: 1 }}
            >
              링크 발급
            </Button>
          </Group>

          {inviteUrl && (
            <Stack gap="xs">
              <TextInput value={inviteUrl} readOnly radius="md" aria-label="스태프 초대 링크" />
              <Group justify="space-between" gap="xs">
                <Text
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                >
                  만료 {new Date(expiresAt).toLocaleString('ko-KR', { hour12: false })}
                </Text>
                <Button
                  leftSection={<Copy size={14} />}
                  variant="light"
                  size="xs"
                  radius="md"
                  onClick={copyInviteUrl}
                >
                  복사
                </Button>
              </Group>
            </Stack>
          )}

          {invites.length > 0 && (
            <Stack gap="xs">
              <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }}>
                발급된 초대
              </Text>
              <Stack gap={0}>
                {invites.map((item) => {
                  const isUsed = !!item.usedAt;
                  const isRevoked = !!item.revokedAt;
                  const isExpired = item.expiresAt ? new Date(item.expiresAt) <= new Date() : false;
                  const canCancel = !isUsed && !isRevoked && !isExpired;
                  const status = isUsed
                    ? { label: '사용됨', color: 'blue' }
                    : isRevoked
                      ? { label: '취소됨', color: 'gray' }
                      : isExpired
                        ? { label: '만료됨', color: 'orange' }
                        : { label: '대기', color: 'green' };
                  return (
                    <Group
                      key={item.token}
                      justify="space-between"
                      gap="xs"
                      py="xs"
                      style={{ borderTop: '1px solid var(--color-border)' }}
                    >
                      <Box style={{ minWidth: 0 }}>
                        <Group gap="xs">
                          <Text
                            style={{
                              fontSize: 'var(--font-size-sm)',
                              fontWeight: 'var(--fw-medium)',
                            }}
                          >
                            {item.token}
                          </Text>
                          <Badge color={status.color} size="sm" variant="light">
                            {status.label}
                          </Badge>
                        </Group>
                        <Text
                          truncate
                          style={{
                            fontSize: 'var(--font-size-sm)',
                            color: 'var(--color-text-disabled)',
                          }}
                        >
                          만료{' '}
                          {item.expiresAt
                            ? new Date(item.expiresAt).toLocaleString('ko-KR', { hour12: false })
                            : '-'}
                        </Text>
                      </Box>
                      <ActionIcon
                        aria-label={`${item.token} 초대 취소`}
                        color="red"
                        disabled={!canCancel}
                        radius="md"
                        variant="subtle"
                        onClick={() => setInviteCancelTarget(item)}
                      >
                        <XCircle size={16} />
                      </ActionIcon>
                    </Group>
                  );
                })}
              </Stack>
            </Stack>
          )}

          <Stack gap="xs">
            <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }}>
              기존 스태프 배정
            </Text>
            <Group align="end" gap="sm" wrap="nowrap">
              <Select
                aria-label="추가 배정할 스태프"
                data={candidates.map((item) => ({
                  value: item.id,
                  label: item.name || item.email || item.id,
                }))}
                disabled={staffLoading || candidates.length === 0}
                placeholder={candidates.length === 0 ? '배정 가능한 스태프 없음' : '스태프 선택'}
                radius="md"
                searchable
                value={selectedStaffId}
                onChange={setSelectedStaffId}
                style={{ flex: 1 }}
              />
              <Button
                disabled={!selectedStaffId}
                loading={assignLoading}
                onClick={assignStaff}
                radius="md"
              >
                배정
              </Button>
            </Group>
          </Stack>

          <Stack gap="xs">
            <Group justify="space-between">
              <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }}>
                배정 스태프
              </Text>
              <Button variant="subtle" size="xs" radius="md" onClick={fetchStaff}>
                새로고침
              </Button>
            </Group>

            {staffLoading ? (
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                불러오는 중...
              </Text>
            ) : staff.length === 0 ? (
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                아직 배정된 스태프가 없습니다.
              </Text>
            ) : (
              <Stack gap={0}>
                {staff.map((item) => (
                  <Group
                    key={item.id}
                    justify="space-between"
                    gap="xs"
                    py="xs"
                    style={{ borderTop: '1px solid var(--color-border)' }}
                  >
                    <Box style={{ minWidth: 0 }}>
                      <Text
                        truncate
                        style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }}
                      >
                        {item.name || item.email || item.id}
                      </Text>
                      {item.email && (
                        <Text
                          truncate
                          style={{
                            fontSize: 'var(--font-size-sm)',
                            color: 'var(--color-text-disabled)',
                          }}
                        >
                          {item.email}
                        </Text>
                      )}
                    </Box>
                    <ActionIcon
                      aria-label={`${item.name || item.email || '스태프'} 권한 회수`}
                      color="red"
                      radius="md"
                      variant="subtle"
                      onClick={() => setRevokeTarget(item)}
                    >
                      <Trash2 size={16} />
                    </ActionIcon>
                  </Group>
                ))}
              </Stack>
            )}
          </Stack>
        </Stack>
      </Paper>

      <ConfirmModal
        opened={!!revokeTarget}
        title="스태프 권한 회수"
        message={`${revokeTarget?.name || revokeTarget?.email || '선택한 스태프'}의 이 거점 접근 권한을 회수합니다. 해당 계정은 정지되고 다시 로그인할 수 없습니다.`}
        confirmLabel="회수"
        cancelLabel="닫기"
        confirmColor="red"
        loading={revokeLoading}
        onClose={() => setRevokeTarget(null)}
        onConfirm={revokeStaff}
      />
      <ConfirmModal
        opened={!!inviteCancelTarget}
        title="스태프 초대 취소"
        message={`${inviteCancelTarget?.token ?? '선택한 초대'} 링크를 취소합니다. 이미 공유된 링크는 더 이상 가입에 사용할 수 없습니다.`}
        confirmLabel="취소"
        cancelLabel="닫기"
        confirmColor="red"
        loading={inviteCancelLoading}
        onClose={() => setInviteCancelTarget(null)}
        onConfirm={cancelInvite}
      />
    </>
  );
}
