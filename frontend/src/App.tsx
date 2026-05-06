import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Approvals } from "./pages/Approvals";
import { Dashboard } from "./pages/Dashboard";
import { Login } from "./pages/Login";
import MessagesPage from "./pages/MessagesPage";
import { ReportsPage } from "./pages/ReportsPage";
import { RequestDetails } from "./pages/RequestDetails";
import { Requests } from "./pages/Requests";
import SettingsPage from "./pages/SettingsPage.jsx";
import DepartmentsPage from "./pages/settings/DepartmentsPage.jsx";
import HealthMonitoringPage from "./pages/settings/HealthMonitoringPage.jsx";
import RequestTypesPage from "./pages/settings/RequestTypesPage.jsx";
import SpecializedSectionsPage from "./pages/settings/SpecializedSectionsPage.jsx";
import UsersPage from "./pages/settings/UsersPage.jsx";
import { apiFetch, CurrentUser } from "./lib/api";

const SETTINGS_ROLES = new Set(["super_admin", "it_manager"]);

function canAccessSettings(user: CurrentUser | null) {
  return Boolean(user && SETTINGS_ROLES.has(user.role));
}

function ProtectedApp() {
  const navigate = useNavigate();
  const token = localStorage.getItem("qib_token");
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [screenPermissions, setScreenPermissions] = useState<string[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }

    apiFetch<CurrentUser>("/auth/me")
      .then((user) => {
        setCurrentUser(user);
        return apiFetch<{ screens: string[]; available_screens?: { key: string; label: string }[] }>("/users/screen-permissions/me")
          .then((permissions) => setScreenPermissions(normalizeScreens(permissions.screens, permissions.available_screens)))
          .catch(() => setScreenPermissions(null));
      })
      .catch(() => {
        localStorage.removeItem("qib_token");
        navigate("/login", { replace: true });
      })
      .finally(() => setIsLoading(false));
  }, [navigate, token]);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600" dir="rtl">
        جاري التحقق من صلاحيات المستخدم...
      </div>
    );
  }

  function canAccessScreen(screenKey: string) {
    return !screenPermissions || screenPermissions.includes(screenKey);
  }

  function screenElement(screenKey: string, element: ReactNode) {
    return canAccessScreen(screenKey) ? element : <Navigate to="/dashboard" replace />;
  }

  return (
    <Layout
      currentUser={currentUser}
      canAccessSettings={canAccessSettings(currentUser)}
      onLogout={() => {
        apiFetch("/auth/logout", { method: "POST" }).finally(() => {
          localStorage.removeItem("qib_token");
          navigate("/login", { replace: true });
        });
      }}
    >
      <Routes>
        <Route path="/dashboard" element={screenElement("dashboard", <Dashboard />)} />
        <Route path="/requests" element={screenElement("requests", <Requests />)} />
        <Route path="/requests/:requestId" element={screenElement("requests", <RequestDetails />)} />
        <Route path="/approvals" element={screenElement("approvals", <Approvals />)} />
        <Route path="/messages" element={screenElement("messages", <MessagesPage />)} />
        <Route
          path="/reports"
          element={currentUser?.role !== "employee" && canAccessScreen("reports") ? <ReportsPage /> : <Navigate to="/dashboard" replace />}
        />
        <Route
          path="/settings"
          element={canAccessSettings(currentUser) && canAccessScreen("settings") ? <SettingsPage /> : <Navigate to="/dashboard" replace />}
        />
        <Route
          path="/request-types"
          element={canAccessSettings(currentUser) && canAccessScreen("request_types") ? <RequestTypesPage /> : <Navigate to="/dashboard" replace />}
        />
        <Route
          path="/users"
          element={canAccessSettings(currentUser) && canAccessScreen("users") ? <UsersPage /> : <Navigate to="/dashboard" replace />}
        />
        <Route
          path="/departments"
          element={canAccessSettings(currentUser) && canAccessScreen("departments") ? <DepartmentsPage /> : <Navigate to="/dashboard" replace />}
        />
        <Route
          path="/specialized-sections"
          element={canAccessSettings(currentUser) && canAccessScreen("specialized_sections") ? <SpecializedSectionsPage /> : <Navigate to="/dashboard" replace />}
        />
        <Route
          path="/settings/health-monitoring"
          element={canAccessSettings(currentUser) && canAccessScreen("health_monitoring") ? <HealthMonitoringPage /> : <Navigate to="/dashboard" replace />}
        />
        <Route path="/settings/request-types" element={<Navigate to="/request-types" replace />} />
        <Route path="/settings/users" element={<Navigate to="/users" replace />} />
        <Route path="/settings/departments" element={<Navigate to="/departments" replace />} />
        <Route path="/settings/specialized-sections" element={<Navigate to="/specialized-sections" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Layout>
  );
}

function normalizeScreens(screens: string[], availableScreens?: { key: string; label: string }[]) {
  const next = [...(screens || [])];
  const backendKnowsMessages = availableScreens?.some((screen) => screen.key === "messages");
  if (!backendKnowsMessages && !next.includes("messages")) next.push("messages");
  return next;
}

export default function App() {
  const navigate = useNavigate();

  return (
    <div dir="rtl" lang="ar" className="min-h-screen text-right font-sans">
      <Routes>
        <Route
          path="/login"
          element={
            localStorage.getItem("qib_token") ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <Login
                onLogin={(token) => {
                  localStorage.setItem("qib_token", token);
                  navigate("/dashboard", { replace: true });
                }}
              />
            )
          }
        />
        <Route path="/*" element={<ProtectedApp />} />
      </Routes>
    </div>
  );
}
