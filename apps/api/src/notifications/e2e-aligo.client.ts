import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NotificationChannel } from '@greenhub/shared';
import { resolveE2EProviderMode } from '../common/e2e-provider-mode';
import type { NotificationDeliveryResult } from './aligo.client';
import {
  type ApiNotificationTemplateCode,
  renderNotificationMessage,
} from './notification-templates';

type E2EAligoScenario =
  | 'alimtalk_success'
  | 'alimtalk_retry_sms_success'
  | 'final_failure';

type CallEvidence = {
  action: 'sendAlimtalk' | 'sendSms';
  templateCode: string;
  scenario: E2EAligoScenario;
  resultChannel: Extract<NotificationChannel, 'alimtalk' | 'sms'> | null;
  sequence: number;
};

function scenarioFromVariables(variables: Record<string, string>): E2EAligoScenario {
  const scenario = variables['e2eScenario'] ?? 'alimtalk_success';
  if (
    scenario !== 'alimtalk_success' &&
    scenario !== 'alimtalk_retry_sms_success' &&
    scenario !== 'final_failure'
  ) {
    throw new Error('허용되지 않은 알림 E2E 시나리오입니다.');
  }
  return scenario;
}

@Injectable()
export class E2EAligoClient {
  private readonly calls: CallEvidence[] = [];

  constructor(config: ConfigService) {
    const mode = resolveE2EProviderMode(config);
    if (!mode.enabled) {
      throw new Error('알림 E2E 대역은 검증된 stub mode에서만 생성할 수 있습니다.');
    }
  }

  async sendAlimtalk(
    _phone: string,
    templateCode: ApiNotificationTemplateCode,
    variables: Record<string, string>,
  ): Promise<NotificationDeliveryResult> {
    const scenario = scenarioFromVariables(variables);
    const message = renderNotificationMessage(templateCode, variables);
    const result =
      scenario === 'alimtalk_success'
        ? {
            success: true,
            channel: 'alimtalk' as const,
            message,
            alimtalkAttempts: 1,
            smsAttempts: 0,
          }
        : scenario === 'alimtalk_retry_sms_success'
          ? {
              success: true,
              channel: 'sms' as const,
              message,
              alimtalkAttempts: 3,
              smsAttempts: 1,
            }
          : {
              success: false,
              channel: null,
              message,
              alimtalkAttempts: 3,
              smsAttempts: 1,
              errorMessage: 'E2E 알림톡과 문자 최종 실패 fixture입니다.',
            };
    this.record('sendAlimtalk', templateCode, scenario, result.channel);
    return result;
  }

  async sendSms(
    _phone: string,
    templateCode: ApiNotificationTemplateCode,
    variables: Record<string, string>,
  ): Promise<NotificationDeliveryResult> {
    const scenario = scenarioFromVariables(variables);
    const message = renderNotificationMessage(templateCode, variables);
    const success = scenario !== 'final_failure';
    const result: NotificationDeliveryResult = {
      success,
      channel: success ? 'sms' : null,
      message,
      alimtalkAttempts: 0,
      smsAttempts: 1,
      errorMessage: success ? undefined : 'E2E 문자 최종 실패 fixture입니다.',
    };
    this.record('sendSms', templateCode, scenario, result.channel);
    return result;
  }

  getCallEvidence(): readonly CallEvidence[] {
    return this.calls.map((call) => ({ ...call }));
  }

  private record(
    action: CallEvidence['action'],
    templateCode: string,
    scenario: E2EAligoScenario,
    resultChannel: CallEvidence['resultChannel'],
  ): void {
    this.calls.push({
      action,
      templateCode,
      scenario,
      resultChannel,
      sequence: this.calls.length + 1,
    });
  }
}
