'use client';

import type { Product, SaleRoundDeliveryRegion } from '@greenhub/shared';
import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { Copy, Link2, PackagePlus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

export type NumericValue = number | string;

export interface ItemDraft {
  key: string;
  productId: string;
  name: string;
  roundPrice: NumericValue;
  saleLimitQuantity: NumericValue;
  displayOrder: NumericValue;
}

export interface FormDraft {
  name: string;
  orderOpenAt: string;
  orderCloseAt: string;
  auctionAt: string;
  deliveryStartAt: string;
  deliveryEndAt: string;
  deliveryRegionEnabled: boolean;
  maxDeliveryAddresses: NumericValue;
  maxItemQuantity: NumericValue;
  items: ItemDraft[];
}

export interface CopyFeedback {
  kind: 'success' | 'error';
  message: string;
}

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Paper radius="lg" shadow="xs" p="md">
      <Stack gap="md">
        <Box>
          <Title order={4}>{title}</Title>
          {description && (
            <Text
              mt={4}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              {description}
            </Text>
          )}
        </Box>
        {children}
      </Stack>
    </Paper>
  );
}

export function ScheduleSection({
  draft,
  busy,
  onChange,
}: {
  draft: FormDraft;
  busy: boolean;
  onChange: (
    key: 'orderOpenAt' | 'orderCloseAt' | 'auctionAt' | 'deliveryStartAt' | 'deliveryEndAt',
    value: string,
  ) => void;
}) {
  return (
    <FormSection
      title="일정"
      description="한국 시간 기준입니다. 주문 시작 → 주문 마감 → 경매 → 배송 시작 → 배송 종료 순서로 맞춰 주세요."
    >
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        {(
          [
            ['orderOpenAt', '주문 시작'],
            ['orderCloseAt', '주문 마감'],
            ['auctionAt', '경매 시각'],
            ['deliveryStartAt', '배송 시작'],
            ['deliveryEndAt', '배송 종료'],
          ] as const
        ).map(([key, label]) => (
          <TextInput
            key={key}
            type="datetime-local"
            label={label}
            value={draft[key]}
            onChange={(event) => onChange(key, event.currentTarget.value)}
            disabled={busy}
            required
          />
        ))}
      </SimpleGrid>
    </FormSection>
  );
}

export function DeliveryRegionSection({
  region,
  enabled,
  busy,
  onChange,
}: {
  region: SaleRoundDeliveryRegion;
  enabled: boolean;
  busy: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <FormSection
      title="배송 지역"
      description="이 회차에서 주문을 받는 지역입니다. 끄면 이 지역 주문을 받지 않습니다."
    >
      <Group justify="space-between" align="center" wrap="nowrap">
        <Text style={{ fontWeight: 'var(--fw-medium)' }}>{region.label}</Text>
        <Switch
          label="배송 지역 활성"
          checked={enabled}
          onChange={(event) => onChange(event.currentTarget.checked)}
          disabled={busy}
        />
      </Group>
      {!enabled && (
        <Alert color="yellow" title="배송 지역 비활성">
          저장하면 이 회차에서 해당 지역 주문을 받을 수 없습니다.
        </Alert>
      )}
    </FormSection>
  );
}

export function LimitsSection({
  maxDeliveryAddresses,
  maxItemQuantity,
  busy,
  onChange,
}: {
  maxDeliveryAddresses: NumericValue;
  maxItemQuantity: NumericValue;
  busy: boolean;
  onChange: (key: 'maxDeliveryAddresses' | 'maxItemQuantity', value: NumericValue) => void;
}) {
  return (
    <FormSection title="회차 한도">
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <NumberInput
          label="배송지 한도"
          min={1}
          step={1}
          allowDecimal={false}
          value={maxDeliveryAddresses}
          onChange={(value) => onChange('maxDeliveryAddresses', value)}
          disabled={busy}
          required
        />
        <NumberInput
          label="판매 수량 한도"
          min={1}
          step={1}
          allowDecimal={false}
          value={maxItemQuantity}
          onChange={(value) => onChange('maxItemQuantity', value)}
          disabled={busy}
          required
        />
      </SimpleGrid>
    </FormSection>
  );
}

