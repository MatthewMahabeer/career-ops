import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import {
  ALL_STEPS,
  CHECKPOINT_STATUSES,
  JOB_STATES,
  PDF_STATES,
  SOURCE_KINDS,
  STEP_PHASE,
  TRACKER_STATES,
  assertKnownEventType,
  assertKnownState,
  assertKnownStep,
  normalizeJobAccess,
} from './schema.mjs';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_DB_PATH = join(REPO_ROOT, 'data', 'browser-harness.sqlite');

function serializeJson(value) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function parseJson(value) {
  return value ? JSON.parse(value) : null;
}

function assertExistingRow(kind, row, id) {
  if (!row) {
    throw new Error(`${kind} "${id}" not found`);
  }
}

export function defaultHarnessDbPath() {
  return DEFAULT_DB_PATH;
}

export class HarnessStore {
  constructor({ dbPath = defaultHarnessDbPath() } = {}) {
    mkdirSync(dirname(dbPath), { recursive: true });

    this.dbPath = dbPath;
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.#initSchema();
  }

  close() {
    this.db.close();
  }

  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const result = work();
      this.db.exec('COMMIT;');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  createJob({ job, checkpoints, initialEvent }) {
    return this.transaction(() => {
      this.#insertJob(job);
      for (const checkpoint of checkpoints) {
        this.#insertCheckpoint(job.jobId, checkpoint);
      }
      this.appendEvent(job.jobId, initialEvent);
      return this.getJobGraphForAccess({
        jobId: job.jobId,
        ownerId: job.ownerId,
        workspaceId: job.workspaceId,
      });
    });
  }

  getJobGraph(jobId) {
    return {
      job: this.getJob(jobId),
      checkpoints: this.getCheckpoints(jobId),
      events: this.listEvents(jobId),
    };
  }

