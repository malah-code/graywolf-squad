import { CalibrationResult } from './confidence-calibration';

/**
 * 7-Section 60-Second Executive Review Packet Builder (Task 11.3a, PRD §8.4, FR-003, SC-003).
 *
 * Generates the standardized 7-section Pull Request Markdown review packet:
 *  1. 10-Second Executive Summary (DecisionGate Risk + Data Residency + Calibrated Confidence)
 *  2. Quality Gate Compliance Table (Clean-Code, Test, Doc, In-Container Review)
 *  3. Dual-Axis Review Matrix (Standards Axis vs. Spec Axis, ADR-083)
 *  4. Docs-Guard AST Symbol Verification Badge
 *  5. Browser Smoke Test Findings Table (e2e explore, ADR-076)
 *  6. Visual Proof Artifacts with [CACHED] vs [LIVE] indicators (ADR-077)
 *  7. Deterministic AST Semantic Diff Summary & Scoped File Diff Breakdown
 */

export type ModelDataResidencyTier =
  | 'tier-1-local-only'
  | 'tier-2-zero-retention-cloud'
  | 'tier-3-standard-commercial-api';

export interface ExecutiveReviewPacketInput {
  taskId: string;
  title: string;
  executiveSummary: string;
  decisionGateRisk: 'low' | 'medium' | 'high' | 'critical';
  providersUsed: string[];
  dataResidencyTier?: ModelDataResidencyTier;
  calibration: CalibrationResult;
  guardCompliance: {
    cleanCodePassed: boolean;
    testGuardPassed: boolean;
    docGuardPassed: boolean;
    inContainerReviewPassed: boolean;
  };
  dualAxisMatrix: {
    standardsAxisSummary: string;
    specAxisSummary: string;
    agreedP2Advisories?: string[];
  };
  docsGuardVerifiedSymbols: string[];
  browserSmokeFindings?: Array<{ route: string; status: 'pass' | 'fail'; note: string }>;
  visualProofArtifacts?: Array<{ label: string; pathOrUrl: string; mode: 'cached' | 'live' }>;
  semanticDiffSummary: string[];
  scopedFileDiffs: Array<{
    filePath: string;
    scope: 'writable' | 'readonly';
    additions: number;
    deletions: number;
  }>;
}

const LOCAL_PROVIDERS = new Set(['ollama', 'vllm', 'llamacpp', 'local']);

export function resolveDataResidencyTier(providersUsed: string[]): ModelDataResidencyTier {
  if (providersUsed.length === 0) return 'tier-1-local-only';

  const allLocal = providersUsed.every(
    (p) => LOCAL_PROVIDERS.has(p.toLowerCase()) || p.startsWith('cli-subscription-')
  );
  if (allLocal) return 'tier-1-local-only';

  const hasZdr = providersUsed.some((p) => {
    const lower = p.toLowerCase();
    return lower.includes('zdr') || lower.includes('zero-retention') || lower.includes('azure-openai');
  });
  if (hasZdr) return 'tier-2-zero-retention-cloud';

  return 'tier-3-standard-commercial-api';
}

function renderResidencyBadge(tier: ModelDataResidencyTier): string {
  switch (tier) {
    case 'tier-1-local-only':
      return '`🔒 Data Residency: Tier 1 (Local-Only — 100% Offline, $0 License)`';
    case 'tier-2-zero-retention-cloud':
      return '`🛡️ Data Residency: Tier 2 (Enterprise Zero-Data-Retention Cloud)`';
    case 'tier-3-standard-commercial-api':
    default:
      return '`🌐 Data Residency: Tier 3 (Standard Commercial Cloud API)`';
  }
}

function renderRiskBadge(risk: 'low' | 'medium' | 'high' | 'critical'): string {
  const icon = risk === 'low' ? '🟢' : risk === 'medium' ? '🟡' : '🔴';
  return `\`${icon} DecisionGate Risk: ${risk.toUpperCase()}\``;
}

function renderConfidenceBadge(cal: CalibrationResult): string {
  if (cal.isCalibrated) {
    const sign = cal.delta >= 0 ? '+' : '';
    return `\`🎯 Calibrated Confidence: ${cal.calibratedConfidence.toFixed(3)} (Raw: ${cal.rawConfidence.toFixed(3)}, Δ: ${sign}${cal.delta.toFixed(3)}, n=${cal.sampleCount})\``;
  }
  return `\`🎯 Confidence: ${cal.rawConfidence.toFixed(3)} (Unadjusted — n=${cal.sampleCount} < 30 sample threshold)\``;
}

