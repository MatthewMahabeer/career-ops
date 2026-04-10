import { SOURCE_KINDS } from './schema.mjs';

export const EXTRACTED_SNAPSHOT_CONTRACT_VERSION = 1;
export const NORMALIZED_JOB_CONTRACT_VERSION = 1;

export const UNKNOWN_VALUE_KIND = 'unknown';
export const UNKNOWN_REASONS = [
  'not_found',
  'ambiguous',
  'not_applicable',
  'not_collected',
];

export const NORMALIZATION_STRATEGIES = [
  'deterministic',
  'fallback_model',
];

export const EVIDENCE_LOCATOR_STRATEGIES = [
  'excerpt',
  'char_range',
  'section_hint',
];

export const NORMALIZATION_FALLBACK_REASONS = [
  'missing_core_identity',
  'missing_role_content',
  'insufficient_confidence',
];

export const MAX_EVIDENCE_ITEMS = 24;
export const MAX_EVIDENCE_QUOTE_CHARS = 400;
export const MAX_EVIDENCE_TOTAL_CHARS = 4_000;
export const MIN_EXTRACTED_TEXT_CHARS_FOR_FALLBACK = 120;
export const MIN_NORMALIZATION_OVERALL_CONFIDENCE = 0.5;
export const MIN_CORE_FIELD_CONFIDENCE = 0.6;
export const MIN_SUMMARY_CHARS_FOR_EVALUATION = 24;

function requireObject(fieldName, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }

  return value;
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

function requireNullableString(fieldName, value) {
  if (value === null || value === undefined) {
    return null;
  }

  return requireNonEmptyString(fieldName, value);
}

function requireEnum(fieldName, allowedValues, value) {
  if (!allowedValues.includes(value)) {
    throw new Error(`${fieldName} must be one of: ${allowedValues.join(', ')}`);
  }

  return value;
}

function requireIsoTimestamp(fieldName, value) {
  const normalized = requireNonEmptyString(fieldName, value);
  if (Number.isNaN(Date.parse(normalized))) {
    throw new Error(`${fieldName} must be an ISO timestamp`);
  }

  return normalized;
}

function requireConfidence(fieldName, value) {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 1) {
    throw new Error(`${fieldName} must be a number between 0 and 1`);
  }

  return value;
}

