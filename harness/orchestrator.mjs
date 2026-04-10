import { randomUUID } from 'crypto';

import {
  CORE_STEPS,
  PROJECTION_STEPS,
  buildInitialCheckpoints,
  buildRetryCheckpointUpdates,
  createEvent,
  createJobId,
  defaultJobSnapshot,
  hasActiveLease,
  isProjectionStep,
  isTerminalJobState,
  nextCoreStep,
  normalizeCommittedPdfArtifactRefs,
  normalizeCommittedReportArtifactRefs,
  normalizeJobAccess,
  normalizeLeaseIdentity,
  normalizeLeaseOwner,
  normalizeSourceInput,
  nowIso,
} from './schema.mjs';
import {
  assertExtractedSnapshotMatchesJobSource,
  assertNormalizedJobMatchesExtractedSnapshot,
  assessNormalizedJobForEvaluation,
} from './contracts.mjs';
import { HarnessStore } from './store.mjs';

function checkpointMap(checkpoints) {
  return new Map(checkpoints.map((checkpoint) => [checkpoint.stepId, checkpoint]));
}

export class HarnessOrchestrator {
  constructor({ store = new HarnessStore() } = {}) {
    this.store = store;
  }

  close() {
    this.store.close();
  }

  getJobGraph({ jobId, access }) {
    const scope = normalizeJobAccess(access);
    return this.store.getJobGraphForAccess({
      jobId,
      ownerId: scope.ownerId,
      workspaceId: scope.workspaceId,
    });
  }

  startEvaluationJob({ ownerId, workspaceId, sourceKind, source, requestedBy = 'system' }) {
    const scope = normalizeJobAccess({ ownerId, workspaceId });
    const { sourceValue } = normalizeSourceInput({ sourceKind, source });
    const createdAt = nowIso();
    const jobId = createJobId();
    const job = defaultJobSnapshot({
      jobId,
      ownerId: scope.ownerId,
      workspaceId: scope.workspaceId,
      sourceKind,
      sourceValue,
      createdAt,
    });

    const checkpoints = buildInitialCheckpoints(createdAt);
    return this.store.createJob({
      job,
      checkpoints,
      initialEvent: createEvent({
        eventType: 'job.created',
        payload: {
          action: 'start_evaluation_job',
          requestedBy,
          ownerId: scope.ownerId,
          workspaceId: scope.workspaceId,
          sourceKind,
        },
        createdAt,
      }),
    });
  }

  requestCancellation({ jobId, access, requestedBy = 'system', reason = null }) {
    const scope = normalizeJobAccess(access);
    return this.store.transaction(() => {
      const job = this.#getScopedJob(jobId, scope);
      if (job.cancelRequested || isTerminalJobState(job.jobState)) {
        return this.#getScopedJobGraph(jobId, scope);
      }

      const updatedAt = nowIso();
      this.store.updateJob(jobId, {
        cancel_requested: true,
        cancel_requested_at: updatedAt,
        updated_at: updatedAt,
      });
      this.store.appendEvent(jobId, createEvent({
        eventType: 'job.cancel_requested',
        payload: {
          action: 'cancel_job',
          requestedBy,
          reason,
        },
        createdAt: updatedAt,
      }));

      return this.#getScopedJobGraph(jobId, scope);
    });
  }

  retryJobFromCheckpoint({ jobId, access, stepId, requestedBy = 'system', reason = null }) {
    const scope = normalizeJobAccess(access);
    return this.store.transaction(() => {
      const job = this.#getScopedJob(jobId, scope);
      const checkpoints = this.store.getCheckpoints(jobId);
      const updatedAt = nowIso();
      const nextCheckpoints = buildRetryCheckpointUpdates(stepId, checkpoints, updatedAt);

      for (const checkpoint of nextCheckpoints) {
        this.store.updateCheckpoint(jobId, checkpoint.stepId, {
          status: checkpoint.status,
          last_started_at: checkpoint.lastStartedAt,
          last_finished_at: checkpoint.lastFinishedAt,
          output_json: checkpoint.output === null ? null : JSON.stringify(checkpoint.output),
          error_json: checkpoint.error === null ? null : JSON.stringify(checkpoint.error),
          updated_at: checkpoint.updatedAt,
        });
      }

      const isProjectionRetry = isProjectionStep(stepId);
      this.store.updateJob(jobId, {
        job_state: isProjectionRetry ? 'report_ready' : 'queued',
        current_step: stepId,
        tracker_state: stepId === 'update_tracker' ? 'queued' : (isProjectionRetry ? job.trackerState : 'blocked'),
        pdf_state: stepId === 'generate_pdf' ? 'queued' : (isProjectionRetry ? job.pdfState : 'not_requested'),
        cancel_requested: false,
        cancel_requested_at: null,
        failed_at: null,
        failure_step: null,
        failure_code: null,
        failure_message: null,
        retry_count_total: job.retryCountTotal + 1,
        last_retry_step: stepId,
        last_retry_requested_at: updatedAt,
        updated_at: updatedAt,
      });

      this.store.appendEvent(jobId, createEvent({
        eventType: 'job.retry_requested',
        stepId,
        payload: {
          action: 'retry_job_from_checkpoint',
          requestedBy,
          reason,
        },
        createdAt: updatedAt,
      }));

      return this.#getScopedJobGraph(jobId, scope);
    });
  }

