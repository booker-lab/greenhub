'use client';

import { Alert, AlertDescription, AlertTitle } from '@greenhub/ui/components/alert';
import { Badge } from '@greenhub/ui/components/badge';
import { Button, ButtonLabel } from '@greenhub/ui/components/button';
import { Checkbox } from '@greenhub/ui/components/checkbox';
import { Chip } from '@greenhub/ui/components/chip';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@greenhub/ui/components/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@greenhub/ui/components/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@greenhub/ui/components/field';
import { Input, InputSection } from '@greenhub/ui/components/input';
import { Loader } from '@greenhub/ui/components/loader';
import { LoadingButton } from '@greenhub/ui/components/loading-button';
import { NativeSelect } from '@greenhub/ui/components/native-select';
import { NumberInput } from '@greenhub/ui/components/number-input';
import { Select } from '@greenhub/ui/components/select';
import { Switch } from '@greenhub/ui/components/switch';
import { Textarea } from '@greenhub/ui/components/textarea';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@greenhub/ui/components/sheet';
import {
  ActionIcon,
  Alert as MAlert,
  Badge as MBadge,
  Button as MButton,
  Card as MCard,
  Checkbox as MCheckbox,
  Chip as MChip,
  Drawer,
  Loader as MLoader,
  Modal,
  NativeSelect as MNativeSelect,
  NumberInput as MNumberInput,
  Select as MSelect,
  Stack as MStack,
  Switch as MSwitch,
  Text,
  Textarea as MTextarea,
  TextInput,
  Title,
} from '@mantine/core';
import { AlertTriangle, ChevronLeft, RefreshCcw } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { LoadMoreFooter } from '@/app/admin/_components/LoadMoreFooter';

// 행마다 왼쪽 Mantine, 오른쪽 @greenhub/ui를 같은 칸 크기로 그린다. 촬영해 두 칸을 눈과 픽셀로 비교한다.
// 짝은 판매자 앱이 실제로 쓰는 Mantine props(theme.ts 기본값 포함)를 기준으로 고른다.

const CELL: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  padding: 8,
  minHeight: 56,
  background: '#fff',
  outline: '1px dashed #e5e7eb',
};

function Row({ name, mantine, ui }: { name: string; mantine: ReactNode; ui: ReactNode }) {
  return (
    <div data-compare-row={name} style={{ display: 'contents' }}>
      <div style={{ fontSize: 12, color: '#6b716e', padding: '8px 0', gridColumn: '1 / -1' }}>
        {name}
      </div>
      <div data-compare-cell="mantine" style={CELL}>
        {mantine}
      </div>
      <div data-compare-cell="ui" style={CELL}>
        {ui}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px' }}>{title}</h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          columnGap: 8,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700 }}>Mantine</div>
        <div style={{ fontSize: 12, fontWeight: 700 }}>@greenhub/ui</div>
        {children}
      </div>
    </section>
  );
}

const BUTTON_VARIANTS = [
  { name: 'filled ↔ default', m: { variant: 'filled' }, ui: 'default' },
  { name: 'outline ↔ outline', m: { variant: 'outline' }, ui: 'outline' },
  {
    name: 'outline gray ↔ outline-gray',
    m: { variant: 'outline', color: 'gray' },
    ui: 'outline-gray',
  },
  { name: 'light ↔ light', m: { variant: 'light' }, ui: 'light' },
  { name: 'subtle ↔ subtle', m: { variant: 'subtle' }, ui: 'subtle' },
  { name: 'light gray ↔ secondary', m: { variant: 'light', color: 'gray' }, ui: 'secondary' },
  { name: 'subtle gray ↔ ghost', m: { variant: 'subtle', color: 'gray' }, ui: 'ghost' },
  { name: 'filled red ↔ destructive', m: { variant: 'filled', color: 'red' }, ui: 'destructive' },
  {
    name: 'light red ↔ light-destructive',
    m: { variant: 'light', color: 'red' },
    ui: 'light-destructive',
  },
  {
    name: 'subtle red ↔ subtle-destructive',
    m: { variant: 'subtle', color: 'red' },
    ui: 'subtle-destructive',
  },
  {
    name: 'light yellow ↔ light-warning',
    m: { variant: 'light', color: 'yellow' },
    ui: 'light-warning',
  },
] as const;

const BUTTON_SIZES = [
  { name: 'xs ↔ xs (30)', m: 'xs', ui: 'xs' },
  { name: 'xs ↔ sm (30)', m: 'xs', ui: 'sm' },
  { name: 'sm(기본) ↔ default (36)', m: 'sm', ui: 'default' },
  { name: 'md ↔ md (42)', m: 'md', ui: 'md' },
  { name: 'lg ↔ lg (50)', m: 'lg', ui: 'lg' },
] as const;

