import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXTRACTED_SNAPSHOT_CONTRACT_VERSION,
  MAX_EVIDENCE_ITEMS,
  MAX_EVIDENCE_QUOTE_CHARS,
  MIN_EXTRACTED_TEXT_CHARS_FOR_FALLBACK,
  NORMALIZED_JOB_CONTRACT_VERSION,
  assessNormalizationFallback,
  assessNormalizedJobForEvaluation,
  makeUnknown,
  validateBoundedEvidence,
  validateExtractedSnapshot,
  validateNormalizedJob,
} from '../../harness/contracts.mjs';

const DEFAULT_SOURCE_TEXT = [
  'ExampleCo is hiring a Senior AI Engineer to build a browser-first evaluation harness.',
  'Responsibilities include deterministic normalization, evidence packaging, and markdown report rendering.',
  'Requirements include Node.js, Playwright, and workflow orchestration experience.',
].join(' ');

function buildExtractedSnapshot({
  sourceKind = 'pasted_text',
  sourceValue = sourceKind === 'pasted_text' ? DEFAULT_SOURCE_TEXT : 'https://example.com/jobs/123',
  rawText = null,
  snapshotId = 'snapshot-contract',
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
      rawText: rawText ?? (sourceKind === 'pasted_text' ? sourceValue : DEFAULT_SOURCE_TEXT),
      title: 'Senior AI Engineer',
      language: 'en',
    },
  };
}

