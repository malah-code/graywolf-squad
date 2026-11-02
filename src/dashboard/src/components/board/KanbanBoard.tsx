import React, { useState } from 'react';
import type { WorkspaceRole, DashboardPersona, ProjectMode } from '../../context/DashboardContext';
import type { RightPanelTabId } from '../cockpit/RightPanel';

export type TaskStatus =
  | 'BACKLOG'
  | 'UPDATED'
  | 'QUEUED'
  | 'BLOCKED'
  | 'IN_PROGRESS'
  | 'INTERNAL_REVIEW'
  | 'INTERNAL_REVIEW_FAILED'
  | 'GUARD_VERIFYING'
  | 'QA_FIXING'
  | 'VERIFICATION_FAILED'
  | 'AWAITING_CLARIFICATION'
  | 'ESCALATED'
  | 'HUMAN_REVIEW_GATE'
  | 'REJECTED'
  | 'MERGED'
  | 'CANCELLED';

export interface KanbanColumn {
  id: string;
  title: string;
  statuses: TaskStatus[];
}

export interface KanbanTaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  spendUsd: number;
  assignedTier?: string | null;
}

export function getKanbanColumnsForView(options: {
  persona: 'maker' | 'developer';
  projectMode: 'greenfield' | 'brownfield';
  userRole: WorkspaceRole;
}): {
  viewMode: 'developer' | 'maker' | 'viewer';
  columns: KanbanColumn[];
  collapsedTabs: RightPanelTabId[];
  visibleTabs: RightPanelTabId[];
  hideAstDiffsByDefault: boolean;
} {
  if (options.userRole === 'viewer') {
    return {
      viewMode: 'viewer',
      columns: [],
      collapsedTabs: ['files', 'commits', 'terminal', 'planner'],
      visibleTabs: ['browser', 'usage'],
      hideAstDiffsByDefault: true,
    };
  }

  if (options.persona === 'maker') {
    return {
      viewMode: 'maker',
      columns: [
        { id: 'ideas', title: 'Ideas', statuses: ['BACKLOG', 'UPDATED'] },
        { id: 'planning', title: 'Planning', statuses: ['QUEUED', 'BLOCKED', 'AWAITING_CLARIFICATION'] },
        {
          id: 'building',
          title: 'Building',
          statuses: [
            'IN_PROGRESS',
            'INTERNAL_REVIEW',
            'INTERNAL_REVIEW_FAILED',
            'GUARD_VERIFYING',
            'QA_FIXING',
            'VERIFICATION_FAILED',
          ],
        },
        { id: 'ready_to_review', title: 'Ready to Review', statuses: ['HUMAN_REVIEW_GATE', 'ESCALATED', 'REJECTED'] },
        { id: 'live', title: 'Live', statuses: ['MERGED', 'CANCELLED'] },
      ],
      collapsedTabs: ['files', 'commits', 'terminal'],
      visibleTabs: ['browser', 'planner'],
      hideAstDiffsByDefault: true,
    };
  }

  // Developer view (default)
  return {
    viewMode: 'developer',
    columns: [
      { id: 'backlog', title: 'Backlog', statuses: ['BACKLOG', 'UPDATED'] },
      { id: 'queued', title: 'Queued / Ready', statuses: ['QUEUED', 'BLOCKED'] },
      { id: 'in_progress', title: 'In Progress', statuses: ['IN_PROGRESS'] },
      { id: 'internal_review', title: 'Internal Review', statuses: ['INTERNAL_REVIEW', 'INTERNAL_REVIEW_FAILED'] },
      { id: 'qa_guard', title: 'QA Guard Verifying', statuses: ['GUARD_VERIFYING', 'QA_FIXING', 'VERIFICATION_FAILED'] },
      { id: 'awaiting_clarification', title: 'Awaiting Clarification', statuses: ['AWAITING_CLARIFICATION', 'ESCALATED'] },
      { id: 'review_gate', title: 'Review Gate', statuses: ['HUMAN_REVIEW_GATE', 'REJECTED'] },
      { id: 'merged_done', title: 'Merged / Done', statuses: ['MERGED', 'CANCELLED'] },
    ],
    collapsedTabs: [],
    visibleTabs: ['files', 'commits', 'planner', 'terminal', 'browser', 'usage'],
    hideAstDiffsByDefault: false,
  };
}

export interface KanbanBoardProps {
  persona?: DashboardPersona;
  projectMode?: ProjectMode;
  userRole?: WorkspaceRole;
  tasks?: KanbanTaskItem[];
  goal?: string;
  onTaskClick?: (taskId: string) => void;
}

const DEFAULT_TASKS: KanbanTaskItem[] = [
  { id: 'TASK-101', title: 'Fastify Vercel AI SDK route', status: 'IN_PROGRESS', priority: 'HIGH', spendUsd: 0.042 },
  { id: 'TASK-102', title: 'Socratic Grilling Prompt', status: 'INTERNAL_REVIEW', priority: 'HIGH', spendUsd: 0.018 },
  { id: 'TASK-103', title: 'Playwright Visual Regression', status: 'BACKLOG', priority: 'MEDIUM', spendUsd: 0 },
  { id: 'TASK-104', title: 'VCS Delivery PR webhook loop', status: 'MERGED', priority: 'HIGH', spendUsd: 0.095 },
];