  getJobGraphForAccess({ jobId, ownerId, workspaceId }) {
    const scope = normalizeJobAccess({ ownerId, workspaceId });
    this.getJobForAccess({ jobId, ...scope });

    // Checkpoints and events inherit access through the parent job. The harness
    // does not expose child-table reads or writes outside this scoped path.
    return {
      job: this.#toReadableJob(this.getJob(jobId)),
      checkpoints: this.getCheckpoints(jobId),
      events: this.listEvents(jobId).map((event) => this.#toReadableEvent(event)),
    };
  }

  getJob(jobId) {
    const row = this.db.prepare(`
      SELECT
        job_id,
        owner_id,
        workspace_id,
        schema_version,
        source_kind,
        source_value,
        job_state,
        current_step,
        tracker_state,
        pdf_state,
        cancel_requested,
        cancel_requested_at,
        cancelled_at,
        report_ready_at,
        completed_at,
        failed_at,
        failure_step,
        failure_code,
        failure_message,
        retry_count_total,
        last_retry_step,
        last_retry_requested_at,
        lease_owner,
        lease_token,
        lease_expires_at,
        report_number,
        report_path,
        tracker_addition_path,
        pdf_path,
        created_at,
        updated_at
      FROM harness_jobs
      WHERE job_id = ?
    `).get(jobId);

    assertExistingRow('Job', row, jobId);
    return this.#hydrateJob(row);
  }

  getJobForAccess({ jobId, ownerId, workspaceId }) {
    const scope = normalizeJobAccess({ ownerId, workspaceId });
    const row = this.db.prepare(`
      SELECT
        job_id,
        owner_id,
        workspace_id,
        schema_version,
        source_kind,
        source_value,
        job_state,
        current_step,
        tracker_state,
        pdf_state,
        cancel_requested,
        cancel_requested_at,
        cancelled_at,
        report_ready_at,
        completed_at,
        failed_at,
        failure_step,
        failure_code,
        failure_message,
        retry_count_total,
        last_retry_step,
        last_retry_requested_at,
        lease_owner,
        lease_token,
        lease_expires_at,
        report_number,
        report_path,
        tracker_addition_path,
        pdf_path,
        created_at,
        updated_at
      FROM harness_jobs
      WHERE job_id = ? AND owner_id = ? AND workspace_id = ?
    `).get(jobId, scope.ownerId, scope.workspaceId);

    if (!row) {
      throw new Error(`Job "${jobId}" is not available in the requested owner/workspace scope`);
    }

    return this.#hydrateJob(row);
  }

  getCheckpoints(jobId) {
    return this.db.prepare(`
      SELECT
        step_id,
        phase,
        status,
        attempt_count,
        last_started_at,
        last_finished_at,
        output_json,
        error_json,
        updated_at
      FROM harness_job_checkpoints
      WHERE job_id = ?
      ORDER BY step_order ASC
    `).all(jobId).map((row) => this.#hydrateCheckpoint(row));
  }

  getCheckpoint(jobId, stepId) {
    assertKnownStep(stepId);
    const row = this.db.prepare(`
      SELECT
        step_id,
        phase,
        status,
        attempt_count,
        last_started_at,
        last_finished_at,
        output_json,
        error_json,
        updated_at
      FROM harness_job_checkpoints
      WHERE job_id = ? AND step_id = ?
    `).get(jobId, stepId);

    assertExistingRow('Checkpoint', row, `${jobId}:${stepId}`);
    return this.#hydrateCheckpoint(row);
  }

  updateJob(jobId, patch) {
    const columns = [];
    const values = [];

    const allowedColumns = {
      source_kind: (value) => assertKnownState('source kind', SOURCE_KINDS, value),
      source_value: () => {},
      job_state: (value) => assertKnownState('job state', JOB_STATES, value),
      current_step: (value) => {
        if (value !== null) {
          assertKnownStep(value);
        }
      },
      tracker_state: (value) => assertKnownState('tracker state', TRACKER_STATES, value),
      pdf_state: (value) => assertKnownState('pdf state', PDF_STATES, value),
      cancel_requested: () => {},
      cancel_requested_at: () => {},
      cancelled_at: () => {},
      report_ready_at: () => {},
      completed_at: () => {},
      failed_at: () => {},
      failure_step: (value) => {
        if (value !== null) {
          assertKnownStep(value);
        }
      },
      failure_code: () => {},
      failure_message: () => {},
      retry_count_total: () => {},
      last_retry_step: (value) => {
        if (value !== null) {
          assertKnownStep(value);
        }
      },
      last_retry_requested_at: () => {},
      lease_owner: () => {},
      lease_token: () => {},
      lease_expires_at: () => {},
      report_number: () => {},
      report_path: () => {},
      tracker_addition_path: () => {},
      pdf_path: () => {},
      updated_at: () => {},
    };

    for (const [column, value] of Object.entries(patch)) {
      if (!Object.hasOwn(allowedColumns, column)) {
        throw new Error(`Unsupported job column "${column}"`);
      }

      allowedColumns[column](value);
      columns.push(`${column} = ?`);
      if (column === 'cancel_requested') {
        values.push(value ? 1 : 0);
      } else {
        values.push(value);
      }
    }

    if (columns.length === 0) {
      return this.getJob(jobId);
    }

    values.push(jobId);
    const result = this.db.prepare(`
      UPDATE harness_jobs
      SET ${columns.join(', ')}
      WHERE job_id = ?
    `).run(...values);

    if (result.changes === 0) {
      throw new Error(`Job "${jobId}" not found`);
    }

    return this.getJob(jobId);
  }

  updateCheckpoint(jobId, stepId, patch) {
    assertKnownStep(stepId);

    const columns = [];
    const values = [];
    const allowedColumns = {
      status: (value) => assertKnownState('checkpoint status', CHECKPOINT_STATUSES, value),
      attempt_count: () => {},
      last_started_at: () => {},
      last_finished_at: () => {},
      output_json: () => {},
      error_json: () => {},
      updated_at: () => {},
    };

    for (const [column, value] of Object.entries(patch)) {
      if (!Object.hasOwn(allowedColumns, column)) {
        throw new Error(`Unsupported checkpoint column "${column}"`);
      }

      allowedColumns[column](value);
      columns.push(`${column} = ?`);
      values.push(value);
    }

    if (columns.length === 0) {
      return this.getCheckpoint(jobId, stepId);
    }

    values.push(jobId, stepId);
    const result = this.db.prepare(`
      UPDATE harness_job_checkpoints
      SET ${columns.join(', ')}
      WHERE job_id = ? AND step_id = ?
    `).run(...values);

    if (result.changes === 0) {
      throw new Error(`Checkpoint "${jobId}:${stepId}" not found`);
    }

    return this.getCheckpoint(jobId, stepId);
  }

  appendEvent(jobId, event) {
    assertKnownEventType(event.eventType);
    if (event.stepId !== null) {
      assertKnownStep(event.stepId);
    }

    const row = this.db.prepare(`
      SELECT COALESCE(MAX(event_seq), 0) AS next_seq
      FROM harness_job_events
      WHERE job_id = ?
    `).get(jobId);

    const eventSeq = Number(row.next_seq) + 1;
    this.db.prepare(`
      INSERT INTO harness_job_events (
        job_id,
        event_seq,
        event_type,
        step_id,
        payload_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      jobId,
      eventSeq,
      event.eventType,
      event.stepId,
      serializeJson(event.payload ?? {}),
      event.createdAt
    );

    return {
      eventSeq,
      ...event,
    };
  }

  listEvents(jobId) {
    return this.db.prepare(`
      SELECT
        event_seq,
        event_type,
        step_id,
        payload_json,
        created_at
      FROM harness_job_events
      WHERE job_id = ?
      ORDER BY event_seq ASC
    `).all(jobId).map((row) => ({
      eventSeq: Number(row.event_seq),
      eventType: row.event_type,
      stepId: row.step_id,
      payload: parseJson(row.payload_json) ?? {},
      createdAt: row.created_at,
    }));
  }

  #initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS harness_jobs (
        job_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL DEFAULT '__legacy_unscoped__',
        workspace_id TEXT NOT NULL DEFAULT '__legacy_unscoped__',
        schema_version INTEGER NOT NULL,
        source_kind TEXT NOT NULL,
        source_value TEXT NOT NULL,
        job_state TEXT NOT NULL,
        current_step TEXT,
        tracker_state TEXT NOT NULL,
        pdf_state TEXT NOT NULL,
        cancel_requested INTEGER NOT NULL DEFAULT 0,
        cancel_requested_at TEXT,
        cancelled_at TEXT,
        report_ready_at TEXT,
        completed_at TEXT,
        failed_at TEXT,
        failure_step TEXT,
        failure_code TEXT,
        failure_message TEXT,
        retry_count_total INTEGER NOT NULL DEFAULT 0,
        last_retry_step TEXT,
        last_retry_requested_at TEXT,
        lease_owner TEXT,
        lease_token TEXT,
        lease_expires_at TEXT,
        report_number INTEGER,
        report_path TEXT,
        tracker_addition_path TEXT,
        pdf_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS harness_job_checkpoints (
        job_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        step_order INTEGER NOT NULL,
        phase TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_started_at TEXT,
        last_finished_at TEXT,
        output_json TEXT,
        error_json TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (job_id, step_id),
        FOREIGN KEY (job_id) REFERENCES harness_jobs(job_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS harness_job_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        event_seq INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        step_id TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (job_id, event_seq),
        FOREIGN KEY (job_id) REFERENCES harness_jobs(job_id) ON DELETE CASCADE
      );
    `);

    this.#ensureHarnessJobsColumn(
      'owner_id',
      `ALTER TABLE harness_jobs ADD COLUMN owner_id TEXT NOT NULL DEFAULT '__legacy_unscoped__'`
    );
    this.#ensureHarnessJobsColumn(
      'workspace_id',
      `ALTER TABLE harness_jobs ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '__legacy_unscoped__'`
    );

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_harness_jobs_state
        ON harness_jobs (job_state, tracker_state, pdf_state);

      CREATE INDEX IF NOT EXISTS idx_harness_jobs_scope
        ON harness_jobs (owner_id, workspace_id, job_state);

      CREATE INDEX IF NOT EXISTS idx_harness_events_job
        ON harness_job_events (job_id, event_seq);
    `);
  }

  #insertJob(job) {
    const scope = normalizeJobAccess({
      ownerId: job.ownerId,
      workspaceId: job.workspaceId,
    });
    assertKnownState('source kind', SOURCE_KINDS, job.sourceKind);
    assertKnownState('job state', JOB_STATES, job.jobState);
    assertKnownState('tracker state', TRACKER_STATES, job.trackerState);
    assertKnownState('pdf state', PDF_STATES, job.pdfState);

    this.db.prepare(`
      INSERT INTO harness_jobs (
        job_id,
        owner_id,
        workspace_id,
        schema_version,
        source_kind,
        source_value,
        job_state,
        current_step,
        tracker_state,
        pdf_state,
        cancel_requested,
        cancel_requested_at,
        cancelled_at,
        report_ready_at,
        completed_at,
        failed_at,
        failure_step,
        failure_code,
        failure_message,
        retry_count_total,
        last_retry_step,
        last_retry_requested_at,
        lease_owner,
        lease_token,
        lease_expires_at,
        report_number,
        report_path,
        tracker_addition_path,
        pdf_path,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      job.jobId,
      scope.ownerId,
      scope.workspaceId,
      job.schemaVersion,
      job.sourceKind,
      job.sourceValue,
      job.jobState,
      job.currentStep,
      job.trackerState,
      job.pdfState,
      job.cancelRequested ? 1 : 0,
      job.cancelRequestedAt,
      job.cancelledAt,
      job.reportReadyAt,
      job.completedAt,
      job.failedAt,
      job.failureStep,
      job.failureCode,
      job.failureMessage,
      job.retryCountTotal,
      job.lastRetryStep,
      job.lastRetryRequestedAt,
      job.leaseOwner,
      job.leaseToken,
      job.leaseExpiresAt,
      job.reportNumber,
      job.reportPath,
      job.trackerAdditionPath,
      job.pdfPath,
      job.createdAt,
      job.updatedAt
    );
  }

