import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { SupportedLocale } from '../lib/bidi';
import type { KanbanTaskItem } from '../components/board/KanbanBoard';

export type { SupportedLocale };

export type WorkspaceRole = 'owner' | 'lead_dev' | 'developer' | 'viewer';
export type DashboardPersona = 'maker' | 'developer';
export type ProjectMode = 'greenfield' | 'brownfield';
export type ActiveView = 'cockpit' | 'board';

export interface ProjectItem {
  id: string;
  name: string;
  slug: string;
  mode: ProjectMode;
  gitRemoteUrl: string;
  gitProvider?: string;
  workspaceId?: string;
}

export interface DashboardContextValue {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  setRole: (role: WorkspaceRole) => void;
  persona: DashboardPersona;
  setPersona: (persona: DashboardPersona) => void;
  projectMode: ProjectMode;
  setProjectMode: (mode: ProjectMode) => void;
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  isRtl: boolean;
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;

  // Live Projects & Tasks state
  projects: ProjectItem[];
  activeProjectId: string | null;
  activeProject?: ProjectItem;
  setActiveProjectId: (id: string) => void;
  tasks: KanbanTaskItem[];
  isLoadingProjects: boolean;
  isLoadingTasks: boolean;
  refreshProjects: () => Promise<void>;
  refreshTasks: (projectId?: string) => Promise<void>;
  createProject: (data: { name: string; mode: ProjectMode; gitRemoteUrl?: string }) => Promise<ProjectItem>;
  createTask: (data: { title: string; description?: string; priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; blockedBy?: string[] }) => Promise<KanbanTaskItem>;
  dispatchTask: (taskId: string) => Promise<{ taskId: string; status: string; containerId?: string }>;
  transitionTask: (taskId: string, targetStatus: TaskStatus) => Promise<{ taskId: string; status: TaskStatus }>;
  approveTask: (taskId: string) => Promise<{ taskId: string; mergedStatus: string; prUrl?: string }>;
  answerClarification: (taskId: string, answerText: string) => Promise<{ success: boolean; resumedStatus: string }>;
}

const DashboardContext = createContext<DashboardContextValue | undefined>(undefined);

export interface DashboardProviderProps {
  children: React.ReactNode;
  initialUserId?: string;
  initialWorkspaceId?: string;
  initialRole?: WorkspaceRole;
  initialPersona?: DashboardPersona;
  initialProjectMode?: ProjectMode;
  initialLocale?: SupportedLocale;
  initialView?: ActiveView;
}

