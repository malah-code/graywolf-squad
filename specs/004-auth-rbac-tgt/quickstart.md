# Quickstart & Verification Guide: 004-auth-rbac-tgt

## 1. Run Unit & Integration Tests

```bash
pnpm test
```

Expected outcome:
- `tests/unit/rbac.test.ts`: All 4 roles (`viewer`, `developer`, `lead_dev`, `owner`) tested against all 19 actions (`76` role-action matrix evaluations) plus exact ADR-042 error codes (`RBAC_MERGE_NOT_AUTHORIZED`, `RBAC_KEY_MANAGEMENT_DENIED`, `RBAC_COCKPIT_TOOL_FORBIDDEN`, `RBAC_INSUFFICIENT_ROLE`).
- `tests/unit/tgt.test.ts`: Valid single-use consumption (`GETDEL`), replay detection (`AUTH_TGT_ALREADY_USED`), and expiration (`AUTH_TGT_EXPIRED`).
- `tests/integration/auth-invites-seed.test.ts`: First-boot Zero-Config Solo Mode seeding, instant Valkey session revocation (`AUTH_SESSION_REVOKED`), and cryptographic SHA-256 invite creation, redemption, expiration (`AUTH_INVITE_EXPIRED`), exhaustion (`AUTH_INVITE_EXHAUSTED`), and invalid hash rejection (`AUTH_INVITE_INVALID`).

## 2. Run Static Quality Checks

```bash
pnpm typecheck && pnpm lint && pnpm build
```

Expected outcome: 0 TypeScript errors, 0 ESLint warnings, and clean build output.