  #ensureHarnessJobsColumn(columnName, alterStatement) {
    const columns = this.db.prepare(`PRAGMA table_info(harness_jobs)`).all();
    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    this.db.exec(alterStatement);
  }

  #insertCheckpoint(jobId, checkpoint) {
    assertKnownStep(checkpoint.stepId);
    assertKnownState('checkpoint status', CHECKPOINT_STATUSES, checkpoint.status);

    this.db.prepare(`
      INSERT INTO harness_job_checkpoints (
        job_id,
        step_id,
        step_order,
        phase,
        status,
        attempt_count,
        last_started_at,
        last_finished_at,
        output_json,
        error_json,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      jobId,
      checkpoint.stepId,
      ALL_STEPS.indexOf(checkpoint.stepId),
      STEP_PHASE[checkpoint.stepId],
      checkpoint.status,
      checkpoint.attemptCount,
      checkpoint.lastStartedAt,
      checkpoint.lastFinishedAt,
      serializeJson(checkpoint.output),
      serializeJson(checkpoint.error),
      checkpoint.updatedAt
    );
  }

  #hydrateJob(row) {
    return {
      jobId: row.job_id,
      ownerId: row.owner_id,
      workspaceId: row.workspace_id,
      schemaVersion: Number(row.schema_version),
      sourceKind: row.source_kind,
      sourceValue: row.source_value,
      jobState: row.job_state,
      currentStep: row.current_step,
      trackerState: row.tracker_state,
      pdfState: row.pdf_state,
      cancelRequested: Boolean(row.cancel_requested),
      cancelRequestedAt: row.cancel_requested_at,
      cancelledAt: row.cancelled_at,
      reportReadyAt: row.report_ready_at,
      completedAt: row.completed_at,
      failedAt: row.failed_at,
      failureStep: row.failure_step,
      failureCode: row.failure_code,
      failureMessage: row.failure_message,
      retryCountTotal: Number(row.retry_count_total),
      lastRetryStep: row.last_retry_step,
      lastRetryRequestedAt: row.last_retry_requested_at,
      leaseOwner: row.lease_owner,
      leaseToken: row.lease_token,
      leaseExpiresAt: row.lease_expires_at,
      reportNumber: row.report_number === null ? null : Number(row.report_number),
      reportPath: row.report_path,
      trackerAdditionPath: row.tracker_addition_path,
      pdfPath: row.pdf_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  #hydrateCheckpoint(row) {
    return {
      stepId: row.step_id,
      phase: row.phase,
      status: row.status,
      attemptCount: Number(row.attempt_count),
      lastStartedAt: row.last_started_at,
      lastFinishedAt: row.last_finished_at,
      output: parseJson(row.output_json),
      error: parseJson(row.error_json),
      updatedAt: row.updated_at,
    };
  }

  #toReadableJob(job) {
    return {
      ...job,
      leaseToken: null,
    };
  }

  #toReadableEvent(event) {
    if (event.eventType !== 'lease.claimed') {
      return event;
    }

    const { leaseToken: _leaseToken, ...payload } = event.payload ?? {};
    return {
      ...event,
      payload,
    };
  }
}
