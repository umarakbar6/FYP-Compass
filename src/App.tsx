import { MfaBoundary } from './security/AccountSecurity';
import { EnquiryInbox } from './engagement/EnquiryInbox';

import { lazy, Suspense } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ForgotPassword, ResetPassword } from './auth/RecoveryPages';
import { StudentRegistrationPage, ConfirmStudentEmail } from './auth/RegistrationPages';
import { Policies } from './pages/Policies';

import { EngagementProvider } from './engagement/EngagementProvider';

import { coreV2 } from './lib/backend-version';

import { HealthProvider } from './health/HealthProvider';

import { NoticesPage } from './health/NoticesPage';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { Layout, navigation } from './components/Layout';
import { LoadingState } from './components/ui';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { ModulePlaceholder } from './pages/ModulePlaceholder';
import { dashboardPath, roles, type Role } from './types/shared';
import { StudentProvider } from './student/StudentProvider';
import { StudentDashboard } from './student/StudentDashboard';
import { GroupPage } from './student/GroupPage';
import { ProposalPage } from './student/ProposalPage';
import { SupervisorProvider } from './supervisor/SupervisorProvider';
import { SupervisorDashboard } from './supervisor/SupervisorDashboard';
import { ProposalList } from './supervisor/ProposalList';

import { MilestoneProvider } from './milestones/MilestoneProvider';
import { MilestoneList } from './milestones/MilestoneList';

import { Services } from './pages/Services';
import { ConnectedModule } from './pages/ConnectedModule';
const AgentWorkspace = lazy(() =>
  import('./operations/AgentWorkspace').then((module) => ({ default: module.AgentWorkspace })),
);
const AccountSecurity = lazy(() =>
  import('./security/AccountSecurity').then((m) => ({ default: m.AccountSecurity })),
);
const PrivacyRequests = lazy(() =>
  import('./privacy/PrivacyRequests').then((m) => ({ default: m.PrivacyRequests })),
);
const InviteUsers = lazy(() =>
  import('./operations/InviteUsers').then((m) => ({ default: m.InviteUsers })),
);
const CoordinatorHealth = lazy(() =>
  import('./health/CoordinatorHealth').then((module) => ({ default: module.CoordinatorHealth })),
);
const OperationsPage = lazy(() =>
  import('./operations/OperationsPage').then((module) => ({ default: module.OperationsPage })),
);
const GuidedDemo = lazy(() =>
  import('./engagement/GuidedDemo').then((module) => ({ default: module.GuidedDemo })),
);
const HelpPage = lazy(() =>
  import('./engagement/EngagementPages').then((m) => ({ default: m.HelpPage })),
);
const CaseStudyAdmin = lazy(() =>
  import('./engagement/EngagementPages').then((m) => ({ default: m.CaseStudyAdmin })),
);
const ConfigurationPage = lazy(() =>
  import('./core/CorePages').then((m) => ({ default: m.ConfigurationPage })),
);
const MatchingPage = lazy(() =>
  import('./core/CorePages').then((m) => ({ default: m.MatchingPage })),
);
const ReportsPage = lazy(() =>
  import('./operations/ReportExplorer').then((m) => ({ default: m.ReportExplorer })),
);
const AssessmentPage = lazy(() =>
  import('./assessment/AssessmentPage').then((module) => ({ default: module.AssessmentPage })),
);
const GovernancePage = lazy(() =>
  import('./governance/GovernancePage').then((module) => ({ default: module.GovernancePage })),
);
const PeerPage = lazy(() =>
  import('./peer/PeerPage').then((module) => ({ default: module.PeerPage })),
);
const HealthPage = lazy(() =>
  import('./health/HealthPage').then((module) => ({ default: module.HealthPage })),
);
const ProposalReviewPage = lazy(() =>
  import('./supervisor/ProposalReviewPage').then((module) => ({
    default: module.ProposalReviewPage,
  })),
);
const MilestoneDetail = lazy(() =>
  import('./milestones/MilestoneDetail').then((module) => ({ default: module.MilestoneDetail })),
);

