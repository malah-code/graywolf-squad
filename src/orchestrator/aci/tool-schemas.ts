import { Type, Static, TSchema, FormatRegistry } from '@sinclair/typebox';
import { RbacAction } from '../auth/rbac';

const UuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!FormatRegistry.Has('uuid')) {
  FormatRegistry.Set('uuid', (value) => typeof value === 'string' && UuidRegex.test(value));
}

export const TaskPriorityEnum = Type.Union([
  Type.Literal('LOW'),
  Type.Literal('MEDIUM'),
  Type.Literal('HIGH'),
  Type.Literal('CRITICAL'),
]);

const TaskIdRegex = '^TASK-[0-9A-Z-]+$';

// 1. create_task
export const CreateTaskToolSchema = Type.Object(
  {
    projectId: Type.String({ format: 'uuid' }),
    title: Type.String({ minLength: 1, maxLength: 512 }),
    briefMarkdown: Type.String({ minLength: 1 }),
    priority: Type.Optional(TaskPriorityEnum),
    blockedBy: Type.Optional(Type.Array(Type.String())),
    writableScope: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false }
);
export type CreateTaskToolInput = Static<typeof CreateTaskToolSchema>;

// 2. reorder_backlog
export const ReorderBacklogToolSchema = Type.Object(
  {
    projectId: Type.String({ format: 'uuid' }),
    orderedTaskIds: Type.Array(Type.String({ pattern: TaskIdRegex }), { minItems: 1 }),
  },
  { additionalProperties: false }
);
export type ReorderBacklogToolInput = Static<typeof ReorderBacklogToolSchema>;

// 3. update_blocked_by
export const UpdateBlockedByToolSchema = Type.Object(
  {
    taskId: Type.String({ pattern: TaskIdRegex }),
    blockedBy: Type.Array(Type.String({ pattern: TaskIdRegex })),
  },
  { additionalProperties: false }
);
export type UpdateBlockedByToolInput = Static<typeof UpdateBlockedByToolSchema>;

// 4. pause_container
export const PauseContainerToolSchema = Type.Object(
  {
    taskId: Type.String({ pattern: TaskIdRegex }),
    reason: Type.Optional(Type.String()),
  },
  { additionalProperties: false }
);
export type PauseContainerToolInput = Static<typeof PauseContainerToolSchema>;

// 5. cancel_task
export const CancelTaskToolSchema = Type.Object(
  {
    taskId: Type.String({ pattern: TaskIdRegex }),
    reason: Type.Optional(Type.String()),
  },
  { additionalProperties: false }
);
export type CancelTaskToolInput = Static<typeof CancelTaskToolSchema>;

// 6. approve_pr_merge
export const ApprovePrMergeToolSchema = Type.Object(
  {
    taskId: Type.String({ pattern: TaskIdRegex }),
    comment: Type.Optional(Type.String()),
  },
  { additionalProperties: false }
);
export type ApprovePrMergeToolInput = Static<typeof ApprovePrMergeToolSchema>;

// 7. modify_blast_radius
export const ModifyBlastRadiusToolSchema = Type.Object(
  {
    projectId: Type.String({ format: 'uuid' }),
    writable: Type.Array(Type.String()),
    readonly: Type.Optional(Type.Array(Type.String())),
    forbidden: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false }
);
export type ModifyBlastRadiusToolInput = Static<typeof ModifyBlastRadiusToolSchema>;

export const COCKPIT_TOOL_SCHEMAS: Record<
  string,
  {
    schema: TSchema;
    requiredAction: RbacAction;
    description: string;
  }
> = {
  create_task: {
    schema: CreateTaskToolSchema,
    requiredAction: 'create_task',
    description: 'Create a new engineering task with title and brief markdown',
  },
  reorder_backlog: {
    schema: ReorderBacklogToolSchema,
    requiredAction: 'reorder_backlog',
    description: 'Reorder backlog task priorities within a project',
  },
  update_blocked_by: {
    schema: UpdateBlockedByToolSchema,
    requiredAction: 'reorder_backlog',
    description: 'Update dependency blockers for a specific task',
  },
  pause_container: {
    schema: PauseContainerToolSchema,
    requiredAction: 'dispatch_task',
    description: 'Pause execution of an active task runner container',
  },
  cancel_task: {
    schema: CancelTaskToolSchema,
    requiredAction: 'dispatch_task',
    description: 'Cancel task execution and restore worktree',
  },
  approve_pr_merge: {
    schema: ApprovePrMergeToolSchema,
    requiredAction: 'approve_review_gate',
    description: 'Approve review gate and merge code pull request (lead_dev/owner only)',
  },
  modify_blast_radius: {
    schema: ModifyBlastRadiusToolSchema,
    requiredAction: 'modify_blast_radius',
    description: 'Update writable, readonly, and forbidden glob barriers for a project',
  },
};

export type CockpitToolName = keyof typeof COCKPIT_TOOL_SCHEMAS;
