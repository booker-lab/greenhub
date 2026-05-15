'use client';

import { useState } from 'react';
import { Box, Container, Group, Title, UnstyledButton } from '@mantine/core';
import type { SettlementTab } from './_constants';
import { TABS } from './_constants';
import { useSettlements } from './_hooks/useSettlements';
import { DailySummaryTab } from './_components/DailySummaryTab';
import { OrdersTab } from './_components/OrdersTab';
import { PeriodTab } from './_components/PeriodTab';

export default function SettlementsPage() {
  const [activeTab, setActiveTab] = useState<SettlementTab>('daily');
  const {
    selectedDate,
    setSelectedDate,
    selectedDateLabel,
    today,
    from,
    setFrom,
    to,
    setTo,
    summary,
    summaryLoading,
    summaryError,
    settlements,
    listLoading,
    listError,
    fetchSettlements,
  } = useSettlements(activeTab);

  return (
    <Box
      component="main"
      style={{ minHeight: '100vh', backgroundColor: 'var(--color-surface-muted)' }}
    >
      <Box
        component="header"
        style={{
          backgroundColor: 'var(--color-bg)',
          borderBottom: '1px solid var(--color-border)',
          padding: '16px',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <Container size="sm">
          <Title order={3}>정산 관리</Title>
        </Container>
      </Box>

      <Box
        style={{
          backgroundColor: 'var(--color-bg)',
          borderBottom: '1px solid var(--color-border)',
          position: 'sticky',
          top: 57,
          zIndex: 10,
        }}
      >
        <Container size="sm">
          <Group gap={0}>
            {TABS.map((tab) => (
              <UnstyledButton
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  fontSize: 14,
                  fontWeight: 500,
                  textAlign: 'center',
                  borderBottom: `2px solid ${activeTab === tab.key ? 'var(--color-primary)' : 'transparent'}`,
                  color:
                    activeTab === tab.key ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                }}
              >
                {tab.label}
              </UnstyledButton>
            ))}
          </Group>
        </Container>
      </Box>

      <Container size="sm" px="md" py="md">
        {activeTab === 'daily' && (
          <DailySummaryTab
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            selectedDateLabel={selectedDateLabel}
            today={today}
            summary={summary}
            summaryLoading={summaryLoading}
            summaryError={summaryError}
          />
        )}
        {activeTab === 'period' && (
          <PeriodTab
            from={from}
            setFrom={setFrom}
            to={to}
            setTo={setTo}
            settlements={settlements}
            listLoading={listLoading}
            listError={listError}
            onSearch={(f, t) => fetchSettlements(f, t)}
          />
        )}
        {activeTab === 'orders' && (
          <OrdersTab settlements={settlements} listLoading={listLoading} />
        )}
      </Container>
    </Box>
  );
}
