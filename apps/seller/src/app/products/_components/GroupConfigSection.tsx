'use client';

import { Button, ButtonLabel } from '@greenhub/ui/components/button';

const GROUP_DELIVERY_METHODS = [
  { value: 'direct', label: '꽃차 직배송' },
  { value: 'parcel', label: '택배' },
] as const;

// ① 외형 유지(UI 교체 P2b): Mantine Text(p, 여백 0)·Group(간격 10) 값.
const TEXT = 'm-0 p-0 text-base font-normal';
const GROUP = 'flex flex-row flex-wrap items-center justify-start gap-2.5';

interface GroupConfigForm {
  minQuantity: string;
  targetQuantity: string;
  maxPerPerson: string;
  recruitDeadline: string;
  groupDeliveryDate: string;
  groupDeliveryMethod: 'direct' | 'parcel';
}

interface Props {
  visible: boolean;
  config: GroupConfigForm;
  setGroupConfig: <K extends keyof GroupConfigForm>(key: K, value: GroupConfigForm[K]) => void;
}

export default function GroupConfigSection({ visible, config, setGroupConfig }: Props) {
  return (
    <div
      style={{
        overflow: 'hidden',
        maxHeight: visible ? 600 : 0,
        transition: 'max-height 0.3s ease-in-out',
        marginTop: visible ? 16 : 0,
      }}
    >
      <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
        <div className={`${GROUP} mb-3`}>
          <div style={{ flex: 1 }}>
            <p
              className={`${TEXT} mb-1`}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              최소 수량
            </p>
            <input
              type="number"
              placeholder="10"
              min={1}
              value={config.minQuantity}
              onChange={(e) => setGroupConfig('minQuantity', e.target.value)}
              style={{
                width: '100%',
                border: '1px solid var(--color-border)',
                borderRadius: 12,
                padding: '10px 12px',
                fontSize: 'var(--font-size-sm)',
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <p
              className={`${TEXT} mb-1`}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              목표 수량
            </p>
            <input
              type="number"
              placeholder="50"
              min={1}
              value={config.targetQuantity}
              onChange={(e) => setGroupConfig('targetQuantity', e.target.value)}
              style={{
                width: '100%',
                border: '1px solid var(--color-border)',
                borderRadius: 12,
                padding: '10px 12px',
                fontSize: 'var(--font-size-sm)',
              }}
            />
          </div>
        </div>
        <div className="mb-3">
          <p
            className={`${TEXT} mb-1`}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            1인 최대 구매 수량
          </p>
          <input
            type="number"
            placeholder="5"
            min={1}
            value={config.maxPerPerson}
            onChange={(e) => setGroupConfig('maxPerPerson', e.target.value)}
            style={{
              width: '100%',
              border: '1px solid var(--color-border)',
              borderRadius: 12,
              padding: '10px 12px',
              fontSize: 'var(--font-size-sm)',
            }}
          />
        </div>

        <div className="mb-3">
          <p
            className={`${TEXT} mb-1`}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            모집 마감일시
          </p>
          <input
            type="datetime-local"
            value={config.recruitDeadline}
            onChange={(e) => setGroupConfig('recruitDeadline', e.target.value)}
            style={{
              width: '100%',
              border: '1px solid var(--color-border)',
              borderRadius: 12,
              padding: '10px 12px',
              fontSize: 'var(--font-size-sm)',
            }}
          />
        </div>

        <div className="mb-3">
          <p
            className={`${TEXT} mb-1`}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            배송 예정일
          </p>
          <input
            type="date"
            value={config.groupDeliveryDate}
            onChange={(e) => setGroupConfig('groupDeliveryDate', e.target.value)}
            style={{
              width: '100%',
              border: '1px solid var(--color-border)',
              borderRadius: 12,
              padding: '10px 12px',
              fontSize: 'var(--font-size-sm)',
            }}
          />
        </div>

        <div>
          <p
            className={`${TEXT} mb-1`}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            배송 수단
          </p>
          <div className={GROUP}>
            {GROUP_DELIVERY_METHODS.map(({ value, label }) => (
              <Button
                key={value}
                type="button"
                onClick={() => setGroupConfig('groupDeliveryMethod', value as 'direct' | 'parcel')}
                className="flex-1"
                variant="outline-gray"
                style={
                  config.groupDeliveryMethod === value
                    ? {
                        backgroundColor: 'var(--color-primary-surface)',
                        borderColor: 'var(--color-primary)',
                        color: 'var(--color-primary-dark)',
                      }
                    : {}
                }
              >
                <ButtonLabel>{label}</ButtonLabel>
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
