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
import AISettingsPage from "./pages/settings/AISettingsPage.jsx";
import DatabaseSettingsPage from "./pages/settings/DatabaseSettingsPage.jsx";
import DepartmentsPage from "./pages/settings/DepartmentsPage.jsx";
import HealthMonitoringPage from "./pages/settings/HealthMonitoringPage.jsx";
import LocalUpdatePage from "./pages/settings/LocalUpdatePage.jsx";
import MessagingSettingsPage from "./pages/settings/MessagingSettingsPage.jsx";
import RequestTypesPage from "./pages/settings/RequestTypesPage.jsx";
import SpecializedSectionsPage from "./pages/settings/SpecializedSectionsPage.jsx";
import UpdateManagementPage from "./pages/settings/UpdateManagementPage.jsx";
import UsersPage from "./pages/settings/UsersPage.jsx";
import { apiFetch, CurrentUser } from "./lib/api";

const SCREEN_ROUTES: Record<string, string> = {
  dashboard: "/dashboard",
  requests: "/requests",
  approvals: "/approvals",
  messages: "/messages",
  reports: "/reports",
  settings: "/settings",
  request_types: "/settings/request-management",
  users: "/settings/users-permissions",
  departments: "/departments",
  specialized_sections: "/specialized-sections",
  health_monitoring: "/settings/health-monitoring"
};
const DEFAULT_SCREEN_ORDER = ["dashboard", "requests", "approvals", "messages", "reports", "settings", "request_types", "users", "departments", "specialized_sections", "health_monitoring"];

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
        if (user.force_password_change) {
          setScreenPermissions([]);
          return undefined;
        }
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

  useEffect(() => {
    function endSession() {
      localStorage.removeItem("qib_token");
      navigate("/login", { replace: true });
    }
    window.addEventListener("qib-session-ended", endSession);
    return () => window.removeEventListener("qib-session-ended", endSession);
  }, [navigate]);

  useEffect(() => {
    if (!token || !currentUser) return;
    const timer = window.setInterval(() => {
      apiFetch<CurrentUser>("/auth/me").catch(() => undefined);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [token, currentUser?.id]);

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

  function defaultPath() {
    if (!screenPermissions) return "/requests";
    const screen = DEFAULT_SCREEN_ORDER.find((key) => screenPermissions.includes(key));
    return screen ? SCREEN_ROUTES[screen] : "/requests";
  }

  function screenElement(screenKey: string, element: ReactNode) {
    return canAccessScreen(screenKey) ? element : <Navigate to={defaultPath()} replace />;
  }

  function canAccessAnyAdminScreen() {
    return [
      "settings",
      "request_types",
      "users",
      "departments",
      "specialized_sections",
      "messaging_settings",
      "ai_settings",
      "database_settings",
      "update_management",
      "health_monitoring"
    ].some(canAccessScreen);
  }

  return (
    <Layout
      currentUser={currentUser}
      canAccessSettings={canAccessAnyAdminScreen()}
      onLogout={() => {
        apiFetch("/auth/logout", { method: "POST" }).finally(() => {
          localStorage.removeItem("qib_token");
          navigate("/login", { replace: true });
        });
      }}
      onPasswordChanged={() => {
        setCurrentUser((user) => (user ? { ...user, force_password_change: false } : user));
        apiFetch<{ screens: string[]; available_screens?: { key: string; label: string }[] }>("/users/screen-permissions/me")
          .then((permissions) => setScreenPermissions(normalizeScreens(permissions.screens, permissions.available_screens)))
          .catch(() => setScreenPermissions(null));
      }}
    >
      <Routes>
        <Route path="/dashboard" element={screenElement("dashboard", <Dashboard />)} />
        <Route path="/requests" element={screenElement("requests", <Requests />)} />
        <Route path="/requests/new" element={screenElement("requests", <Requests />)} />
        <Route path="/requests/:requestId" element={screenElement("requests", <RequestDetails />)} />
        <Route path="/approvals" element={screenElement("approvals", <Approvals />)} />
        <Route path="/messages" element={screenElement("messages", <MessagesPage />)} />
        <Route
          path="/reports"
          element={currentUser?.role !== "employee" && canAccessScreen("reports") ? <ReportsPage /> : <Navigate to={defaultPath()} replace />}
        />
        <Route
          path="/settings"
          element={canAccessScreen("settings") ? <SettingsPage /> : <Navigate to={defaultPath()} replace />}
        />
        <Route
          path="/settings/ai"
          element={canAccessScreen("ai_settings") ? <AISettingsPage /> : <Navigate to={defaultPath()} replace />}
        />
        <Route
          path="/settings/database"
          element={canAccessScreen("database_settings") ? <DatabaseSettingsPage /> : <Navigate to={defaultPath()} replace />}
        />
        <Route
          path="/settings/messaging"
          element={canAccessScreen("messaging_settings") ? <MessagingSettingsPage /> : <Navigate to={defaultPath()} replace />}
        />
        <Route
          path="/settings/updates"
          element={canAccessScreen("update_management") ? <UpdateManagementPage /> : <Navigate to={defaultPath()} replace />}
        />
        <Route
          path="/settings/updates/local"
          element={canAccessScreen("update_management") ? <LocalUpdatePage /> : <Navigate to={defaultPath()} replace />}
        />
        <Route
          path="/request-types"
          element={canAccessScreen("request_types") ? <RequestTypesPage /> : <Navigate to={defaultPath()} replace />}
        />
        <Route
          path="/settings/request-management"
          element={canAccessScreen("request_types") ? <RequestTypesPage /> : <Navigate to={defaultPath()} replace />}
        />
        <Route
          path="/users"
          element={canAccessScreen("users") ? <UsersPage /> : <Navigate to={defaultPath()} replace />}
        />
        <Route
          path="/settings/users-permissions"
          element={canAccessScreen("users") ? <UsersPage /> : <Navigate to={defaultPath()} replace />}
        />
        <Route
          path="/departments"
          element={canAccessScreen("departments") ? <DepartmentsPage /> : <Navigate to={defaultPath()} replace />}
        />
        <Route
          path="/specialized-sections"
          element={canAccessScreen("specialized_sections") ? <SpecializedSectionsPage /> : <Navigate to={defaultPath()} replace />}
        />
        <Route
          path="/settings/health-monitoring"
          element={canAccessScreen("health_monitoring") ? <HealthMonitoringPage /> : <Navigate to={defaultPath()} replace />}
        />
        <Route path="/settings/request-types" element={<Navigate to="/settings/request-management" replace />} />
        <Route path="/settings/users" element={<Navigate to="/settings/users-permissions" replace />} />
        <Route path="/settings/departments" element={<Navigate to="/departments" replace />} />
        <Route path="/settings/specialized-sections" element={<Navigate to="/specialized-sections" replace />} />
        <Route path="*" element={<Navigate to={defaultPath()} replace />} />
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
              <Navigate to="/" replace />
            ) : (
              <Login
                onLogin={(token) => {
                  localStorage.setItem("qib_token", token);
                  navigate("/", { replace: true });
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
