import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

// BiDi
import {
  BidiProse,
  CodeIsolate,
  postProcessBidiDocument,
  verifyBidiCompliance,
  LTR_ISOLATE_START,
  LTR_ISOLATE_END,
} from '../src/lib/bidi';

// Cockpit
import {
  AccessModePill,
  canEditAccessModePill,
} from '../src/components/cockpit/AccessModePill';
import {
  SpendTicker,
  applyCostDeltaEvent,
  SpendTickerState,
} from '../src/components/cockpit/SpendTicker';
import { ChatCockpit } from '../src/components/cockpit/ChatCockpit';

// Right Panel
import {
  loadPersistedRightPanelState,
  savePersistedRightPanelState,
  RIGHT_PANEL_LAZY_TABS,
} from '../src/components/cockpit/RightPanel';

// Board & DAG
import {
  KanbanBoard,
  getKanbanColumnsForView,
} from '../src/components/board/KanbanBoard';
import {
  connectDagDependencyEdge,
  DagTaskNode,
} from '../src/components/board/DagGraph';
import {
  TimeTravelSlider,
  selectTrajectorySnapshotAtStep,
  TrajectorySnapshot,
} from '../src/components/board/TimeTravelSlider';
import { BoardLayout } from '../src/components/board/BoardLayout';

