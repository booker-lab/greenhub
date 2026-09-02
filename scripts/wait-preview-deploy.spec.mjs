import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  collectCommitStatusEvidence,
  collectDeploymentEvidence,
  inspectAppCommitStatus,
  normalizeTargetUrl,
  REPO,
} from './wait-preview-deploy.mjs';

const SHA = 'a'.repeat(40);
const OLD_SHA = 'b'.repeat(40);
const APPS = [
  {
    app: 'consumer',
    context: 'Vercel – greenhubconsumer',
    targetUrl: 'https://consumer-preview.example.test/',
  },
  {
    app: 'seller',
    context: 'Vercel – greenhub-seller',
    targetUrl: 'https://seller-preview.example.test/',
  },
  {
    app: 'driver',
    context: 'Vercel – greenhub-driver',
    targetUrl: 'https://driver-preview.example.test/',
  },
];

function makeStatus(app, overrides = {}) {
  const config = APPS.find((candidate) => candidate.app === app);
  return {
    id: app.length,
    sha: SHA,
    context: config.context,
    state: 'success',
    target_url: config.targetUrl,
    created_at: '2026-09-02T00:00:00Z',
    updated_at: '2026-09-02T00:00:00Z',
    ...overrides,
  };
}

function allSuccessStatuses() {
  return APPS.map(({ app }) => makeStatus(app));
}

function collectWith(statuses, observedPaths = []) {
  return collectCommitStatusEvidence(SHA, (apiPath) => {
    observedPaths.push(apiPath);
    return statuses;
  });
}

