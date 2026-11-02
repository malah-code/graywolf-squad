# Auth, Invite, RBAC & TGT Contracts: 004-auth-rbac-tgt

## 1. Zero-Config Solo Seeder (`src/orchestrator/auth/solo-seed.ts`)
- `seedSoloWorkspaceIfEmpty(): Promise<SoloSeedResult>`

## 2. Better-Auth Valkey Session Store (`src/orchestrator/auth/better-auth.ts`)
- `createSession(input: CreateSessionInput): Promise<SessionData>`
- `verifySession(sessionId?: string): Promise<SessionData>`
- `revokeUserSessions(userId: string): Promise<number>`
- `revokeSession(sessionId: string): Promise<void>`

## 3. Cryptographic Workspace Invites (`src/orchestrator/auth/invites.ts`)
- `createWorkspaceInvite(input: CreateWorkspaceInviteInput): Promise<CreatedWorkspaceInvite>`
- `redeemWorkspaceInvite(input: RedeemWorkspaceInviteInput): Promise<RedeemedWorkspaceInvite>`

## 4. Casbin RBAC Enforcer (`src/orchestrator/auth/rbac.ts`)
- `checkPermission(role: WorkspaceRole, action: RbacAction): Promise<boolean>`
- `enforcePermission(role: WorkspaceRole, action: RbacAction, opts?: { isCockpitTool?: boolean }): Promise<void>`
- `requirePermission(action: RbacAction): preHandlerAsyncHookHandler`

## 5. Single-Use WebSocket TGT (`src/orchestrator/auth/tgt.ts`)
- `mintWsTicket(input: MintWsTicketInput): Promise<MintedWsTicket>`
- `consumeWsTicket(ticket: string): Promise<WsTicketPayload>`
