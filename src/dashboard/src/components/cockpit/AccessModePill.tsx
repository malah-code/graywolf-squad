import React from 'react';
import type { WorkspaceRole } from '../../context/DashboardContext';

export type AccessModePillValue = 'plan-read-only' | 'plan-gate' | 'full-factory';

export interface AccessModePillOption {
  value: AccessModePillValue;
  label: 'Plan / Read-Only' | 'Plan-Gate' | 'Full Factory';
  icon: '🔍' | '✋' | '⚡';
  readOnlyContainer: boolean;
  requiresPlanApproval: boolean;
  description: string;
}

export const ACCESS_MODE_OPTIONS: Record<AccessModePillValue, AccessModePillOption> = {
  'plan-read-only': {
    value: 'plan-read-only',
    label: 'Plan / Read-Only',
    icon: '🔍',
    readOnlyContainer: true,
    requiresPlanApproval: false,
    description: 'Dev-Level-1 analyzes codebase and produces plan.md. No code modifications allowed.',
  },
  'plan-gate': {
    value: 'plan-gate',
    label: 'Plan-Gate',
    icon: '✋',
    readOnlyContainer: false,
    requiresPlanApproval: true,
    description: 'Dev-Level-1 drafts plan.md. Pauses for human approval before Dev-Level-3 writes code.',
  },
  'full-factory': {
    value: 'full-factory',
    label: 'Full Factory',
    icon: '⚡',
    readOnlyContainer: false,
    requiresPlanApproval: false,
    description: 'Autonomous execution through Planner, Implementer, and Reviewer tiers.',
  },
};

export function canEditAccessModePill(role: WorkspaceRole): boolean {
  return role === 'developer' || role === 'lead_dev' || role === 'owner';
}

export interface AccessModePillProps {
  value: AccessModePillValue;
  role: WorkspaceRole;
  onChange?: (next: AccessModePillValue) => void;
  className?: string;
}

export function AccessModePill({
  value,
  role,
  onChange,
  className = '',
}: AccessModePillProps): React.ReactElement {
  const isEditable = canEditAccessModePill(role);
  const current = ACCESS_MODE_OPTIONS[value] || ACCESS_MODE_OPTIONS['full-factory'];

  const handleCycle = () => {
    if (!isEditable || !onChange) return;
    const order: AccessModePillValue[] = ['plan-read-only', 'plan-gate', 'full-factory'];
    const nextIdx = (order.indexOf(value) + 1) % order.length;
    onChange(order[nextIdx]);
  };

  return (
    <div
      data-testid="access-mode-pill"
      data-value={value}
      data-editable={isEditable}
      className={`inline-flex items-center space-x-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
        value === 'plan-read-only'
          ? 'bg-blue-950/80 text-blue-300 border border-blue-800'
          : value === 'plan-gate'
          ? 'bg-amber-950/80 text-amber-300 border border-amber-800'
          : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
      } ${isEditable ? 'cursor-pointer hover:opacity-90' : 'cursor-not-allowed opacity-75'} ${className}`.trim()}
      onClick={handleCycle}
      title={isEditable ? `${current.description} (Click to switch)` : `${current.description} (Read-only for viewer)`}
    >
      <span className="text-sm">{current.icon}</span>
      <span>{current.label}</span>
      {isEditable && <span className="text-[10px] opacity-60">⇄</span>}
      {!isEditable && <span className="text-[10px] text-slate-400">🔒</span>}
    </div>
  );
}

export function renderAccessModePill(props: {
  value: AccessModePillValue;
  role: WorkspaceRole;
  onChange?: (next: AccessModePillValue) => void;
}): React.ReactElement | null {
  return <AccessModePill {...props} />;
}