function requireBoolean(fieldName, value) {
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be a boolean`);
  }

  return value;
}

function requireStringArray(fieldName, value, { maxItems = 25 } = {}) {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }

  if (value.length > maxItems) {
    throw new Error(`${fieldName} must not contain more than ${maxItems} items`);
  }

  return value.map((item, index) => requireNonEmptyString(`${fieldName}[${index}]`, item));
}

function requireMeaningfulText(fieldName, value) {
  const normalized = requireNonEmptyString(fieldName, value);
  if (!/[A-Za-z]{2,}/.test(normalized)) {
    throw new Error(`${fieldName} must contain meaningful text`);
  }

  return normalized;
}

export function makeUnknown(reason, note = null) {
  return {
    kind: UNKNOWN_VALUE_KIND,
    reason: requireEnum('unknown reason', UNKNOWN_REASONS, reason),
    note: note === null || note === undefined ? null : requireNonEmptyString('unknown note', note),
  };
}

export function isUnknownValue(value) {
  return Boolean(
    value
      && typeof value === 'object'
      && !Array.isArray(value)
      && value.kind === UNKNOWN_VALUE_KIND
      && UNKNOWN_REASONS.includes(value.reason)
  );
}

export function validateUnknownValue(fieldName, value) {
  const unknownValue = requireObject(fieldName, value);
  if (!isUnknownValue(unknownValue)) {
    throw new Error(`${fieldName} must be an explicit unknown value`);
  }

  return makeUnknown(unknownValue.reason, unknownValue.note ?? null);
}

function validateStringOrUnknown(fieldName, value) {
  if (isUnknownValue(value)) {
    return validateUnknownValue(fieldName, value);
  }

  if (value === null) {
    throw new Error(`${fieldName} must use an explicit unknown value instead of null`);
  }

  return requireNonEmptyString(fieldName, value);
}

function validateStringArrayOrUnknown(fieldName, value, options = {}) {
  if (isUnknownValue(value)) {
    return validateUnknownValue(fieldName, value);
  }

  if (value === null) {
    throw new Error(`${fieldName} must use an explicit unknown value instead of null`);
  }

  return requireStringArray(fieldName, value, options);
}

function validateSourceDescriptor(fieldName, value, { requireUrlForUrlKind } = { requireUrlForUrlKind: false }) {
  const source = requireObject(fieldName, value);
  const kind = requireEnum(`${fieldName}.kind`, SOURCE_KINDS, source.kind);
  const url = requireNullableString(`${fieldName}.url`, source.url ?? null);

  if (kind === 'url') {
    if (!url && requireUrlForUrlKind) {
      throw new Error(`${fieldName}.url is required for url sources`);
    }

    if (url) {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`${fieldName}.url must use http or https`);
      }
    }
  } else if (url !== null) {
    throw new Error(`${fieldName}.url must be null for pasted_text sources`);
  }

  return {
    kind,
    url,
  };
}

export function validateExtractedSnapshot(snapshot) {
  const value = requireObject('ExtractedSnapshot', snapshot);
  if (value.contractType !== 'ExtractedSnapshot') {
    throw new Error('ExtractedSnapshot.contractType must be "ExtractedSnapshot"');
  }

  if (value.contractVersion !== EXTRACTED_SNAPSHOT_CONTRACT_VERSION) {
    throw new Error(`ExtractedSnapshot.contractVersion must be ${EXTRACTED_SNAPSHOT_CONTRACT_VERSION}`);
  }

  const source = validateSourceDescriptor('ExtractedSnapshot.source', value.source, {
    requireUrlForUrlKind: true,
  });
  const extraction = requireObject('ExtractedSnapshot.extraction', value.extraction);
  const content = requireObject('ExtractedSnapshot.content', value.content);

  return {
    contractType: 'ExtractedSnapshot',
    contractVersion: EXTRACTED_SNAPSHOT_CONTRACT_VERSION,
    snapshotId: requireNonEmptyString('ExtractedSnapshot.snapshotId', value.snapshotId),
    source,
    extraction: {
      method: requireNonEmptyString('ExtractedSnapshot.extraction.method', extraction.method),
      extractedAt: requireIsoTimestamp('ExtractedSnapshot.extraction.extractedAt', extraction.extractedAt),
    },
    content: {
      rawText: requireMeaningfulText('ExtractedSnapshot.content.rawText', content.rawText),
      title: requireNullableString('ExtractedSnapshot.content.title', content.title ?? null),
      language: requireNullableString('ExtractedSnapshot.content.language', content.language ?? null),
    },
  };
}

export function validateBoundedEvidence(evidence, {
  extractedSnapshotId = null,
  sourceKind = null,
  extractedSourceText = null,
} = {}) {
  if (!Array.isArray(evidence)) {
    throw new Error('NormalizedJob.evidence must be an array');
  }

  if (evidence.length === 0) {
    throw new Error('NormalizedJob.evidence must contain at least one evidence item');
  }

  if (evidence.length > MAX_EVIDENCE_ITEMS) {
    throw new Error(`NormalizedJob.evidence must not contain more than ${MAX_EVIDENCE_ITEMS} items`);
  }

  let totalQuoteChars = 0;
  const normalizedEvidence = evidence.map((item, index) => {
    const evidenceItem = requireObject(`NormalizedJob.evidence[${index}]`, item);
    const locator = requireObject(`NormalizedJob.evidence[${index}].locator`, evidenceItem.locator);
    const locatorStrategy = requireEnum(
      `NormalizedJob.evidence[${index}].locator.strategy`,
      EVIDENCE_LOCATOR_STRATEGIES,
      locator.strategy
    );
    const quote = requireNonEmptyString(`NormalizedJob.evidence[${index}].quote`, evidenceItem.quote);
    if (quote.length > MAX_EVIDENCE_QUOTE_CHARS) {
      throw new Error(
        `NormalizedJob.evidence[${index}].quote must not exceed ${MAX_EVIDENCE_QUOTE_CHARS} characters`
      );
    }

    totalQuoteChars += quote.length;
    const sourceSnapshotId = requireNonEmptyString(
      `NormalizedJob.evidence[${index}].sourceSnapshotId`,
      evidenceItem.sourceSnapshotId
    );
    const evidenceSourceKind = requireEnum(
      `NormalizedJob.evidence[${index}].sourceKind`,
      SOURCE_KINDS,
      evidenceItem.sourceKind
    );
    if (extractedSnapshotId && sourceSnapshotId !== extractedSnapshotId) {
      throw new Error(
        `NormalizedJob.evidence[${index}].sourceSnapshotId must match extractedSnapshotId`
      );
    }

    if (sourceKind && evidenceSourceKind !== sourceKind) {
      throw new Error(`NormalizedJob.evidence[${index}].sourceKind must match NormalizedJob.source.kind`);
    }

    if (extractedSourceText !== null && !extractedSourceText.includes(quote)) {
      throw new Error(
        `NormalizedJob.evidence[${index}].quote must be present in ExtractedSnapshot.content.rawText`
      );
    }

    let normalizedLocator;
    if (locatorStrategy === 'char_range') {
      if (!Number.isInteger(locator.start) || locator.start < 0) {
        throw new Error(`NormalizedJob.evidence[${index}].locator.start must be a non-negative integer`);
      }

      if (!Number.isInteger(locator.end) || locator.end <= locator.start) {
        throw new Error(`NormalizedJob.evidence[${index}].locator.end must be greater than locator.start`);
      }

      if (extractedSourceText !== null) {
        if (locator.end > extractedSourceText.length) {
          throw new Error(
            `NormalizedJob.evidence[${index}].locator.end must not exceed ExtractedSnapshot.content.rawText length`
          );
        }

        if (extractedSourceText.slice(locator.start, locator.end) !== quote) {
          throw new Error(
            `NormalizedJob.evidence[${index}] char_range must resolve exactly to its quote`
          );
        }
      }

      normalizedLocator = {
        strategy: locatorStrategy,
        start: locator.start,
        end: locator.end,
        section: null,
      };
    } else if (locatorStrategy === 'section_hint') {
      normalizedLocator = {
        strategy: locatorStrategy,
        start: null,
        end: null,
        section: requireNonEmptyString(
          `NormalizedJob.evidence[${index}].locator.section`,
          locator.section
        ),
      };
    } else {
      normalizedLocator = {
        strategy: locatorStrategy,
        start: null,
        end: null,
        section: requireNullableString(
          `NormalizedJob.evidence[${index}].locator.section`,
          locator.section ?? null
        ),
      };
    }

    return {
      evidenceId: requireNonEmptyString(`NormalizedJob.evidence[${index}].evidenceId`, evidenceItem.evidenceId),
      fieldPath: requireNonEmptyString(`NormalizedJob.evidence[${index}].fieldPath`, evidenceItem.fieldPath),
      quote,
      sourceSnapshotId,
      sourceKind: evidenceSourceKind,
      locator: normalizedLocator,
    };
  });

  if (totalQuoteChars > MAX_EVIDENCE_TOTAL_CHARS) {
    throw new Error(
      `NormalizedJob.evidence total quoted text must not exceed ${MAX_EVIDENCE_TOTAL_CHARS} characters`
    );
  }

  return normalizedEvidence;
}

function validateFieldConfidenceMap(fieldConfidenceMap) {
  const value = requireObject('NormalizedJob.normalization.confidence.fields', fieldConfidenceMap);
  const entries = Object.entries(value);
  if (entries.length === 0) {
    throw new Error('NormalizedJob.normalization.confidence.fields must include at least one field confidence');
  }

  return Object.fromEntries(entries.map(([fieldPath, confidence]) => ([
    requireNonEmptyString('NormalizedJob.normalization.confidence.fields key', fieldPath),
    requireConfidence(`NormalizedJob.normalization.confidence.fields.${fieldPath}`, confidence),
  ])));
}

export function validateNormalizedJob(normalizedJob) {
  const value = requireObject('NormalizedJob', normalizedJob);
  if (value.contractType !== 'NormalizedJob') {
    throw new Error('NormalizedJob.contractType must be "NormalizedJob"');
  }

  if (value.contractVersion !== NORMALIZED_JOB_CONTRACT_VERSION) {
    throw new Error(`NormalizedJob.contractVersion must be ${NORMALIZED_JOB_CONTRACT_VERSION}`);
  }

  const source = validateSourceDescriptor('NormalizedJob.source', value.source, {
    requireUrlForUrlKind: true,
  });
  const normalization = requireObject('NormalizedJob.normalization', value.normalization);
  const identity = requireObject('NormalizedJob.identity', value.identity);
  const classification = requireObject('NormalizedJob.classification', value.classification);
  const content = requireObject('NormalizedJob.content', value.content);
  const fallback = requireObject('NormalizedJob.normalization.fallback', normalization.fallback);

  const strategy = requireEnum(
    'NormalizedJob.normalization.strategy',
    NORMALIZATION_STRATEGIES,
    normalization.strategy
  );
  const normalizedFallback = {
    eligible: requireBoolean('NormalizedJob.normalization.fallback.eligible', fallback.eligible),
    used: requireBoolean('NormalizedJob.normalization.fallback.used', fallback.used),
    reasons: requireStringArray('NormalizedJob.normalization.fallback.reasons', fallback.reasons ?? [], {
      maxItems: NORMALIZATION_FALLBACK_REASONS.length,
    }).map((reason) => requireEnum(
      'NormalizedJob.normalization.fallback.reasons[]',
      NORMALIZATION_FALLBACK_REASONS,
      reason
    )),
  };

  if (strategy === 'deterministic' && normalizedFallback.used) {
    throw new Error('NormalizedJob.normalization.strategy "deterministic" cannot mark fallback.used=true');
  }

  if (strategy === 'fallback_model' && !normalizedFallback.used) {
    throw new Error('NormalizedJob.normalization.strategy "fallback_model" requires fallback.used=true');
  }

  if (normalizedFallback.used && !normalizedFallback.eligible) {
    throw new Error('NormalizedJob.normalization.fallback.used=true requires fallback.eligible=true');
  }

  if ((normalizedFallback.eligible || normalizedFallback.used) && normalizedFallback.reasons.length === 0) {
    throw new Error('NormalizedJob.normalization.fallback requires at least one reason when eligible or used');
  }

  if (!normalizedFallback.eligible && !normalizedFallback.used && normalizedFallback.reasons.length > 0) {
    throw new Error('NormalizedJob.normalization.fallback reasons require fallback eligibility or usage');
  }

  const extractedSnapshotId = requireNonEmptyString(
    'NormalizedJob.extractedSnapshotId',
    value.extractedSnapshotId
  );
  const evidence = validateBoundedEvidence(value.evidence, {
    extractedSnapshotId,
    sourceKind: source.kind,
  });

  return {
    contractType: 'NormalizedJob',
    contractVersion: NORMALIZED_JOB_CONTRACT_VERSION,
    extractedSnapshotId,
    source,
    normalization: {
      strategy,
      normalizedAt: requireIsoTimestamp(
        'NormalizedJob.normalization.normalizedAt',
        normalization.normalizedAt
      ),
      confidence: {
        overall: requireConfidence(
          'NormalizedJob.normalization.confidence.overall',
          normalization.confidence?.overall
        ),
        fields: validateFieldConfidenceMap(normalization.confidence?.fields),
      },
      fallback: normalizedFallback,
    },
    identity: {
      companyName: validateStringOrUnknown('NormalizedJob.identity.companyName', identity.companyName),
      roleTitle: validateStringOrUnknown('NormalizedJob.identity.roleTitle', identity.roleTitle),
    },
    classification: {
      archetype: validateStringOrUnknown('NormalizedJob.classification.archetype', classification.archetype),
      domain: validateStringOrUnknown('NormalizedJob.classification.domain', classification.domain),
      function: validateStringOrUnknown('NormalizedJob.classification.function', classification.function),
      seniority: validateStringOrUnknown('NormalizedJob.classification.seniority', classification.seniority),
      remote: validateStringOrUnknown('NormalizedJob.classification.remote', classification.remote),
      location: validateStringOrUnknown('NormalizedJob.classification.location', classification.location),
      employmentType: validateStringOrUnknown(
        'NormalizedJob.classification.employmentType',
        classification.employmentType
      ),
      teamSize: validateStringOrUnknown('NormalizedJob.classification.teamSize', classification.teamSize),
      compensation: validateStringOrUnknown(
        'NormalizedJob.classification.compensation',
        classification.compensation
      ),
    },
    content: {
      summary: validateStringOrUnknown('NormalizedJob.content.summary', content.summary),
      responsibilities: validateStringArrayOrUnknown(
        'NormalizedJob.content.responsibilities',
        content.responsibilities
      ),
      requirementsMust: validateStringArrayOrUnknown(
        'NormalizedJob.content.requirementsMust',
        content.requirementsMust
      ),
      requirementsNice: validateStringArrayOrUnknown(
        'NormalizedJob.content.requirementsNice',
        content.requirementsNice
      ),
      technologies: validateStringArrayOrUnknown('NormalizedJob.content.technologies', content.technologies),
    },
    evidence,
  };
}

function knownString(value) {
  return typeof value === 'string' ? value : null;
}

function knownStringArray(value) {
  return Array.isArray(value) ? value : null;
}

export function assessNormalizedJobForEvaluation(normalizedJob) {
  const value = validateNormalizedJob(normalizedJob);
  const missingCoreFields = [];
  const lowConfidenceFields = [];
  const reasons = [];

  if (!knownString(value.identity.companyName)) {
    missingCoreFields.push('identity.companyName');
  }

  if (!knownString(value.identity.roleTitle)) {
    missingCoreFields.push('identity.roleTitle');
  }

  const contentSignals = {
    summary: Boolean(
      knownString(value.content.summary)
        && value.content.summary.length >= MIN_SUMMARY_CHARS_FOR_EVALUATION
    ),
    responsibilities: (knownStringArray(value.content.responsibilities) ?? []).length,
    requirementsMust: (knownStringArray(value.content.requirementsMust) ?? []).length,
  };

  if (!contentSignals.summary && contentSignals.responsibilities === 0 && contentSignals.requirementsMust === 0) {
    reasons.push('missing_role_content');
  }

  if (value.normalization.confidence.overall < MIN_NORMALIZATION_OVERALL_CONFIDENCE) {
    lowConfidenceFields.push('normalization.confidence.overall');
  }

  const companyConfidence = value.normalization.confidence.fields['identity.companyName'];
  if (
    knownString(value.identity.companyName)
    && (companyConfidence === undefined || companyConfidence < MIN_CORE_FIELD_CONFIDENCE)
  ) {
    lowConfidenceFields.push('identity.companyName');
  }

  const roleTitleConfidence = value.normalization.confidence.fields['identity.roleTitle'];
  if (
    knownString(value.identity.roleTitle)
    && (roleTitleConfidence === undefined || roleTitleConfidence < MIN_CORE_FIELD_CONFIDENCE)
  ) {
    lowConfidenceFields.push('identity.roleTitle');
  }

  if (missingCoreFields.length > 0) {
    reasons.push('missing_core_identity');
  }

  if (lowConfidenceFields.length > 0) {
    reasons.push('insufficient_confidence');
  }

  const accepted = missingCoreFields.length === 0 && lowConfidenceFields.length === 0 && reasons.length === 0;
  return {
    accepted,
    missingCoreFields,
    lowConfidenceFields,
    reasons: [...new Set(reasons)],
    contentSignals,
  };
}

export function assertExtractedSnapshotMatchesJobSource(extractedSnapshot, {
  sourceKind,
  sourceValue,
}) {
  const snapshot = validateExtractedSnapshot(extractedSnapshot);
  if (snapshot.source.kind !== sourceKind) {
    throw new Error('ExtractedSnapshot.source.kind must match the job source kind');
  }

  if (sourceKind === 'url' && snapshot.source.url !== sourceValue) {
    throw new Error('ExtractedSnapshot.source.url must match the job source value');
  }

  if (sourceKind === 'pasted_text' && snapshot.content.rawText.trim() !== sourceValue) {
    throw new Error('ExtractedSnapshot.content.rawText must match the queued pasted_text source');
  }

  return snapshot;
}

export function assertNormalizedJobMatchesExtractedSnapshot(normalizedJob, extractedSnapshot) {
  const job = validateNormalizedJob(normalizedJob);
  const snapshot = validateExtractedSnapshot(extractedSnapshot);

  if (job.extractedSnapshotId !== snapshot.snapshotId) {
    throw new Error('NormalizedJob.extractedSnapshotId must match ExtractedSnapshot.snapshotId');
  }

  if (job.source.kind !== snapshot.source.kind) {
    throw new Error('NormalizedJob.source.kind must match ExtractedSnapshot.source.kind');
  }

  if (job.source.url !== snapshot.source.url) {
    throw new Error('NormalizedJob.source.url must match ExtractedSnapshot.source.url');
  }

  return {
    ...job,
    evidence: validateBoundedEvidence(job.evidence, {
      extractedSnapshotId: snapshot.snapshotId,
      sourceKind: snapshot.source.kind,
      extractedSourceText: snapshot.content.rawText,
    }),
  };
}

export function assessNormalizationFallback({ extractedSnapshot, normalizedJob }) {
  const snapshot = validateExtractedSnapshot(extractedSnapshot);
  const job = validateNormalizedJob(normalizedJob);
  const readiness = assessNormalizedJobForEvaluation(job);

  if (readiness.accepted) {
    return {
      decision: 'not_needed',
      eligible: false,
      reasons: [],
    };
  }

  if (job.normalization.fallback.used) {
    return {
      decision: 'already_used',
      eligible: false,
      reasons: ['fallback_already_used'],
    };
  }

  if (snapshot.content.rawText.length < MIN_EXTRACTED_TEXT_CHARS_FOR_FALLBACK) {
    return {
      decision: 'reject',
      eligible: false,
      reasons: ['source_text_too_short'],
    };
  }

  return {
    decision: 'eligible',
    eligible: true,
    reasons: readiness.reasons,
  };
}
