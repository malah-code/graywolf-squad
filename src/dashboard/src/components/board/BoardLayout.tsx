import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { WorkspaceRole, DashboardPersona, ProjectMode } from '../../context/DashboardContext';
import { KanbanBoard, DEFAULT_TASKS, KanbanTaskItem } from './KanbanBoard';
import { DagGraph, DEFAULT_DAG_NODES, DagTaskNode } from './DagGraph';
import { TimeTravelSlider, DEFAULT_SNAPSHOTS, TrajectorySnapshot } from './TimeTravelSlider';

export type BoardPreset = 'all' | 'kanban' | 'dag' | 'timeline';

export interface BoardLayoutProps {
  persona?: DashboardPersona;
  projectMode?: ProjectMode;
  userRole?: WorkspaceRole;
  initialTasks?: KanbanTaskItem[];
  initialDagNodes?: DagTaskNode[];
  initialSnapshots?: TrajectorySnapshot[];
  onDispatchTask?: (taskId: string) => Promise<unknown>;
  onTransitionTask?: (taskId: string, targetStatus: any) => Promise<unknown>;
  onApproveTask?: (taskId: string) => Promise<unknown>;
  onAnswerClarification?: (taskId: string, answerText: string) => Promise<unknown>;
}

export function BoardLayout({
  persona = 'developer',
  projectMode = 'greenfield',
  userRole = 'developer',
  initialTasks = DEFAULT_TASKS,
  initialDagNodes = DEFAULT_DAG_NODES,
  initialSnapshots = DEFAULT_SNAPSHOTS,
  onDispatchTask,
  onTransitionTask,
  onApproveTask,
  onAnswerClarification,
}: BoardLayoutProps): React.ReactElement {
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [clarificationAnswer, setClarificationAnswer] = useState('');
  // Panel heights for resizable split view (in pixels)
  const [dagHeight, setDagHeight] = useState<number>(180);
  const [timelineHeight, setTimelineHeight] = useState<number>(160);

  // Collapse states for each panel
  const [collapsedPanels, setCollapsedPanels] = useState<{
    kanban: boolean;
    dag: boolean;
    timeline: boolean;
  }>({
    kanban: false,
    dag: false,
    timeline: false,
  });

  // Track if a panel is maximized (full screen mode)
  const [maximizedPanel, setMaximizedPanel] = useState<'kanban' | 'dag' | 'timeline' | null>(null);

  // Selected task detail inspector modal / drawer
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // Dragging state references
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingSplitter1Ref = useRef(false);
  const isDraggingSplitter2Ref = useRef(false);
  const startYRef = useRef(0);
  const startDagHeightRef = useRef(0);
  const startTimelineHeightRef = useRef(0);

  // Toggle Collapse handlers
  const toggleCollapse = useCallback((panel: 'kanban' | 'dag' | 'timeline') => {
    setCollapsedPanels((prev) => {
      const nextVal = !prev[panel];
      // If expanding a panel while it was maximized elsewhere, clear maximize
      if (!nextVal && maximizedPanel) {
        setMaximizedPanel(null);
      }
      return { ...prev, [panel]: nextVal };
    });
  }, [maximizedPanel]);

  // Toggle Maximize handlers
  const toggleMaximize = useCallback((panel: 'kanban' | 'dag' | 'timeline') => {
    setMaximizedPanel((curr) => {
      if (curr === panel) {
        // Restore
        setCollapsedPanels({ kanban: false, dag: false, timeline: false });
        return null;
      } else {
        // Maximize panel, collapse others
        setCollapsedPanels({
          kanban: panel !== 'kanban',
          dag: panel !== 'dag',
          timeline: panel !== 'timeline',
        });
        return panel;
      }
    });
  }, []);

  // Preset Layout Selector
  const applyPreset = useCallback((preset: BoardPreset) => {
    setMaximizedPanel(null);
    if (preset === 'all') {
      setCollapsedPanels({ kanban: false, dag: false, timeline: false });
      setDagHeight(180);
      setTimelineHeight(160);
    } else if (preset === 'kanban') {
      setCollapsedPanels({ kanban: false, dag: true, timeline: true });
      setMaximizedPanel('kanban');
    } else if (preset === 'dag') {
      setCollapsedPanels({ kanban: true, dag: false, timeline: true });
      setMaximizedPanel('dag');
    } else if (preset === 'timeline') {
      setCollapsedPanels({ kanban: true, dag: true, timeline: false });
      setMaximizedPanel('timeline');
    }
  }, []);

  // Splitter 1: Between Kanban and DAG (drag to resize DAG height)
  const handleMouseDownSplitter1 = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingSplitter1Ref.current = true;
    startYRef.current = e.clientY;
    startDagHeightRef.current = dagHeight;

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingSplitter1Ref.current) return;
      // Moving mouse UP (delta < 0) increases DAG height; moving DOWN decreases DAG height
      const deltaY = startYRef.current - moveEvent.clientY;
      const nextHeight = Math.max(100, Math.min(550, startDagHeightRef.current + deltaY));
      setDagHeight(nextHeight);
    };

    const handleMouseUp = () => {
      isDraggingSplitter1Ref.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Splitter 2: Between DAG and Timeline (drag to resize Timeline height)
  const handleMouseDownSplitter2 = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingSplitter2Ref.current = true;
    startYRef.current = e.clientY;
    startTimelineHeightRef.current = timelineHeight;

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingSplitter2Ref.current) return;
      // Moving mouse UP (delta < 0) increases Timeline height; moving DOWN decreases Timeline height
      const deltaY = startYRef.current - moveEvent.clientY;
      const nextHeight = Math.max(90, Math.min(500, startTimelineHeightRef.current + deltaY));
      setTimelineHeight(nextHeight);
    };

    const handleMouseUp = () => {
      isDraggingSplitter2Ref.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  const selectedTask = selectedTaskId ? initialTasks.find((t) => t.id === selectedTaskId) : null;

  const effectiveDagNodes = React.useMemo(() => {
    if (initialTasks && initialTasks.length > 0 && initialTasks !== DEFAULT_TASKS) {
      return initialTasks.map((t, idx) => ({
        id: t.id,
        title: t.title,
        status: (t.status === 'MERGED' ? 'MERGED' : t.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : t.status === 'CANCELLED' ? 'CANCELLED' : 'BACKLOG') as DagTaskNode['status'],
        blockedBy: t.blockedBy !== undefined ? t.blockedBy : (idx > 0 ? [initialTasks[idx - 1].id] : []),
        writableScope: t.writableScope && t.writableScope.length > 0 ? t.writableScope : ['src/'],
      }));
    }
    if (initialTasks && initialTasks.length === 0) {
      return [];
    }
    return initialDagNodes;
  }, [initialTasks, initialDagNodes]);

  return (
    <div
      ref={containerRef}
      data-testid="board-container"
      className="flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-slate-950 text-slate-100"
    >
      {/* Layout Presets Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-800 text-xs flex-shrink-0">
        <div className="flex items-center space-x-2">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Layout:</span>
          <div className="flex rounded-md bg-slate-950 p-0.5 border border-slate-800 space-x-0.5">
            <button
              type="button"
              data-testid="preset-all-btn"
              onClick={() => applyPreset('all')}
              className={`px-2.5 py-0.5 text-[11px] font-medium rounded transition ${
                !collapsedPanels.kanban && !collapsedPanels.dag && !collapsedPanels.timeline && !maximizedPanel
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
              }`}
            >
              Split View
            </button>
            <button
              type="button"
              data-testid="preset-kanban-btn"
              onClick={() => applyPreset('kanban')}
              className={`px-2.5 py-0.5 text-[11px] font-medium rounded transition ${
                maximizedPanel === 'kanban'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
              }`}
            >
              Kanban Focus
            </button>
            <button
              type="button"
              data-testid="preset-dag-btn"
              onClick={() => applyPreset('dag')}
              className={`px-2.5 py-0.5 text-[11px] font-medium rounded transition ${
                maximizedPanel === 'dag'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
              }`}
            >
              DAG Focus
            </button>
            <button
              type="button"
              data-testid="preset-timeline-btn"
              onClick={() => applyPreset('timeline')}
              className={`px-2.5 py-0.5 text-[11px] font-medium rounded transition ${
                maximizedPanel === 'timeline'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
              }`}
            >
              Timeline Focus
            </button>
          </div>
        </div>

        <div className="flex items-center space-x-2 text-[11px] text-slate-400">
          <span>Active:</span>
          <span className="font-mono text-sky-400 font-semibold">
            {maximizedPanel
              ? `${maximizedPanel.toUpperCase()} (Maximized)`
              : `${!collapsedPanels.kanban ? 'Kanban ' : ''}${!collapsedPanels.dag ? 'DAG ' : ''}${!collapsedPanels.timeline ? 'Timeline' : ''}`}
          </span>
          {(collapsedPanels.kanban || collapsedPanels.dag || collapsedPanels.timeline || maximizedPanel) && (
            <button
              type="button"
              onClick={() => applyPreset('all')}
              className="text-slate-400 hover:text-slate-200 underline decoration-slate-600 text-[10px] ml-1"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* 1. Kanban Board Section */}
      <div
        className={`flex flex-col min-h-0 transition-all ${
          collapsedPanels.kanban
            ? 'flex-shrink-0'
            : maximizedPanel === 'kanban'
            ? 'flex-1'
            : !collapsedPanels.dag && !collapsedPanels.timeline
            ? 'flex-1'
            : 'flex-1'
        }`}
      >
        <KanbanBoard
          persona={persona}
          projectMode={projectMode}
          userRole={userRole}
          tasks={initialTasks}
          onTaskClick={(id) => setSelectedTaskId(id)}
          isCollapsed={collapsedPanels.kanban}
          onToggleCollapse={() => toggleCollapse('kanban')}
          isMaximized={maximizedPanel === 'kanban'}
          onToggleMaximize={() => toggleMaximize('kanban')}
        />
      </div>

      {/* Resizer Splitter 1: between Kanban & DAG */}
      {!collapsedPanels.kanban && !collapsedPanels.dag && !maximizedPanel && (
        <div
          data-testid="board-splitter-kanban-dag"
          onMouseDown={handleMouseDownSplitter1}
          className="h-2 relative bg-slate-900 border-y border-slate-800 hover:bg-sky-500/40 cursor-row-resize flex items-center justify-center transition-colors select-none z-10 group flex-shrink-0"
          title="Drag up or down to resize Kanban and DAG panels"
        >
          <div className="w-12 h-1 rounded-full bg-slate-700 group-hover:bg-sky-400 transition" />
        </div>
      )}

      {/* 2. DAG Graph Section */}
      <div
        style={
          !collapsedPanels.dag && !maximizedPanel && !collapsedPanels.kanban
            ? { height: `${dagHeight}px` }
            : !collapsedPanels.dag && maximizedPanel === 'dag'
            ? { flex: 1 }
            : {}
        }
        className={`flex flex-col min-h-0 border-t border-slate-800 transition-all ${
          collapsedPanels.dag ? 'flex-shrink-0' : ''
        }`}
      >
        <DagGraph
          initialNodes={effectiveDagNodes}
          isCollapsed={collapsedPanels.dag}
          onToggleCollapse={() => toggleCollapse('dag')}
          isMaximized={maximizedPanel === 'dag'}
          onToggleMaximize={() => toggleMaximize('dag')}
        />
      </div>

      {/* Resizer Splitter 2: between DAG & Timeline */}
      {!collapsedPanels.timeline && (!collapsedPanels.dag || !collapsedPanels.kanban) && !maximizedPanel && (
        <div
          data-testid="board-splitter-dag-timeline"
          onMouseDown={handleMouseDownSplitter2}
          className="h-2 relative bg-slate-900 border-y border-slate-800 hover:bg-sky-500/40 cursor-row-resize flex items-center justify-center transition-colors select-none z-10 group flex-shrink-0"
          title="Drag up or down to resize DAG and Time-Travel panels"
        >
          <div className="w-12 h-1 rounded-full bg-slate-700 group-hover:bg-sky-400 transition" />
        </div>
      )}

      {/* 3. Time-Travel Trajectory Inspector Section */}
      <div
        style={
          !collapsedPanels.timeline && !maximizedPanel && (!collapsedPanels.kanban || !collapsedPanels.dag)
            ? { height: `${timelineHeight}px` }
            : !collapsedPanels.timeline && maximizedPanel === 'timeline'
            ? { flex: 1 }
            : {}
        }
        className={`flex flex-col min-h-0 transition-all ${
          collapsedPanels.timeline ? 'flex-shrink-0' : ''
        }`}
      >
        <TimeTravelSlider
          snapshots={initialSnapshots}
          isCollapsed={collapsedPanels.timeline}
          onToggleCollapse={() => toggleCollapse('timeline')}
          isMaximized={maximizedPanel === 'timeline'}
          onToggleMaximize={() => toggleMaximize('timeline')}
        />
      </div>

      {/* Task Details Slide-Over Drawer */}
      {selectedTask && (
        <div
          data-testid="task-detail-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in"
          onClick={() => {
            setSelectedTaskId(null);
            setModalError(null);
          }}
        >
          <div
            className="w-full max-w-lg rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <code dir="ltr" className="text-sm font-bold text-sky-400 font-mono bg-sky-950 px-2 py-0.5 rounded border border-sky-800">
                  {selectedTask.id}
                </code>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    selectedTask.priority === 'CRITICAL'
                      ? 'bg-rose-950 text-rose-300 border border-rose-800'
                      : selectedTask.priority === 'HIGH'
                      ? 'bg-amber-950 text-amber-300 border border-amber-800'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {selectedTask.priority}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedTaskId(null);
                  setModalError(null);
                }}
                className="text-slate-400 hover:text-white text-base px-2 py-1 rounded hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            {modalError && (
              <div
                data-testid="task-modal-error"
                className="rounded-lg bg-rose-950/90 border border-rose-800 p-3 text-xs text-rose-200 flex items-start justify-between gap-2"
              >
                <span>⚠️ {modalError}</span>
                <button
                  type="button"
                  onClick={() => setModalError(null)}
                  className="text-rose-400 hover:text-white font-bold"
                >
                  ✕
                </button>
              </div>
            )}

            <div>
              <h3 className="text-base font-bold text-white mb-2">{selectedTask.title}</h3>
              <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-slate-400 text-[10px] block mb-0.5">CURRENT STATUS</span>
                  <span className="text-sky-300 font-semibold">{selectedTask.status}</span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-slate-400 text-[10px] block mb-0.5">SPEND ACCUMULATED</span>
                  <span className="text-emerald-400 font-semibold">${selectedTask.spendUsd.toFixed(3)}</span>
                </div>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2 text-xs">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">Assigned Cognitive Tier</span>
              <div className="flex items-center space-x-2">
                <span className="text-base">🤖</span>
                <span className="font-mono text-slate-200">{selectedTask.assignedTier || 'Dev-Level-3 (Implementer)'}</span>
              </div>
            </div>

            {/* Task Description & Implementation Plan */}
            {(selectedTask.description || selectedTask.title.length > 60) && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase text-slate-400 block tracking-wider">
                  📋 Implementation Brief & Requirements
                </span>
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 max-h-56 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                  {selectedTask.description || selectedTask.title}
                </div>
              </div>
            )}

            {selectedTask.status === 'AWAITING_CLARIFICATION' && (
              <div
                data-testid="clarification-resolution-box"
                className="p-3 rounded-lg bg-amber-950/50 border border-amber-800 space-y-2 text-xs"
              >
                <span className="text-[10px] font-bold uppercase text-amber-300 block">
                  ❓ Agent Ambiguity Escalation — Clarification Required
                </span>
                <p className="text-slate-300 text-[11px]">
                  Provide architectural guidance to resolve the blocked subtask and resume container execution:
                </p>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    data-testid="clarification-input"
                    value={clarificationAnswer}
                    onChange={(e) => setClarificationAnswer(e.target.value)}
                    placeholder="Enter architectural decision or constraint..."
                    className="flex-1 rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    data-testid="submit-clarification-btn"
                    disabled={isActionLoading || !clarificationAnswer.trim()}
                    onClick={async () => {
                      setIsActionLoading(true);
                      setModalError(null);
                      try {
                        await onAnswerClarification?.(selectedTask.id, clarificationAnswer.trim());
                        setClarificationAnswer('');
                        setSelectedTaskId(null);
                      } catch (err: any) {
                        setModalError(err?.message || 'Failed to submit clarification');
                      } finally {
                        setIsActionLoading(false);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-bold text-white shadow transition disabled:opacity-50"
                  >
                    Resolve & Resume
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <div className="flex items-center space-x-2">
                {(selectedTask.status === 'BACKLOG' || selectedTask.status === 'QUEUED') && (
                  <button
                    type="button"
                    disabled={isActionLoading}
                    onClick={async () => {
                      setIsActionLoading(true);
                      setModalError(null);
                      try {
                        await onDispatchTask?.(selectedTask.id);
                        setSelectedTaskId(null);
                      } catch (err: any) {
                        setModalError(err?.message || 'Failed to dispatch task');
                      } finally {
                        setIsActionLoading(false);
                      }
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow transition flex items-center space-x-1.5 disabled:opacity-50"
                  >
                    <span>🚀</span>
                    <span>Dispatch Squad</span>
                  </button>
                )}

                {selectedTask.status === 'IN_PROGRESS' && (
                  <>
                    <button
                      type="button"
                      disabled={isActionLoading}
                      onClick={async () => {
                        setIsActionLoading(true);
                        setModalError(null);
                        try {
                          await onTransitionTask?.(selectedTask.id, 'INTERNAL_REVIEW');
                          setSelectedTaskId(null);
                        } catch (err: any) {
                          setModalError(err?.message || 'Failed to transition task');
                        } finally {
                          setIsActionLoading(false);
                        }
                      }}
                      className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white shadow transition disabled:opacity-50"
                    >
                      Submit for Review
                    </button>
                    <button
                      type="button"
                      data-testid="request-clarification-btn"
                      disabled={isActionLoading}
                      onClick={async () => {
                        setIsActionLoading(true);
                        setModalError(null);
                        try {
                          await onTransitionTask?.(selectedTask.id, 'AWAITING_CLARIFICATION');
                        } catch (err: any) {
                          setModalError(err?.message || 'Failed to request clarification');
                        } finally {
                          setIsActionLoading(false);
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-amber-700/80 hover:bg-amber-600 text-xs font-bold text-amber-100 border border-amber-600 transition disabled:opacity-50"
                    >
                      ❓ Escalate Clarification
                    </button>
                  </>
                )}

                {selectedTask.status === 'INTERNAL_REVIEW' && (
                  <button
                    type="button"
                    disabled={isActionLoading}
                    onClick={async () => {
                      setIsActionLoading(true);
                      setModalError(null);
                      try {
                        await onTransitionTask?.(selectedTask.id, 'GUARD_VERIFYING');
                        setSelectedTaskId(null);
                      } catch (err: any) {
                        setModalError(err?.message || 'Failed to transition task');
                      } finally {
                        setIsActionLoading(false);
                      }
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-xs font-bold text-white shadow transition disabled:opacity-50"
                  >
                    Run QA Guard
                  </button>
                )}

                {selectedTask.status === 'GUARD_VERIFYING' && (
                  <button
                    type="button"
                    disabled={isActionLoading}
                    onClick={async () => {
                      setIsActionLoading(true);
                      setModalError(null);
                      try {
                        await onTransitionTask?.(selectedTask.id, 'HUMAN_REVIEW_GATE');
                        setSelectedTaskId(null);
                      } catch (err: any) {
                        setModalError(err?.message || 'Failed to transition task');
                      } finally {
                        setIsActionLoading(false);
                      }
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-bold text-white shadow transition disabled:opacity-50"
                  >
                    Ready for Human Review Gate
                  </button>
                )}

                {selectedTask.status === 'HUMAN_REVIEW_GATE' && (
                  <>
                    <button
                      type="button"
                      data-testid="approve-merge-btn"
                      disabled={isActionLoading}
                      onClick={async () => {
                        setIsActionLoading(true);
                        setModalError(null);
                        try {
                          await onApproveTask?.(selectedTask.id);
                          setSelectedTaskId(null);
                        } catch (err: any) {
                          setModalError(err?.message || 'Failed to approve review gate');
                        } finally {
                          setIsActionLoading(false);
                        }
                      }}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow transition flex items-center space-x-1.5 disabled:opacity-50"
                    >
                      <span>✅</span>
                      <span>Approve & Merge PR</span>
                    </button>
                    <button
                      type="button"
                      data-testid="reject-review-gate-btn"
                      disabled={isActionLoading}
                      onClick={async () => {
                        setIsActionLoading(true);
                        setModalError(null);
                        try {
                          await onTransitionTask?.(selectedTask.id, 'IN_PROGRESS');
                          setSelectedTaskId(null);
                        } catch (err: any) {
                          setModalError(err?.message || 'Failed to return task to in-progress');
                        } finally {
                          setIsActionLoading(false);
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-rose-900/80 hover:bg-rose-800 text-xs font-bold text-rose-100 border border-rose-700 transition disabled:opacity-50"
                    >
                      ↩ Request Changes
                    </button>
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setSelectedTaskId(null);
                  setModalError(null);
                }}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition"
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default BoardLayout;
