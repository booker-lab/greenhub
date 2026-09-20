// Proof for GREENHUB-COORDINATION-WINDOWS-ATOMIC-WRITE-CONTENTION-37.
// Bounded Windows/NTFS rename-contention absorption for durable atomic writes:
// EPERM/EBUSY only, bounded attempts, canonical exhaustion error, temp cleanup,
// no delete-then-write, no partial JSON, and no scan failure on a concurrent
// writer's in-flight temp artifact.
// No scheduler, polling, daemon, unbounded retry, new durable namespace, task
// schema, claim authority, or sequence/cursor semantics change.
// All runtime state lives in isolated temp directories. No network required.

import assert from 'node:assert/strict';
import nodeFs, { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';

import { ATOMIC_WRITE_CONTENTION_EXHAUSTED, CoordinationStore, writeJsonAtomic } from './store.mjs';

// Bounded retry policy contract of writeJsonAtomic (attempts per replacement).
const ATOMIC_WRITE_MAX_ATTEMPTS = 8;

function makeHome(prefix = 'greenhub-atomic37-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'WINDOWS_ATOMIC_WRITE_CONTENTION_CLOSED',
    policyRefs: [
      'docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md',
    ],
    evidenceRefs: ['git:live-main-read'],
    contextRefs: ['docs/PROJECT_MAP.md#scripts'],
    authorityRequirement: { liveMainHint: null, requiredPolicies: ['AGENTS.md'] },
    ownedSurface: ['scripts/coordination/'],
    mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['atomic-write-contention-proof'],
  };
}

function tempArtifactNames(directory) {
  return readdirSync(directory).filter((name) => name.endsWith('.tmp'));
}

/** Real filesystem with an injected rename-failure queue (deterministic). */
function fileSystemWithRenameFailures(renameErrorCodes) {
  const calls = { rename: 0, unlink: 0, write: 0 };
  const queue = [...renameErrorCodes];
  return {
    calls,
    mkdirSync: (...args) => nodeFs.mkdirSync(...args),
    writeFileSync: (...args) => {
      calls.write += 1;
      return nodeFs.writeFileSync(...args);
    },
    unlinkSync: (...args) => {
      calls.unlink += 1;
      return nodeFs.unlinkSync(...args);
    },
    renameSync: (from, to) => {
      calls.rename += 1;
      const code = queue.shift();
      if (code) {
        const error = new Error(`${code}: injected rename contention`);
        error.code = code;
        throw error;
      }
      return nodeFs.renameSync(from, to);
    },
  };
}

// A. RETRYABLE CONTENTION IS ABSORBED WITHIN THE BOUND.
test('A. transient EPERM/EBUSY rename contention is absorbed and publishes the complete document', () => {
  for (const code of ['EPERM', 'EBUSY']) {
    const directory = makeHome();
    try {
      const target = join(directory, 'task.json');
      writeFileSync(target, JSON.stringify({ status: 'READY' }, null, 2), 'utf8');
      const fileSystem = fileSystemWithRenameFailures([code, code]);

      const outcome = writeJsonAtomic(target, { status: 'CLAIMED' }, { fileSystem });

      assert.equal(outcome.written, true);
      assert.equal(fileSystem.calls.rename, 3);
      assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { status: 'CLAIMED' });
      assert.deepEqual(tempArtifactNames(directory), []);
    } finally {
      removeHome(directory);
    }
  }
});

// B. NON-RETRYABLE FAILURE KEEPS IMMEDIATE FAIL-CLOSED SEMANTICS.
test('B. non-retryable filesystem errors fail closed immediately without retry, rewrite, or residue', () => {
  for (const code of ['EACCES', 'EXDEV', 'EISDIR']) {
    const directory = makeHome();
    try {
      const target = join(directory, 'task.json');
      const before = JSON.stringify({ status: 'READY', revision: 1 }, null, 2);
      writeFileSync(target, before, 'utf8');
      const fileSystem = fileSystemWithRenameFailures([code, 'EPERM', 'EPERM']);

      assert.throws(
        () => writeJsonAtomic(target, { status: 'CLAIMED', revision: 2 }, { fileSystem }),
        (error) => error?.code === code,
      );
      assert.equal(
        fileSystem.calls.rename,
        1,
        'a non-retryable error must not be absorbed by the retry loop',
      );
      assert.equal(
        readFileSync(target, 'utf8'),
        before,
        'the previous complete document stays in place',
      );
      assert.deepEqual(tempArtifactNames(directory), []);
    } finally {
      removeHome(directory);
    }
  }
});

