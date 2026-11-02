/**
 * Shared deterministic guard result contracts (contracts/guards-and-decision-gate.md §2).
 * Used by `clean-code-guard.ts`, `test-guard.ts`, and `doc-guard.ts`.
 */

export interface GuardCheckViolation {
  /** ADR-042-styled rule code, e.g. `GUARD_TEST_FAILED:vacuous-test`. */
  rule: string;
  filePath?: string;
  line?: number;
  message: string;
}

export interface SingleGuardCheck {
  label: string;
  passed: boolean;
}

export interface SingleGuardResult {
  guard: 'clean-code' | 'test' | 'doc';
  passed: boolean;
  checks: SingleGuardCheck[];
  violations: GuardCheckViolation[];
}