export function ProductsSection({
  items,
  availableProducts,
  busy,
  onAdd,
  onRemove,
  onUpdate,
}: {
  items: ItemDraft[];
  availableProducts: readonly Product[];
  busy: boolean;
  onAdd: (product: Product) => void;
  onRemove: (key: string) => void;
  onUpdate: (
    key: string,
    field: 'roundPrice' | 'saleLimitQuantity' | 'displayOrder',
    value: NumericValue,
  ) => void;
}) {
  return (
    <FormSection
      title="회차 상품"
      description="회차 가격과 상품별 판매 한도는 1 이상, 노출 순서는 0부터 숫자로 적어 주세요(작은 숫자가 먼저 보입니다)."
    >
      {items.length === 0 && (
        <Alert color="yellow" title="선택한 상품이 없습니다">
          아래 상품 목록에서 회차에 포함할 상품을 추가해 주세요.
        </Alert>
      )}
      {items.map((item) => (
        <Paper key={item.key} radius="md" p="sm" withBorder>
          <Stack gap="sm">
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Box>
                <Text style={{ fontWeight: 'var(--fw-medium)' }}>{item.name}</Text>
                <Text
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                >
                  {item.productId}
                </Text>
              </Box>
              <Button
                type="button"
                size="xs"
                variant="subtle"
                color="red"
                leftSection={<Trash2 size={14} />}
                onClick={() => onRemove(item.key)}
                disabled={busy}
              >
                제거
              </Button>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <NumberInput
                label="회차 가격"
                min={1}
                step={1}
                allowDecimal={false}
                thousandSeparator=","
                value={item.roundPrice}
                onChange={(value) => onUpdate(item.key, 'roundPrice', value)}
                disabled={busy}
                required
              />
              <NumberInput
                label="상품별 한도"
                min={1}
                step={1}
                allowDecimal={false}
                value={item.saleLimitQuantity}
                onChange={(value) => onUpdate(item.key, 'saleLimitQuantity', value)}
                disabled={busy}
                required
              />
              <NumberInput
                label="노출 순서"
                min={0}
                step={1}
                allowDecimal={false}
                value={item.displayOrder}
                onChange={(value) => onUpdate(item.key, 'displayOrder', value)}
                disabled={busy}
                required
              />
            </SimpleGrid>
          </Stack>
        </Paper>
      ))}

      <Stack gap="xs">
        <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }}>
          추가 가능한 상품
        </Text>
        {availableProducts.length === 0 && (
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            추가할 수 있는 상품이 없습니다. 상품 관리에서 판매 중인 상품을 먼저 등록해 주세요.
          </Text>
        )}
        {availableProducts.map((product) => (
          <Group key={product.id} justify="space-between" wrap="nowrap">
            <Box>
              <Group gap="xs">
                <Text style={{ fontSize: 'var(--font-size-sm)' }}>{product.name}</Text>
                {!product.isActive && (
                  <Badge color="gray" variant="light">
                    비활성
                  </Badge>
                )}
              </Group>
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                상품 기준가 ₩{product.price.toLocaleString()}
              </Text>
            </Box>
            <Button
              type="button"
              size="xs"
              variant="light"
              leftSection={<PackagePlus size={14} />}
              onClick={() => onAdd(product)}
              disabled={busy || !product.isActive}
            >
              추가
            </Button>
          </Group>
        ))}
      </Stack>
    </FormSection>
  );
}

function LinkRow({
  label,
  url,
  disabled,
  onCopy,
}: {
  label: string;
  url: string | null;
  disabled: boolean;
  onCopy: (url: string, label: string) => Promise<void>;
}) {
  return (
    <Paper radius="md" p="sm" withBorder>
      <Group justify="space-between" align="center" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <Link2 size={18} style={{ flexShrink: 0 }} />
          <Box style={{ minWidth: 0 }}>
            <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }}>
              {label}
            </Text>
            <Text
              style={{
                fontSize: 'var(--font-size-sm)',
                color: url ? 'var(--color-text-secondary)' : 'var(--color-text-disabled)',
                wordBreak: 'break-all',
              }}
            >
              {url ?? '아직 공유 링크가 없습니다.'}
            </Text>
          </Box>
        </Group>
        <Button
          type="button"
          size="xs"
          variant="light"
          leftSection={<Copy size={14} />}
          onClick={() => url && void onCopy(url, label)}
          disabled={disabled || !url}
          style={{ flexShrink: 0 }}
        >
          복사
        </Button>
      </Group>
    </Paper>
  );
}

export function CarrotLinksSection({
  items,
  representativeUrl,
  copyFeedback,
  busy,
  getProductLink,
  onCopy,
}: {
  items: ItemDraft[];
  representativeUrl: string | null;
  copyFeedback: CopyFeedback | null;
  busy: boolean;
  getProductLink: (productId: string) => string | null;
  onCopy: (url: string, label: string) => Promise<void>;
}) {
  return (
    <FormSection
      title="당근 공유 링크"
      description="당근 게시글에 붙여 넣을 회차·상품 링크입니다. 복사해서 쓰세요."
    >
      <Stack gap="sm">
        <LinkRow label="당근 대표 링크" url={representativeUrl} disabled={busy} onCopy={onCopy} />
        {items.map((item) => (
          <LinkRow
            key={`link:${item.key}`}
            label={`${item.name} 상품 링크`}
            url={getProductLink(item.productId)}
            disabled={busy}
            onCopy={onCopy}
          />
        ))}
      </Stack>
      {copyFeedback && (
        <Alert
          color={copyFeedback.kind === 'success' ? 'brand' : 'red'}
          title={copyFeedback.kind === 'success' ? '링크 복사 완료' : '링크 복사 실패'}
          role={copyFeedback.kind === 'success' ? 'status' : 'alert'}
        >
          {copyFeedback.message}
        </Alert>
      )}
    </FormSection>
  );
}
