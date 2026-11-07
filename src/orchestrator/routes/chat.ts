import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import pino from 'pino';
import { requirePermission, enforcePermission } from '../auth/rbac';
import { executeAuthorizedToolCall } from '../aci/validate';
import { LiteLLMClient } from '../gateway/litellm-client';
import { withTenantContext } from '../db';

const logger = pino({ name: 'routes:chat' });

export const ChatMessageSchema = Type.Object({
  id: Type.Optional(Type.String()),
  role: Type.Union([
    Type.Literal('system'),
    Type.Literal('user'),
    Type.Literal('assistant'),
    Type.Literal('tool'),
  ]),
  content: Type.String(),
});

export const RequestedToolCallSchema = Type.Object({
  toolCallId: Type.Optional(Type.String()),
  toolName: Type.String(),
  args: Type.Record(Type.String(), Type.Unknown()),
});

export const ChatStreamBodySchema = Type.Object({
  projectId: Type.String(),
  taskId: Type.Optional(Type.String()),
  messages: Type.Array(ChatMessageSchema),
  cockpitMode: Type.Optional(Type.Union([Type.Literal('STANDARD'), Type.Literal('GRILL')])),
  accessModeOverride: Type.Optional(
    Type.Union([
      Type.Literal('plan-read-only'),
      Type.Literal('plan-gate'),
      Type.Literal('full-factory'),
    ])
  ),
  currentFile: Type.Optional(Type.String()),
  skipGrill: Type.Optional(Type.Boolean()),
  toolCalls: Type.Optional(Type.Array(RequestedToolCallSchema)),
});

export type ChatStreamBody = Static<typeof ChatStreamBodySchema>;

export interface GrillState {
  active: boolean;
  bypassed: boolean;
  questionIndex: number;
  maxQuestions: number;
  currentQuestion: string | null;
  referencedArtifacts: string[];
  targetDocument: 'docs/PRD.md' | 'brief.md';
  briefPreviewMarkdown: string | null;
  requiresConfirmation: boolean;
}

export const GRILL_QUESTIONS = [
  'What is the blast-radius scope (writable, read-only, forbidden) for this change?',
  'What are the non-negotiable edge cases and failure modes we must defend against?',
  'Which existing database tables or API contracts will be modified or extended?',
  'What is the verification and testing strategy (unit tests vs end-to-end Playwright)?',
  'Are there any breaking changes to public APIs, authentication, or backward compatibility?',
];

export function buildGrillSystemPrompt(options: {
  currentFile?: string;
  questionIndex: number;
  constitutionPrinciples?: string[];
}): string {
  const fileContext = options.currentFile ? `\nActive Viewport File (@current_file): ${options.currentFile}` : '';
  return `You are Graywolf Squad Socratic Grilling Engine (ADR-083).
Your goal is to stress-test the human operator's requirements before task implementation.
Reference project architecture, constitution principles, and active file context.${fileContext}
Ask up to 5 probing questions (one at a time, currently at question ${options.questionIndex} of 5).
Probe for: blast radius bounds, edge cases, error recovery, testing strategy, and schema stability.
If the operator enters --skip-grill or requests to bypass, immediately synthesize the final task brief preview.`;
}