describe('Preview commit status 증거 계약', () => {
  it('target_url은 안전한 HTTPS 주소만 trailing slash을 제거한다', () => {
    assert.equal(
      normalizeTargetUrl(' https://preview.example.test/ '),
      'https://preview.example.test',
    );
    assert.equal(normalizeTargetUrl('http://preview.example.test'), null);
    assert.equal(normalizeTargetUrl('https://preview.example.test/?x=1'), null);
    assert.equal(normalizeTargetUrl('https://user:pass@preview.example.test'), null);
    assert.equal(normalizeTargetUrl('https://preview.example.test/#fragment'), null);
  });

  it('세 exact Vercel context가 expected SHA에서 모두 success이면 통과한다', () => {
    const observedPaths = [];
    const evidence = collectWith(allSuccessStatuses(), observedPaths);

    assert.equal(evidence.ready, true);
    assert.equal(observedPaths.length, 1);
    assert.equal(
      observedPaths[0],
      'repos/' + REPO + '/commits/' + SHA + '/statuses?per_page=100',
    );
    assert.deepEqual(evidence.statusShas, {
      consumer: SHA,
      seller: SHA,
      driver: SHA,
    });
    assert.deepEqual(evidence.deploymentShas, evidence.statusShas);
    assert.equal(evidence.evidenceSource, 'github-commit-status');
  });

  it('consumer status가 없으면 불완전 상태로 fail closed한다', () => {
    const evidence = collectWith(
      allSuccessStatuses().filter((status) => status.context !== 'Vercel – greenhubconsumer'),
    );
    const consumer = evidence.apps.find(({ app }) => app === 'consumer');

    assert.equal(evidence.ready, false);
    assert.equal(consumer.state, 'missing');
    assert.equal(consumer.statusSha, null);
  });

  it('driver pending은 success로 추정하지 않는다', () => {
    const evidence = collectWith(
      allSuccessStatuses().map((status) =>
        status.context === 'Vercel – greenhub-driver'
          ? { ...status, state: 'pending' }
          : status,
      ),
    );
    const driver = evidence.apps.find(({ app }) => app === 'driver');

    assert.equal(evidence.ready, false);
    assert.equal(driver.state, 'pending');
    assert.equal(driver.statusSha, SHA);
  });

  it('seller failure와 error 상태를 모두 거부한다', () => {
    for (const state of ['failure', 'error']) {
      const evidence = collectWith(
        allSuccessStatuses().map((status) =>
          status.context === 'Vercel – greenhub-seller' ? { ...status, state } : status,
        ),
      );
      const seller = evidence.apps.find(({ app }) => app === 'seller');

      assert.equal(evidence.ready, false);
      assert.equal(seller.state, state);
      assert.equal(seller.ready, false);
    }
  });

  it('old SHA success는 현재 SHA의 성공 증거로 사용하지 않는다', () => {
    const statuses = allSuccessStatuses().map((status) =>
      status.context === 'Vercel – greenhubconsumer'
        ? { ...status, sha: OLD_SHA, updated_at: '2026-09-02T00:00:03Z' }
        : status,
    );
    const evidence = collectWith(statuses);
    const consumer = evidence.apps.find(({ app }) => app === 'consumer');

    assert.equal(evidence.ready, false);
    assert.equal(consumer.state, 'stale');
    assert.equal(consumer.statusSha, OLD_SHA);
    assert.equal(consumer.targetUrl, null);
  });

  it('unrelated context는 무시하고 exact context 세 개만 판정한다', () => {
    const evidence = collectWith([
      ...allSuccessStatuses(),
      {
        id: 999,
        sha: SHA,
        context: 'Vercel – unrelated-project',
        state: 'success',
        target_url: 'https://unrelated.example.test/',
      },
    ]);

    assert.equal(evidence.ready, true);
    assert.equal(evidence.apps.length, 3);
    assert.deepEqual(
      evidence.apps.map(({ context }) => context).sort(),
      APPS.map(({ context }) => context).sort(),
    );
  });

  it('duplicate context는 최신 updated_at 상태를 사용한다', () => {
    const statuses = [
      ...allSuccessStatuses().filter((status) => status.context !== 'Vercel – greenhubconsumer'),
      makeStatus('consumer', {
        id: 11,
        state: 'pending',
        created_at: '2026-09-02T00:00:01Z',
        updated_at: '2026-09-02T00:00:01Z',
      }),
      makeStatus('consumer', {
        id: 12,
        state: 'success',
        created_at: '2026-09-02T00:00:02Z',
        updated_at: '2026-09-02T00:00:02Z',
      }),
    ];
    const consumer = collectWith(statuses).apps.find(({ app }) => app === 'consumer');

    assert.equal(consumer.ready, true);
    assert.equal(consumer.state, 'success');
    assert.equal(consumer.statusId, 12);
  });

  it('unsafe target_url은 success status와 함께 있어도 거부한다', () => {
    const evidence = collectWith(
      allSuccessStatuses().map((status) =>
        status.context === 'Vercel – greenhub-seller'
          ? { ...status, target_url: 'https://seller-preview.example.test/?blocked=1' }
          : status,
      ),
    );
    const seller = evidence.apps.find(({ app }) => app === 'seller');

    assert.equal(evidence.ready, false);
    assert.equal(seller.state, 'success');
    assert.equal(seller.targetUrl, null);
    assert.equal(seller.ready, false);
  });

  it('historical Deployment 객체가 없어도 세 commit status success이면 통과한다', () => {
    const observedPaths = [];
    const evidence = collectWith(allSuccessStatuses(), observedPaths);

    assert.equal(evidence.ready, true);
    assert.equal(observedPaths.some((apiPath) => apiPath.includes('/deployments')), false);
    assert.equal(observedPaths[0].includes('/commits/' + SHA + '/statuses'), true);
  });

  it('commit status 응답 자체가 없으면 성공으로 추정하지 않는다', () => {
    const evidence = collectWith([]);

    assert.equal(evidence.ready, false);
    assert.deepEqual(
      evidence.apps.map(({ state, ready }) => ({ state, ready })),
      [
        { state: 'missing', ready: false },
        { state: 'missing', ready: false },
        { state: 'missing', ready: false },
      ],
    );
  });

  it('status 응답에 sha 필드가 없어도 exact SHA 요청 경로를 증거로 사용한다', () => {
    const statuses = allSuccessStatuses().map((status) =>
      Object.fromEntries(Object.entries(status).filter(([key]) => key !== 'sha')),
    );
    const evidence = collectWith(statuses);

    assert.equal(evidence.ready, true);
    assert.deepEqual(evidence.statusShas, {
      consumer: SHA,
      seller: SHA,
      driver: SHA,
    });
  });

  it('기존 collectDeploymentEvidence export도 status source를 사용한다', () => {
    const paths = [];
    const evidence = collectDeploymentEvidence(SHA, (apiPath) => {
      paths.push(apiPath);
      return allSuccessStatuses();
    });

    assert.equal(evidence.ready, true);
    assert.equal(paths.length, 1);
    assert.equal(paths[0].includes('/commits/' + SHA + '/statuses'), true);
  });

  it('직접 검사도 알 수 없는 앱을 명시적으로 거부한다', () => {
    assert.throws(
      () => inspectAppCommitStatus('unknown', SHA, []),
      /알 수 없는 Preview 앱입니다/,
    );
  });
});
