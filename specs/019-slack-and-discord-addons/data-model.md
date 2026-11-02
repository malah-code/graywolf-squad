# Phase 1 Data Model: Expanded First-Party Addons (`019-slack-and-discord-addons`)

## 1. `@graywolf/addon-slack-cockpit` Entities (`src/orchestrator/addons/builtin/slack-cockpit.ts`)

### 1.1 `SlackInteractionPayloadSchema` (Union of Normalized & Native Block Kit Action)

```ts
// Variant A: Normalized Cockpit Interaction
{
  externalMessageId: string; // minLength: 1
  intentText: string;        // minLength: 1 (e.g. "/approve TASK-101")
  actorExternalId: string;   // minLength: 1 (Slack user ID e.g. "U012AB3CD")
}

// Variant B: Native Slack Block Actions Payload
{
  type: 'block_actions';
  user: { id: string; username?: string };
  container?: { message_ts?: string };
  message?: { ts?: string };
  actions: Array<{
    action_id: string;
    value: string; // e.g. "approve TASK-101"
  }>;
}
```

### 1.2 `SlackBlockKitMessage` Output Structure

```ts
export interface SlackBlockKitMessage {
  text: string;
  blocks: Array<
    | { type: 'header'; text: { type: 'plain_text'; text: string; emoji: boolean } }
    | { type: 'section'; text: { type: 'mrkdwn'; text: string } }
    | {
        type: 'actions';
        elements: Array<{
          type: 'button';
          text: { type: 'plain_text'; text: string };
          style?: 'primary' | 'danger';
          action_id: string;
          value: string;
        }>;
      }
  >;
}
```

---

## 2. `@graywolf/addon-discord-signal` Entities (`src/orchestrator/addons/builtin/discord-signal.ts`)

### 2.1 `DiscordSignalWebhookPayloadSchema`

| Field | Type | Validation / Constraint |
|---|---|---|
| `channelId` | `string` | `minLength: 1` (Discord channel snowflake ID) |
| `messageId` | `string` | `minLength: 1` (Discord message snowflake ID) |
| `threadId` | `string` (optional) | Optional thread snowflake ID (used for thread-level deduplication) |
| `title` | `string` (optional) | Thread title or summary (fallback: first 120 chars of `content`) |
| `content` | `string` | `minLength: 1` (Untrusted community message / stack trace body) |
| `author` | `{ id: string; username: string }` | Discord author identity |
| `kind` | `'crash' \| 'bug' \| 'community_feedback'` (optional) | Defaults to `'crash'` if content matches crash/exception keywords, else `'bug'` |
| `severity` | `'critical' \| 'high' \| 'medium' \| 'low'` (optional) | Defaults to `'high'` for crashes, `'medium'` for bugs |
| `messageUrl` | `string` (optional) | Optional permalink to Discord message |
| `timestamp` | `string` (optional) | ISO-8601 timestamp |

---

## 3. `@graywolf/addon-msteams-cockpit` Entities (`src/orchestrator/addons/builtin/msteams-cockpit.ts`)

### 3.1 `MsTeamsInteractionPayloadSchema` (Union of Normalized & Adaptive Card `Action.Submit`)

```ts
// Variant A: Normalized Cockpit Interaction
{
  externalMessageId: string; // minLength: 1
  intentText: string;        // minLength: 1
  actorExternalId: string;   // minLength: 1 (Azure AD / Teams user ID)
}

// Variant B: MS Teams Adaptive Card Action.Submit Invoke
{
  id: string;                // Message / activity ID
  from: { id: string; aadObjectId?: string; name?: string };
  value: {
    intentText: string;      // e.g. "approve TASK-101"
    taskId?: string;
  };
}
```

### 3.2 `MsTeamsAdaptiveCard` Output Structure

```ts
export interface MsTeamsAdaptiveCard {
  $schema: 'http://adaptivecards.io/schemas/adaptive-card.json';
  type: 'AdaptiveCard';
  version: '1.5';
  body: Array<{
    type: 'TextBlock';
    text: string;
    weight?: 'Bolder';
    size?: 'Large' | 'Medium';
    wrap: boolean;
  }>;
  actions: Array<{
    type: 'Action.Submit';
    title: string;
    data: { intentText: string; taskId: string };
  }>;
}
```