export function DashboardProvider({
  children,
  initialUserId = 'user-001',
  initialWorkspaceId = '00000000-0000-4000-8000-000000000001',
  initialRole = 'owner',
  initialPersona = 'developer',
  initialProjectMode = 'greenfield',
  initialLocale = 'en',
  initialView = 'cockpit',
}: DashboardProviderProps) {
  const [userId] = useState<string>(initialUserId);
  const [workspaceId] = useState<string>(initialWorkspaceId);
  const [role, setRole] = useState<WorkspaceRole>(initialRole);
  const [persona, setPersona] = useState<DashboardPersona>(initialPersona);
  const [projectMode, setProjectMode] = useState<ProjectMode>(initialProjectMode);
  const [locale, setLocale] = useState<SupportedLocale>(initialLocale);
  const [activeView, setActiveView] = useState<ActiveView>(initialView);

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(() => {
    try {
      if (typeof window !== 'undefined') {
        return localStorage.getItem('graywolf_active_project_id');
      }
    } catch {}
    return null;
  });

  const setActiveProjectId = useCallback((id: string | null) => {
    setActiveProjectIdState(id);
    try {
      if (typeof window !== 'undefined') {
        if (id) {
          localStorage.setItem('graywolf_active_project_id', id);
        } else {
          localStorage.removeItem('graywolf_active_project_id');
        }
      }
    } catch {}
  }, []);

  const [tasks, setTasks] = useState<KanbanTaskItem[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);

  const isRtl = locale === 'ar';

  const refreshProjects = useCallback(async () => {
    setIsLoadingProjects(true);
    try {
      const res = await fetch('/api/v1/projects');
      if (res.ok) {
        const data = (await res.json()) as ProjectItem[];
        setProjects(data);
        if (data.length > 0) {
          let chosenId = activeProjectId;
          try {
            const saved = localStorage.getItem('graywolf_active_project_id');
            if (saved && data.some((p) => p.id === saved)) {
              chosenId = saved;
            }
          } catch {}

          const matched = (chosenId ? data.find((p) => p.id === chosenId) : null) || data[0];
          setActiveProjectId(matched.id);
          setProjectMode(matched.mode);
        }
      }
    } catch {
      // Offline fallback
    } finally {
      setIsLoadingProjects(false);
    }
  }, [activeProjectId, setActiveProjectId]);

  const refreshTasks = useCallback(async (targetProjectId?: string) => {
    const pid = targetProjectId || activeProjectId;
    if (!pid) return;
    setIsLoadingTasks(true);
    try {
      const res = await fetch(`/api/v1/tasks?projectId=${encodeURIComponent(pid)}`);
      if (res.ok) {
        const data = (await res.json()) as KanbanTaskItem[];
        setTasks(data);
      }
    } catch {
      // Offline fallback
    } finally {
      setIsLoadingTasks(false);
    }
  }, [activeProjectId]);

  const createProject = useCallback(
    async (data: { name: string; mode: ProjectMode; gitRemoteUrl?: string }) => {
      const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'new-app';
      const body = {
        name: data.name,
        slug,
        mode: data.mode,
        gitRemoteUrl: data.gitRemoteUrl || `https://github.com/local/${slug}.git`,
        gitProvider: 'github',
      };

      const res = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`Failed to create project: ${res.statusText}`);
      }

      const created = (await res.json()) as ProjectItem;
      setProjects((prev) => [...prev, created]);
      setActiveProjectId(created.id);
      setProjectMode(created.mode);
      setTasks([]);
      return created;
    },
    []
  );

  const createTask = useCallback(
    async (data: {
      title: string;
      description?: string;
      priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      blockedBy?: string[];
    }) => {
      if (!activeProjectId) {
        throw new Error('No active project selected to add a task to');
      }

      const body = {
        projectId: activeProjectId,
        title: data.title,
        description: data.description || data.title,
        priority: data.priority || 'HIGH',
        blockedBy: data.blockedBy,
      };

      const res = await fetch('/api/v1/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Role': role },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Failed to create task: ${res.statusText}`);
      }

      const created = (await res.json()) as KanbanTaskItem;
      setTasks((prev) => [...prev, created]);
      return created;
    },
    [activeProjectId, role]
  );

  const dispatchTask = useCallback(
    async (taskId: string) => {
      const res = await fetch(`/api/v1/tasks/${taskId}/dispatch`, {
        method: 'POST',
        headers: { 'X-User-Role': role },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Failed to dispatch task: ${res.statusText}`);
      }
      const data = await res.json();
      await refreshTasks(activeProjectId || undefined);
      return data;
    },
    [activeProjectId, refreshTasks, role]
  );

  const transitionTask = useCallback(
    async (taskId: string, targetStatus: TaskStatus) => {
      const res = await fetch(`/api/v1/tasks/${taskId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Role': role },
        body: JSON.stringify({ targetStatus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Failed to transition task: ${res.statusText}`);
      }
      const data = await res.json();
      await refreshTasks(activeProjectId || undefined);
      return data;
    },
    [activeProjectId, refreshTasks, role]
  );

  const approveTask = useCallback(
    async (taskId: string) => {
      const res = await fetch(`/api/v1/tasks/${taskId}/review-gate/approve`, {
        method: 'POST',
        headers: { 'X-User-Role': role },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Failed to approve review gate: ${res.statusText}`);
      }
      const data = await res.json();
      await refreshTasks(activeProjectId || undefined);
      return data;
    },
    [activeProjectId, refreshTasks, role]
  );

  const answerClarification = useCallback(
    async (taskId: string, answerText: string) => {
      const res = await fetch(`/api/v1/tasks/${taskId}/clarification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Role': role },
        body: JSON.stringify({
          answers: [{ questionId: 'Q-1', answer: answerText }],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Failed to resolve clarification: ${res.statusText}`);
      }
      const data = await res.json();
      await refreshTasks(activeProjectId || undefined);
      return data;
    },
    [activeProjectId, refreshTasks, role]
  );

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    if (activeProjectId) {
      void refreshTasks(activeProjectId);
    }
  }, [activeProjectId, refreshTasks]);

  useEffect(() => {
    if (!activeProjectId) return;
    const hasActiveTasks = tasks.some((t) =>
      ['QUEUED', 'IN_PROGRESS', 'INTERNAL_REVIEW', 'GUARD_VERIFYING', 'QA_FIXING'].includes(t.status)
    );
    if (!hasActiveTasks) return;

    const timer = setInterval(() => {
      void refreshTasks(activeProjectId);
    }, 1500);

    return () => clearInterval(timer);
  }, [activeProjectId, tasks, refreshTasks]);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  const value: DashboardContextValue = {
    userId,
    workspaceId,
    role,
    setRole,
    persona,
    setPersona,
    projectMode,
    setProjectMode,
    locale,
    setLocale,
    isRtl,
    activeView,
    setActiveView,
    projects,
    activeProjectId,
    activeProject,
    setActiveProjectId,
    tasks,
    isLoadingProjects,
    isLoadingTasks,
    refreshProjects,
    refreshTasks,
    createProject,
    createTask,
    dispatchTask,
    transitionTask,
    approveTask,
    answerClarification,
  };

  return (
    <DashboardContext.Provider value={value}>
      <div dir={isRtl ? 'rtl' : 'ltr'} data-locale={locale} className="min-h-screen bg-slate-950 text-slate-100">
        {children}
      </div>
    </DashboardContext.Provider>
  );
}

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) {
    throw new Error('useDashboard must be used within a DashboardProvider');
  }
  return ctx;
}