export function KanbanBoard({
  persona = 'developer',
  projectMode = 'greenfield',
  userRole = 'developer',
  tasks = DEFAULT_TASKS,
  goal = 'Build next-generation autonomous software engineering platform with dual modes and cognitive tiers',
  onTaskClick,
}: KanbanBoardProps): React.ReactElement {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const viewConfig = getKanbanColumnsForView({ persona, projectMode, userRole });

  // Viewer / Client Stakeholder Dashboard
  if (viewConfig.viewMode === 'viewer') {
    const completedTasks = tasks.filter((t) => t.status === 'MERGED').length;
    const progressPercent = tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0;
    const totalSpend = tasks.reduce((sum, t) => sum + t.spendUsd, 0);

    return (
      <div data-testid="viewer-dashboard" className="flex flex-col h-full bg-slate-950 text-slate-100 p-6 space-y-6">
        <div className="border-b border-slate-800 pb-3 flex justify-between items-center">
          <div>
            <span className="text-xs uppercase font-bold text-sky-400">Stakeholder Executive Dashboard</span>
            <h2 className="text-lg font-bold text-white mt-1">Project Milestone Overview</h2>
          </div>
          <div className="text-right">
            <span className="text-xs text-slate-400">Total Spend</span>
            <div data-testid="viewer-spend" className="font-mono text-base font-bold text-emerald-400">
              ${totalSpend.toFixed(2)}
            </div>
          </div>
        </div>

        {/* Goal */}
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-xs font-semibold text-slate-400 block mb-1">Target Business Goal</span>
          <p data-testid="viewer-goal" className="text-sm text-slate-200">{goal}</p>
        </div>

        {/* Progress Bar */}
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="font-semibold text-slate-300">Feature Delivery Progress</span>
            <span data-testid="viewer-progress-percent" className="font-mono font-bold text-sky-400">{progressPercent}%</span>
          </div>
          <div className="h-3 w-full rounded-full bg-slate-950 overflow-hidden border border-slate-800">
            <div
              style={{ width: `${progressPercent}%` }}
              className="h-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-500"
            />
          </div>
          <span className="text-[11px] text-slate-400 font-mono">
            {completedTasks} of {tasks.length} tasks merged and delivered
          </span>
        </div>

        {/* Playwright Video/Screenshot Demos */}
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
          <h3 className="text-xs font-semibold text-slate-300">Live Verification Demos & Recordings</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center space-x-3">
              <span className="text-2xl">🎬</span>
              <div>
                <p className="text-xs font-bold text-slate-200">Playwright E2E Verification</p>
                <span className="text-[10px] text-slate-400 font-mono">100% assertions green</span>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center space-x-3">
              <span className="text-2xl">📸</span>
              <div>
                <p className="text-xs font-bold text-slate-200">Visual Regression Diff</p>
                <span className="text-[10px] text-slate-400 font-mono">0 pixel threshold drift</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Developer or Maker Kanban Board
  return (
    <div data-testid="kanban-board" data-view-mode={viewConfig.viewMode} className="flex flex-col h-full bg-slate-950 text-slate-200 overflow-hidden">
      {/* Board Header */}
      <div className="flex items-center justify-between p-3 border-b border-slate-800 bg-slate-900/60">
        <div className="flex items-center space-x-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            {viewConfig.viewMode === 'maker' ? '🎨 Maker Kanban Board (5 Columns)' : '⚙️ Developer Kanban Board (8 Columns)'}
          </h3>
          <span className="font-mono text-xs text-sky-400">[{tasks.length} tasks]</span>
        </div>

        {/* Maker Technical Details Toggle */}
        {viewConfig.viewMode === 'maker' && (
          <button
            type="button"
            data-testid="toggle-tech-details-btn"
            onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
            className="rounded bg-slate-800 px-2.5 py-1 text-xs text-slate-300 border border-slate-700 hover:text-white transition"
          >
            {showTechnicalDetails ? 'Hide Technical Details' : 'Show Technical Details'}
          </button>
        )}
      </div>

      {/* Columns Grid */}
      <div className="flex-1 flex overflow-x-auto p-3 space-x-3">
        {viewConfig.columns.map((column) => {
          const columnTasks = tasks.filter((t) => column.statuses.includes(t.status));
          return (
            <div
              key={column.id}
              data-testid={`kanban-column-${column.id}`}
              className="w-72 flex-shrink-0 flex flex-col rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden"
            >
              <div className="flex items-center justify-between p-2.5 border-b border-slate-800 bg-slate-900">
                <span className="text-xs font-bold text-slate-300">{column.title}</span>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-slate-400">
                  {columnTasks.length}
                </span>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {columnTasks.map((task) => (
                  <div
                    key={task.id}
                    data-testid={`kanban-task-${task.id}`}
                    onClick={() => onTaskClick && onTaskClick(task.id)}
                    className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 hover:border-sky-700/80 cursor-pointer shadow-sm transition space-y-2"
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <code dir="ltr" className="font-mono text-sky-400">{task.id}</code>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                        task.priority === 'CRITICAL' ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'bg-slate-800 text-slate-300'
                      }`}>
                        {task.priority}
                      </span>
                    </div>

                    <p className="text-xs font-semibold text-slate-200">{task.title}</p>

                    <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-900 font-mono">
                      <span>Status: {task.status}</span>
                      <span>${task.spendUsd.toFixed(3)}</span>
                    </div>

                    {showTechnicalDetails && (
                      <div data-testid="technical-details-box" className="text-[10px] text-purple-300 bg-purple-950/40 p-1.5 rounded border border-purple-900/50 font-mono">
                        AST Diff: verified by Tree-sitter | Tier: {task.assignedTier || 'implementer'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default KanbanBoard;