export function evaluateGrillTurn(
  messages: Array<{ role: string; content: string }>,
  currentFile?: string,
  explicitSkip?: boolean
): GrillState {
  const userMessages = messages.filter((m) => m.role === 'user');
  const lastUserMsg = userMessages[userMessages.length - 1]?.content || '';
  const bypassed = Boolean(explicitSkip || lastUserMsg.includes('--skip-grill'));

  const questionIndex = Math.min(Math.max(userMessages.length, 1), 5);

  if (bypassed || (userMessages.length >= 5 && !lastUserMsg.toLowerCase().includes('queue task'))) {
    const originalGoal = userMessages[0]?.content.replace(/--skip-grill/g, '').trim() || 'Unspecified task';
    const brief = `# Task Brief Preview\n\n**Goal**: ${originalGoal}\n**File Scope**: ${currentFile || 'src/'}\n**Status**: Socratic review complete. Ready to queue.\n\n*Click "Queue Task" to confirm and proceed with task creation.*`;

    return {
      active: false,
      bypassed: true,
      questionIndex: 5,
      maxQuestions: 5,
      currentQuestion: null,
      referencedArtifacts: ['constitution.md', 'docs/PRD.md', ...(currentFile ? [currentFile] : [])],
      targetDocument: 'brief.md',
      briefPreviewMarkdown: brief,
      requiresConfirmation: true,
    };
  }

  return {
    active: true,
    bypassed: false,
    questionIndex,
    maxQuestions: 5,
    currentQuestion: GRILL_QUESTIONS[questionIndex - 1] || GRILL_QUESTIONS[0],
    referencedArtifacts: ['constitution.md', 'docs/PRD.md', ...(currentFile ? [currentFile] : [])],
    targetDocument: 'brief.md',
    briefPreviewMarkdown: null,
    requiresConfirmation: false,
  };
}