export function buildExecutiveReviewPacket(input: ExecutiveReviewPacketInput): {
  residencyTier: ModelDataResidencyTier;
  markdown: string;
} {
  const residencyTier = input.dataResidencyTier ?? resolveDataResidencyTier(input.providersUsed);

  const sections: string[] = [];

  // Section 1: 10-Second Executive Summary
  sections.push(
    `# 60-Second Executive Review Packet: ${input.taskId}`,
    '',
    `## 1. 10-Second Executive Summary`,
    '',
    `**Title**: ${input.title}`,
    '',
    `${input.executiveSummary.trim()}`,
    '',
    `${renderRiskBadge(input.decisionGateRisk)} · ${renderResidencyBadge(residencyTier)} · ${renderConfidenceBadge(input.calibration)}`,
    ''
  );

  // Section 2: Quality Gate Compliance Table
  const statusIcon = (passed: boolean) => (passed ? '✅ PASS' : '❌ FAIL');
  sections.push(
    `## 2. Quality Gate Compliance Table`,
    '',
    `| Quality Gate | Type | Status | Requirement |`,
    `|---|---|---|---|`,
    `| In-Container Review Signoff | Cognitive Handoff | ${statusIcon(input.guardCompliance.inContainerReviewPassed)} | review-signoff.md emitted |`,
    `| Clean-Code Guard | Deterministic AST | ${statusIcon(input.guardCompliance.cleanCodePassed)} | No empty catch, floating promise, zombie code, F14 allowlist |`,
    `| Test Guard | Deterministic AST / Ledger | ${statusIcon(input.guardCompliance.testGuardPassed)} | No internal mocks, >= 1 passing test execution in evidence ledger |`,
    `| Documentation Guard | Deterministic AST | ${statusIcon(input.guardCompliance.docGuardPassed)} | process.env & symbol sync with .env.example and code |`,
    ''
  );

  // Section 3: Dual-Axis Review Matrix (Standards Axis vs. Spec Axis)
  const advisories =
    input.dualAxisMatrix.agreedP2Advisories && input.dualAxisMatrix.agreedP2Advisories.length > 0
      ? input.dualAxisMatrix.agreedP2Advisories.map((a) => `- _Advisory_: ${a}`).join('\n')
      : '_None — zero non-blocking advisories._';

  sections.push(
    `## 3. Dual-Axis Review Matrix (Standards Axis vs. Spec Axis)`,
    '',
    `### Standards Axis (Code Health & Architecture Standards)`,
    `${input.dualAxisMatrix.standardsAxisSummary.trim()}`,
    '',
    `### Spec Axis (Functional Acceptance Criteria)`,
    `${input.dualAxisMatrix.specAxisSummary.trim()}`,
    '',
    `### Agreed P2 Non-Blocking Advisories`,
    `${advisories}`,
    ''
  );

  // Section 4: Docs-Guard AST Symbol Verification Badge
  const symbols =
    input.docsGuardVerifiedSymbols.length > 0
      ? input.docsGuardVerifiedSymbols.map((s) => `\`${s}\``).join(', ')
      : '_No public symbols modified._';
  sections.push(
    `## 4. Docs-Guard AST Symbol Verification Badge`,
    '',
    `✅ **Verified Public Symbols**: ${symbols}`,
    '',
    `_Every exported symbol, CLI flag, and environment variable documented in this PR was verified against the AST of the proposed patch diff._`,
    ''
  );

  // Section 5: Browser Smoke Test Findings Table
  const smokeRows =
    input.browserSmokeFindings && input.browserSmokeFindings.length > 0
      ? input.browserSmokeFindings
          .map((f) => `| \`${f.route}\` | ${f.status === 'pass' ? '✅ PASS' : '❌ FAIL'} | ${f.note} |`)
          .join('\n')
      : '| N/A (Backend / Non-UI Task) | ✅ PASS | Zero browser smoke test required |';

  sections.push(
    `## 5. Browser Smoke Test Findings Table (e2e explore)`,
    '',
    `| Route / View | Status | Notes |`,
    `|---|---|---|`,
    smokeRows,
    ''
  );

  // Section 6: Visual Proof Artifacts
  const visualRows =
    input.visualProofArtifacts && input.visualProofArtifacts.length > 0
      ? input.visualProofArtifacts
          .map((a) => `- **${a.label}** (${a.mode === 'cached' ? '`⚡ CACHED REPLAY (0 tokens)`' : '`🔴 LIVE TURN`'}): [View Artifact](${a.pathOrUrl})`)
          .join('\n')
      : '_No visual UI proof artifacts required for this task._';

  sections.push(
    `## 6. Visual Proof Artifacts`,
    '',
    visualRows,
    ''
  );

  // Section 7: Deterministic AST Semantic Diff Summary & Scoped File Diff Breakdown
  const diffBullets =
    input.semanticDiffSummary.length > 0
      ? input.semanticDiffSummary.map((b) => `- ${b}`).join('\n')
      : '- Patch applies cleanly without semantic drift.';

  const fileRows = input.scopedFileDiffs
    .map(
      (f) =>
        `| \`${f.filePath}\` | \`${f.scope}\` | +${f.additions} | -${f.deletions} |`
    )
    .join('\n');

  sections.push(
    `## 7. Deterministic AST Semantic Diff Summary & Scoped File Diff Breakdown`,
    '',
    `### Semantic Changes`,
    diffBullets,
    '',
    `### Scoped File Touches (Blast-Radius Check)`,
    `| File Path | Scope Tier | Additions | Deletions |`,
    `|---|---|---|---|`,
    fileRows,
    ''
  );

  return {
    residencyTier,
    markdown: sections.join('\n'),
  };
}