const ICON_SIZES = [
  { name: 'ActionIcon 기본(28) ↔ ghost size-7', px: 28, ui: 'icon-sm', className: 'size-7' },
  { name: 'ActionIcon 24 ↔ icon-xs', px: 24, ui: 'icon-xs' },
  { name: 'ActionIcon 30 ↔ icon-sm', px: 30, ui: 'icon-sm' },
  { name: 'ActionIcon 36 ↔ icon', px: 36, ui: 'icon' },
  { name: 'ActionIcon 42 ↔ icon-lg', px: 42, ui: 'icon-lg' },
] as const;

const BADGES = [
  { name: 'filled ↔ default', m: { variant: 'filled' }, ui: 'default' },
  { name: 'light ↔ light', m: { variant: 'light' }, ui: 'light' },
  { name: 'outline ↔ outline', m: { variant: 'outline' }, ui: 'outline' },
  { name: 'light yellow ↔ warning', m: { variant: 'light', color: 'yellow' }, ui: 'warning' },
  { name: 'light gray ↔ secondary', m: { variant: 'light', color: 'gray' }, ui: 'secondary' },
  { name: 'light red ↔ destructive', m: { variant: 'light', color: 'red' }, ui: 'destructive' },
  {
    name: 'outline yellow ↔ outline-warning',
    m: { variant: 'outline', color: 'yellow' },
    ui: 'outline-warning',
  },
  {
    name: 'outline red ↔ outline-destructive',
    m: { variant: 'outline', color: 'red' },
    ui: 'outline-destructive',
  },
] as const;

const MODAL_TITLE = '주문 취소';
const SHEET_TITLE = '옵션 고르기';
const MODAL_TEXT = '이 주문을 취소하면 결제 금액이 환불됩니다.';
// 시트는 내용 폭만큼 넓어지므로(소비자 OptionSheet는 선택지가 화면 폭을 채운다) PC 폭에서도 두 줄이 되는 글로 폭을 채운다.
const SHEET_TEXT =
  '화분 종류와 문구를 고르면 가격이 바로 바뀝니다. 고른 옵션은 장바구니와 주문 내역에 그대로 남고, 배송 전까지는 주문 상세에서 확인할 수 있습니다. 문구가 필요한 옵션은 고른 뒤 아래 입력칸에 적어 주세요. 같은 상품을 다른 옵션으로 더 담으면 장바구니에 따로 들어갑니다.';

// 상품 등록·수정의 품종 선택(VarietySelector)과 같은 묶음 목록.
const VARIETY_GROUPS = [
  {
    group: '심비디움',
    items: [
      { value: 'variety-biglip', label: '빅립' },
      { value: 'variety-mancheonhong', label: '만천홍' },
    ],
  },
  { group: '호접란', items: [{ value: 'variety-white', label: '화이트 호접' }] },
];
const LONG_TEXT =
  '경매에서 직접 고른 동양란입니다. 꽃대가 튼튼하고 향이 은은해 거실이나 사무실에 두기 좋아요. 받으신 뒤에는 밝은 창가에 두고 겉흙이 마르면 물을 주세요.';

// 상품 폼 출하 형태 버튼(TouchSelector)처럼 글자 두 줄을 넣은 버튼 안쪽.
function StemLabel() {
  return (
    <div className="flex flex-col items-center justify-start gap-0">
      <p className="m-0 p-0 text-base font-normal" style={{ fontSize: 15, fontWeight: 700 }}>
        외대
      </p>
      <p className="m-0 p-0 text-base font-normal" style={{ fontSize: 15, color: '#a3a9a6' }}>
        1줄기
      </p>
    </div>
  );
}

const SELECTED_BADGE = {
  cursor: 'pointer',
  backgroundColor: 'var(--color-primary-surface)',
  color: 'var(--color-primary-dark)',
  borderColor: 'var(--color-primary)',
} as const;

function SelectOpen({ open }: { open: string }) {
  // 열린 목록은 칸 밖으로 나오므로 같은 자리에 하나씩 그려 캡처끼리 비교한다.
  // 촬영(fixture compareScreens)이 입력칸을 실제로 눌러 연다.
  return (
    <main style={{ padding: 16, maxWidth: 480 }}>
      {open === 'select' ? (
        <MSelect
          placeholder="품종 선택 (선택사항)"
          data={VARIETY_GROUPS}
          value="variety-biglip"
          clearable
          size="md"
          radius="xl"
          maxDropdownHeight={240}
          comboboxProps={{ position: 'bottom', middlewares: { flip: false } }}
        />
      ) : (
        <Select
          placeholder="품종 선택 (선택사항)"
          data={VARIETY_GROUPS}
          value="variety-biglip"
          onValueChange={() => {}}
          clearable
          size="md"
          className="rounded-xl"
          maxDropdownHeight={240}
        />
      )}
    </main>
  );
}

