import React, { createContext, useContext, useState } from 'react';
import type { SupportedLocale } from '../lib/bidi';
export type { SupportedLocale };

export type WorkspaceRole = 'owner' | 'lead_dev' | 'developer' | 'viewer';
export type DashboardPersona = 'maker' | 'developer';
export type ProjectMode = 'greenfield' | 'brownfield';
export type ActiveView = 'cockpit' | 'board';

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
  initialRole = 'developer',
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

  const isRtl = locale === 'ar';

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
