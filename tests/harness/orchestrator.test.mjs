import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { HarnessOrchestrator } from '../../harness/orchestrator.mjs';
import { HarnessStore } from '../../harness/store.mjs';

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

function runCoreSteps(orchestrator, { jobId, access, through = 'render_report' }) {
  const steps = ['ingest_source', 'normalize_job', 'evaluate_job', 'render_report'];
  const targetIndex = steps.indexOf(through);
  if (targetIndex === -1) {
    throw new Error(`Unknown core step "${through}"`);
  }

  for (const stepId of steps.slice(0, targetIndex + 1)) {
    orchestrator.startStep({ jobId, access, stepId });
    orchestrator.completeStep({
      jobId,
      access,
      stepId,
      output: { stepId },
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
    source: 'Some JD text',
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
      source: 'Some JD text',
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
      source: 'Some JD text',
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

    context.orchestrator.completeStep({
      jobId,
      access,
      stepId: 'ingest_source',
      output: { extractedText: 'normalized later' },
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
      source: 'Some JD text',
    });
    const { jobId } = created.job;

    context.orchestrator.startStep({ jobId, access, stepId: 'ingest_source' });
    context.orchestrator.completeStep({
      jobId,
      access,
      stepId: 'ingest_source',
      output: { extractedText: 'Role details' },
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
      source: 'Some JD text',
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
      source: 'Some JD text',
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

test('render_report cannot cross into report_ready without committed report artifacts', () => {
  const context = createHarnessTestContext();
  const access = accessFor('report');

  try {
    const created = context.orchestrator.startEvaluationJob({
      ...access,
      sourceKind: 'pasted_text',
      source: 'Some JD text',
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
      source: 'Some JD text',
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
    context.orchestrator.completeStep({
      jobId,
      access,
      stepId: 'ingest_source',
      output: { extractedText: 'retry worked' },
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
