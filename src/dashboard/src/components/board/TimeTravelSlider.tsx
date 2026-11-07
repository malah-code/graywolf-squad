import React, { useState } from 'react';

export interface FileMutationRecord {
  filePath: string;
  operation: 'create' | 'modify' | 'delete';
  patchSummary: string;
}

export interface TrajectorySnapshot {
  seq: number;
  timestamp: string;
  narrativeAction: string; // Surface A
  actorTier: 'planner' | 'implementer' | 'reviewer' | 'guard' | 'orchestrator';
  fileMutations: FileMutationRecord[];
  terminalStdout?: string; // Surface B
  terminalStderr?: string;
  thoughtSummary?: string;
}

export function selectTrajectorySnapshotAtStep(
  snapshots: TrajectorySnapshot[],
  stepIndex: number
): TrajectorySnapshot | null {
  if (!snapshots || snapshots.length === 0) return null;
  const clamped = Math.max(0, Math.min(snapshots.length - 1, stepIndex));
  return snapshots[clamped] || null;
}

export const DEFAULT_SNAPSHOTS: TrajectorySnapshot[] = [
  {
    seq: 0,
    timestamp: '2026-10-25 15:00:00 UTC',
    narrativeAction: 'Dev-Level-1 completed reconnaissance and generated plan.md',
    actorTier: 'planner',
    fileMutations: [
      {
        filePath: 'specs/014-cockpit-and-kanban-ui/plan.md',
        operation: 'create',
        patchSummary: '+114 lines of architecture and tasks',
      },
    ],
    thoughtSummary: 'Identified 5 user stories and 6 right-panel lazy tabs.',
    terminalStdout: '[recon] Indexed 39 test suites and 44 symbol references.\n[plan] Generated tasks T001..T015.\n',
  },
  {
    seq: 1,
    timestamp: '2026-10-25 15:05:30 UTC',
    narrativeAction: 'Dev-Level-3 implemented Fastify streaming chat route and ACI tool execution',
    actorTier: 'implementer',
    fileMutations: [
      {
        filePath: 'src/orchestrator/routes/chat.ts',
        operation: 'create',
        patchSummary: '+270 lines (0:, 9:, a:, 2:, d: data stream protocol)',
      },
    ],
    thoughtSummary: 'Streaming frames 0:, 9:, a:, 2:, d: hand-rolled cleanly on LiteLLMClient.',
    terminalStdout: '[chat.ts] Compiled cleanly. Registered in app.ts with prefix /api/v1/chat.\n',
  },
  {
    seq: 2,
    timestamp: '2026-10-25 15:10:15 UTC',
    narrativeAction: 'QA Guard and TestGuard verified zero vacuous tests and clean AST diffs',
    actorTier: 'guard',
    fileMutations: [
      {
        filePath: 'tests/integration/chat-grill.test.ts',
        operation: 'create',
        patchSummary: '+310 lines (9/9 tests pass)',
      },
    ],
    thoughtSummary: 'All 9 integration test scenarios green.',
    terminalStdout: 'Test Files 1 passed (1)\nTests 9 passed (9)\nDuration 1.19s\n',
  },
];

export interface TimeTravelSliderProps {
  snapshots?: TrajectorySnapshot[];
  onStepChange?: (stepIndex: number) => void;
  className?: string;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  headerActions?: React.ReactNode;
}

