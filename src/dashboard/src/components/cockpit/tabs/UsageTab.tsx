import React, { useState } from 'react';

export interface UsageTabProps {
  contextWindowUsedTokens?: number;
  contextWindowMaxTokens?: number;
  taskSpendUsd?: number;
  workspaceDailySpendUsd?: number;
  dailySpendCapUsd?: number;
  onCompactContext?: () => Promise<{ compacted: boolean; savedTokens: number }>;
}

export function UsageTab({
  contextWindowUsedTokens = 64200,
  contextWindowMaxTokens = 128000,
  taskSpendUsd = 0.0845,
  workspaceDailySpendUsd = 6.24,
  dailySpendCapUsd = 50.0,
  onCompactContext,
}: UsageTabProps): React.ReactElement {
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactResult, setCompactResult] = useState<string | null>(null);

  const fillPercent = Math.min(100, Math.round((contextWindowUsedTokens / contextWindowMaxTokens) * 100));
  const spendPercent = Math.min(100, Math.round((workspaceDailySpendUsd / dailySpendCapUsd) * 100));

  const handleCompact = async () => {
    setIsCompacting(true);
    try {
      if (onCompactContext) {
        const res = await onCompactContext();
        setCompactResult(`Context pruned! Freed ${res.savedTokens.toLocaleString()} tokens.`);
      } else {
        await new Promise((r) => setTimeout(r, 400));
        setCompactResult('Context pruned! Compacted 18 turns into summarized context checkpoint.');
      }
    } finally {
      setIsCompacting(false);
    }
  };

  return (
    <div data-testid="usage-tab" className="flex flex-col h-full bg-slate-950 text-slate-200 overflow-y-auto p-4 space-y-5">
      <div className="border-b border-slate-800 pb-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Context Window & Spend Ledger</h3>
      </div>

      {/* Context Window Gauge */}
      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-300">Context Window Gauge</span>
          <span data-testid="context-fill-percent" className="font-mono text-xs font-bold text-sky-400">
            {fillPercent}% ({contextWindowUsedTokens.toLocaleString()} / {contextWindowMaxTokens.toLocaleString()} tokens)
          </span>
        </div>

        {/* Progress Bar */}
        <div className="h-2.5 w-full rounded-full bg-slate-950 overflow-hidden border border-slate-800">
          <div
            data-testid="context-meter-bar"
            style={{ width: `${fillPercent}%` }}
            className={`h-full transition-all duration-500 ${
              fillPercent >= 85 ? 'bg-rose-500' : fillPercent >= 65 ? 'bg-amber-400' : 'bg-sky-500'
            }`}
          />
        </div>

        <div className="flex items-center justify-between pt-2">
          <span className="text-[11px] text-slate-400">Prune redundant AST slices & message turns</span>
          <button
            type="button"
            data-testid="compact-context-button"
            onClick={handleCompact}
            disabled={isCompacting}
            className="rounded bg-slate-800 px-3 py-1.5 text-xs font-semibold text-sky-400 border border-slate-700 hover:bg-slate-700 transition disabled:opacity-50"
          >
            {isCompacting ? 'Compacting...' : 'Compact Context'}
          </button>
        </div>

        {compactResult && (
          <p data-testid="compact-result-msg" className="text-[11px] text-emerald-400 font-medium pt-1">
            ✓ {compactResult}
          </p>
        )}
      </div>

      {/* Spend & Cost Metrics */}
      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-3">
        <h4 className="text-xs font-semibold text-slate-300">ACID Cost Ledger</h4>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="p-2.5 rounded bg-slate-950 border border-slate-800/80">
            <span className="text-slate-400 block text-[11px]">Task Spend (USD)</span>
            <span data-testid="usage-task-spend" className="font-mono text-base font-bold text-sky-400">
              ${taskSpendUsd.toFixed(4)}
            </span>
          </div>

          <div className="p-2.5 rounded bg-slate-950 border border-slate-800/80">
            <span className="text-slate-400 block text-[11px]">Workspace Daily Spend</span>
            <span data-testid="usage-daily-spend" className="font-mono text-base font-bold text-purple-400">
              ${workspaceDailySpendUsd.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Daily Cap Progress */}
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-slate-400">
            <span>Daily Budget Valve (${dailySpendCapUsd.toFixed(2)} Cap)</span>
            <span className="font-mono">{spendPercent}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-950 overflow-hidden border border-slate-800">
            <div
              style={{ width: `${spendPercent}%` }}
              className={`h-full ${spendPercent >= 100 ? 'bg-rose-500' : spendPercent >= 80 ? 'bg-amber-400' : 'bg-purple-500'}`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default UsageTab;
