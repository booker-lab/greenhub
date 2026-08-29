import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  collectDeploymentEvidence,
  inspectAppDeployment,
  normalizeTargetUrl,
} from './wait-preview-deploy.mjs';

const SHA = 'a'.repeat(40);

describe('Preview 배포 target_url 증거 계약', () => {
  it('target_url은 trailing slash만 제한적으로 정규화한다', () => {
    assert.equal(
      normalizeTargetUrl(' https://preview.example.test/ '),
      'https://preview.example.test',
    );
    assert.equal(normalizeTargetUrl('http://preview.example.test'), null);
    assert.equal(normalizeTargetUrl('https://preview.example.test/?x=1'), null);
  });

  it('SHA가 일치하고 성공한 deployment의 target_url을 함께 반환한다', () => {
    const requests = [];
    const result = inspectAppDeployment('consumer', 'Preview – greenhubconsumer', SHA, (path) => {
      requests.push(path);
      if (path.includes('/deployments?')) return [{ id: 17, sha: SHA }];
      return [{ state: 'success', target_url: 'https://consumer-preview.example.test/' }];
    });

    assert.equal(result.ready, true);
    assert.equal(result.deploymentSha, SHA);
    assert.equal(result.targetUrl, 'https://consumer-preview.example.test');
    assert.match(requests[0], /environment=Preview%20%E2%80%93%20greenhubconsumer/);
  });

  it('성공 상태여도 target_url이 없으면 준비 완료로 판정하지 않는다', () => {
    const result = inspectAppDeployment('seller', 'Preview – greenhub-seller', SHA, (path) => {
      if (path.includes('/deployments?')) return [{ id: 18, sha: SHA }];
      return [{ state: 'success' }];
    });

    assert.equal(result.ready, false);
    assert.equal(result.targetUrl, null);
  });

  it('지정 SHA deployment가 없으면 배포 미확인으로 닫는다', () => {
    const result = inspectAppDeployment('driver', 'Preview – greenhub-driver', SHA, (path) => {
      if (path.includes('/deployments?')) return [{ id: 19, sha: 'b'.repeat(40) }];
      throw new Error('SHA가 다른 deployment는 status를 조회하면 안 된다');
    });

    assert.equal(result.ready, false);
    assert.equal(result.deploymentId, null);
    assert.equal(result.deploymentSha, null);
    assert.equal(result.state, 'missing');
  });

  it('deployment SHA가 다르면 지정 SHA 배포로 인정하지 않는다', () => {
    const result = inspectAppDeployment('consumer', 'Preview – greenhubconsumer', SHA, (path) => {
      if (path.includes('/deployments?')) return [{ id: 20, sha: 'c'.repeat(40) }];
      throw new Error('SHA가 다른 deployment는 status를 조회하면 안 된다');
    });

    assert.equal(result.ready, false);
    assert.equal(result.deploymentId, null);
  });

  it('세 앱의 SHA와 target_url을 후속 단계가 사용할 맵으로 내보낸다', () => {
    const targets = {
      seller: 'https://seller-preview.example.test',
      consumer: 'https://consumer-preview.example.test',
      driver: 'https://driver-preview.example.test',
    };
    const deploymentIds = { seller: '1', consumer: '2', driver: '3' };
    const evidence = collectDeploymentEvidence(SHA, (path) => {
      if (path.includes('/deployments?')) {
        const app = path.includes('greenhub-seller')
          ? 'seller'
          : path.includes('greenhubconsumer')
            ? 'consumer'
            : 'driver';
        return [{ id: deploymentIds[app], sha: SHA }];
      }
      const app = path.includes('/deployments/1/')
        ? 'seller'
        : path.includes('/deployments/2/')
          ? 'consumer'
          : 'driver';
      return [{ state: 'success', target_url: `${targets[app]}/` }];
    });

    assert.equal(evidence.ready, true);
    assert.deepEqual(evidence.deploymentShas, { consumer: SHA, seller: SHA, driver: SHA });
    assert.deepEqual(evidence.deploymentTargetUrls, targets);
  });
});