export function TimeTravelSlider({
  snapshots = DEFAULT_SNAPSHOTS,
  onStepChange,
  className = '',
  isCollapsed = false,
  onToggleCollapse,
  isMaximized = false,
  onToggleMaximize,
  headerActions,
}: TimeTravelSliderProps): React.ReactElement {
  const [currentStep, setCurrentStep] = useState<number>(snapshots.length - 1);
  const [surfaceBOpen, setSurfaceBOpen] = useState<boolean>(false);

  const activeSnapshot = selectTrajectorySnapshotAtStep(snapshots, currentStep);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextStep = Number(e.target.value);
    setCurrentStep(nextStep);
    if (onStepChange) {
      onStepChange(nextStep);
    }
  };

  if (!activeSnapshot) {
    return <div data-testid="time-travel-slider" className="text-xs text-slate-500">No trajectory snapshots</div>;
  }

  const tierColors: Record<TrajectorySnapshot['actorTier'], string> = {
    planner: 'bg-blue-950 text-blue-300 border-blue-800',
    implementer: 'bg-emerald-950 text-emerald-300 border-emerald-800',
    reviewer: 'bg-purple-950 text-purple-300 border-purple-800',
    guard: 'bg-amber-950 text-amber-300 border-amber-800',
    orchestrator: 'bg-sky-950 text-sky-300 border-sky-800',
  };

  // Collapsed mode
  if (isCollapsed) {
    return (
      <div
        data-testid="time-travel-slider-collapsed"
        className="flex items-center justify-between px-3 py-2 bg-slate-950 border-t border-slate-800 cursor-pointer hover:bg-slate-900 transition select-none flex-shrink-0"
        onClick={onToggleCollapse}
      >
        <div className="flex items-center space-x-2.5 text-xs">
          <span className="text-sm">⏳</span>
          <span className="font-bold text-slate-300 uppercase tracking-wider">
            Time-Travel Trajectory Inspector
          </span>
          <span className="text-[11px] font-mono text-sky-400 bg-sky-950/60 px-2 py-0.5 rounded border border-sky-800/60">
            Step: {currentStep + 1} / {snapshots.length}
          </span>
          <span className="hidden sm:inline text-slate-500 text-[11px]">({activeSnapshot.timestamp})</span>
        </div>
        <div className="flex items-center space-x-2">
          <button
            type="button"
            data-testid="expand-timeline-btn"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse?.();
            }}
            className="flex items-center space-x-1 text-xs text-sky-400 hover:text-sky-300 font-medium px-2 py-0.5 rounded bg-sky-950/80 border border-sky-800 hover:bg-sky-900 transition"
          >
            <span>▲ Expand</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="time-travel-slider"
      className={`flex flex-col bg-slate-950 border-t border-slate-800 p-3 space-y-3 min-h-0 overflow-y-auto ${className}`.trim()}
    >
      {/* Slider Bar Controls & Header */}
      <div className="flex items-center justify-between text-xs flex-shrink-0">
        <div className="flex items-center space-x-2">
          <span className="text-base">⏳</span>
          <span className="font-bold text-slate-300 uppercase tracking-wider">
            Time-Travel Trajectory Inspector
          </span>
          <div className="hidden sm:flex items-center space-x-2 font-mono text-[11px] pl-2 border-l border-slate-800">
            <span className="text-slate-400">Step:</span>
            <span data-testid="current-step-label" className="text-sky-400 font-bold">
              {currentStep + 1} / {snapshots.length}
            </span>
            <span className="text-slate-500">({activeSnapshot.timestamp})</span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {headerActions}

          {onToggleMaximize && (
            <button
              type="button"
              data-testid="maximize-timeline-btn"
              onClick={onToggleMaximize}
              className="text-xs text-slate-300 hover:text-white px-2 py-1 rounded bg-slate-800/80 border border-slate-700 hover:bg-slate-700 transition"
              title={isMaximized ? 'Restore normal view' : 'Maximize Trajectory Inspector'}
            >
              {isMaximized ? '◱ Restore' : '⛶ Maximize'}
            </button>
          )}

          {onToggleCollapse && (
            <button
              type="button"
              data-testid="collapse-timeline-btn"
              onClick={onToggleCollapse}
              className="text-xs text-slate-300 hover:text-white px-2 py-1 rounded bg-slate-800/80 border border-slate-700 hover:bg-slate-700 transition"
              title="Collapse Trajectory Inspector"
            >
              ▼ Collapse
            </button>
          )}
        </div>
      </div>

      <div className="flex-shrink-0">
        <input
          type="range"
          min={0}
          max={snapshots.length - 1}
          value={currentStep}
          onChange={handleSliderChange}
          data-testid="trajectory-slider-input"
          className="w-full accent-sky-500 cursor-pointer h-2 bg-slate-800 rounded-lg"
        />
      </div>

      {/* Surface A: Narrative Timeline Milestone */}
      <div data-testid="surface-a-narrative" className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <span className={`text-[10px] uppercase px-2 py-0.5 rounded font-bold border ${tierColors[activeSnapshot.actorTier]}`}>
            {activeSnapshot.actorTier.toUpperCase()}
          </span>
          <span className="text-[11px] font-mono text-slate-400">Seq #{activeSnapshot.seq}</span>
        </div>

        <p data-testid="narrative-action-text" className="text-xs font-semibold text-slate-100">
          {activeSnapshot.narrativeAction}
        </p>

        {activeSnapshot.thoughtSummary && (
          <p className="text-[11px] text-slate-400 italic">
            Cognitive intent: &ldquo;{activeSnapshot.thoughtSummary}&rdquo;
          </p>
        )}

        {/* File Mutations List */}
        {activeSnapshot.fileMutations.length > 0 && (
          <div className="pt-2 border-t border-slate-800 space-y-1">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">File Mutations:</span>
            {activeSnapshot.fileMutations.map((m, idx) => (
              <div key={idx} className="flex items-center justify-between text-[11px] font-mono bg-slate-950 p-1.5 rounded">
                <code dir="ltr" className="text-sky-400">{m.filePath}</code>
                <span className="text-slate-400 text-[10px]">{m.patchSummary}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Surface B: Expandable Raw Terminal Drawers */}
      <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-900/60 flex-shrink-0">
        <button
          type="button"
          data-testid="toggle-surface-b-btn"
          onClick={() => setSurfaceBOpen(!surfaceBOpen)}
          className="w-full flex items-center justify-between p-2 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800/80 transition"
        >
          <span className="flex items-center space-x-1.5">
            <span>💻</span>
            <span>Surface B: Raw Terminal Output Drawer</span>
          </span>
          <span className="font-mono text-slate-500">{surfaceBOpen ? '▲ Collapse' : '▼ Expand'}</span>
        </button>

        {surfaceBOpen && (
          <div data-testid="surface-b-terminal-drawer" className="p-3 bg-slate-950 border-t border-slate-800 font-mono text-xs text-slate-300">
            {activeSnapshot.terminalStdout ? (
              <pre dir="ltr" className="whitespace-pre-wrap text-[11px] text-emerald-300 overflow-x-auto">
                {activeSnapshot.terminalStdout}
              </pre>
            ) : (
              <p className="text-slate-500 italic">No raw stdout captured for this step.</p>
            )}

            {activeSnapshot.terminalStderr && (
              <pre dir="ltr" className="whitespace-pre-wrap text-[11px] text-rose-300 overflow-x-auto mt-2 pt-2 border-t border-slate-800">
                {activeSnapshot.terminalStderr}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default TimeTravelSlider;