function buildNormalizedJob(extractedSnapshot, overrides = {}) {
  const base = {
    contractType: 'NormalizedJob',
    contractVersion: NORMALIZED_JOB_CONTRACT_VERSION,
    extractedSnapshotId: extractedSnapshot.snapshotId,
    source: {
      kind: extractedSnapshot.source.kind,
      url: extractedSnapshot.source.url,
    },
    normalization: {
      strategy: 'deterministic',
      normalizedAt: '2026-04-09T12:05:00.000Z',
      confidence: {
        overall: 0.9,
        fields: {
          'identity.companyName': 0.95,
          'identity.roleTitle': 0.96,
          'content.summary': 0.82,
        },
      },
      fallback: {
        eligible: false,
        used: false,
        reasons: [],
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
      summary: 'Build a browser-first evaluation harness and deterministic normalization pipeline.',
      responsibilities: [
        'Own typed extraction and normalization contracts.',
      ],
      requirementsMust: [
        'Experience with Node.js and Playwright.',
      ],
      requirementsNice: makeUnknown('not_found'),
      technologies: ['Node.js', 'Playwright', 'SQLite'],
    },
    evidence: [
      {
        evidenceId: 'ev-1',
        fieldPath: 'identity.companyName',
        quote: 'ExampleCo is hiring a Senior AI Engineer to build a browser-first evaluation harness.',
        sourceSnapshotId: extractedSnapshot.snapshotId,
        sourceKind: extractedSnapshot.source.kind,
        locator: {
          strategy: 'section_hint',
          section: 'Header',
        },
      },
      {
        evidenceId: 'ev-2',
        fieldPath: 'content.summary',
        quote: 'Responsibilities include deterministic normalization, evidence packaging, and markdown report rendering.',
        sourceSnapshotId: extractedSnapshot.snapshotId,
        sourceKind: extractedSnapshot.source.kind,
        locator: {
          strategy: 'section_hint',
          section: 'Responsibilities',
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

test('ExtractedSnapshot v1 accepts both url and pasted_text ingestion shapes', () => {
  const urlSnapshot = validateExtractedSnapshot(buildExtractedSnapshot({
    sourceKind: 'url',
    sourceValue: 'https://example.com/jobs/123',
  }));
  const pastedSnapshot = validateExtractedSnapshot(buildExtractedSnapshot({
    sourceKind: 'pasted_text',
    sourceValue: DEFAULT_SOURCE_TEXT,
  }));

  assert.equal(urlSnapshot.source.kind, 'url');
  assert.equal(urlSnapshot.source.url, 'https://example.com/jobs/123');
  assert.equal(pastedSnapshot.source.kind, 'pasted_text');
  assert.equal(pastedSnapshot.source.url, null);
});

test('NormalizedJob v1 accepts explicit unknown values while rejecting null fact fields', () => {
  const snapshot = buildExtractedSnapshot();
  const normalizedJob = validateNormalizedJob(buildNormalizedJob(snapshot));

  assert.equal(normalizedJob.classification.location.kind, 'unknown');
  assert.equal(normalizedJob.classification.compensation.reason, 'not_found');

  assert.throws(
    () => validateNormalizedJob(buildNormalizedJob(snapshot, {
      classification: {
        location: null,
      },
    })),
    /explicit unknown value instead of null/
  );
});

test('evaluation readiness requires core identity, substantive content, and minimum confidence', () => {
  const snapshot = buildExtractedSnapshot();
  const readiness = assessNormalizedJobForEvaluation(buildNormalizedJob(snapshot, {
    identity: {
      companyName: makeUnknown('not_found'),
    },
    content: {
      summary: makeUnknown('not_found'),
      responsibilities: makeUnknown('not_found'),
      requirementsMust: makeUnknown('not_found'),
    },
    normalization: {
      confidence: {
        overall: 0.32,
        fields: {
          'identity.companyName': 0.1,
          'identity.roleTitle': 0.95,
        },
      },
      fallback: {
        eligible: true,
        used: false,
        reasons: ['missing_core_identity', 'missing_role_content', 'insufficient_confidence'],
      },
    },
  }));

  assert.equal(readiness.accepted, false);
  assert.deepEqual(readiness.missingCoreFields, ['identity.companyName']);
  assert.deepEqual(readiness.reasons, [
    'missing_role_content',
    'missing_core_identity',
    'insufficient_confidence',
  ]);
});

test('normalization fallback is only eligible when the extracted snapshot is substantive', () => {
  const snapshot = buildExtractedSnapshot();
  const fallbackCandidate = buildNormalizedJob(snapshot, {
    identity: {
      companyName: makeUnknown('not_found'),
    },
    normalization: {
      fallback: {
        eligible: true,
        used: false,
        reasons: ['missing_core_identity'],
      },
    },
  });

  const eligible = assessNormalizationFallback({
    extractedSnapshot: snapshot,
    normalizedJob: fallbackCandidate,
  });
  assert.deepEqual(eligible, {
    decision: 'eligible',
    eligible: true,
    reasons: ['missing_core_identity'],
  });

  const shortSnapshot = buildExtractedSnapshot({
    rawText: 'Short JD snippet only.',
  });
  const rejected = assessNormalizationFallback({
    extractedSnapshot: shortSnapshot,
    normalizedJob: buildNormalizedJob(shortSnapshot, {
      identity: {
        companyName: makeUnknown('not_found'),
      },
      normalization: {
        fallback: {
          eligible: true,
          used: false,
          reasons: ['missing_core_identity'],
        },
      },
    }),
  });

  assert.equal(shortSnapshot.content.rawText.length < MIN_EXTRACTED_TEXT_CHARS_FOR_FALLBACK, true);
  assert.deepEqual(rejected, {
    decision: 'reject',
    eligible: false,
    reasons: ['source_text_too_short'],
  });
});

test('normalization fallback is not eligible after a fallback pass has already been used', () => {
  const snapshot = buildExtractedSnapshot();
  const alreadyFallbacked = assessNormalizationFallback({
    extractedSnapshot: snapshot,
    normalizedJob: buildNormalizedJob(snapshot, {
      normalization: {
        strategy: 'fallback_model',
        fallback: {
          eligible: true,
          used: true,
          reasons: ['insufficient_confidence'],
        },
      },
      identity: {
        companyName: makeUnknown('not_found'),
      },
    }),
  });

  assert.deepEqual(alreadyFallbacked, {
    decision: 'already_used',
    eligible: false,
    reasons: ['fallback_already_used'],
  });
});

test('bounded evidence must resolve back to the extracted snapshot text', () => {
  const snapshot = buildExtractedSnapshot();

  assert.throws(
    () => validateBoundedEvidence([
      {
        evidenceId: 'ev-fabricated',
        fieldPath: 'content.summary',
        quote: 'This sentence never appeared in the JD.',
        sourceSnapshotId: snapshot.snapshotId,
        sourceKind: snapshot.source.kind,
        locator: {
          strategy: 'excerpt',
        },
      },
    ], {
      extractedSnapshotId: snapshot.snapshotId,
      sourceKind: snapshot.source.kind,
      extractedSourceText: snapshot.content.rawText,
    }),
    /must be present in ExtractedSnapshot\.content\.rawText/
  );

  const realQuote = 'Responsibilities include deterministic normalization, evidence packaging, and markdown report rendering.';
  const start = snapshot.content.rawText.indexOf(realQuote);
  assert.notEqual(start, -1);

  assert.throws(
    () => validateBoundedEvidence([
      {
        evidenceId: 'ev-mismatch-range',
        fieldPath: 'content.summary',
        quote: realQuote,
        sourceSnapshotId: snapshot.snapshotId,
        sourceKind: snapshot.source.kind,
        locator: {
          strategy: 'char_range',
          start,
          end: start + realQuote.length - 5,
        },
      },
    ], {
      extractedSnapshotId: snapshot.snapshotId,
      sourceKind: snapshot.source.kind,
      extractedSourceText: snapshot.content.rawText,
    }),
    /char_range must resolve exactly to its quote/
  );
});

test('NormalizedJob rejects malformed fallback booleans', () => {
  const snapshot = buildExtractedSnapshot();

  assert.throws(
    () => validateNormalizedJob(buildNormalizedJob(snapshot, {
      normalization: {
        fallback: {
          eligible: 'false',
          used: 0,
          reasons: [],
        },
      },
    })),
    /fallback\.(eligible|used) must be a boolean/
  );
});

test('bounded evidence rejects oversized or overlong evidence payloads', () => {
  const snapshot = buildExtractedSnapshot();

  assert.throws(
    () => validateBoundedEvidence(
      Array.from({ length: MAX_EVIDENCE_ITEMS + 1 }, (_, index) => ({
        evidenceId: `ev-${index}`,
        fieldPath: 'content.summary',
        quote: 'evidence quote',
        sourceSnapshotId: snapshot.snapshotId,
        sourceKind: snapshot.source.kind,
        locator: {
          strategy: 'excerpt',
        },
      })),
      {
        extractedSnapshotId: snapshot.snapshotId,
        sourceKind: snapshot.source.kind,
      }
    ),
    /must not contain more than/
  );

  assert.throws(
    () => validateBoundedEvidence([
      {
        evidenceId: 'ev-long',
        fieldPath: 'content.summary',
        quote: 'x'.repeat(MAX_EVIDENCE_QUOTE_CHARS + 1),
        sourceSnapshotId: snapshot.snapshotId,
        sourceKind: snapshot.source.kind,
        locator: {
          strategy: 'excerpt',
        },
      },
    ], {
      extractedSnapshotId: snapshot.snapshotId,
      sourceKind: snapshot.source.kind,
    }),
    /must not exceed/
  );
});
