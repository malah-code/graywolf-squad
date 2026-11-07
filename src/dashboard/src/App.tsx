import React, { useState } from 'react';
import { DashboardProvider, useDashboard } from './context/DashboardContext';
import type { SupportedLocale, WorkspaceRole, DashboardPersona, ActiveView } from './context/DashboardContext';
import { ChatCockpit } from './components/cockpit/ChatCockpit';
import { RightPanel } from './components/cockpit/RightPanel';
import { BoardLayout } from './components/board/BoardLayout';
import { NewProjectModal } from './components/common/NewProjectModal';

export function DashboardHeader() {
  const {
    role,
    setRole,
    persona,
    setPersona,
    locale,
    setLocale,
    activeView,
    setActiveView,
    projects,
    activeProjectId,
    setActiveProjectId,
    createProject,
  } = useDashboard();

  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-4 py-3 backdrop-blur flex-shrink-0">
        <div className="flex items-center space-x-3">
          <span className="text-xl">🐺</span>
          <h1 className="text-lg font-bold tracking-tight text-white">Graywolf Squad</h1>
          <span className="rounded bg-sky-950/80 px-2 py-0.5 text-xs font-medium text-sky-400 border border-sky-800">
            Cockpit
          </span>

          {/* Project Selector & New Project Button */}
          <div className="flex items-center space-x-2 pl-3 border-l border-slate-800">
            {projects.length > 0 ? (
              <select
                data-testid="project-select"
                value={activeProjectId || ''}
                onChange={(e) => setActiveProjectId(e.target.value)}
                className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-500 max-w-[180px] truncate"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    📁 {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-slate-400 font-mono">No active project</span>
            )}

            <button
              type="button"
              data-testid="new-project-btn"
              onClick={() => setIsModalOpen(true)}
              className="flex items-center space-x-1 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/40 px-2.5 py-1 text-xs font-bold text-sky-300 transition"
            >
              <span>+</span>
              <span>New Project</span>
            </button>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          {/* View Switcher: Cockpit vs Board */}
          <div className="flex rounded-lg bg-slate-800 p-1 border border-slate-700">
            <button
              type="button"
              data-testid="view-cockpit-btn"
              onClick={() => setActiveView('cockpit')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition ${
                activeView === 'cockpit' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Cockpit
            </button>
            <button
              type="button"
              data-testid="view-board-btn"
              onClick={() => setActiveView('board')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition ${
                activeView === 'board' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Board & DAG
            </button>
          </div>

          {/* Persona Switcher: Maker vs Developer */}
          <div className="flex rounded-lg bg-slate-800 p-1 border border-slate-700">
            <button
              type="button"
              data-testid="persona-maker-btn"
              onClick={() => setPersona('maker')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                persona === 'maker' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Maker
            </button>
            <button
              type="button"
              data-testid="persona-dev-btn"
              onClick={() => setPersona('developer')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                persona === 'developer' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Developer
            </button>
          </div>

          {/* Locale Selector: ar | en | fr | tr */}
          <div className="flex items-center space-x-1">
            <label htmlFor="locale-select" className="text-xs text-slate-400">Locale:</label>
            <select
              id="locale-select"
              data-testid="locale-select"
              value={locale}
              onChange={(e) => setLocale(e.target.value as SupportedLocale)}
              className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="en">English (en)</option>
              <option value="ar">العربية (ar)</option>
              <option value="fr">Français (fr)</option>
              <option value="tr">Türkçe (tr)</option>
            </select>
          </div>

          {/* Role Selector: owner | lead_dev | developer | viewer */}
          <div className="flex items-center space-x-1">
            <label htmlFor="role-select" className="text-xs text-slate-400">Role:</label>
            <select
              id="role-select"
              data-testid="role-select"
              value={role}
              onChange={(e) => setRole(e.target.value as WorkspaceRole)}
              className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="owner">Owner</option>
              <option value="lead_dev">Lead Dev</option>
              <option value="developer">Developer</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
        </div>
      </header>

      <NewProjectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreate={async (data) => {
          await createProject(data);
        }}
      />
    </>
  );
}

export function DashboardBody() {
  const {
    activeView,
    setActiveView,
    persona,
    role,
    activeProjectId,
    activeProject,
    tasks,
    createTask,
    dispatchTask,
    transitionTask,
    approveTask,
    answerClarification,
  } = useDashboard();

  return (
    <main className="flex-1 flex overflow-hidden">
      {activeView === 'cockpit' ? (
        <div data-testid="cockpit-container" className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <ChatCockpit
              conversationId="conv-default"
              projectId={activeProjectId || '00000000-0000-4000-8000-000000000001'}
              activeTaskId={tasks[0]?.id || 'TASK-101'}
              userRole={role}
              onViewBoard={() => setActiveView('board')}
              onQueueTask={async (brief) => {
                // 1. Check if the brief contains a structured task breakdown table
                const taskRows: Array<{ rawId: string; title: string; rawDeps: string; criteria: string }> = [];
                const lines = brief.split('\n');
                for (const line of lines) {
                  const trimmed = line.trim();
                  if (!trimmed.startsWith('|') || trimmed.includes('---')) continue;
                  const cols = trimmed.split('|').map((c) => c.trim().replace(/\*+/g, '')).filter(Boolean);
                  if (cols.length >= 3) {
                    const idCol = cols[0];
                    const titleCol = cols[1];
                    const depsCol = cols[2];
                    const criteriaCol = cols[3] || '';
                    if (/^T-?\d+/i.test(idCol) || /^TASK-?\d+/i.test(idCol)) {
                      taskRows.push({
                        rawId: idCol,
                        title: titleCol,
                        rawDeps: depsCol,
                        criteria: criteriaCol,
                      });
                    }
                  }
                }

                // If a breakdown table is present, instantiate all atomic tasks with dependency edges
                if (taskRows.length > 0) {
                  const idMap: Record<string, string> = {};
                  for (const row of taskRows) {
                    const blockedBy: string[] = [];
                    for (const [prevRawId, realTaskId] of Object.entries(idMap)) {
                      if (row.rawDeps.includes(prevRawId)) {
                        blockedBy.push(realTaskId);
                      }
                    }

                    const cleanTitlePart = row.title
                      .split(/<br\s*\/?>|\s+—\s+|\s+--\s+|\s+-\s+/i)[0]
                      .replace(/<[^>]+>/g, '')
                      .replace(/\*+/g, '')
                      .trim();
                    const cleanFullDesc = row.title.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
                    const desc = `### ${cleanTitlePart}\n\n${cleanFullDesc}\n\n**Verification Criteria:**\n${row.criteria.replace(/<br\s*\/?>/gi, '\n')}\n\n---\n*Extracted from squad architectural plan.*`;
                    const created = await createTask({
                      title: `${row.rawId}: ${cleanTitlePart}`,
                      description: desc,
                      priority: 'HIGH',
                      blockedBy,
                    });
                    idMap[row.rawId] = created.id;
                  }
                } else {
                  // Fallback for single monolithic task or GRILL brief
                  const rawLines = brief.split('\n').map((l) => l.trim()).filter(Boolean);
                  let cleanTitle = activeProject?.name || 'Asset & Maintenance Tracker';
                  const goalMatch = brief.match(/\*\*Goal\*\*:\s*([^\n]+)/i);
                  if (goalMatch && goalMatch[1].trim()) {
                    cleanTitle = goalMatch[1].trim();
                  } else {
                    const blacklistedHeadings = [
                      'prerequisites',
                      'getting started',
                      'setup',
                      'installation',
                      'overview',
                      'introduction',
                      'why i presented',
                      'table of contents',
                      'steps',
                      'task brief',
                      'task brief preview',
                    ];
                    for (const line of rawLines) {
                      const cleaned = line.replace(/^#*\s*/, '').replace(/\*+/g, '').trim();
                      const lower = cleaned.toLowerCase();
                      if (
                        cleaned &&
                        cleaned.length >= 5 &&
                        cleaned.length <= 70 &&
                        !cleaned.endsWith('?') &&
                        !cleaned.endsWith(':') &&
                        !blacklistedHeadings.some((bh) => lower.startsWith(bh))
                      ) {
                        cleanTitle = cleaned;
                        break;
                      }
                    }
                  }
                  await createTask({
                    title: cleanTitle,
                    description: brief,
                  });
                }
              }}
            />
          </div>
          <RightPanel conversationId="conv-default" />
        </div>
      ) : (
        <BoardLayout
          persona={persona}
          userRole={role}
          initialTasks={tasks}
          onDispatchTask={dispatchTask}
          onTransitionTask={transitionTask}
          onApproveTask={approveTask}
          onAnswerClarification={answerClarification}
        />
      )}
    </main>
  );
}

export interface AppProps {
  initialRole?: WorkspaceRole;
  initialPersona?: DashboardPersona;
  initialLocale?: SupportedLocale;
  initialView?: ActiveView;
}

export function App(props: AppProps = {}) {
  return (
    <DashboardProvider
      initialRole={props.initialRole}
      initialPersona={props.initialPersona}
      initialLocale={props.initialLocale}
      initialView={props.initialView}
    >
      <div className="flex flex-col h-screen overflow-hidden">
        <DashboardHeader />
        <DashboardBody />
      </div>
    </DashboardProvider>
  );
}

export default App;