function PartnerModule({ role, module }: { role: Role; module: string }) {
  return navigation[role].some((item) => item.path === module) ? (
    <ConnectedModule />
  ) : (
    <Navigate to={dashboardPath(role)} replace />
  );
}
function Landing() {
  const { user, loading } = useAuth();
  return loading ? (
    <LoadingState />
  ) : (
    <Navigate to={user ? dashboardPath(user.role) : '/login'} replace />
  );
}
function RoleGuard({ role }: { role: Role }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingState />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={dashboardPath(user.role)} replace />;
  return (
    <MfaBoundary>
      <EngagementProvider>
        {role === 'student' ? (
          <StudentProvider>
            <MilestoneProvider>
              <HealthProvider>
                <Layout />
              </HealthProvider>
            </MilestoneProvider>
          </StudentProvider>
        ) : role === 'supervisor' ? (
          <SupervisorProvider>
            <MilestoneProvider>
              <HealthProvider>
                <Layout />
              </HealthProvider>
            </MilestoneProvider>
          </SupervisorProvider>
        ) : (
          <Layout />
        )}
      </EngagementProvider>
    </MfaBoundary>
  );
}
export function PortalRoutes() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingState label="Opening your screen…" />}>
        <Routes>
          <Route path="/" element={<Services />} />
          <Route path="/pricing" element={<Services />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<StudentRegistrationPage />} />
          <Route path="/auth/confirm" element={<ConfirmStudentEmail />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/auth/reset" element={<ResetPassword />} />
          <Route path="/privacy" element={<Policies />} />
          <Route path="/terms" element={<Policies terms />} />
          <Route path="/demo" element={<GuidedDemo />} />
          {roles.map((role) => (
            <Route key={role} path={`/${role}`} element={<RoleGuard role={role} />}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route
                path="dashboard"
                element={
                  role === 'student' ? (
                    <StudentDashboard />
                  ) : role === 'supervisor' ? (
                    <SupervisorDashboard />
                  ) : (
                    <Dashboard />
                  )
                }
              />
              {role === 'student' && (
                <>
                  <Route path="group" element={<GroupPage />} />
                  <Route path="proposal" element={<ProposalPage />} />
                </>
              )}
              {role === 'supervisor' && (
                <>
                  <Route path="groups" element={<ProposalList groups />} />
                  <Route path="proposals" element={<ProposalList />} />
                  <Route path="proposals/:id" element={<ProposalReviewPage />} />
                </>
              )}
              {(role === 'student' || role === 'supervisor') && (
                <>
                  <Route path="milestones" element={<MilestoneList />} />
                  <Route path="milestones/:id" element={<MilestoneDetail />} />
                </>
              )}
              <Route
                path="notices"
                element={
                  role === 'student' || role === 'supervisor' ? (
                    <NoticesPage />
                  ) : role === 'coordinator' && coreV2 ? (
                    <CoordinatorHealth notices />
                  ) : (
                    <PartnerModule role={role} module="notices" />
                  )
                }
              />
              {(role === 'student' || role === 'supervisor') && (
                <Route path="peers" element={<PeerPage />} />
              )}
              <Route
                path="health"
                element={
                  role === 'supervisor' ? (
                    <HealthPage />
                  ) : role === 'coordinator' && coreV2 ? (
                    <CoordinatorHealth />
                  ) : (
                    <PartnerModule role={role} module="health" />
                  )
                }
              />
              <Route
                path="defenses"
                element={
                  role === 'examiner' ? (
                    <AssessmentPage />
                  ) : (
                    <PartnerModule role={role} module="defenses" />
                  )
                }
              />
              <Route path="assessment" element={<AssessmentPage />} />
              <Route path="security" element={<AccountSecurity />} />
              <Route
                path="governance"
                element={
                  role === 'student' || role === 'supervisor' || role === 'coordinator' ? (
                    <GovernancePage />
                  ) : (
                    <Navigate to={dashboardPath(role)} replace />
                  )
                }
              />
              <Route
                path="results"
                element={
                  role === 'student' ? (
                    <AssessmentPage />
                  ) : (
                    <Navigate to={dashboardPath(role)} replace />
                  )
                }
              />
              <Route
                path="configuration"
                element={
                  role === 'coordinator' && coreV2 ? (
                    <ConfigurationPage />
                  ) : (
                    <PartnerModule role={role} module="configuration" />
                  )
                }
              />
              <Route
                path="matching"
                element={
                  role === 'coordinator' && coreV2 ? (
                    <MatchingPage />
                  ) : (
                    <PartnerModule role={role} module="matching" />
                  )
                }
              />
              <Route
                path="reports"
                element={
                  role === 'coordinator' && coreV2 ? (
                    <ReportsPage />
                  ) : (
                    <PartnerModule role={role} module="reports" />
                  )
                }
              />
              <Route path="help" element={<HelpPage />} />
              <Route path="privacy-requests" element={<PrivacyRequests />} />
              <Route
                path="service-status"
                element={
                  role === 'coordinator' ? (
                    <OperationsPage />
                  ) : (
                    <Navigate to={dashboardPath(role)} replace />
                  )
                }
              />
              <Route path="assistants" element={<AgentWorkspace />} />
              <Route
                path="users"
                element={
                  role === 'coordinator' ? (
                    <InviteUsers />
                  ) : (
                    <Navigate to={dashboardPath(role)} replace />
                  )
                }
              />
              <Route
                path="enquiries"
                element={
                  role === 'coordinator' ? (
                    <EnquiryInbox />
                  ) : (
                    <Navigate to={dashboardPath(role)} replace />
                  )
                }
              />
              <Route
                path="case-studies"
                element={
                  role === 'coordinator' ? (
                    <CaseStudyAdmin />
                  ) : (
                    <Navigate to={dashboardPath(role)} replace />
                  )
                }
              />
              <Route path="*" element={<ModulePlaceholder />} />
            </Route>
          ))}
          <Route path="*" element={<Landing />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <PortalRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
