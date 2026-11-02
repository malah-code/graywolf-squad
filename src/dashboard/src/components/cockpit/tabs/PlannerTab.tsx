import React, { useState } from 'react';
import type { AccessModePillValue } from '../AccessModePill';

export interface PlanStepItem {
  id: string;
  label: string;
  completed: boolean;
}

export interface PlannerTabProps {
  planMarkdown?: string;
  steps?: PlanStepItem[];
  accessMode?: AccessModePillValue;
  onApprovePlan?: () => void;
  onRequestChanges?: (feedback: string) => void;
}

const DEFAULT_STEPS: PlanStepItem[] = [
  { id: 'step-1', label: 'AST Reconnaissance & Symbol Graph Indexing', completed: true },
  { id: 'step-2', label: 'Blast-radius boundaries verified (writable: src/orchestrator/)', completed: true },
  { id: 'step-3', label: 'Implement Fastify Vercel AI SDK route & Casbin RBAC', completed: true },
  { id: 'step-4', label: 'Unit and integration tests for streaming and Socratic Grilling', completed: false },
  { id: 'step-5', label: 'Reviewer 3-pass adversarial review & DecisionGate', completed: false },
];

export function PlannerTab({
  planMarkdown = '# Implementation Plan: Conversational Cockpit\n\n- Phase 1: Scaffold & BiDi\n- Phase 2: /api/v1/chat/stream\n- Phase 3: Cockpit & Spend Ticker',
  steps = DEFAULT_STEPS,
  accessMode = 'plan-gate',
  onApprovePlan,
  onRequestChanges,
}: PlannerTabProps): React.ReactElement {
  const [currentSteps, setCurrentSteps] = useState<PlanStepItem[]>(steps);
  const [feedbackText, setFeedbackText] = useState('');
  const [isApproved, setIsApproved] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);

  const toggleStep = (id: string) => {
    setCurrentSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, completed: !s.completed } : s))
    );
  };

  const handleApprove = () => {
    setIsApproved(true);
    if (onApprovePlan) {
      onApprovePlan();
    }
  };

  const handleRequestChanges = () => {
    if (!feedbackText.trim()) return;
    setFeedbackSent(true);
    if (onRequestChanges) {
      onRequestChanges(feedbackText);
    }
  };

  const isPlanGate = accessMode === 'plan-gate';

  return (
    <div data-testid="planner-tab" className="flex flex-col h-full bg-slate-950 text-slate-200 overflow-y-auto p-4 space-y-4">
      {/* Header & Access Mode Indicator */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Dev-Level-1 Planner State</h3>
        <span
          data-testid="planner-access-mode-badge"
          className="rounded px-2 py-0.5 text-[11px] font-semibold bg-slate-800 text-sky-400 border border-slate-700 font-mono"
        >
          Mode: {accessMode}
        </span>
      </div>

      {/* Plan Gate Human Action Banner */}
      {isPlanGate && !isApproved && (
        <div data-testid="plan-gate-approval-banner" className="p-3 rounded-lg bg-amber-950/70 border border-amber-800 text-amber-200">
          <div className="flex items-center space-x-2 mb-1">
            <span className="text-base">✋</span>
            <h4 className="text-xs font-bold uppercase tracking-wide">Human Plan Approval Gate (Plan-Gate Mode)</h4>
          </div>
          <p className="text-xs text-amber-300/90 mb-3">
            Dev-Level-1 has drafted the plan. Implementation is paused until you approve or request changes.
          </p>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              data-testid="approve-plan-btn"
              onClick={handleApprove}
              className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-emerald-500 transition"
            >
              Approve Plan
            </button>
            <div className="flex-1 flex items-center space-x-2">
              <input
                type="text"
                data-testid="request-changes-input"
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="Specify changes required..."
                className="flex-1 rounded bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-500 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
              <button
                type="button"
                data-testid="request-changes-btn"
                onClick={handleRequestChanges}
                disabled={!feedbackText.trim()}
                className="rounded bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-300 border border-slate-700 hover:text-white transition disabled:opacity-50"
              >
                Request Changes
              </button>
            </div>
          </div>
          {feedbackSent && (
            <p data-testid="feedback-sent-msg" className="text-[11px] text-emerald-400 mt-2 font-medium">✓ Feedback dispatched to Dev-Level-1 planner.</p>
          )}
        </div>
      )}

      {isApproved && (
        <div data-testid="plan-approved-msg" className="p-2.5 rounded-lg bg-emerald-950/70 border border-emerald-800 text-emerald-300 text-xs flex items-center space-x-2 font-medium">
          <span>✓</span>
          <span>Plan approved by human lead. Dev-Level-3 implementer unlocked.</span>
        </div>
      )}

      {/* Checklist Steps */}
      <div className="space-y-2">
        <h4 className="text-xs font-bold uppercase text-slate-400 tracking-wider">Plan Checklist</h4>
        <div className="space-y-1.5">
          {currentSteps.map((step) => (
            <div
              key={step.id}
              data-testid={`plan-step-${step.id}`}
              onClick={() => toggleStep(step.id)}
              className="flex items-center space-x-2.5 p-2 rounded bg-slate-900/60 border border-slate-800/80 cursor-pointer hover:bg-slate-900 transition"
            >
              <input
                type="checkbox"
                checked={step.completed}
                onChange={() => toggleStep(step.id)}
                className="h-3.5 w-3.5 rounded border-slate-700 text-sky-600 focus:ring-sky-500"
              />
              <span className={`text-xs ${step.completed ? 'line-through text-slate-500' : 'text-slate-200'}`}>
                {step.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Plan Document Preview */}
      <div className="space-y-1.5">
        <h4 className="text-xs font-bold uppercase text-slate-400 tracking-wider">Raw Plan Markdown</h4>
        <pre dir="ltr" data-testid="plan-markdown-preview" className="p-3 rounded-lg bg-slate-900 border border-slate-800 font-mono text-xs text-slate-300 whitespace-pre-wrap">
          {planMarkdown}
        </pre>
      </div>
    </div>
  );
}

export default PlannerTab;
