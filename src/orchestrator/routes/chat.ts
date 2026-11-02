import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import pino from 'pino';
import { requirePermission, enforcePermission } from '../auth/rbac';
import { executeAuthorizedToolCall } from '../aci/validate';
import { LiteLLMClient } from '../gateway/litellm-client';

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

      // Inject @current_file into prompt context
      const messagesWithContext = [...body.messages];
      if (body.currentFile) {
        messagesWithContext.unshift({
          role: 'system',
          content: `@current_file: ${body.currentFile}`,
        });
      }

      // Try LiteLLM completion with fallback
      try {
        const completion = await litellmClient.complete({
          alias: 'agent-planner',
          messages: messagesWithContext.map((m) => ({ role: m.role, content: m.content })),
          workspaceId: user.currentWorkspaceId,
          persona: 'planner',
        });
        reply.raw.write(`0:${JSON.stringify(completion.content + '\n')}\n`);
      } catch (err) {
        logger.debug({ err }, 'LiteLLM completion fallback triggered');
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
