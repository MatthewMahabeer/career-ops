import { randomUUID } from 'crypto';

export const HARNESS_SCHEMA_VERSION = 1;

export const SOURCE_KINDS = ['url', 'pasted_text'];

export const CORE_STEPS = [
  'ingest_source',
  'normalize_job',
  'evaluate_job',
  'render_report',
];

export const PROJECTION_STEPS = [
  'update_tracker',
  'generate_pdf',
];

export const ALL_STEPS = [...CORE_STEPS, ...PROJECTION_STEPS];

export const STEP_PHASE = Object.freeze({
  ingest_source: 'core',
  normalize_job: 'core',
  evaluate_job: 'core',
  render_report: 'core',
  update_tracker: 'projection',
  generate_pdf: 'projection',
});

export const STEP_DEPENDENCIES = Object.freeze({
  ingest_source: [],
  normalize_job: ['ingest_source'],
  evaluate_job: ['normalize_job'],
  render_report: ['evaluate_job'],
  update_tracker: ['render_report'],
  generate_pdf: ['render_report'],
});

export const JOB_STATES = [
  'queued',
  'running',
  'report_ready',
  'failed',
  'cancelled',
];

export const TRACKER_STATES = [
  'blocked',
  'queued',
  'running',
  'succeeded',
  'failed',
];

export const PDF_STATES = [
  'not_requested',
  'queued',
  'running',
  'succeeded',
  'failed',
];

export const CHECKPOINT_STATUSES = [
  'blocked',
  'pending',
  'ready',
  'running',
  'succeeded',
  'failed',
  'skipped',
];

export const ROUTE_ACTIONS = [
  'start_evaluation_job',
  'retry_job_from_checkpoint',
  'cancel_job',
];

export const EVENT_TYPES = [
  'job.created',
  'job.cancel_requested',
  'job.cancelled',
  'job.retry_requested',
  'job.report_ready',
  'job.failed',
  'lease.claimed',
  'lease.released',
  'step.started',
  'step.succeeded',
  'step.failed',
  'projection.tracker.queued',
  'projection.tracker.succeeded',
  'projection.tracker.failed',
  'projection.pdf.queued',
  'projection.pdf.succeeded',
  'projection.pdf.failed',
];

export function nowIso() {
  return new Date().toISOString();
}

export function createJobId() {
  return `job_${randomUUID()}`;
}

function requireNonEmptyString(fieldName, value) {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} must not be empty`);
  }

  return normalized;
}

export function isTerminalJobState(jobState) {
  return jobState === 'report_ready' || jobState === 'failed' || jobState === 'cancelled';
}

export function normalizeJobAccess({ ownerId, workspaceId }) {
  return {
    ownerId: requireNonEmptyString('ownerId', ownerId),
    workspaceId: requireNonEmptyString('workspaceId', workspaceId),
  };
}

export function normalizeLeaseIdentity({ owner, token }) {
  return {
    owner: requireNonEmptyString('lease owner', owner),
    token: requireNonEmptyString('lease token', token),
  };
}

export function normalizeLeaseOwner(owner) {
  return requireNonEmptyString('lease owner', owner);
}

export function hasActiveLease(job, now = Date.now()) {
  if (!job.leaseOwner || !job.leaseToken || !job.leaseExpiresAt) {
    return false;
  }

  return Date.parse(job.leaseExpiresAt) > now;
}

export function isProjectionStep(stepId) {
  return PROJECTION_STEPS.includes(stepId);
}

export function nextCoreStep(stepId) {
  const index = CORE_STEPS.indexOf(stepId);
  if (index === -1) {
    throw new Error(`Unknown core step "${stepId}"`);
  }

  return CORE_STEPS[index + 1] ?? null;
}

export function assertKnownState(kind, allowed, value) {
  if (!allowed.includes(value)) {
    throw new Error(`Unknown ${kind} "${value}"`);
  }
}

export function assertKnownStep(stepId) {
  if (!ALL_STEPS.includes(stepId)) {
    throw new Error(`Unknown step "${stepId}"`);
  }
}

export function assertKnownEventType(eventType) {
  if (!EVENT_TYPES.includes(eventType)) {
    throw new Error(`Unknown event type "${eventType}"`);
  }
}

export function normalizeSourceInput({ sourceKind, source }) {
  assertKnownState('source kind', SOURCE_KINDS, sourceKind);

  if (typeof source !== 'string') {
    throw new Error('source must be a string');
  }

  const sourceValue = source.trim();
  if (!sourceValue) {
    throw new Error('source must not be empty');
  }

  if (sourceKind === 'url') {
    const parsed = new URL(sourceValue);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Unsupported URL protocol "${parsed.protocol}"`);
    }
  }

  return {
    sourceKind,
    sourceValue,
  };
}

