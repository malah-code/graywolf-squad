import React from 'react';

export interface SpendTickerState {
  taskId?: string;
  taskSpendUsd: number;
  workspaceDailySpendUsd: number;
  dailySpendCapUsd: number;
  totalTokens: number;
  connectionStatus: 'connected' | 'reconnecting' | 'disconnected';
}

export function applyCostDeltaEvent(
  state: SpendTickerState,
  deltaPayload: { costUsdDelta: number; tokensDelta: number; taskId?: string }
): SpendTickerState {
  const isTargetTask = !state.taskId || !deltaPayload.taskId || state.taskId === deltaPayload.taskId;
  const nextTaskSpend = isTargetTask ? state.taskSpendUsd + deltaPayload.costUsdDelta : state.taskSpendUsd;
  const nextWorkspaceSpend = state.workspaceDailySpendUsd + deltaPayload.costUsdDelta;
  const nextTokens = state.totalTokens + (deltaPayload.tokensDelta || 0);

  return {
    ...state,
    taskSpendUsd: Number(nextTaskSpend.toFixed(6)),
    workspaceDailySpendUsd: Number(nextWorkspaceSpend.toFixed(6)),
    totalTokens: nextTokens,
  };
}

export interface SpendTickerProps {
  state: SpendTickerState;
  className?: string;
}

export function SpendTicker({ state, className = '' }: SpendTickerProps): React.ReactElement {
  const percentUsed =
    state.dailySpendCapUsd > 0
      ? Math.min(100, (state.workspaceDailySpendUsd / state.dailySpendCapUsd) * 100)
      : 0;

  const isExceeded = percentUsed >= 100;
  const isWarning = percentUsed >= 80 && !isExceeded;

  return (
    <div
      data-testid="spend-ticker"
      className={`inline-flex items-center space-x-3 rounded-lg bg-slate-900 px-3 py-1.5 border border-slate-800 text-xs text-slate-200 ${className}`.trim()}
    >
      {/* Connection Indicator */}
      <div className="flex items-center space-x-1" title={`WS Connection: ${state.connectionStatus}`}>
        <span
          data-testid="connection-indicator"
          className={`h-2 w-2 rounded-full ${
            state.connectionStatus === 'connected'
              ? 'bg-emerald-400'
              : state.connectionStatus === 'reconnecting'
              ? 'bg-amber-400 animate-pulse'
              : 'bg-rose-500'
          }`}
        />
        <span className="text-[10px] uppercase font-mono text-slate-400">{state.connectionStatus}</span>
      </div>

      {/* Task Spend */}
      <div className="flex items-center space-x-1">
        <span className="text-slate-400">Task:</span>
        <span data-testid="task-spend" className="font-mono font-semibold text-sky-400">
          ${state.taskSpendUsd.toFixed(4)}
        </span>
      </div>

      {/* Workspace Daily Spend / Cap */}
      <div className="flex items-center space-x-1">
        <span className="text-slate-400">Daily:</span>
        <span
          data-testid="daily-spend"
          className={`font-mono font-semibold ${
            isExceeded ? 'text-rose-400 font-bold' : isWarning ? 'text-amber-400' : 'text-slate-200'
          }`}
        >
          ${state.workspaceDailySpendUsd.toFixed(2)} / ${state.dailySpendCapUsd.toFixed(2)}
        </span>
        {isExceeded && (
          <span className="rounded bg-rose-950 px-1 text-[10px] font-bold text-rose-300 border border-rose-800">
            CAP REACHED
          </span>
        )}
      </div>

      {/* Token Count */}
      <div className="flex items-center space-x-1">
        <span className="text-slate-400">Tokens:</span>
        <span data-testid="total-tokens" className="font-mono text-purple-400">
          {state.totalTokens.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

export function renderSpendTicker(state: SpendTickerState): React.ReactElement | null {
  return <SpendTicker state={state} />;
}