// C. EXHAUSTION: CANONICAL ERROR, PREVIOUS DOCUMENT PRESERVED, NO RESIDUE.
test('C. retry exhaustion throws the canonical error with cleanup and never touches foreign temp files', () => {
  const directory = makeHome();
  try {
    const target = join(directory, 'task.json');
    const before = JSON.stringify({ status: 'READY', revision: 1 }, null, 2);
    writeFileSync(target, before, 'utf8');
    const foreignTemp = `${target}.99999.0123456789abcdef0123456789abcdef.tmp`;
    writeFileSync(foreignTemp, 'foreign in-flight writer', 'utf8');
    const fileSystem = fileSystemWithRenameFailures(Array.from({ length: 64 }, () => 'EPERM'));

    assert.throws(
      () => writeJsonAtomic(target, { status: 'CLAIMED', revision: 2 }, { fileSystem }),
      (error) =>
        error?.name === 'CoordinationStoreError' &&
        error?.code === ATOMIC_WRITE_CONTENTION_EXHAUSTED &&
        /no partial target was published/.test(String(error?.message)),
    );
    assert.equal(
      fileSystem.calls.rename,
      ATOMIC_WRITE_MAX_ATTEMPTS,
      'retry count is bounded and exact',
    );
    assert.equal(
      readFileSync(target, 'utf8'),
      before,
      'exhaustion never deletes or partially rewrites the target',
    );
    assert.deepEqual(
      tempArtifactNames(directory),
      [basename(foreignTemp)],
      "only this writer's own temp is removed",
    );
    assert.equal(readFileSync(foreignTemp, 'utf8'), 'foreign in-flight writer');
  } finally {
    removeHome(directory);
  }
});

// D. THE BUILDER IS RE-EVALUATED PER ATTEMPT; null PUBLISHES NOTHING.
test('D. a builder document is rebuilt before every attempt and null publishes nothing', () => {
  const directory = makeHome();
  try {
    const target = join(directory, 'task.json');
    let built = 0;
    const fileSystem = fileSystemWithRenameFailures(['EPERM', 'EBUSY']);

    const outcome = writeJsonAtomic(
      target,
      () => {
        built += 1;
        return { status: 'CLAIMED', revision: built };
      },
      { fileSystem },
    );

    assert.equal(outcome.written, true);
    assert.equal(built, 3, 'the builder runs once per attempt');
    assert.equal(fileSystem.calls.rename, 3);
    assert.deepEqual(
      JSON.parse(readFileSync(target, 'utf8')),
      { status: 'CLAIMED', revision: 3 },
      'the published document is the last re-evaluation, never a stale one',
    );

    const before = readFileSync(target, 'utf8');
    const obsolete = writeJsonAtomic(target, () => null, {
      fileSystem: fileSystemWithRenameFailures([]),
    });
    assert.equal(obsolete.written, false);
    assert.equal(obsolete.document, null);
    assert.equal(readFileSync(target, 'utf8'), before);
    assert.deepEqual(tempArtifactNames(directory), []);
  } finally {
    removeHome(directory);
  }
});

// E. SEQUENCE SCAN: IN-FLIGHT TEMP ARTIFACTS ARE NOT CORRUPTION.
test('E. sequence scan ignores in-flight temp artifacts but still fails closed on any other stray file', () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    store.createTask(sampleTaskInput('ATOM37-E001'));
    const entriesDirectory = join(home, 'consumption', 'sequence', 'entries');
    const inFlightTemp = join(
      entriesDirectory,
      '0000000001.json.4242.0123456789abcdef0123456789abcdef.tmp',
    );
    writeFileSync(inFlightTemp, '{"sequenceNumber":1', 'utf8');

    assert.deepEqual(store.readTaskSequence(), ['ATOM37-E001']);
    assert.deepEqual(
      store.readSequenceEntries().map((entry) => entry.sequenceNumber),
      [1],
    );

    rmSync(inFlightTemp, { force: true });
    writeFileSync(join(entriesDirectory, 'stray-notes.txt'), 'not a durable entry', 'utf8');
    assert.throws(
      () => store.readTaskSequence(),
      (error) => error?.code === 'CORRUPT_SEQUENCE',
    );
  } finally {
    removeHome(home);
  }
});