export function normalizeCommittedReportArtifactRefs(artifactRefs) {
  if (!artifactRefs || typeof artifactRefs !== 'object') {
    throw new Error('render_report requires committed report artifact refs');
  }

  const reportPath = requireNonEmptyString('reportPath', artifactRefs.reportPath);
  if (!Number.isInteger(artifactRefs.reportNumber) || artifactRefs.reportNumber <= 0) {
    throw new Error('reportNumber must be a positive integer before report_ready');
  }

  return {
    ...artifactRefs,
    reportNumber: artifactRefs.reportNumber,
    reportPath,
  };
}

export function normalizeCommittedPdfArtifactRefs(artifactRefs) {
  if (!artifactRefs || typeof artifactRefs !== 'object') {
    throw new Error('generate_pdf requires committed PDF artifact refs');
  }

  const pdfPath = requireNonEmptyString('pdfPath', artifactRefs.pdfPath);
  return {
    ...artifactRefs,
    pdfPath,
  };
}

export function buildInitialCheckpoints(createdAt = nowIso()) {
  return [
    buildCheckpoint('ingest_source', 'ready', createdAt),
    buildCheckpoint('normalize_job', 'pending', createdAt),
    buildCheckpoint('evaluate_job', 'pending', createdAt),
    buildCheckpoint('render_report', 'pending', createdAt),
    buildCheckpoint('update_tracker', 'blocked', createdAt),
    buildCheckpoint('generate_pdf', 'blocked', createdAt),
  ];
}

export function buildCheckpoint(stepId, status, updatedAt = nowIso()) {
  assertKnownStep(stepId);
  assertKnownState('checkpoint status', CHECKPOINT_STATUSES, status);

  return {
    stepId,
    phase: STEP_PHASE[stepId],
    status,
    attemptCount: 0,
    lastStartedAt: null,
    lastFinishedAt: null,
    output: null,
    error: null,
    updatedAt,
  };
}

export function validateCheckpointRetry(stepId, checkpoints) {
  assertKnownStep(stepId);
  const checkpointMap = new Map(checkpoints.map((checkpoint) => [checkpoint.stepId, checkpoint]));
  const target = checkpointMap.get(stepId);

  if (!target) {
    throw new Error(`No checkpoint exists for step "${stepId}"`);
  }

  if (target.status !== 'failed') {
    throw new Error(`Step "${stepId}" is not retryable from status "${target.status}"`);
  }

  for (const dependency of STEP_DEPENDENCIES[stepId]) {
    const dependencyCheckpoint = checkpointMap.get(dependency);
    if (!dependencyCheckpoint || dependencyCheckpoint.status !== 'succeeded') {
      throw new Error(`Step "${stepId}" cannot be retried before dependency "${dependency}" succeeds`);
    }
  }

  return target;
}

export function buildRetryCheckpointUpdates(stepId, checkpoints, updatedAt = nowIso()) {
  validateCheckpointRetry(stepId, checkpoints);

  if (isProjectionStep(stepId)) {
    return checkpoints.map((checkpoint) => {
      if (checkpoint.stepId !== stepId) {
        return checkpoint;
      }

      return {
        ...checkpoint,
        status: 'ready',
        output: null,
        error: null,
        updatedAt,
      };
    });
  }

  const targetIndex = CORE_STEPS.indexOf(stepId);
  return checkpoints.map((checkpoint) => {
    if (PROJECTION_STEPS.includes(checkpoint.stepId)) {
      return {
        ...checkpoint,
        status: 'blocked',
        output: null,
        error: null,
        lastStartedAt: null,
        lastFinishedAt: null,
        updatedAt,
      };
    }

    const checkpointIndex = CORE_STEPS.indexOf(checkpoint.stepId);
    if (checkpointIndex < targetIndex) {
      return checkpoint;
    }

    return {
      ...checkpoint,
      status: checkpoint.stepId === stepId ? 'ready' : 'pending',
      output: null,
      error: null,
      lastStartedAt: null,
      lastFinishedAt: null,
      updatedAt,
    };
  });
}

export function defaultJobSnapshot({
  jobId,
  ownerId,
  workspaceId,
  sourceKind,
  sourceValue,
  createdAt = nowIso(),
}) {
  return {
    jobId,
    ownerId,
    workspaceId,
    schemaVersion: HARNESS_SCHEMA_VERSION,
    sourceKind,
    sourceValue,
    jobState: 'queued',
    currentStep: 'ingest_source',
    trackerState: 'blocked',
    pdfState: 'not_requested',
    cancelRequested: false,
    cancelRequestedAt: null,
    cancelledAt: null,
    reportReadyAt: null,
    completedAt: null,
    failedAt: null,
    failureStep: null,
    failureCode: null,
    failureMessage: null,
    retryCountTotal: 0,
    lastRetryStep: null,
    lastRetryRequestedAt: null,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    reportNumber: null,
    reportPath: null,
    trackerAdditionPath: null,
    pdfPath: null,
    createdAt,
    updatedAt: createdAt,
  };
}

export function createEvent({
  eventType,
  stepId = null,
  payload = {},
  createdAt = nowIso(),
}) {
  assertKnownEventType(eventType);
  if (stepId !== null) {
    assertKnownStep(stepId);
  }

  return {
    eventType,
    stepId,
    payload,
    createdAt,
  };
}
