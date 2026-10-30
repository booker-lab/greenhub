'use client';

import { Badge } from '@greenhub/ui/components/badge';
import { Button } from '@greenhub/ui/components/button';
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
import { Input } from '@greenhub/ui/components/input';
import { Switch } from '@greenhub/ui/components/switch';
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
  Badge as MBadge,
  Button as MButton,
  Card as MCard,
  Drawer,
  Modal,
  Switch as MSwitch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';

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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 8 }}>
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
] as const;

const MODAL_TITLE = '주문 취소';
const SHEET_TITLE = '옵션 고르기';
const MODAL_TEXT = '이 주문을 취소하면 결제 금액이 환불됩니다.';
// 시트는 내용 폭만큼 넓어지므로(소비자 OptionSheet는 선택지가 화면 폭을 채운다) PC 폭에서도 두 줄이 되는 글로 폭을 채운다.
const SHEET_TEXT =
  '화분 종류와 문구를 고르면 가격이 바로 바뀝니다. 고른 옵션은 장바구니와 주문 내역에 그대로 남고, 배송 전까지는 주문 상세에서 확인할 수 있습니다. 문구가 필요한 옵션은 고른 뒤 아래 입력칸에 적어 주세요. 같은 상품을 다른 옵션으로 더 담으면 장바구니에 따로 들어갑니다.';

export function UiCompare({ open }: { open?: string }) {
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
      </Section>

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
