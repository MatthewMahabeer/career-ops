import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  EXTRACTED_SNAPSHOT_CONTRACT_VERSION,
  NORMALIZED_JOB_CONTRACT_VERSION,
  makeUnknown,
} from '../../harness/contracts.mjs';
import { HarnessOrchestrator } from '../../harness/orchestrator.mjs';
import { HarnessStore } from '../../harness/store.mjs';

const DEFAULT_PASTED_SOURCE_TEXT = [
  'ExampleCo is hiring a Senior AI Engineer.',
  'Responsibilities include running browser-first job extraction and deterministic normalization.',
  'Requirements include Node.js, Playwright, and workflow orchestration experience.',
].join(' ');

function createHarnessTestContext() {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-harness-'));
  const dbPath = join(dir, 'browser-harness.sqlite');
  const store = new HarnessStore({ dbPath });
  const orchestrator = new HarnessOrchestrator({ store });

  return {
    dbPath,
    store,
    orchestrator,
    cleanup() {
      orchestrator.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function accessFor(label) {
  return {
    ownerId: `owner-${label}`,
    workspaceId: `workspace-${label}`,
  };
}

function buildExtractedSnapshot({
  sourceKind = 'pasted_text',
  sourceValue = sourceKind === 'pasted_text' ? DEFAULT_PASTED_SOURCE_TEXT : 'https://example.com/jobs/123',
  snapshotId = 'snapshot-example',
  rawText = null,
} = {}) {
  return {
    contractType: 'ExtractedSnapshot',
    contractVersion: EXTRACTED_SNAPSHOT_CONTRACT_VERSION,
    snapshotId,
    source: {
      kind: sourceKind,
      url: sourceKind === 'url' ? sourceValue : null,
    },
    extraction: {
      method: sourceKind === 'url' ? 'browser_dom' : 'pasted_text',
      extractedAt: '2026-04-09T12:00:00.000Z',
    },
    content: {
      rawText: rawText ?? (sourceKind === 'pasted_text' ? sourceValue : DEFAULT_PASTED_SOURCE_TEXT),
      title: 'Senior AI Engineer',
      language: 'en',
    },
  };
}

function buildNormalizedJob(extractedSnapshot, overrides = {}) {
  const fallbackUsed = overrides.normalization?.strategy === 'fallback_model';
  const base = {
    contractType: 'NormalizedJob',
    contractVersion: NORMALIZED_JOB_CONTRACT_VERSION,
    extractedSnapshotId: extractedSnapshot.snapshotId,
    source: {
      kind: extractedSnapshot.source.kind,
      url: extractedSnapshot.source.url,
    },
    normalization: {
      strategy: fallbackUsed ? 'fallback_model' : 'deterministic',
      normalizedAt: '2026-04-09T12:05:00.000Z',
      confidence: {
        overall: 0.88,
        fields: {
          'identity.companyName': 0.96,
          'identity.roleTitle': 0.97,
          'content.summary': 0.83,
        },
      },
      fallback: {
        eligible: fallbackUsed,
        used: fallbackUsed,
        reasons: fallbackUsed ? ['insufficient_confidence'] : [],
      },
    },
    identity: {
      companyName: 'ExampleCo',
      roleTitle: 'Senior AI Engineer',
    },
    classification: {
      archetype: 'AI Platform / LLMOps Engineer',
      domain: 'Workflow software',
      function: 'Build',
      seniority: 'Senior',
      remote: 'Remote-first',
      location: makeUnknown('not_found'),
      employmentType: 'Full-time',
      teamSize: makeUnknown('not_found'),
      compensation: makeUnknown('not_found'),
    },
    content: {
      summary: 'Build and operate a browser-first evaluation harness for AI-assisted job search.',
      responsibilities: [
        'Own extraction, normalization, and evaluation workflow reliability.',
      ],
      requirementsMust: [
        'Experience with Node.js and Playwright.',
      ],
      requirementsNice: makeUnknown('not_found'),
      technologies: ['Node.js', 'Playwright', 'SQLite'],
    },
    evidence: [
      {
        evidenceId: 'ev-company',
        fieldPath: 'identity.companyName',
        quote: 'ExampleCo is hiring a Senior AI Engineer.',
        sourceSnapshotId: extractedSnapshot.snapshotId,
        sourceKind: extractedSnapshot.source.kind,
        locator: {
          strategy: 'section_hint',
          section: 'Header',
        },
      },
      {
        evidenceId: 'ev-summary',
        fieldPath: 'content.summary',
        quote: 'Responsibilities include running browser-first job extraction and deterministic normalization.',
        sourceSnapshotId: extractedSnapshot.snapshotId,
        sourceKind: extractedSnapshot.source.kind,
        locator: {
          strategy: 'section_hint',
          section: 'Responsibilities',
        },
      },
      {
        evidenceId: 'ev-requirement',
        fieldPath: 'content.requirementsMust',
        quote: 'Requirements include Node.js, Playwright, and workflow orchestration experience.',
        sourceSnapshotId: extractedSnapshot.snapshotId,
        sourceKind: extractedSnapshot.source.kind,
        locator: {
          strategy: 'section_hint',
          section: 'Requirements',
        },
      },
    ],
  };

  return {
    ...base,
    ...overrides,
    source: {
      ...base.source,
      ...overrides.source,
    },
    normalization: {
      ...base.normalization,
      ...overrides.normalization,
      confidence: {
        ...base.normalization.confidence,
        ...overrides.normalization?.confidence,
        fields: {
          ...base.normalization.confidence.fields,
          ...overrides.normalization?.confidence?.fields,
        },
      },
      fallback: {
        ...base.normalization.fallback,
        ...overrides.normalization?.fallback,
      },
    },
    identity: {
      ...base.identity,
      ...overrides.identity,
    },
    classification: {
      ...base.classification,
      ...overrides.classification,
    },
    content: {
      ...base.content,
      ...overrides.content,
    },
    evidence: overrides.evidence ?? base.evidence,
  };
}

function runCoreSteps(orchestrator, { jobId, access, through = 'render_report' }) {
  const steps = ['ingest_source', 'normalize_job', 'evaluate_job', 'render_report'];
  const targetIndex = steps.indexOf(through);
  if (targetIndex === -1) {
    throw new Error(`Unknown core step "${through}"`);
  }

  const {
    job,
  } = orchestrator.getJobGraph({ jobId, access });
  const extractedSnapshot = buildExtractedSnapshot({
    sourceKind: job.sourceKind,
    sourceValue: job.sourceValue,
  });
  const normalizedJob = buildNormalizedJob(extractedSnapshot);

  for (const stepId of steps.slice(0, targetIndex + 1)) {
    orchestrator.startStep({ jobId, access, stepId });
    orchestrator.completeStep({
      jobId,
      access,
      stepId,
      output: stepId === 'ingest_source'
        ? extractedSnapshot
        : stepId === 'normalize_job'
          ? normalizedJob
          : { stepId },
      artifactRefs: stepId === 'render_report'
        ? { reportNumber: 42, reportPath: 'reports/042-example-2026-04-09.md' }
        : null,
    });
  }
}

function createReportReadyJob(orchestrator, access) {
  const created = orchestrator.startEvaluationJob({
    ...access,
    sourceKind: 'pasted_text',
    source: DEFAULT_PASTED_SOURCE_TEXT,
  });
  const { jobId } = created.job;
  runCoreSteps(orchestrator, { jobId, access });
  return jobId;
}

test('startEvaluationJob uses the same orchestration surface for URL and pasted text', () => {
  const context = createHarnessTestContext();
  const urlAccess = accessFor('url');
  const pastedAccess = accessFor('pasted');

  try {
    const urlJob = context.orchestrator.startEvaluationJob({
      ...urlAccess,
      sourceKind: 'url',
      source: 'https://example.com/jobs/123',
      requestedBy: 'test-user',
    });
    const pastedJob = context.orchestrator.startEvaluationJob({
      ...pastedAccess,
      sourceKind: 'pasted_text',
      source: 'Senior engineer role with Python and Playwright',
      requestedBy: 'test-user',
    });

    assert.equal(urlJob.job.sourceKind, 'url');
    assert.equal(pastedJob.job.sourceKind, 'pasted_text');
    assert.equal(urlJob.job.ownerId, urlAccess.ownerId);
    assert.equal(urlJob.job.workspaceId, urlAccess.workspaceId);
    assert.equal(pastedJob.job.ownerId, pastedAccess.ownerId);
    assert.equal(urlJob.job.jobState, 'queued');
    assert.equal(pastedJob.job.jobState, 'queued');
    assert.equal(urlJob.job.currentStep, 'ingest_source');
    assert.equal(pastedJob.job.currentStep, 'ingest_source');
    assert.equal(urlJob.job.trackerState, 'blocked');
    assert.equal(pastedJob.job.pdfState, 'not_requested');
    assert.deepEqual(
      urlJob.checkpoints.map((checkpoint) => [checkpoint.stepId, checkpoint.status]),
      [
        ['ingest_source', 'ready'],
        ['normalize_job', 'pending'],
        ['evaluate_job', 'pending'],
        ['render_report', 'pending'],
        ['update_tracker', 'blocked'],
        ['generate_pdf', 'blocked'],
      ]
    );
    assert.equal(urlJob.events[0].eventType, 'job.created');
    assert.equal(pastedJob.events[0].payload.action, 'start_evaluation_job');
  } finally {
    context.cleanup();
  }
});

test('owner/workspace scope prevents cross-job reads and mutations', () => {
  const context = createHarnessTestContext();
  const accessA = accessFor('a');
  const accessB = accessFor('b');

  try {
    const created = context.orchestrator.startEvaluationJob({
      ...accessA,
      sourceKind: 'pasted_text',
      source: DEFAULT_PASTED_SOURCE_TEXT,
    });
    const { jobId } = created.job;

    assert.throws(
      () => context.store.getJobGraphForAccess({ jobId, ...accessB }),
      /owner\/workspace scope/
    );
    assert.throws(
      () => context.orchestrator.getJobGraph({ jobId, access: accessB }),
      /owner\/workspace scope/
    );
    assert.throws(
      () => context.orchestrator.requestCancellation({
        jobId,
        access: accessB,
        requestedBy: 'other-user',
      }),
      /owner\/workspace scope/
    );

    const ownedGraph = context.orchestrator.getJobGraph({ jobId, access: accessA });
    assert.equal(ownedGraph.job.ownerId, accessA.ownerId);
    assert.equal(ownedGraph.job.workspaceId, accessA.workspaceId);
  } finally {
    context.cleanup();
  }
});

test('soft cancellation is explicit and only honored between steps', () => {
  const context = createHarnessTestContext();
  const access = accessFor('cancel');

  try {
    const created = context.orchestrator.startEvaluationJob({
      ...access,
      sourceKind: 'pasted_text',
      source: DEFAULT_PASTED_SOURCE_TEXT,
    });
    const { jobId } = created.job;

    const cancelRequested = context.orchestrator.requestCancellation({
      jobId,
      access,
      requestedBy: 'test-user',
    });
    assert.equal(cancelRequested.job.cancelRequested, true);
    assert.equal(cancelRequested.job.jobState, 'queued');

    context.orchestrator.startStep({ jobId, access, stepId: 'ingest_source' });
    assert.throws(
      () => context.orchestrator.honorSoftCancellation({ jobId, access }),
      /between steps/
    );

    const extractedSnapshot = buildExtractedSnapshot();
    context.orchestrator.completeStep({
      jobId,
      access,
      stepId: 'ingest_source',
      output: extractedSnapshot,
    });
    const cancelled = context.orchestrator.honorSoftCancellation({ jobId, access });

    assert.equal(cancelled.job.jobState, 'cancelled');
    assert.equal(cancelled.job.cancelRequested, true);
    assert.equal(cancelled.job.currentStep, null);
    assert.equal(cancelled.checkpoints.find((checkpoint) => checkpoint.stepId === 'normalize_job').status, 'skipped');
    assert.equal(cancelled.events.at(-1).eventType, 'job.cancelled');
  } finally {
    context.cleanup();
  }
});

test('retryJobFromCheckpoint resets downstream core checkpoints and persists retry metadata', () => {
  const context = createHarnessTestContext();
  const access = accessFor('retry');

  try {
    const created = context.orchestrator.startEvaluationJob({
      ...access,
      sourceKind: 'pasted_text',
      source: DEFAULT_PASTED_SOURCE_TEXT,
    });
    const { jobId } = created.job;

    const extractedSnapshot = buildExtractedSnapshot();
    context.orchestrator.startStep({ jobId, access, stepId: 'ingest_source' });
    context.orchestrator.completeStep({
      jobId,
      access,
      stepId: 'ingest_source',
      output: extractedSnapshot,
    });
    context.orchestrator.startStep({ jobId, access, stepId: 'normalize_job' });
    context.orchestrator.failStep({
      jobId,
      access,
      stepId: 'normalize_job',
      code: 'NORMALIZE_SCHEMA_GAP',
      message: 'Missing required fields',
    });

    const retried = context.orchestrator.retryJobFromCheckpoint({
      jobId,
      access,
      stepId: 'normalize_job',
      requestedBy: 'test-user',
    });

    assert.equal(retried.job.jobState, 'queued');
    assert.equal(retried.job.currentStep, 'normalize_job');
    assert.equal(retried.job.retryCountTotal, 1);
    assert.equal(retried.job.lastRetryStep, 'normalize_job');
    assert.equal(retried.job.failureStep, null);
    assert.equal(retried.checkpoints.find((checkpoint) => checkpoint.stepId === 'normalize_job').status, 'ready');
    assert.equal(retried.checkpoints.find((checkpoint) => checkpoint.stepId === 'evaluate_job').status, 'pending');
    assert.equal(retried.checkpoints.find((checkpoint) => checkpoint.stepId === 'update_tracker').status, 'blocked');
    assert.equal(retried.events.at(-1).eventType, 'job.retry_requested');
  } finally {
    context.cleanup();
  }
});

test('startStep requires a matching live lease owner/token when a lease exists', () => {
  const context = createHarnessTestContext();
  const access = accessFor('lease');

  try {
    const created = context.orchestrator.startEvaluationJob({
      ...access,
      sourceKind: 'pasted_text',
      source: DEFAULT_PASTED_SOURCE_TEXT,
    });
    const { jobId } = created.job;

    const leased = context.orchestrator.claimLease({
      jobId,
      access,
      owner: 'worker-a',
      ttlMs: 60_000,
    });
    const liveLeaseToken = leased.lease.token;

    assert.throws(
      () => context.orchestrator.startStep({ jobId, access, stepId: 'ingest_source' }),
      /matching owner\/token/
    );
    assert.throws(
      () => context.orchestrator.startStep({
        jobId,
        access,
        stepId: 'ingest_source',
        leaseOwner: 'worker-b',
        leaseToken: liveLeaseToken,
      }),
      /matching owner\/token/
    );
    assert.throws(
      () => context.orchestrator.startStep({
        jobId,
        access,
        stepId: 'ingest_source',
        leaseOwner: 'worker-a',
        leaseToken: 'lease_wrong',
      }),
      /matching owner\/token/
    );

    const started = context.orchestrator.startStep({
      jobId,
      access,
      stepId: 'ingest_source',
      leaseOwner: 'worker-a',
      leaseToken: liveLeaseToken,
    });

    assert.equal(started.job.jobState, 'running');
    assert.equal(started.checkpoints.find((checkpoint) => checkpoint.stepId === 'ingest_source').status, 'running');
  } finally {
    context.cleanup();
  }
});

test('scoped readable job graphs and events redact live lease tokens', () => {
  const context = createHarnessTestContext();
  const access = accessFor('redact');

  try {
    const created = context.orchestrator.startEvaluationJob({
      ...access,
      sourceKind: 'pasted_text',
      source: DEFAULT_PASTED_SOURCE_TEXT,
    });
    const { jobId } = created.job;

    const leased = context.orchestrator.claimLease({
      jobId,
      access,
      owner: 'worker-a',
      ttlMs: 60_000,
    });

    assert.ok(leased.lease.token);
    assert.equal(leased.job.leaseToken, null);
    assert.equal(leased.events.at(-1).eventType, 'lease.claimed');
    assert.equal(Object.hasOwn(leased.events.at(-1).payload, 'leaseToken'), false);

    const scopedGraph = context.orchestrator.getJobGraph({ jobId, access });
    assert.equal(scopedGraph.job.leaseToken, null);
    assert.equal(scopedGraph.events.at(-1).eventType, 'lease.claimed');
    assert.equal(Object.hasOwn(scopedGraph.events.at(-1).payload, 'leaseToken'), false);
  } finally {
    context.cleanup();
  }
});

test('ingest_source only accepts an ExtractedSnapshot that matches the job source', () => {
  const context = createHarnessTestContext();
  const access = accessFor('ingest-contract');

  try {
    const created = context.orchestrator.startEvaluationJob({
      ...access,
      sourceKind: 'url',
      source: 'https://example.com/jobs/123',
    });
    const { jobId } = created.job;

    context.orchestrator.startStep({ jobId, access, stepId: 'ingest_source' });

    assert.throws(
      () => context.orchestrator.completeStep({
        jobId,
        access,
        stepId: 'ingest_source',
        output: buildExtractedSnapshot({
          sourceKind: 'url',
          sourceValue: 'https://example.com/jobs/999',
        }),
      }),
      /source\.url must match the job source value/
    );

    const stillRunning = context.orchestrator.getJobGraph({ jobId, access });
    assert.equal(stillRunning.job.jobState, 'running');
    assert.equal(
      stillRunning.checkpoints.find((checkpoint) => checkpoint.stepId === 'ingest_source').status,
      'running'
    );
  } finally {
    context.cleanup();
  }
});

test('ingest_source rejects pasted_text snapshots that do not match the queued source body', () => {
  const context = createHarnessTestContext();
  const access = accessFor('ingest-pasted-contract');

  try {
    const created = context.orchestrator.startEvaluationJob({
      ...access,
      sourceKind: 'pasted_text',
      source: DEFAULT_PASTED_SOURCE_TEXT,
    });
    const { jobId } = created.job;

    context.orchestrator.startStep({ jobId, access, stepId: 'ingest_source' });

    assert.throws(
      () => context.orchestrator.completeStep({
        jobId,
        access,
        stepId: 'ingest_source',
        output: buildExtractedSnapshot({
          sourceKind: 'pasted_text',
          rawText: 'Different JD text that was never queued for this job.',
        }),
      }),
      /must match the queued pasted_text source/
    );
  } finally {
    context.cleanup();
  }
});

test('normalize_job only completes when the normalized contract is ready for evaluation', () => {
  const context = createHarnessTestContext();
  const access = accessFor('normalize-contract');

  try {
    const created = context.orchestrator.startEvaluationJob({
      ...access,
      sourceKind: 'pasted_text',
      source: DEFAULT_PASTED_SOURCE_TEXT,
    });
    const { jobId } = created.job;
    const extractedSnapshot = buildExtractedSnapshot();

    context.orchestrator.startStep({ jobId, access, stepId: 'ingest_source' });
    context.orchestrator.completeStep({
      jobId,
      access,
      stepId: 'ingest_source',
      output: extractedSnapshot,
    });
    context.orchestrator.startStep({ jobId, access, stepId: 'normalize_job' });

    const unreadyNormalizedJob = buildNormalizedJob(extractedSnapshot, {
      identity: {
        companyName: makeUnknown('not_found'),
      },
      normalization: {
        confidence: {
          overall: 0.42,
          fields: {
            'identity.companyName': 0.1,
            'identity.roleTitle': 0.95,
          },
        },
        fallback: {
          eligible: true,
          used: false,
          reasons: ['missing_core_identity', 'insufficient_confidence'],
        },
      },
      content: {
        summary: makeUnknown('not_found'),
        responsibilities: makeUnknown('not_found'),
        requirementsMust: makeUnknown('not_found'),
      },
    });

    assert.throws(
      () => context.orchestrator.completeStep({
        jobId,
        access,
        stepId: 'normalize_job',
        output: unreadyNormalizedJob,
      }),
      /not ready for evaluation/
    );

    const stillRunning = context.orchestrator.getJobGraph({ jobId, access });
    assert.equal(stillRunning.job.jobState, 'running');
    assert.equal(
      stillRunning.checkpoints.find((checkpoint) => checkpoint.stepId === 'normalize_job').status,
      'running'
    );
  } finally {
    context.cleanup();
  }
});

test('normalize_job rejects evidence that does not resolve back to the extracted snapshot text', () => {
  const context = createHarnessTestContext();
  const access = accessFor('normalize-evidence');

  try {
    const created = context.orchestrator.startEvaluationJob({
      ...access,
      sourceKind: 'pasted_text',
      source: DEFAULT_PASTED_SOURCE_TEXT,
    });
    const { jobId } = created.job;
    const extractedSnapshot = buildExtractedSnapshot();

    context.orchestrator.startStep({ jobId, access, stepId: 'ingest_source' });
    context.orchestrator.completeStep({
      jobId,
      access,
      stepId: 'ingest_source',
      output: extractedSnapshot,
    });
    context.orchestrator.startStep({ jobId, access, stepId: 'normalize_job' });

    assert.throws(
      () => context.orchestrator.completeStep({
        jobId,
        access,
        stepId: 'normalize_job',
        output: buildNormalizedJob(extractedSnapshot, {
          evidence: [
            {
              evidenceId: 'ev-fabricated',
              fieldPath: 'content.summary',
              quote: 'Completely fabricated evidence.',
              sourceSnapshotId: extractedSnapshot.snapshotId,
              sourceKind: extractedSnapshot.source.kind,
              locator: {
                strategy: 'excerpt',
              },
            },
          ],
        }),
      }),
      /must be present in ExtractedSnapshot\.content\.rawText/
    );
  } finally {
    context.cleanup();
  }
});

test('render_report cannot cross into report_ready without committed report artifacts', () => {
  const context = createHarnessTestContext();
  const access = accessFor('report');

  try {
    const created = context.orchestrator.startEvaluationJob({
      ...access,
      sourceKind: 'pasted_text',
      source: DEFAULT_PASTED_SOURCE_TEXT,
    });
    const { jobId } = created.job;

    runCoreSteps(context.orchestrator, { jobId, access, through: 'evaluate_job' });
    context.orchestrator.startStep({ jobId, access, stepId: 'render_report' });

    assert.throws(
      () => context.orchestrator.completeStep({
        jobId,
        access,
        stepId: 'render_report',
        output: { stepId: 'render_report' },
      }),
      /committed report artifact refs/
    );

    const stillRendering = context.orchestrator.getJobGraph({ jobId, access });
    assert.equal(stillRendering.job.jobState, 'running');
    assert.equal(stillRendering.job.reportNumber, null);
    assert.equal(stillRendering.job.reportPath, null);
    assert.equal(
      stillRendering.checkpoints.find((checkpoint) => checkpoint.stepId === 'render_report').status,
      'running'
    );
  } finally {
    context.cleanup();
  }
});

test('retry clears stale cancellation flags after cancel-requested step failure', () => {
  const context = createHarnessTestContext();
  const access = accessFor('cancel-retry');

  try {
    const created = context.orchestrator.startEvaluationJob({
      ...access,
      sourceKind: 'pasted_text',
      source: DEFAULT_PASTED_SOURCE_TEXT,
    });
    const { jobId } = created.job;

    context.orchestrator.startStep({ jobId, access, stepId: 'ingest_source' });
    context.orchestrator.requestCancellation({
      jobId,
      access,
      requestedBy: 'test-user',
      reason: 'stop after this attempt',
    });
    context.orchestrator.failStep({
      jobId,
      access,
      stepId: 'ingest_source',
      code: 'INGEST_TIMEOUT',
      message: 'ingest failed',
    });

    const retried = context.orchestrator.retryJobFromCheckpoint({
      jobId,
      access,
      stepId: 'ingest_source',
      requestedBy: 'test-user',
    });

    assert.equal(retried.job.cancelRequested, false);
    assert.equal(retried.job.cancelRequestedAt, null);
    assert.equal(retried.job.currentStep, 'ingest_source');

    context.orchestrator.startStep({ jobId, access, stepId: 'ingest_source' });
    const extractedSnapshot = buildExtractedSnapshot({
      snapshotId: 'snapshot-retry',
    });
    context.orchestrator.completeStep({
      jobId,
      access,
      stepId: 'ingest_source',
      output: extractedSnapshot,
    });

    const postRetry = context.orchestrator.honorSoftCancellation({ jobId, access });
    assert.equal(postRetry.job.jobState, 'queued');
    assert.equal(postRetry.job.cancelRequested, false);
    assert.equal(postRetry.job.currentStep, 'normalize_job');
  } finally {
    context.cleanup();
  }
});

test('projection state stays independent from core report_ready success', () => {
  const context = createHarnessTestContext();
  const access = accessFor('projection');

  try {
    const jobId = createReportReadyJob(context.orchestrator, access);

    const reportReady = context.orchestrator.getJobGraph({ jobId, access });
    assert.equal(reportReady.job.jobState, 'report_ready');
    assert.equal(reportReady.job.trackerState, 'queued');
    assert.equal(reportReady.job.pdfState, 'not_requested');
    assert.equal(reportReady.checkpoints.find((checkpoint) => checkpoint.stepId === 'update_tracker').status, 'ready');
    assert.equal(reportReady.checkpoints.find((checkpoint) => checkpoint.stepId === 'generate_pdf').status, 'blocked');

    context.orchestrator.startStep({ jobId, access, stepId: 'update_tracker' });
    const trackerFailed = context.orchestrator.failStep({
      jobId,
      access,
      stepId: 'update_tracker',
      code: 'TRACKER_MERGE_FAILED',
      message: 'merge-tracker failed',
    });

    assert.equal(trackerFailed.job.jobState, 'report_ready');
    assert.equal(trackerFailed.job.trackerState, 'failed');
    assert.equal(trackerFailed.job.pdfState, 'not_requested');

    const pdfQueued = context.orchestrator.requestPdfGeneration({
      jobId,
      access,
      requestedBy: 'test-user',
    });

    assert.equal(pdfQueued.job.jobState, 'report_ready');
    assert.equal(pdfQueued.job.trackerState, 'failed');
    assert.equal(pdfQueued.job.pdfState, 'queued');
    assert.equal(pdfQueued.checkpoints.find((checkpoint) => checkpoint.stepId === 'generate_pdf').status, 'ready');
  } finally {
    context.cleanup();
  }
});

test('pdf failure metadata is cleared on requeue and eventual success', () => {
  const context = createHarnessTestContext();
  const access = accessFor('pdf');

  try {
    const jobId = createReportReadyJob(context.orchestrator, access);

    context.orchestrator.requestPdfGeneration({
      jobId,
      access,
      requestedBy: 'test-user',
    });
    context.orchestrator.startStep({ jobId, access, stepId: 'generate_pdf' });
    const failed = context.orchestrator.failStep({
      jobId,
      access,
      stepId: 'generate_pdf',
      code: 'PDF_RENDER_FAILED',
      message: 'Playwright crashed',
    });

    assert.equal(failed.job.pdfState, 'failed');
    assert.equal(failed.job.failureStep, 'generate_pdf');
    assert.equal(failed.job.failureCode, 'PDF_RENDER_FAILED');

    const requeued = context.orchestrator.requestPdfGeneration({
      jobId,
      access,
      requestedBy: 'test-user',
    });
    assert.equal(requeued.job.pdfState, 'queued');
    assert.equal(requeued.job.failureStep, null);
    assert.equal(requeued.job.failureCode, null);
    assert.equal(requeued.job.failureMessage, null);
    assert.equal(requeued.checkpoints.find((checkpoint) => checkpoint.stepId === 'generate_pdf').error, null);

    context.orchestrator.startStep({ jobId, access, stepId: 'generate_pdf' });
    const succeeded = context.orchestrator.completeStep({
      jobId,
      access,
      stepId: 'generate_pdf',
      artifactRefs: { pdfPath: 'output/cv-candidate-example-2026-04-09.pdf' },
    });

    assert.equal(succeeded.job.jobState, 'report_ready');
    assert.equal(succeeded.job.pdfState, 'succeeded');
    assert.equal(succeeded.job.failureStep, null);
    assert.equal(succeeded.job.failureCode, null);
    assert.equal(succeeded.job.failureMessage, null);
    assert.equal(succeeded.job.pdfPath, 'output/cv-candidate-example-2026-04-09.pdf');
  } finally {
    context.cleanup();
  }
});

test('generate_pdf cannot succeed without a committed pdfPath artifact', () => {
  const context = createHarnessTestContext();
  const access = accessFor('pdf-artifact');

  try {
    const jobId = createReportReadyJob(context.orchestrator, access);

    context.orchestrator.requestPdfGeneration({
      jobId,
      access,
      requestedBy: 'test-user',
    });
    context.orchestrator.startStep({ jobId, access, stepId: 'generate_pdf' });

    assert.throws(
      () => context.orchestrator.completeStep({
        jobId,
        access,
        stepId: 'generate_pdf',
      }),
      /committed PDF artifact refs/
    );

    const stillRunning = context.orchestrator.getJobGraph({ jobId, access });
    assert.equal(stillRunning.job.pdfState, 'running');
    assert.equal(stillRunning.job.pdfPath, null);
    assert.equal(
      stillRunning.checkpoints.find((checkpoint) => checkpoint.stepId === 'generate_pdf').status,
      'running'
    );
  } finally {
    context.cleanup();
  }
});