export function UiCompare({ open }: { open?: string }) {
  if (open === 'select' || open === 'uiselect') return <SelectOpen open={open} />;
  return (
    <main style={{ padding: 16, maxWidth: 960, margin: '0 auto' }}>
      <Title order={1} style={{ fontSize: 20, marginBottom: 16 }}>
        UI 교체 대조 화면
      </Title>

      <Section title="Button · 변형 (기본 크기)">
        {BUTTON_VARIANTS.map((v) => (
          <Row
            key={v.name}
            name={`Button ${v.name}`}
            mantine={<MButton {...v.m}>저장하기</MButton>}
            ui={<Button variant={v.ui}>저장하기</Button>}
          />
        ))}
        <Row
          name="Button disabled"
          mantine={<MButton disabled>저장하기</MButton>}
          ui={<Button disabled>저장하기</Button>}
        />
      </Section>

      <Section title="Button · 크기">
        {BUTTON_SIZES.map((s) => (
          <Row
            key={s.name}
            name={`Button ${s.name}`}
            mantine={<MButton size={s.m}>주문 확인</MButton>}
            ui={<Button size={s.ui}>주문 확인</Button>}
          />
        ))}
        {ICON_SIZES.map((s) => (
          <Row
            key={s.name}
            name={s.name}
            mantine={
              <ActionIcon size={s.px} radius="xl" variant="subtle" color="gray" aria-label="뒤로">
                <ChevronLeft size={20} />
              </ActionIcon>
            }
            ui={
              <Button
                size={s.ui}
                variant="ghost"
                aria-label="뒤로"
                className={'className' in s ? s.className : undefined}
              >
                <ChevronLeft className="size-5" />
              </Button>
            }
          />
        ))}
      </Section>

      <Section title="Input · Field">
        <Row
          name="Input 입력칸만"
          mantine={<TextInput placeholder="가게 이름" style={{ width: '100%' }} />}
          ui={<Input placeholder="가게 이름" />}
        />
        <Row
          name="Input 값이 있는 입력칸"
          mantine={<TextInput defaultValue="그린러브 화원" style={{ width: '100%' }} />}
          ui={<Input defaultValue="그린러브 화원" />}
        />
        <Row
          name="Input 라벨 + 설명"
          mantine={
            <TextInput
              label="연락처"
              description="고객에게 보이는 번호입니다"
              placeholder="010-0000-0000"
              style={{ width: '100%' }}
            />
          }
          ui={
            <Field>
              <FieldLabel htmlFor="ui-phone">연락처</FieldLabel>
              <FieldDescription>고객에게 보이는 번호입니다</FieldDescription>
              <Input id="ui-phone" placeholder="010-0000-0000" />
            </Field>
          }
        />
        <Row
          name="Input 라벨 + 오류"
          mantine={
            <TextInput
              label="계좌번호"
              error="숫자만 입력해 주세요"
              defaultValue="123-abc"
              style={{ width: '100%' }}
            />
          }
          ui={
            <Field data-invalid>
              <FieldLabel htmlFor="ui-account">계좌번호</FieldLabel>
              <Input id="ui-account" aria-invalid defaultValue="123-abc" />
              <FieldError>숫자만 입력해 주세요</FieldError>
            </Field>
          }
        />
        <Row
          name="Input disabled"
          mantine={<TextInput disabled defaultValue="수정할 수 없음" style={{ width: '100%' }} />}
          ui={<Input disabled defaultValue="수정할 수 없음" />}
        />
      </Section>

      <Section title="Button · 링크·왼쪽 아이콘·작은 크기">
        <Row
          name="Button 링크 xs subtle gray"
          mantine={
            <MButton component={Link} href="/products" size="xs" variant="subtle" color="gray">
              수정
            </MButton>
          }
          ui={
            <Button
              render={<Link href="/products" />}
              nativeButton={false}
              size="xs"
              variant="ghost"
            >
              수정
            </Button>
          }
        />
        <Row
          name="Button 링크 xs filled"
          mantine={
            <MButton component={Link} href="/products/new" size="xs">
              + 등록
            </MButton>
          }
          ui={
            <Button render={<Link href="/products/new" />} nativeButton={false} size="xs">
              + 등록
            </Button>
          }
        />
        <Row
          name="Button xs light red 왼쪽 아이콘"
          mantine={
            <MButton size="xs" variant="light" color="red" leftSection={<RefreshCcw size={14} />}>
              다시 조회
            </MButton>
          }
          ui={
            <Button size="xs" variant="light-destructive">
              <RefreshCcw className="size-3.5" data-icon="inline-start" />
              다시 조회
            </Button>
          }
        />
      </Section>

      <Section title="Button · 모서리 8px·나란히 채우기">
        <Row
          name="Button xs light red radius md"
          mantine={
            <MButton size="xs" variant="light" color="red" radius="md">
              정지
            </MButton>
          }
          ui={
            <Button size="xs" variant="light-destructive" className="rounded-[8px]">
              정지
            </Button>
          }
        />
        <Row
          name="Button xs outline red radius md"
          mantine={
            <MButton size="xs" variant="outline" color="red" radius="md">
              강제환불
            </MButton>
          }
          ui={
            <Button size="xs" variant="outline-destructive" className="rounded-[8px]">
              강제환불
            </Button>
          }
        />
        <Row
          name="Button 확인·취소 flex 1"
          mantine={
            <div style={{ display: 'flex', gap: 10, width: '100%' }}>
              <MButton flex={1} color="red" style={{ fontWeight: 'var(--fw-medium)' }}>
                승인
              </MButton>
              <MButton flex={1} variant="outline" color="gray">
                취소
              </MButton>
            </div>
          }
          ui={
            <div style={{ display: 'flex', gap: 10, width: '100%' }}>
              <Button
                variant="destructive"
                className="flex-1"
                style={{ fontWeight: 'var(--fw-medium)' }}
              >
                승인
              </Button>
              <Button variant="outline-gray" className="flex-1">
                취소
              </Button>
            </div>
          }
        />
      </Section>

      <Section title="Alert">
        <Row
          name="Alert light red"
          mantine={
            <MAlert color="red" title="상품을 불러오지 못했습니다" style={{ width: '100%' }}>
              네트워크 오류
            </MAlert>
          }
          ui={
            <Alert variant="destructive" className="w-full">
              <AlertTitle>상품을 불러오지 못했습니다</AlertTitle>
              <AlertDescription>네트워크 오류</AlertDescription>
            </Alert>
          }
        />
        <Row
          name="Alert light yellow"
          mantine={
            <MAlert
              color="yellow"
              title="최신 정보를 확인하지 못했습니다"
              style={{ width: '100%' }}
            >
              이전 목록을 표시합니다.
            </MAlert>
          }
          ui={
            <Alert variant="warning" className="w-full">
              <AlertTitle>최신 정보를 확인하지 못했습니다</AlertTitle>
              <AlertDescription>이전 목록을 표시합니다.</AlertDescription>
            </Alert>
          }
        />
        <Row
          name="Alert light gray ↔ secondary"
          mantine={
            <MAlert color="gray" title="기본값을 채워 두었습니다" style={{ width: '100%' }}>
              저장하면 작성 중 회차로 만들어집니다.
            </MAlert>
          }
          ui={
            <Alert variant="secondary" className="w-full">
              <AlertTitle>기본값을 채워 두었습니다</AlertTitle>
              <AlertDescription>저장하면 작성 중 회차로 만들어집니다.</AlertDescription>
            </Alert>
          }
        />
        <Row
          name="Alert icon ↔ icon"
          mantine={
            <MAlert
              color="red"
              title="최신 회차를 다시 확인하지 못했습니다"
              icon={<AlertTriangle size={18} />}
              style={{ width: '100%' }}
            >
              네트워크 오류
            </MAlert>
          }
          ui={
            <Alert variant="destructive" icon={<AlertTriangle size={18} />} className="w-full">
              <AlertTitle>최신 회차를 다시 확인하지 못했습니다</AlertTitle>
              <AlertDescription>네트워크 오류</AlertDescription>
            </Alert>
          }
        />
        <Row
          name="Alert withCloseButton ↔ onClose"
          mantine={
            <MAlert
              title="회차 복사 완료"
              withCloseButton
              onClose={() => {}}
              style={{ width: '100%' }}
            >
              복사한 회차를 열어 확인해 주세요.
            </MAlert>
          }
          ui={
            <Alert onClose={() => {}} closeButtonLabel="닫기" className="w-full">
              <AlertTitle>회차 복사 완료</AlertTitle>
              <AlertDescription>복사한 회차를 열어 확인해 주세요.</AlertDescription>
            </Alert>
          }
        />
      </Section>

      <Section title="Switch">
        <Row
          name="Switch 꺼짐"
          mantine={<MSwitch aria-label="기상 제한" />}
          ui={<Switch aria-label="기상 제한" />}
        />
        <Row
          name="Switch 켜짐"
          mantine={<MSwitch aria-label="기상 제한" defaultChecked />}
          ui={<Switch aria-label="기상 제한" defaultChecked />}
        />
        <Row
          name="Switch 잠김·꺼짐"
          mantine={<MSwitch aria-label="기상 제한" disabled />}
          ui={<Switch aria-label="기상 제한" disabled />}
        />
        <Row
          name="Switch 잠김·켜짐"
          mantine={<MSwitch aria-label="기상 제한" defaultChecked disabled />}
          ui={<Switch aria-label="기상 제한" defaultChecked disabled />}
        />
      </Section>

      <Section title="Card">
        <Row
          name="Card(withBorder, radius 16, padding md)"
          mantine={
            <MCard style={{ width: '100%' }}>
              <Text fw={700}>오늘 주문</Text>
              <Text size="sm" style={{ color: 'var(--color-text-secondary)' }}>
                준비할 주문 3건
              </Text>
            </MCard>
          }
          ui={
            <Card className="w-full gap-0">
              <CardHeader className="gap-0">
                <CardTitle>오늘 주문</CardTitle>
                <CardDescription>준비할 주문 3건</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          }
        />
      </Section>

      <Section title="Badge">
        {BADGES.map((b) => (
          <Row
            key={b.name}
            name={`Badge ${b.name}`}
            mantine={<MBadge {...b.m}>배송 준비</MBadge>}
            ui={<Badge variant={b.ui}>배송 준비</Badge>}
          />
        ))}
        <Row
          name="Badge 영문 (대문자)"
          mantine={<MBadge variant="light">new</MBadge>}
          ui={<Badge variant="light">new</Badge>}
        />
        <Row
          name="Badge filled red ↔ destructive-filled"
          mantine={
            <MBadge color="red" variant="filled">
              회수 필요 ₩25,200
            </MBadge>
          }
          ui={<Badge variant="destructive-filled">회수 필요 ₩25,200</Badge>}
        />
        <Row
          name="Badge light orange ↔ light-orange"
          mantine={
            <MBadge color="orange" variant="light">
              지급 보류
            </MBadge>
          }
          ui={<Badge variant="light-orange">지급 보류</Badge>}
        />
      </Section>

      <Section title="상품 폼 입력 부품">
        <Row
          name="TextInput md xl ↔ Input md rounded-xl (자리표시)"
          mantine={<TextInput placeholder="상품명" size="md" radius="xl" w="100%" />}
          ui={<Input placeholder="상품명" size="md" className="rounded-xl" />}
        />
        <Row
          name="TextInput md xl ↔ Input md rounded-xl (값)"
          mantine={<TextInput defaultValue="동양란 빅립" size="md" radius="xl" w="100%" />}
          ui={<Input defaultValue="동양란 빅립" size="md" className="rounded-xl" />}
        />
        <Row
          name="Select md xl clearable ↔ Select md (자리표시)"
          mantine={
            <MSelect
              placeholder="품종 선택 (선택사항)"
              data={VARIETY_GROUPS}
              value={null}
              clearable
              size="md"
              radius="xl"
              w="100%"
            />
          }
          ui={
            <div className="w-full">
              <Select
                placeholder="품종 선택 (선택사항)"
                data={VARIETY_GROUPS}
                value={null}
                onValueChange={() => {}}
                clearable
                size="md"
                className="rounded-xl"
              />
            </div>
          }
        />
        <Row
          name="Select md xl clearable ↔ Select md (값·지우기)"
          mantine={
            <MSelect
              placeholder="품종 선택 (선택사항)"
              data={VARIETY_GROUPS}
              value="variety-biglip"
              clearable
              size="md"
              radius="xl"
              w="100%"
            />
          }
          ui={
            <div className="w-full">
              <Select
                placeholder="품종 선택 (선택사항)"
                data={VARIETY_GROUPS}
                value="variety-biglip"
                onValueChange={() => {}}
                clearable
                size="md"
                className="rounded-xl"
              />
            </div>
          }
        />
        <Row
          name="Textarea radius md 16·1.6 ↔ Textarea (판매자 메모)"
          mantine={
            <MTextarea
              placeholder="예: 직접 키운 호접란입니다."
              radius="md"
              w="100%"
              styles={{ input: { fontSize: 'var(--font-size-md)', lineHeight: 1.6 } }}
            />
          }
          ui={
            <div className="w-full">
              <Textarea
                placeholder="예: 직접 키운 호접란입니다."
                className="rounded-[8px]"
                style={{ fontSize: 'var(--font-size-md)', lineHeight: 1.6 }}
              />
            </div>
          }
        />
        <Row
          name="Textarea autosize minRows 5 ↔ Textarea autosize (상세 설명)"
          mantine={
            <MTextarea
              defaultValue={LONG_TEXT}
              autosize
              minRows={5}
              radius="md"
              w="100%"
              styles={{ input: { fontSize: 'var(--font-size-sm)', lineHeight: 1.7 } }}
            />
          }
          ui={
            <div className="w-full">
              <Textarea
                defaultValue={LONG_TEXT}
                autosize
                minRows={5}
                className="rounded-[8px]"
                style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.7 }}
              />
            </div>
          }
        />
        <Row
          name="Textarea autosize minRows 5 빈 칸 ↔ Textarea autosize (상세 설명 비었을 때)"
          mantine={
            <MTextarea
              placeholder="AI가 생성한 상세 설명"
              autosize
              minRows={5}
              radius="md"
              w="100%"
              styles={{ input: { fontSize: 'var(--font-size-sm)', lineHeight: 1.7 } }}
            />
          }
          ui={
            <div className="w-full">
              <Textarea
                placeholder="AI가 생성한 상세 설명"
                autosize
                minRows={5}
                className="rounded-[8px]"
                style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.7 }}
              />
            </div>
          }
        />
        <Row
          name="Loader xs ↔ Loader xs"
          mantine={<MLoader size="xs" color="var(--color-primary)" />}
          ui={<Loader size="xs" />}
        />
        <Row
          name="Loader md ↔ Loader md"
          mantine={<MLoader size="md" color="var(--color-primary)" />}
          ui={<Loader size="md" />}
        />
        <Row
          name="Badge button outline gray ↔ Badge outline-gray"
          mantine={
            <MBadge
              component="button"
              radius="xl"
              variant="outline"
              color="gray"
              style={{ cursor: 'pointer' }}
            >
              핑크
            </MBadge>
          }
          ui={
            <Badge
              render={<button type="button" />}
              variant="outline-gray"
              style={{ cursor: 'pointer' }}
            >
              핑크
            </Badge>
          }
        />
        <Row
          name="Badge button filled gray 고름 ↔ Badge outline-gray 고름"
          mantine={
            <MBadge
              component="button"
              radius="xl"
              variant="filled"
              color="gray"
              style={SELECTED_BADGE}
            >
              핑크
            </MBadge>
          }
          ui={
            <Badge render={<button type="button" />} variant="outline-gray" style={SELECTED_BADGE}>
              핑크
            </Badge>
          }
        />
        <Row
          name="Button md outline gray 두 줄 ↔ outline-gray md (출하 형태)"
          mantine={
            <MButton size="md" variant="outline" color="gray" w={120}>
              <StemLabel />
            </MButton>
          }
          ui={
            <Button size="md" variant="outline-gray" className="w-[120px]">
              <StemLabel />
            </Button>
          }
        />
        <Row
          name="Button md outline gray 두 줄·좁음 ↔ outline-gray md + ButtonLabel (잘림)"
          mantine={
            <MButton size="md" variant="outline" color="gray" w={70}>
              <StemLabel />
            </MButton>
          }
          ui={
            <Button size="md" variant="outline-gray" className="w-[70px]">
              <ButtonLabel>
                <StemLabel />
              </ButtonLabel>
            </Button>
          }
        />
        <Row
          name="Button lg outline gray ↔ outline-gray lg (이전)"
          mantine={
            <MButton size="lg" variant="outline" color="gray" flex={1}>
              이전
            </MButton>
          }
          ui={
            <Button size="lg" variant="outline-gray" className="flex-1">
              이전
            </Button>
          }
        />
      </Section>

      <Section title="상품 폼 4·5단계 부품">
        <Row
          name="NumberInput md xl ₩ ↔ NumberInput md (가격)"
          mantine={
            <MNumberInput
              placeholder="가격"
              leftSection={<Text style={{ fontSize: 15, color: '#a3a9a6' }}>₩</Text>}
              thousandSeparator=","
              hideControls
              value={30000}
              size="md"
              radius="xl"
              w="100%"
            />
          }
          ui={
            <div className="w-full">
              <NumberInput
                placeholder="가격"
                leftSection={
                  <p
                    className="m-0 p-0 text-base font-normal"
                    style={{ fontSize: 15, color: '#a3a9a6' }}
                  >
                    ₩
                  </p>
                }
                thousandSeparator=","
                value={30000}
                onValueChange={() => {}}
                size="md"
                className="rounded-xl"
              />
            </div>
          }
        />
        <Row
          name="TextInput label·단위 radius md ↔ Field + Input rightSection (크기)"
          mantine={
            <TextInput
              label="높이"
              rightSection={<Text size="sm">cm</Text>}
              defaultValue="55"
              radius="md"
              w="100%"
            />
          }
          ui={
            <div className="w-full">
              <Field>
                <FieldLabel htmlFor="cmp-height">높이</FieldLabel>
                <Input
                  id="cmp-height"
                  rightSection={<p className="m-0 p-0 text-base font-normal text-sm">cm</p>}
                  defaultValue="55"
                  className="rounded-[8px]"
                />
              </Field>
            </div>
          }
        />
        <Row
          name="NativeSelect xs label ↔ NativeSelect xs label (재고 연결)"
          mantine={
            <MNativeSelect
              size="xs"
              label="재고 연결"
              data={[{ value: '', label: '연결 안 함 (수량 제한 없음)' }]}
              w="100%"
            />
          }
          ui={
            <div className="w-full">
              <NativeSelect
                size="xs"
                label="재고 연결"
                data={[{ value: '', label: '연결 안 함 (수량 제한 없음)' }]}
              />
            </div>
          }
        />
        <Row
          name="Checkbox green 꺼짐 ↔ Checkbox"
          mantine={
            <MCheckbox
              color="green"
              label="가게의 품질 보장 대상"
              checked={false}
              onChange={() => {}}
            />
          }
          ui={
            <Checkbox
              color="#40c057"
              label="가게의 품질 보장 대상"
              checked={false}
              onCheckedChange={() => {}}
            />
          }
        />
        <Row
          name="Checkbox green 켜짐 ↔ Checkbox"
          mantine={
            <MCheckbox color="green" label="가게의 품질 보장 대상" checked onChange={() => {}} />
          }
          ui={
            <Checkbox
              color="#40c057"
              label="가게의 품질 보장 대상"
              checked
              onCheckedChange={() => {}}
            />
          }
        />
        <Row
          name="Chip green 꺼짐 ↔ Chip"
          mantine={
            <MChip color="green" checked={false} onChange={() => {}}>
              거실
            </MChip>
          }
          ui={
            <Chip color="#40c057" checked={false} onCheckedChange={() => {}}>
              거실
            </Chip>
          }
        />
        <Row
          name="Chip green 켜짐 ↔ Chip"
          mantine={
            <MChip color="green" checked onChange={() => {}}>
              거실
            </MChip>
          }
          ui={
            <Chip color="#40c057" checked onCheckedChange={() => {}}>
              거실
            </Chip>
          }
        />
        <Row
          name="Button xs outline yellow ↔ outline-warning"
          mantine={
            <MButton size="xs" variant="outline" color="yellow">
              수정 반영하기
            </MButton>
          }
          ui={
            <Button size="xs" variant="outline-warning">
              수정 반영하기
            </Button>
          }
        />
        <Row
          name="Button xs subtle gray ↔ ghost xs"
          mantine={
            <MButton size="xs" variant="subtle" color="gray">
              그대로 등록하기
            </MButton>
          }
          ui={
            <Button size="xs" variant="ghost">
              그대로 등록하기
            </Button>
          }
        />
        <Row
          name="Button xs light green ↔ light-green"
          mantine={
            <MButton size="xs" variant="light" color="green">
              + 선택지
            </MButton>
          }
          ui={
            <Button size="xs" variant="light-green">
              + 선택지
            </Button>
          }
        />
        <Row
          name="Button outline green ↔ outline-green"
          mantine={
            <MButton variant="outline" color="green" radius="xl">
              + 옵션 묶음 추가
            </MButton>
          }
          ui={
            <Button variant="outline-green">
              <ButtonLabel>+ 옵션 묶음 추가</ButtonLabel>
            </Button>
          }
        />
        <Row
          name="Button compact-xs outline md ↔ outline compact-xs"
          mantine={
            <MButton size="compact-xs" variant="outline" radius="md">
              링크 복사
            </MButton>
          }
          ui={
            <Button size="compact-xs" variant="outline" className="rounded-[8px]">
              링크 복사
            </Button>
          }
        />
        <Row
          name="Button compact-xs subtle red md ↔ subtle-destructive"
          mantine={
            <MButton size="compact-xs" variant="subtle" color="red" radius="md">
              취소
            </MButton>
          }
          ui={
            <Button size="compact-xs" variant="subtle-destructive" className="rounded-[8px]">
              취소
            </Button>
          }
        />
        <Row
          name="Button compact-xs subtle red loading ↔ LoadingButton"
          mantine={
            <MButton size="compact-xs" variant="subtle" color="red" radius="md" loading>
              취소
            </MButton>
          }
          ui={
            <LoadingButton
              size="compact-xs"
              variant="subtle-destructive"
              className="rounded-[8px]"
              loading
            >
              취소
            </LoadingButton>
          }
        />
        <Row
          name="Button compact-sm light ↔ light compact-sm"
          mantine={
            <MButton size="compact-sm" variant="light">
              숨김 해제
            </MButton>
          }
          ui={
            <Button size="compact-sm" variant="light">
              숨김 해제
            </Button>
          }
        />
        <Row
          name="Button compact-sm default ↔ plain"
          mantine={
            <MButton size="compact-sm" variant="default">
              연락 전으로 되돌리기
            </MButton>
          }
          ui={
            <Button size="compact-sm" variant="plain">
              연락 전으로 되돌리기
            </Button>
          }
        />
        <Row
          name="Badge light orange ↔ light-orange"
          mantine={
            <MBadge variant="light" color="orange" radius="xl">
              취소됨
            </MBadge>
          }
          ui={
            <Badge variant="light-orange" className="rounded-[32px]">
              취소됨
            </Badge>
          }
        />
        <Row
          name="Badge light green sm ↔ light-green"
          mantine={
            <MBadge variant="light" color="green" radius="sm">
              연락함
            </MBadge>
          }
          ui={
            <Badge variant="light-green" className="rounded-[4px]">
              연락함
            </Badge>
          }
        />
        <Row
          name="Button xs outline red md ↔ outline-destructive"
          mantine={
            <MButton size="xs" variant="outline" color="red" radius="md">
              정지
            </MButton>
          }
          ui={
            <Button size="xs" variant="outline-destructive" className="rounded-[8px]">
              정지
            </Button>
          }
        />
        <Row
          name="Button xs subtle red ↔ subtle-destructive"
          mantine={
            <MButton size="xs" variant="subtle" color="red">
              치우기
            </MButton>
          }
          ui={
            <Button size="xs" variant="subtle-destructive">
              치우기
            </Button>
          }
        />
        <Row
          name="NumberInput xs sm % ↔ Input xs + 17px 칸"
          mantine={
            <MNumberInput
              value="5"
              onChange={() => {}}
              rightSection="%"
              size="xs"
              radius="sm"
              w={104}
            />
          }
          ui={
            <div className="relative w-[104px]">
              <Input value="5" onChange={() => {}} size="xs" className="rounded-[4px] pe-[17px]" />
              <InputSection side="right" size="xs" className="w-[17px] rounded-e-[4px]">
                %
              </InputSection>
            </div>
          }
        />
        <Row
          name="TextInput sm md label ↔ Field + Input"
          mantine={
            <TextInput
              label="판매자 검색"
              placeholder="상호·대표자·전화번호"
              radius="md"
              size="sm"
              style={{ width: 200 }}
            />
          }
          ui={
            <Field style={{ width: 200 }}>
              <FieldLabel htmlFor="compare-stores-keyword">판매자 검색</FieldLabel>
              <Input
                id="compare-stores-keyword"
                placeholder="상호·대표자·전화번호"
                className="rounded-[8px]"
              />
            </Field>
          }
        />
        <Row
          name="Select sm md label ↔ Field + Select"
          mantine={
            <MSelect
              label="상태"
              value="current"
              data={[{ value: 'current', label: '활성' }]}
              radius="md"
              size="sm"
              style={{ width: 120 }}
            />
          }
          ui={
            <Field style={{ width: 120 }}>
              <FieldLabel htmlFor="compare-stores-status">상태</FieldLabel>
              <Select
                id="compare-stores-status"
                value="current"
                onValueChange={() => {}}
                data={[{ value: 'current', label: '활성' }]}
                className="rounded-[8px]"
              />
            </Field>
          }
        />
      </Section>

      <Section title="앱 틀 · 화면 촬영에 없는 상태">
        <Row
          name="ConfirmModal 확인 버튼 filled dark ↔ default + dark-6"
          mantine={
            <MButton color="dark" style={{ fontWeight: 'var(--fw-medium)' }}>
              마감 확인
            </MButton>
          }
          ui={
            <Button
              className="bg-[#2e2e2e] hover:bg-[#242424]"
              style={{ fontWeight: 'var(--fw-medium)' }}
            >
              마감 확인
            </Button>
          }
        />
        <Row
          name="LoadMoreFooter 더 보기 실패(다시 시도)"
          mantine={
            <div style={{ width: '100%' }}>
              <MStack align="center" gap={4} mt="md">
                <Text
                  role="alert"
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
                >
                  드라이버 목록을 더 불러오지 못했습니다.
                </Text>
                <MButton variant="light" color="gray" radius="md">
                  다시 시도
                </MButton>
              </MStack>
            </div>
          }
          ui={
            <div style={{ width: '100%' }}>
              <LoadMoreFooter
                hasMore
                loadingMore={false}
                moreError="드라이버 목록을 더 불러오지 못했습니다."
                onLoadMore={() => {}}
              />
            </div>
          }
        />
      </Section>

      <p style={{ fontSize: 13, color: '#6b716e' }}>
        Select 열린 상태는 ?open=select·uiselect 로 따로 찍는다.
      </p>
      <p style={{ fontSize: 13, color: '#6b716e' }}>
        Dialog · Sheet 열린 상태는 ?open=modal·dialog·drawer·sheet 로 따로 찍는다.
      </p>

      {/* ConfirmModal(src/components/ConfirmModal.tsx)과 같은 설정 */}
      <Modal
        opened={open === 'modal'}
        onClose={() => {}}
        title={<Text style={{ fontWeight: 'var(--fw-bold)' }}>{MODAL_TITLE}</Text>}
        radius="lg"
        centered
      >
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          {MODAL_TEXT}
        </Text>
      </Modal>
      <Dialog open={open === 'dialog'}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="leading-[1.55] font-bold">{MODAL_TITLE}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <DialogDescription className="leading-[1.55]">{MODAL_TEXT}</DialogDescription>
          </DialogBody>
        </DialogContent>
      </Dialog>

      {/* 소비자 OptionSheet(apps/consumer/src/components/benchmark/OptionSheet.tsx)와 같은 설정 */}
      <Drawer
        opened={open === 'drawer'}
        onClose={() => {}}
        position="bottom"
        size="auto"
        radius="lg"
        title={SHEET_TITLE}
        styles={{
          title: { fontWeight: 800, fontSize: 'var(--font-size-lg)' },
          content: { flex: '0 0 auto', height: 'auto', maxHeight: '85dvh' },
        }}
      >
        <Text size="sm">{SHEET_TEXT}</Text>
      </Drawer>
      <Sheet open={open === 'sheet'}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle className="text-lg leading-none font-extrabold">{SHEET_TITLE}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            <SheetDescription className="text-black">{SHEET_TEXT}</SheetDescription>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </main>
  );
}