describe('Cockpit & Dashboard Components Unit & Integration Tests (Phase 12)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('1. BiDi Isolation & Document Post-Processor (Task 12.1)', () => {
    it('BidiProse renders with appropriate dir and alignment attributes', () => {
      const { container: enContainer } = render(
        <BidiProse locale="en">
          <p>English content</p>
        </BidiProse>
      );
      const enEl = enContainer.querySelector('[data-testid="bidi-prose"]');
      expect(enEl?.getAttribute('dir')).toBe('ltr');
      expect(enEl?.className).toContain('text-left');

      const { container: arContainer } = render(
        <BidiProse locale="ar">
          <p>محتوى عربي</p>
        </BidiProse>
      );
      const arEl = arContainer.querySelector('[data-testid="bidi-prose"]');
      expect(arEl?.getAttribute('dir')).toBe('rtl');
      expect(arEl?.className).toContain('text-right');
    });

    it('CodeIsolate enforces dir="ltr" and isolate styles', () => {
      const { container } = render(
        <CodeIsolate as="code">src/auth/service.ts</CodeIsolate>
      );
      const codeEl = container.querySelector('[data-testid="code-isolate"]');
      expect(codeEl?.getAttribute('dir')).toBe('ltr');
      expect(codeEl?.getAttribute('style')).toContain('unicode-bidi: isolate');
      expect(codeEl?.textContent).toBe('src/auth/service.ts');
    });

    it('postProcessBidiDocument wraps code spans, file paths, and CLI flags with LTR isolate markers', () => {
      const inputMarkdown =
        'قم بتشغيل الأمر `--skip-grill` وافحص الملف `src/orchestrator/routes/chat.ts` للتأكد من المسار ./config/seccomp.json';
      const processed = postProcessBidiDocument(inputMarkdown, 'ar');

      // Inline backticks wrapped in <code dir="ltr"> with \u2066...\u2069
      expect(processed).toContain(`dir="ltr" class="bidi-isolate"`);
      expect(processed).toContain(LTR_ISOLATE_START);
      expect(processed).toContain(LTR_ISOLATE_END);
      expect(processed).toContain(`--skip-grill`);
      expect(processed).toContain(`src/orchestrator/routes/chat.ts`);

      // Verify compliance
      const compliance = verifyBidiCompliance(processed);
      expect(compliance.compliant).toBe(true);
      expect(compliance.violations).toHaveLength(0);
    });

    it('verifyBidiCompliance detects unisolated <code> tags', () => {
      const nonCompliantHtml = '<div><p>Raw text</p><code>unisolated code</code></div>';
      const check = verifyBidiCompliance(nonCompliantHtml);
      expect(check.compliant).toBe(false);
      expect(check.violations.length).toBeGreaterThan(0);
    });
  });

  describe('2. AccessModePill & Role RBAC (Task 12.3)', () => {
    it('canEditAccessModePill allows developer, lead_dev, owner and denies viewer', () => {
      expect(canEditAccessModePill('owner')).toBe(true);
      expect(canEditAccessModePill('lead_dev')).toBe(true);
      expect(canEditAccessModePill('developer')).toBe(true);
      expect(canEditAccessModePill('viewer')).toBe(false);
    });

    it('AccessModePill renders editable pill for developer and cycles states on click', () => {
      const handleChange = vi.fn();
      render(
        <AccessModePill
          value="plan-read-only"
          role="developer"
          onChange={handleChange}
        />
      );

      const pill = screen.getByTestId('access-mode-pill');
      expect(pill.getAttribute('data-editable')).toBe('true');
      expect(pill.textContent).toContain('Plan / Read-Only');

      fireEvent.click(pill);
      expect(handleChange).toHaveBeenCalledWith('plan-gate');
    });

    it('AccessModePill renders locked read-only display for viewer role', () => {
      const handleChange = vi.fn();
      render(
        <AccessModePill
          value="full-factory"
          role="viewer"
          onChange={handleChange}
        />
      );

      const pill = screen.getByTestId('access-mode-pill');
      expect(pill.getAttribute('data-editable')).toBe('false');
      expect(pill.textContent).toContain('🔒');

      fireEvent.click(pill);
      expect(handleChange).not.toHaveBeenCalled();
    });
  });

  describe('3. SpendTicker & Cost Accumulator (Task 12.3)', () => {
    it('applyCostDeltaEvent increments task, workspace spend, and token count', () => {
      const initial: SpendTickerState = {
        taskId: 'TASK-101',
        taskSpendUsd: 0.01,
        workspaceDailySpendUsd: 1.0,
        dailySpendCapUsd: 50.0,
        totalTokens: 1000,
        connectionStatus: 'connected',
      };

      const delta = {
        taskId: 'TASK-101',
        costUsdDelta: 0.005,
        tokensDelta: 250,
      };

      const updated = applyCostDeltaEvent(initial, delta);
      expect(updated.taskSpendUsd).toBe(0.015);
      expect(updated.workspaceDailySpendUsd).toBe(1.005);
      expect(updated.totalTokens).toBe(1250);
    });

    it('SpendTicker renders formatted values and connection status indicator', () => {
      const state: SpendTickerState = {
        taskId: 'TASK-101',
        taskSpendUsd: 0.0425,
        workspaceDailySpendUsd: 12.5,
        dailySpendCapUsd: 50.0,
        totalTokens: 18450,
        connectionStatus: 'connected',
      };

      render(<SpendTicker state={state} />);

      expect(screen.getByTestId('task-spend').textContent).toContain('$0.0425');
      expect(screen.getByTestId('daily-spend').textContent).toContain('$12.50 / $50.00');
      expect(screen.getByTestId('total-tokens').textContent).toContain('18,450');
      expect(screen.getByTestId('connection-indicator').className).toContain('bg-emerald-400');
    });
  });

  describe('4. ChatCockpit, Panic Button & GRILL Confirmation (Task 12.3)', () => {
    it('renders Panic Button and calls onCancelTask when clicked', async () => {
      const handleCancel = vi.fn().mockResolvedValue({ status: 'CANCELLED' });

      render(
        <ChatCockpit
          conversationId="conv-1"
          projectId="proj-1"
          activeTaskId="TASK-101"
          userRole="developer"
          onCancelTask={handleCancel}
        />
      );

      const panicBtn = screen.getByTestId('panic-cancel-button');
      expect(panicBtn).toBeInTheDocument();

      await act(async () => {
        await fireEvent.click(panicBtn);
      });
      expect(handleCancel).toHaveBeenCalledWith('TASK-101');
    });

    it('toggles Socratic GRILL mode on toolbar button click', () => {
      render(
        <ChatCockpit
          conversationId="conv-1"
          projectId="proj-1"
          userRole="developer"
          initialCockpitMode="STANDARD"
        />
      );

      const toggleBtn = screen.getByTestId('grill-mode-toggle');
      expect(toggleBtn.textContent).toContain('Standard Chat');

      fireEvent.click(toggleBtn);
      expect(toggleBtn.textContent).toContain('GRILL Active');
    });
  });

  describe('5. RightPanel & Lazy Tab Chunk Segregation (Task 12.4)', () => {
    it('persists widthPx and activeTab per conversation in localStorage', () => {
      const mockStorage = {
        data: {} as Record<string, string>,
        getItem(key: string) {
          return this.data[key] || null;
        },
        setItem(key: string, val: string) {
          this.data[key] = val;
        },
      };

      savePersistedRightPanelState(
        'conv-alpha',
        { widthPx: 560, activeTab: 'terminal' },
        mockStorage
      );

      const loaded = loadPersistedRightPanelState('conv-alpha', mockStorage);
      expect(loaded.widthPx).toBe(560);
      expect(loaded.activeTab).toBe('terminal');
    });

    it('clamps widthPx within [320, 960] bounds', () => {
      const mockStorage = {
        data: {} as Record<string, string>,
        getItem(key: string) {
          return this.data[key] || null;
        },
        setItem(key: string, val: string) {
          this.data[key] = val;
        },
      };

      savePersistedRightPanelState(
        'conv-clamp',
        { widthPx: 1200, activeTab: 'files' },
        mockStorage
      );
      const loadedMax = loadPersistedRightPanelState('conv-clamp', mockStorage);
      expect(loadedMax.widthPx).toBe(960);

      savePersistedRightPanelState(
        'conv-min',
        { widthPx: 100, activeTab: 'commits' },
        mockStorage
      );
      const loadedMin = loadPersistedRightPanelState('conv-min', mockStorage);
      expect(loadedMin.widthPx).toBe(320);
    });

    it('verifies all 6 RightPanel tab modules are configured as lazy imports', () => {
      const tabKeys = Object.keys(RIGHT_PANEL_LAZY_TABS);
      expect(tabKeys).toEqual(['files', 'commits', 'planner', 'terminal', 'browser', 'usage']);

      // Each tab loader must be a function
      tabKeys.forEach((key) => {
        expect(typeof RIGHT_PANEL_LAZY_TABS[key as keyof typeof RIGHT_PANEL_LAZY_TABS]).toBe('function');
      });
    });
  });

  describe('6. KanbanBoard Persona Views (Task 12.5)', () => {
    it('getKanbanColumnsForView returns 8 columns in Developer view covering all 16 states', () => {
      const devView = getKanbanColumnsForView({
        persona: 'developer',
        projectMode: 'greenfield',
        userRole: 'developer',
      });

      expect(devView.viewMode).toBe('developer');
      expect(devView.columns).toHaveLength(8);
      expect(devView.hideAstDiffsByDefault).toBe(false);

      // Collect all mapped statuses
      const allMapped = devView.columns.flatMap((col) => col.statuses);
      expect(allMapped).toContain('BACKLOG');
      expect(allMapped).toContain('IN_PROGRESS');
      expect(allMapped).toContain('INTERNAL_REVIEW');
      expect(allMapped).toContain('GUARD_VERIFYING');
      expect(allMapped).toContain('HUMAN_REVIEW_GATE');
      expect(allMapped).toContain('MERGED');
    });

    it('getKanbanColumnsForView returns 5 columns in Maker view and collapses technical tabs', () => {
      const makerView = getKanbanColumnsForView({
        persona: 'maker',
        projectMode: 'greenfield',
        userRole: 'developer',
      });

      expect(makerView.viewMode).toBe('maker');
      expect(makerView.columns).toHaveLength(5);
      expect(makerView.columns.map((c) => c.id)).toEqual([
        'ideas',
        'planning',
        'building',
        'ready_to_review',
        'live',
      ]);
      expect(makerView.collapsedTabs).toEqual(['files', 'commits', 'terminal']);
      expect(makerView.visibleTabs).toEqual(['browser', 'planner']);
      expect(makerView.hideAstDiffsByDefault).toBe(true);
    });

    it('getKanbanColumnsForView returns viewer mode for viewer role', () => {
      const viewerView = getKanbanColumnsForView({
        persona: 'developer',
        projectMode: 'greenfield',
        userRole: 'viewer',
      });

      expect(viewerView.viewMode).toBe('viewer');
      expect(viewerView.columns).toHaveLength(0);
      expect(viewerView.hideAstDiffsByDefault).toBe(true);
    });

    it('renders Viewer / Client Stakeholder Dashboard when userRole is viewer', () => {
      render(
        <KanbanBoard
          userRole="viewer"
          goal="Deliver multi-currency invoice export"
          tasks={[
            { id: 'T-1', title: 'Route', status: 'MERGED', priority: 'HIGH', spendUsd: 1.2 },
            { id: 'T-2', title: 'UI', status: 'IN_PROGRESS', priority: 'MEDIUM', spendUsd: 0.8 },
          ]}
        />
      );

      expect(screen.getByTestId('viewer-dashboard')).toBeInTheDocument();
      expect(screen.getByTestId('viewer-goal').textContent).toContain('Deliver multi-currency invoice export');
      expect(screen.getByTestId('viewer-progress-percent').textContent).toBe('50%');
      expect(screen.getByTestId('viewer-spend').textContent).toBe('$2.00');
    });
  });

  describe('7. DagGraph & TimeTravelSlider (Task 12.5)', () => {
    it('connectDagDependencyEdge allows valid acyclic edge', () => {
      const nodes: DagTaskNode[] = [
        { id: 'A', status: 'BACKLOG', blockedBy: [], writableScope: [] },
        { id: 'B', status: 'BACKLOG', blockedBy: [], writableScope: [] },
      ];

      // Connect A -> B (B blockedBy A)
      const res = connectDagDependencyEdge(nodes, 'A', 'B');
      expect(res.cycle).toBe(false);
      if (!res.cycle) {
        expect(res.targetBlockedBy).toContain('A');
      }
    });

    it('connectDagDependencyEdge detects and rejects cyclic edge', () => {
      const nodes: DagTaskNode[] = [
        { id: 'A', status: 'BACKLOG', blockedBy: [], writableScope: [] },
        { id: 'B', status: 'BACKLOG', blockedBy: ['A'], writableScope: [] },
      ];

      // Connecting B -> A would create A -> B -> A cycle
      const res = connectDagDependencyEdge(nodes, 'B', 'A');
      expect(res.cycle).toBe(true);
      if (res.cycle) {
        expect(res.cyclePath).toBeDefined();
        expect(res.cyclePath.length).toBeGreaterThan(1);
      }
    });

    it('selectTrajectorySnapshotAtStep clamps boundary and retrieves correct snapshot', () => {
      const snapshots: TrajectorySnapshot[] = [
        {
          seq: 0,
          timestamp: '15:00',
          narrativeAction: 'Recon completed',
          actorTier: 'planner',
          fileMutations: [],
        },
        {
          seq: 1,
          timestamp: '15:05',
          narrativeAction: 'Code implemented',
          actorTier: 'implementer',
          fileMutations: [],
        },
      ];

      expect(selectTrajectorySnapshotAtStep(snapshots, 0)?.narrativeAction).toBe('Recon completed');
      expect(selectTrajectorySnapshotAtStep(snapshots, 1)?.narrativeAction).toBe('Code implemented');
      expect(selectTrajectorySnapshotAtStep(snapshots, 99)?.narrativeAction).toBe('Code implemented');
    });

    it('TimeTravelSlider toggles Surface B raw terminal drawer', () => {
      render(<TimeTravelSlider />);

      expect(screen.getByTestId('surface-a-narrative')).toBeInTheDocument();
      expect(screen.queryByTestId('surface-b-terminal-drawer')).not.toBeInTheDocument();

      const toggleBtn = screen.getByTestId('toggle-surface-b-btn');
      fireEvent.click(toggleBtn);

      expect(screen.getByTestId('surface-b-terminal-drawer')).toBeInTheDocument();
    });
  });

  describe('8. BoardLayout, Resizable Splitters & Collapsible Panels', () => {
    it('BoardLayout renders all panels and splitters by default', () => {
      render(<BoardLayout persona="developer" userRole="developer" />);

      expect(screen.getByTestId('board-container')).toBeInTheDocument();
      expect(screen.getByTestId('kanban-board')).toBeInTheDocument();
      expect(screen.getByTestId('dag-graph')).toBeInTheDocument();
      expect(screen.getByTestId('time-travel-slider')).toBeInTheDocument();
      expect(screen.getByTestId('board-splitter-kanban-dag')).toBeInTheDocument();
      expect(screen.getByTestId('board-splitter-dag-timeline')).toBeInTheDocument();
    });

    it('collapses and expands Kanban board', () => {
      render(<BoardLayout persona="developer" userRole="developer" />);

      const collapseKanbanBtn = screen.getByTestId('collapse-kanban-btn');
      fireEvent.click(collapseKanbanBtn);

      expect(screen.queryByTestId('kanban-board')).not.toBeInTheDocument();
      expect(screen.getByTestId('kanban-board-collapsed')).toBeInTheDocument();

      const expandKanbanBtn = screen.getByTestId('expand-kanban-btn');
      fireEvent.click(expandKanbanBtn);

      expect(screen.getByTestId('kanban-board')).toBeInTheDocument();
      expect(screen.queryByTestId('kanban-board-collapsed')).not.toBeInTheDocument();
    });

    it('collapses and expands DAG Visualizer', () => {
      render(<BoardLayout persona="developer" userRole="developer" />);

      const collapseDagBtn = screen.getByTestId('collapse-dag-btn');
      fireEvent.click(collapseDagBtn);

      expect(screen.queryByTestId('dag-graph')).not.toBeInTheDocument();
      expect(screen.getByTestId('dag-graph-collapsed')).toBeInTheDocument();

      const expandDagBtn = screen.getByTestId('expand-dag-btn');
      fireEvent.click(expandDagBtn);

      expect(screen.getByTestId('dag-graph')).toBeInTheDocument();
      expect(screen.queryByTestId('dag-graph-collapsed')).not.toBeInTheDocument();
    });

    it('collapses and expands TimeTravelSlider', () => {
      render(<BoardLayout persona="developer" userRole="developer" />);

      const collapseTimelineBtn = screen.getByTestId('collapse-timeline-btn');
      fireEvent.click(collapseTimelineBtn);

      expect(screen.queryByTestId('time-travel-slider')).not.toBeInTheDocument();
      expect(screen.getByTestId('time-travel-slider-collapsed')).toBeInTheDocument();

      const expandTimelineBtn = screen.getByTestId('expand-timeline-btn');
      fireEvent.click(expandTimelineBtn);

      expect(screen.getByTestId('time-travel-slider')).toBeInTheDocument();
      expect(screen.queryByTestId('time-travel-slider-collapsed')).not.toBeInTheDocument();
    });

    it('maximizes and restores panel via preset buttons', () => {
      render(<BoardLayout persona="developer" userRole="developer" />);

      // Kanban Focus Preset
      const kanbanPresetBtn = screen.getByTestId('preset-kanban-btn');
      fireEvent.click(kanbanPresetBtn);

      expect(screen.getByTestId('kanban-board')).toBeInTheDocument();
      expect(screen.getByTestId('dag-graph-collapsed')).toBeInTheDocument();
      expect(screen.getByTestId('time-travel-slider-collapsed')).toBeInTheDocument();

      // DAG Focus Preset
      const dagPresetBtn = screen.getByTestId('preset-dag-btn');
      fireEvent.click(dagPresetBtn);

      expect(screen.getByTestId('kanban-board-collapsed')).toBeInTheDocument();
      expect(screen.getByTestId('dag-graph')).toBeInTheDocument();
      expect(screen.getByTestId('time-travel-slider-collapsed')).toBeInTheDocument();

      // Split View Preset
      const splitPresetBtn = screen.getByTestId('preset-all-btn');
      fireEvent.click(splitPresetBtn);

      expect(screen.getByTestId('kanban-board')).toBeInTheDocument();
      expect(screen.getByTestId('dag-graph')).toBeInTheDocument();
      expect(screen.getByTestId('time-travel-slider')).toBeInTheDocument();
    });

    it('opens task details modal when a task card is clicked', () => {
      render(<BoardLayout persona="developer" userRole="developer" />);

      const taskCard = screen.getByTestId('kanban-task-TASK-101');
      fireEvent.click(taskCard);

      const modal = screen.getByTestId('task-detail-modal');
      expect(modal).toBeInTheDocument();
      expect(modal.textContent).toContain('Fastify Vercel AI SDK route');

      // Close modal
      const closeBtn = screen.getByText('Close Details');
      fireEvent.click(closeBtn);

      expect(screen.queryByTestId('task-detail-modal')).not.toBeInTheDocument();
    });
  });
});