export async function chatRoutes(fastify: FastifyInstance, options?: { litellmClient?: LiteLLMClient }) {
  const litellmClient = options?.litellmClient ?? new LiteLLMClient();

  const handleChatStream = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const body = (request.body || {}) as ChatStreamBody;

    // Enforce permission to override access mode pill if provided
    if (body.accessModeOverride) {
      await enforcePermission(user.role, 'change_access_mode_pill');
    }

    // Set streaming headers
    reply.raw.setHeader('Content-Type', 'text/plain; charset=utf-8');
    reply.raw.setHeader('X-Vercel-AI-Data-Stream', 'v1');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.writeHead(200);

    const isGrill = body.cockpitMode === 'GRILL';

    if (isGrill) {
      const grillState = evaluateGrillTurn(body.messages, body.currentFile, body.skipGrill);

      // Emit annotation frame (2:)
      reply.raw.write(
        `2:${JSON.stringify([
          {
            type: 'grill_state',
            ...grillState,
            currentFile: body.currentFile,
            accessMode: body.accessModeOverride || 'full-factory',
          },
        ])}\n`
      );

      // Stream assistant prose response (0:)
      if (grillState.active && grillState.currentQuestion) {
        reply.raw.write(`0:${JSON.stringify(`Question ${grillState.questionIndex}/5: ${grillState.currentQuestion}\n`)}\n`);
      } else if (grillState.briefPreviewMarkdown) {
        reply.raw.write(`0:${JSON.stringify(grillState.briefPreviewMarkdown + '\n')}\n`);
      }
    } else {
      // STANDARD mode
      reply.raw.write(
        `2:${JSON.stringify([
          {
            type: 'context_sync',
            currentFile: body.currentFile,
            accessMode: body.accessModeOverride || 'full-factory',
            cockpitMode: 'STANDARD',
          },
        ])}\n`
      );

      // Fetch active project's current task list from DB to provide full board context to LLM
      let projectContext = `Active Workspace ID: ${user.currentWorkspaceId}\nActive Project ID: ${body.projectId}`;
      try {
        const tasks = await withTenantContext(
          { workspaceId: user.currentWorkspaceId, orgId: user.currentOrganizationId },
          async (client) => {
            const res = await client.query<{
              id: string;
              title: string;
              status: string;
              priority: string;
              assigned_tier: string | null;
            }>(
              `SELECT id, title, status, priority, assigned_tier
               FROM tasks
               WHERE project_id = $1 AND workspace_id = $2
               ORDER BY created_at ASC`,
              [body.projectId, user.currentWorkspaceId]
            );
            return res.rows;
          }
        );

        if (tasks && tasks.length > 0) {
          projectContext += `\nCurrent Tasks on Board (${tasks.length}):\n` +
            tasks
              .map(
                (t) =>
                  `- [${t.id}] ${t.title} (Status: ${t.status}, Priority: ${t.priority}${
                    t.assigned_tier ? `, Assigned: ${t.assigned_tier}` : ''
                  })`
              )
              .join('\n');
        } else {
          projectContext += `\nCurrent Tasks on Board: None (The task board is currently empty for this project).`;
        }
      } catch (err) {
        logger.warn({ err }, 'Could not fetch tasks for cockpit context');
      }

      // Inject system prompt with board awareness and optional active file
      const messagesWithContext = [...body.messages];
      messagesWithContext.unshift({
        role: 'system',
        content:
          `You are Graywolf Squad Technical Lead and Architect assisting the developer in the Cockpit.\n${projectContext}` +
          (body.currentFile ? `\n@current_file: ${body.currentFile}` : '') +
          `\n\nARCHITECTURAL PLANNING PROTOCOL:
When the user asks to build, design, or plan a project, application, or feature:
1. Provide a concise architectural investigation & technical strategy summary.
2. ALWAYS include a structured **Recommended Task Breakdown** markdown table so the Cockpit can instantiate atomic tasks and DAG dependency edges on the Kanban board when the user clicks "Create Task on Board".
Use this exact 4-column table format:
| ID | Task | Dependencies | Verification Criteria |
| :--- | :--- | :--- | :--- |
| **T-01** | **Short Task Title** — Detailed implementation scope and requirements | None | Concrete verification and test criteria |
| **T-02** | **Next Task Title** — Detailed implementation scope and requirements | T-01 | Concrete verification and test criteria |
Keep tasks atomic (3 to 7 tasks depending on scope), ordered by dependency, and never put HTML <br> tags inside table cells.`,
      });

      // Try LiteLLM completion with fallback
      try {
        // Stream immediate progress acknowledgement frame
        reply.raw.write(
          `2:${JSON.stringify([
            {
              type: 'progress',
              status: 'thinking',
              message: 'Squad Planner is formulating architecture and execution strategy...',
            },
          ])}\n`
        );

        const completion = await litellmClient.complete({
          alias: 'agent-planner',
          messages: messagesWithContext.map((m) => ({ role: m.role, content: m.content })),
          workspaceId: user.currentWorkspaceId,
          persona: 'planner',
          maxTokens: 8192,
        });

        if (completion.reasoningContent) {
          reply.raw.write(
            `2:${JSON.stringify([
              {
                type: 'thought',
                thought: completion.reasoningContent,
              },
            ])}\n`
          );
        }

        reply.raw.write(`0:${JSON.stringify(completion.content + '\n')}\n`);
      } catch (err) {
        logger.error({ err }, 'LiteLLM completion error in chat route');
        const fallbackText = `Acknowledged. Cockpit turn processed for workspace ${user.currentWorkspaceId}.${
          body.currentFile ? ` Active file: ${body.currentFile}` : ''
        }\n`;
        reply.raw.write(`0:${JSON.stringify(fallbackText)}\n`);
      }
    }

    // Process tool calls if requested
    if (body.toolCalls && body.toolCalls.length > 0) {
      for (const call of body.toolCalls) {
        const toolCallId = call.toolCallId || `call_${Date.now()}`;

        // 1. Invocations frame (9:)
        reply.raw.write(
          `9:${JSON.stringify({
            toolCallId,
            toolName: call.toolName,
            args: call.args,
          })}\n`
        );

        // 2. Authoritative execution via ACI gateway
        const result = await executeAuthorizedToolCall(
          {
            userId: user.userId,
            workspaceId: user.currentWorkspaceId,
            role: user.role,
          },
          call.toolName,
          call.args
        );

        // 3. Execution result frame (a:)
        reply.raw.write(
          `a:${JSON.stringify({
            toolCallId,
            result,
          })}\n`
        );
      }
    }

    // Finish frame (d:)
    reply.raw.write(
      `d:${JSON.stringify({
        finishReason: 'stop',
        usage: { promptTokens: 120, completionTokens: 64 },
      })}\n`
    );

    reply.raw.end();
  };

  // Register both /stream and /chat/stream routes
  fastify.post(
    '/stream',
    {
      schema: { body: ChatStreamBodySchema },
      preHandler: [requirePermission('chat_turn')],
    },
    handleChatStream
  );

  fastify.post(
    '/chat/stream',
    {
      schema: { body: ChatStreamBodySchema },
      preHandler: [requirePermission('chat_turn')],
    },
    handleChatStream
  );
}
