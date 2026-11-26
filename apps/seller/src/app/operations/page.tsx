'use client';

import { Alert, AlertDescription, AlertTitle } from '@greenhub/ui/components/alert';
import { StatusDot } from '@greenhub/ui/components/status-dot';
import { ChevronRight, RefreshCcw, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { describeIssue, ISSUE_LABELS } from '@/app/orders/[id]/operation-issues';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { useStoreOperationIssues } from '@/hooks/useStoreOperationIssues';
import { LoadingButton } from '../../components/Button';
import {
  canManuallyResolve,
  manualResolverLabel,
  type StoreOperationIssue,
} from './manual-resolve';
import { ResolveIssueModal } from './ResolveIssueModal';

const SEVERITY_META = {
  critical: { label: '긴급', color: 'red' },
  warning: { label: '주의', color: 'yellow' },
  info: { label: '참고', color: 'gray' },
} as const;

// ① 외형 유지(UI 교체 P4): Mantine Container size sm(최대 720px, 좌우 16px)·Paper(radius lg = 16px; 그림자는 ② D2로 걷음)·
// Group·Stack·Text(p, 여백 0, 줄 높이 1.55)·Button xs·Alert light(제목 있음)와 같은 값.
const TEXT = 'm-0 p-0 text-base font-normal';
// ② 상태는 배지 면 대신 점 + 글자(StatusDot, 2026-11-01 결정): 열린 긴급=빨강, 열린 주의·참고=검정, 닫힌 기록=회색.
const TONE = { red: 'problem', yellow: 'default', gray: 'done' } as const;

const STATUS_LABELS = { OPEN: '확인 필요', RESOLVED: '해결', DISMISSED: '종료' } as const;
// 행 조작은 초록 면 버튼 대신 검정 밑줄 글자다(초록은 화면의 주요 버튼 하나, 회차·주문 목록과 같은 규칙).
// 누르는 높이는 44px이고, 글 아래 한 줄에 두어 설명이 카드 폭을 다 쓴다.
const ROW_ACTION =
  'inline-flex min-h-11 cursor-pointer items-center gap-0.5 rounded-[6px] border-0 bg-transparent p-0 text-sm font-bold whitespace-nowrap text-foreground underline underline-offset-4 outline-none [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value));
}

function IssueRow({
  issue,
  role,
  canResolve,
  onResolve,
}: {
  issue: StoreOperationIssue;
  role: string | null;
  canResolve: boolean;
  onResolve: (issue: StoreOperationIssue) => void;
}) {
  const severity = SEVERITY_META[issue.severity];
  const open = issue.status === 'OPEN';
  const resolution = issue.resolution;
  return (
    <div
      className="block rounded-[16px] bg-card p-4"
      // ② 문제 상자는 빨강 1px 테두리 대신 빨강 연한 면(design-direction §3.1·§3.2).
      style={
        open && issue.severity === 'critical'
          ? { backgroundColor: 'var(--color-danger-surface)' }
          : undefined
      }
    >
      <div className="flex flex-col gap-1 break-keep [overflow-wrap:anywhere]">
        <div className="flex flex-col gap-1" style={{ minWidth: 0 }}>
          <div className="flex flex-row flex-wrap items-center justify-start gap-1.5">
            <StatusDot tone={TONE[open ? severity.color : 'gray']}>
              {open ? severity.label : STATUS_LABELS[issue.status]}
            </StatusDot>
            <p className={TEXT} style={{ fontWeight: 'var(--fw-bold)' }}>
              {ISSUE_LABELS[issue.type]}
            </p>
          </div>
          <p
            className={TEXT}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
          >
            {describeIssue(issue.type, role)}
          </p>
          <p
            className={TEXT}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
          >
            {formatDateTime(issue.updatedAt)}
          </p>
          {resolution && (
            <div
              className="mt-1 flex flex-col gap-0.5 p-2.5"
              style={{
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--frame)',
              }}
            >
              <p
                className={TEXT}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
              >
                {manualResolverLabel(resolution)}가 직접 닫았어요 ·{' '}
                {formatDateTime(resolution.resolvedAt)}
              </p>
              <p className={TEXT} style={{ fontSize: 'var(--font-size-sm)' }}>
                {resolution.memo}
              </p>
            </div>
          )}
        </div>
        <div className="-mb-2 flex flex-row flex-wrap items-center justify-start gap-x-5">
          <Link href={`/orders/${encodeURIComponent(issue.orderId)}`} className={ROW_ACTION}>
            주문 보기
            <ChevronRight className="size-3.5" aria-hidden />
          </Link>
          {canResolve && (
            <button type="button" className={ROW_ACTION} onClick={() => onResolve(issue)}>
              해결로 닫기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type IssueTab = 'OPEN' | 'ALL';

export default function OperationsPage() {
  const { issues, openIssues, loading, error, hasLoaded, reload, resolveIssue, role } =
    useStoreOperationIssues();
  const [tab, setTab] = useState<IssueTab>('OPEN');
  const [resolving, setResolving] = useState<StoreOperationIssue | null>(null);
  const visible = tab === 'OPEN' ? openIssues : issues;

  return (
    <PageShell>
      <PageHeader
        title="운영 확인"
        backHref="/"
        right={
          <LoadingButton
            measured
            size="xs"
            variant="ghost"
            className="size-11 px-0"
            onClick={() => void reload()}
            loading={loading}
            aria-label="운영 기록 다시 조회"
          >
            <RefreshCcw size={16} />
          </LoadingButton>
        }
      />
      <div className="mx-auto max-w-[720px] px-4 py-4">
        <div className="flex flex-col gap-4">
          <p
            className={`${TEXT} break-keep`}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
          >
            결제·환불·고객 연락·배송 사진에서 자동으로 끝내지 못한 일을 모아 보여 줘요. 조치(환불
            재시도·문자 재발송)는 각 주문 화면에서 하고, 직접 처리를 마친 기록은 메모를 남기고
            &quot;해결로 닫기&quot;로 닫아 주세요.
          </p>
          <SegmentedTabs<IssueTab>
            variant="underline"
            value={tab}
            onChange={setTab}
            tabs={[
              {
                key: 'OPEN',
                label: '확인 필요',
                count: openIssues.length,
                badgeColor: openIssues.length > 0 ? 'red' : 'gray',
              },
              { key: 'ALL', label: '전체', count: issues.length },
            ]}
          />
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertTitle>운영 기록을 불러오지 못했습니다</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {loading && !hasLoaded && <LoadingState />}
          {hasLoaded && visible.length === 0 && (
            <EmptyState
              icon={<ShieldCheck size={48} strokeWidth={1.5} />}
              text={tab === 'OPEN' ? '확인할 운영 기록이 없어요' : '운영 기록이 없어요'}
            />
          )}
          {visible.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              role={role}
              canResolve={canManuallyResolve(issue, role)}
              onResolve={setResolving}
            />
          ))}
        </div>
      </div>
      <ResolveIssueModal
        issue={resolving}
        onClose={() => setResolving(null)}
        onConfirm={resolveIssue}
      />
    </PageShell>
  );
}