  claimLease({ jobId, access, owner, leaseToken = null, ttlMs = 30_000 }) {
    const scope = normalizeJobAccess(access);
    const leaseOwner = normalizeLeaseOwner(owner);

    if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
      throw new Error('ttlMs must be a positive integer');
    }

    return this.store.transaction(() => {
      const job = this.#getScopedJob(jobId, scope);
      const now = Date.now();
      const updatedAt = new Date(now).toISOString();
      const expiresAt = new Date(now + ttlMs).toISOString();

      if (hasActiveLease(job, now)) {
        const activeLease = normalizeLeaseIdentity({ owner: leaseOwner, token: leaseToken });
        if (activeLease.owner !== job.leaseOwner || activeLease.token !== job.leaseToken) {
          throw new Error(`Job "${jobId}" already has an active lease owned by "${job.leaseOwner}"`);
        }

        this.store.updateJob(jobId, {
          lease_expires_at: expiresAt,
          updated_at: updatedAt,
        });
        this.store.appendEvent(jobId, createEvent({
          eventType: 'lease.claimed',
          payload: {
            owner: leaseOwner,
            ttlMs,
            renewed: true,
          },
          createdAt: updatedAt,
        }));

        return {
          ...this.#getScopedJobGraph(jobId, scope),
          lease: {
            owner: leaseOwner,
            token: job.leaseToken,
            expiresAt,
            renewed: true,
          },
        };
      }

      const nextLeaseToken = `lease_${randomUUID()}`;
      this.store.updateJob(jobId, {
        lease_owner: leaseOwner,
        lease_token: nextLeaseToken,
        lease_expires_at: expiresAt,
        updated_at: updatedAt,
      });
      this.store.appendEvent(jobId, createEvent({
        eventType: 'lease.claimed',
        payload: {
          owner: leaseOwner,
          ttlMs,
          renewed: false,
        },
        createdAt: updatedAt,
      }));

      return {
        ...this.#getScopedJobGraph(jobId, scope),
        lease: {
          owner: leaseOwner,
          token: nextLeaseToken,
          expiresAt,
          renewed: false,
        },
      };
    });
  }

  releaseLease({ jobId, access, owner = null, leaseToken = null }) {
    const scope = normalizeJobAccess(access);
    return this.store.transaction(() => {
      const job = this.#getScopedJob(jobId, scope);
      if (!job.leaseToken) {
        return this.#getScopedJobGraph(jobId, scope);
      }

      this.#assertLeaseMatchIfActive(job, {
        owner,
        token: leaseToken,
      }, 'release the lease');

      const updatedAt = nowIso();
      this.store.updateJob(jobId, {
        lease_owner: null,
        lease_token: null,
        lease_expires_at: null,
        updated_at: updatedAt,
      });
      this.store.appendEvent(jobId, createEvent({
        eventType: 'lease.released',
        payload: {
          owner: job.leaseOwner,
        },
        createdAt: updatedAt,
      }));

      return this.#getScopedJobGraph(jobId, scope);
    });
  }

  startStep({ jobId, access, stepId, leaseOwner = null, leaseToken = null }) {
    const scope = normalizeJobAccess(access);
    return this.store.transaction(() => {
      const job = this.#getScopedJob(jobId, scope);
      const checkpoint = this.store.getCheckpoint(jobId, stepId);

      if (checkpoint.status !== 'ready') {
        throw new Error(`Step "${stepId}" cannot start from status "${checkpoint.status}"`);
      }

      const activeLease = this.#assertLeaseMatchIfActive(job, {
        owner: leaseOwner,
        token: leaseToken,
      }, 'start a step');

      const updatedAt = nowIso();
      this.store.updateCheckpoint(jobId, stepId, {
        status: 'running',
        attempt_count: checkpoint.attemptCount + 1,
        last_started_at: updatedAt,
        error_json: null,
        updated_at: updatedAt,
      });
      this.store.updateJob(jobId, {
        job_state: isProjectionStep(stepId) ? job.jobState : 'running',
        current_step: stepId,
        tracker_state: stepId === 'update_tracker' ? 'running' : job.trackerState,
        pdf_state: stepId === 'generate_pdf' ? 'running' : job.pdfState,
        updated_at: updatedAt,
      });
      this.store.appendEvent(jobId, createEvent({
        eventType: 'step.started',
        stepId,
        payload: {
          owner: activeLease?.owner ?? leaseOwner,
          attempt: checkpoint.attemptCount + 1,
        },
        createdAt: updatedAt,
      }));

      return this.#getScopedJobGraph(jobId, scope);
    });
  }

  completeStep({ jobId, access, stepId, leaseOwner = null, leaseToken = null, output = null, artifactRefs = null }) {
    const scope = normalizeJobAccess(access);
    return this.store.transaction(() => {
      const job = this.#getScopedJob(jobId, scope);
      const checkpoint = this.store.getCheckpoint(jobId, stepId);
      if (checkpoint.status !== 'running') {
        throw new Error(`Step "${stepId}" cannot complete from status "${checkpoint.status}"`);
      }

      const activeLease = this.#assertLeaseMatchIfActive(job, {
        owner: leaseOwner,
        token: leaseToken,
      }, 'complete a step');
      const normalizedOutput = this.#normalizeStepOutput({
        job,
        jobId,
        stepId,
        output,
      });
      const reportArtifactRefs = stepId === 'render_report'
        ? normalizeCommittedReportArtifactRefs(artifactRefs)
        : stepId === 'generate_pdf'
          ? normalizeCommittedPdfArtifactRefs(artifactRefs)
          : artifactRefs;
      const updatedAt = nowIso();

      this.store.updateCheckpoint(jobId, stepId, {
        status: 'succeeded',
        last_finished_at: updatedAt,
        output_json: normalizedOutput === null ? null : JSON.stringify(normalizedOutput),
        error_json: null,
        updated_at: updatedAt,
      });

      const jobPatch = {
        current_step: stepId,
        updated_at: updatedAt,
      };

      if (stepId === 'render_report') {
        const trackerQueuedEvent = createEvent({
          eventType: 'projection.tracker.queued',
          stepId: 'update_tracker',
          payload: {
            artifactRefs: reportArtifactRefs,
          },
          createdAt: updatedAt,
        });

        this.store.updateCheckpoint(jobId, 'update_tracker', {
          status: 'ready',
          updated_at: updatedAt,
        });
        this.store.updateJob(jobId, {
          job_state: 'report_ready',
          current_step: null,
          tracker_state: 'queued',
          report_ready_at: updatedAt,
          completed_at: updatedAt,
          report_number: reportArtifactRefs.reportNumber,
          report_path: reportArtifactRefs.reportPath,
          updated_at: updatedAt,
        });
        this.store.appendEvent(jobId, createEvent({
          eventType: 'job.report_ready',
          stepId,
          payload: {
            artifactRefs: reportArtifactRefs,
          },
          createdAt: updatedAt,
        }));
        this.store.appendEvent(jobId, trackerQueuedEvent);
      } else if (stepId === 'update_tracker') {
        this.store.updateJob(jobId, {
          tracker_state: 'succeeded',
          tracker_addition_path: artifactRefs?.trackerAdditionPath ?? job.trackerAdditionPath,
          updated_at: updatedAt,
        });
        this.store.appendEvent(jobId, createEvent({
          eventType: 'projection.tracker.succeeded',
          stepId,
          payload: {
            artifactRefs,
          },
          createdAt: updatedAt,
        }));
      } else if (stepId === 'generate_pdf') {
        this.store.updateJob(jobId, {
          pdf_state: 'succeeded',
          pdf_path: reportArtifactRefs.pdfPath,
          failure_step: job.failureStep === 'generate_pdf' ? null : job.failureStep,
          failure_code: job.failureStep === 'generate_pdf' ? null : job.failureCode,
          failure_message: job.failureStep === 'generate_pdf' ? null : job.failureMessage,
          updated_at: updatedAt,
        });
        this.store.appendEvent(jobId, createEvent({
          eventType: 'projection.pdf.succeeded',
          stepId,
          payload: {
            artifactRefs: reportArtifactRefs,
          },
          createdAt: updatedAt,
        }));
      } else {
        const nextStep = nextCoreStep(stepId);
        if (nextStep) {
          this.store.updateCheckpoint(jobId, nextStep, {
            status: 'ready',
            updated_at: updatedAt,
          });
          jobPatch.job_state = 'queued';
          jobPatch.current_step = nextStep;
        }
        this.store.updateJob(jobId, jobPatch);
      }

      this.store.appendEvent(jobId, createEvent({
        eventType: 'step.succeeded',
        stepId,
        payload: {
          owner: activeLease?.owner ?? leaseOwner,
          output: normalizedOutput,
          artifactRefs: reportArtifactRefs ?? artifactRefs,
        },
        createdAt: updatedAt,
      }));

      return this.#getScopedJobGraph(jobId, scope);
    });
  }

  failStep({ jobId, access, stepId, leaseOwner = null, leaseToken = null, code, message, details = null }) {
    const scope = normalizeJobAccess(access);
    return this.store.transaction(() => {
      const job = this.#getScopedJob(jobId, scope);
      const checkpoint = this.store.getCheckpoint(jobId, stepId);
      if (checkpoint.status !== 'running') {
        throw new Error(`Step "${stepId}" cannot fail from status "${checkpoint.status}"`);
      }

      const activeLease = this.#assertLeaseMatchIfActive(job, {
        owner: leaseOwner,
        token: leaseToken,
      }, 'fail a step');
      const updatedAt = nowIso();
      const error = {
        code,
        message,
        details,
      };

      this.store.updateCheckpoint(jobId, stepId, {
        status: 'failed',
        last_finished_at: updatedAt,
        error_json: JSON.stringify(error),
        updated_at: updatedAt,
      });

      if (stepId === 'update_tracker') {
        this.store.updateJob(jobId, {
          tracker_state: 'failed',
          failure_step: stepId,
          failure_code: code,
          failure_message: message,
          updated_at: updatedAt,
        });
        this.store.appendEvent(jobId, createEvent({
          eventType: 'projection.tracker.failed',
          stepId,
          payload: error,
          createdAt: updatedAt,
        }));
      } else if (stepId === 'generate_pdf') {
        this.store.updateJob(jobId, {
          pdf_state: 'failed',
          failure_step: stepId,
          failure_code: code,
          failure_message: message,
          updated_at: updatedAt,
        });
        this.store.appendEvent(jobId, createEvent({
          eventType: 'projection.pdf.failed',
          stepId,
          payload: error,
          createdAt: updatedAt,
        }));
      } else {
        this.store.updateJob(jobId, {
          job_state: 'failed',
          current_step: stepId,
          failed_at: updatedAt,
          failure_step: stepId,
          failure_code: code,
          failure_message: message,
          updated_at: updatedAt,
        });
        this.store.appendEvent(jobId, createEvent({
          eventType: 'job.failed',
          stepId,
          payload: error,
          createdAt: updatedAt,
        }));
      }

      this.store.appendEvent(jobId, createEvent({
        eventType: 'step.failed',
        stepId,
        payload: {
          owner: activeLease?.owner ?? leaseOwner,
          ...error,
        },
        createdAt: updatedAt,
      }));

      return this.#getScopedJobGraph(jobId, scope);
    });
  }

  requestPdfGeneration({ jobId, access, requestedBy = 'system' }) {
    const scope = normalizeJobAccess(access);
    return this.store.transaction(() => {
      const job = this.#getScopedJob(jobId, scope);
      const checkpoint = this.store.getCheckpoint(jobId, 'generate_pdf');
      if (job.jobState !== 'report_ready') {
        throw new Error('PDF generation is only available after report_ready');
      }

      if (!['blocked', 'failed'].includes(checkpoint.status)) {
        throw new Error(`PDF generation cannot be queued from status "${checkpoint.status}"`);
      }

      const updatedAt = nowIso();
      this.store.updateCheckpoint(jobId, 'generate_pdf', {
        status: 'ready',
        error_json: null,
        updated_at: updatedAt,
      });
      this.store.updateJob(jobId, {
        pdf_state: 'queued',
        failure_step: job.failureStep === 'generate_pdf' ? null : job.failureStep,
        failure_code: job.failureStep === 'generate_pdf' ? null : job.failureCode,
        failure_message: job.failureStep === 'generate_pdf' ? null : job.failureMessage,
        updated_at: updatedAt,
      });
      this.store.appendEvent(jobId, createEvent({
        eventType: 'projection.pdf.queued',
        stepId: 'generate_pdf',
        payload: {
          requestedBy,
        },
        createdAt: updatedAt,
      }));

      return this.#getScopedJobGraph(jobId, scope);
    });
  }

  honorSoftCancellation({ jobId, access, leaseOwner = null, leaseToken = null }) {
    const scope = normalizeJobAccess(access);
    return this.store.transaction(() => {
      const job = this.#getScopedJob(jobId, scope);
      if (!job.cancelRequested) {
        return this.#getScopedJobGraph(jobId, scope);
      }

      if (isTerminalJobState(job.jobState) && job.jobState !== 'running') {
        return this.#getScopedJobGraph(jobId, scope);
      }

      this.#assertLeaseMatchIfActive(job, {
        owner: leaseOwner,
        token: leaseToken,
      }, 'honor soft cancellation');

      const checkpoints = checkpointMap(this.store.getCheckpoints(jobId));
      const currentStep = job.currentStep ? checkpoints.get(job.currentStep) : null;
      if (currentStep?.status === 'running') {
        throw new Error('Soft cancellation can only be honored between steps');
      }

      const updatedAt = nowIso();
      for (const stepKey of [...CORE_STEPS, ...PROJECTION_STEPS]) {
        const checkpoint = checkpoints.get(stepKey);
        if (checkpoint && ['pending', 'ready', 'blocked'].includes(checkpoint.status)) {
          this.store.updateCheckpoint(jobId, stepKey, {
            status: 'skipped',
            updated_at: updatedAt,
          });
        }
      }

      this.store.updateJob(jobId, {
        job_state: 'cancelled',
        current_step: null,
        cancelled_at: updatedAt,
        updated_at: updatedAt,
      });
      this.store.appendEvent(jobId, createEvent({
        eventType: 'job.cancelled',
        payload: {},
        createdAt: updatedAt,
      }));

      return this.#getScopedJobGraph(jobId, scope);
    });
  }

  #getScopedJob(jobId, scope) {
    return this.store.getJobForAccess({
      jobId,
      ownerId: scope.ownerId,
      workspaceId: scope.workspaceId,
    });
  }

  #getScopedJobGraph(jobId, scope) {
    return this.store.getJobGraphForAccess({
      jobId,
      ownerId: scope.ownerId,
      workspaceId: scope.workspaceId,
    });
  }

  #assertLeaseMatchIfActive(job, lease, action) {
    if (!hasActiveLease(job)) {
      return null;
    }

    if (typeof lease?.owner !== 'string' || !lease.owner.trim() || typeof lease?.token !== 'string' || !lease.token.trim()) {
      throw new Error(`Job "${job.jobId}" has an active lease and requires a matching owner/token to ${action}`);
    }

    const activeLease = normalizeLeaseIdentity({
      owner: lease?.owner,
      token: lease?.token,
    });
    if (activeLease.owner !== job.leaseOwner || activeLease.token !== job.leaseToken) {
      throw new Error(`Job "${job.jobId}" has an active lease and requires a matching owner/token to ${action}`);
    }

    return activeLease;
  }

  #normalizeStepOutput({ job, jobId, stepId, output }) {
    if (stepId === 'ingest_source') {
      return assertExtractedSnapshotMatchesJobSource(output, {
        sourceKind: job.sourceKind,
        sourceValue: job.sourceValue,
      });
    }

    if (stepId === 'normalize_job') {
      const extractedSnapshot = this.store.getCheckpoint(jobId, 'ingest_source').output;
      if (!extractedSnapshot) {
        throw new Error('normalize_job requires a committed ExtractedSnapshot from ingest_source');
      }

      const normalizedJob = assertNormalizedJobMatchesExtractedSnapshot(output, extractedSnapshot);
      const readiness = assessNormalizedJobForEvaluation(normalizedJob);
      if (!readiness.accepted) {
        throw new Error(
          `normalize_job output is not ready for evaluation: ${readiness.reasons.join(', ')}`
        );
      }

      return normalizedJob;
    }

    return output;
  }
}
