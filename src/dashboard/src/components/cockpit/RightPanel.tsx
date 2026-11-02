import React, { Suspense, lazy, useState, useEffect, useRef } from 'react';
import type { VNode } from '../../lib/jsx-runtime';

export type RightPanelTabId = 'files' | 'commits' | 'planner' | 'terminal' | 'browser' | 'usage';

export const RIGHT_PANEL_LAZY_TABS: Record<
  RightPanelTabId,
  () => Promise<{ default: (props: Record<string, unknown>) => VNode }>
> = {
  files: () => import('./tabs/FilesTab') as Promise<{ default: (props: Record<string, unknown>) => VNode }>,
  commits: () => import('./tabs/CommitsTab') as Promise<{ default: (props: Record<string, unknown>) => VNode }>,
  planner: () => import('./tabs/PlannerTab') as Promise<{ default: (props: Record<string, unknown>) => VNode }>,
  terminal: () => import('./tabs/TerminalTab') as Promise<{ default: (props: Record<string, unknown>) => VNode }>,
  browser: () => import('./tabs/BrowserTab') as Promise<{ default: (props: Record<string, unknown>) => VNode }>,
  usage: () => import('./tabs/UsageTab') as Promise<{ default: (props: Record<string, unknown>) => VNode }>,
};

const LazyFilesTab = lazy(RIGHT_PANEL_LAZY_TABS.files);
const LazyCommitsTab = lazy(RIGHT_PANEL_LAZY_TABS.commits);
const LazyPlannerTab = lazy(RIGHT_PANEL_LAZY_TABS.planner);
const LazyTerminalTab = lazy(RIGHT_PANEL_LAZY_TABS.terminal);
const LazyBrowserTab = lazy(RIGHT_PANEL_LAZY_TABS.browser);
const LazyUsageTab = lazy(RIGHT_PANEL_LAZY_TABS.usage);

export function loadPersistedRightPanelState(
  conversationId: string,
  storage?: Pick<Storage, 'getItem'>
): { widthPx: number; activeTab: RightPanelTabId } {
  const store = storage || (typeof window !== 'undefined' ? window.localStorage : undefined);
  if (!store) {
    return { widthPx: 480, activeTab: 'files' };
  }

  try {
    const raw = store.getItem(`graywolf:right-panel:${conversationId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      const width = Math.min(960, Math.max(320, Number(parsed.widthPx) || 480));
      const validTabs: RightPanelTabId[] = ['files', 'commits', 'planner', 'terminal', 'browser', 'usage'];
      const tab = validTabs.includes(parsed.activeTab) ? parsed.activeTab : 'files';
      return { widthPx: width, activeTab: tab };
    }
  } catch {
    // fallback
  }

  return { widthPx: 480, activeTab: 'files' };
}

export function savePersistedRightPanelState(
  conversationId: string,
  state: { widthPx: number; activeTab: RightPanelTabId },
  storage?: Pick<Storage, 'setItem'>
): void {
  const store = storage || (typeof window !== 'undefined' ? window.localStorage : undefined);
  if (!store) return;

  try {
    const clampedWidth = Math.min(960, Math.max(320, state.widthPx));
    store.setItem(
      `graywolf:right-panel:${conversationId}`,
      JSON.stringify({ widthPx: clampedWidth, activeTab: state.activeTab })
    );
  } catch {
    // ignore quota errors
  }
}

export interface RightPanelProps {
  conversationId: string;
  initialIsOpen?: boolean;
  onSelectFile?: (path: string) => void;
  className?: string;
}

export function RightPanel({
  conversationId,
  initialIsOpen = true,
  onSelectFile,
  className = '',
}: RightPanelProps): React.ReactElement {
  // Session-only open/closed state (never persisted per ADR-053)
  const [isOpen, setIsOpen] = useState(initialIsOpen);

  const initialPersisted = loadPersistedRightPanelState(conversationId);
  const [widthPx, setWidthPx] = useState(initialPersisted.widthPx);
  const [activeTab, setActiveTab] = useState<RightPanelTabId>(initialPersisted.activeTab);

  const isDraggingRef = useRef(false);

  useEffect(() => {
    savePersistedRightPanelState(conversationId, { widthPx, activeTab });
  }, [conversationId, widthPx, activeTab]);

  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const newWidth = window.innerWidth - moveEvent.clientX;
      const clamped = Math.min(960, Math.max(320, newWidth));
      setWidthPx(clamped);
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        data-testid="open-right-panel-btn"
        onClick={() => setIsOpen(true)}
        className="fixed right-4 bottom-4 z-20 rounded-full bg-sky-600 p-3 text-white shadow-xl hover:bg-sky-500 transition border border-sky-400"
        title="Open Right Panel Drawer"
      >
        📑
      </button>
    );
  }

  const tabs: Array<{ id: RightPanelTabId; label: string; icon: string }> = [
    { id: 'files', label: 'Files', icon: '📄' },
    { id: 'commits', label: 'Commits', icon: '🌳' },
    { id: 'planner', label: 'Planner', icon: '📋' },
    { id: 'terminal', label: 'Terminal', icon: '💻' },
    { id: 'browser', label: 'Browser', icon: '🌐' },
    { id: 'usage', label: 'Usage', icon: '📊' },
  ];

  return (
    <aside
      data-testid="right-panel"
      data-active-tab={activeTab}
      style={{ width: `${widthPx}px` }}
      className={`relative flex flex-col h-full bg-slate-950 border-l border-slate-800 shadow-2xl transition-all ${className}`.trim()}
    >
      {/* Resizer Handle */}
      <div
        data-testid="resize-handle"
        onMouseDown={handleMouseDownResize}
        className="absolute top-0 bottom-0 -left-1.5 w-3 cursor-ew-resize hover:bg-sky-500/30 transition z-10"
        title="Drag to resize panel"
      />

      {/* Panel Tab Navigation Bar */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-2 py-1.5">
        <nav className="flex space-x-1 overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                data-testid={`tab-button-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-1 px-2.5 py-1 text-xs font-semibold rounded transition ${
                  isActive
                    ? 'bg-sky-950 text-sky-300 border border-sky-800 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Close Button: session-only */}
        <button
          type="button"
          data-testid="close-right-panel-btn"
          onClick={() => setIsOpen(false)}
          className="rounded p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          title="Close panel (session-only)"
        >
          ✕
        </button>
      </div>

      {/* Lazy-Loaded Tab Viewport */}
      <div className="flex-1 overflow-hidden">
        <Suspense
          fallback={
            <div data-testid="tab-loading-spinner" className="flex items-center justify-center h-full text-xs text-slate-500 font-mono">
              Loading {activeTab} view...
            </div>
          }
        >
          {activeTab === 'files' && <LazyFilesTab onSelectFile={onSelectFile} />}
          {activeTab === 'commits' && <LazyCommitsTab />}
          {activeTab === 'planner' && <LazyPlannerTab />}
          {activeTab === 'terminal' && <LazyTerminalTab />}
          {activeTab === 'browser' && <LazyBrowserTab />}
          {activeTab === 'usage' && <LazyUsageTab />}
        </Suspense>
      </div>
    </aside>
  );
}

export default RightPanel;
