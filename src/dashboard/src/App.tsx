import React from 'react';
import { DashboardProvider, useDashboard } from './context/DashboardContext';
import type { SupportedLocale, WorkspaceRole, DashboardPersona, ActiveView } from './context/DashboardContext';
import { ChatCockpit } from './components/cockpit/ChatCockpit';
import { RightPanel } from './components/cockpit/RightPanel';
import { KanbanBoard } from './components/board/KanbanBoard';
import { DagGraph } from './components/board/DagGraph';
import { TimeTravelSlider } from './components/board/TimeTravelSlider';

export function DashboardHeader() {
  const { role, setRole, persona, setPersona, locale, setLocale, activeView, setActiveView } = useDashboard();

  return (
    <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-4 py-3 backdrop-blur">
      <div className="flex items-center space-x-3">
        <span className="text-xl">🐺</span>
        <h1 className="text-lg font-bold tracking-tight text-white">Graywolf Squad</h1>
        <span className="rounded bg-sky-950/80 px-2 py-0.5 text-xs font-medium text-sky-400 border border-sky-800">
          Cockpit
        </span>
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
  );
}
export function DashboardBody() {
  const { activeView, persona, role } = useDashboard();

  return (
    <main className="flex-1 flex overflow-hidden">
      {activeView === 'cockpit' ? (
        <div data-testid="cockpit-container" className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <ChatCockpit
              conversationId="conv-default"
              projectId="00000000-0000-4000-8000-000000000001"
              activeTaskId="TASK-101"
              userRole={role}
            />
          </div>
          <RightPanel conversationId="conv-default" />
        </div>
      ) : (
        <div data-testid="board-container" className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-x-auto">
            <KanbanBoard persona={persona} userRole={role} />
          </div>
          <div className="h-64 border-t border-slate-800">
            <DagGraph />
          </div>
          <TimeTravelSlider />
        </div>
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
