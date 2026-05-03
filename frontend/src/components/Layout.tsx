import { Activity, BarChart3, Bell, Building2, FileText, KeyRound, LayoutDashboard, LogOut, Network, PanelRightClose, PanelRightOpen, ScrollText, Settings, ShieldCheck, UserCircle, Users, X } from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { API_BASE, apiFetch, CurrentUser, ServiceRequest } from "../lib/api";
import { applyBrandColor, applyBranding, applyStoredFavicon } from "../lib/branding";
import FeedbackDialog from "./ui/FeedbackDialog";

const baseNav = [
  { label: "إحصائيات", href: "/dashboard", icon: LayoutDashboard, hiddenForEmployee: false, screenKey: "dashboard" },
  { label: "الطلبات", href: "/requests", icon: FileText, hiddenForEmployee: false, screenKey: "requests" },
  { label: "الموافقات", href: "/approvals", icon: ShieldCheck, hiddenForEmployee: false, screenKey: "approvals" },
  { label: "التقارير", href: "/reports", icon: BarChart3, hiddenForEmployee: true, screenKey: "reports" }
];

const roleLabels: Record<string, string> = {
  employee: "موظف",
  direct_manager: "مدير مباشر",
  it_staff: "فريق تقنية المعلومات",
  it_manager: "مدير تقنية المعلومات",
  information_security: "أمن المعلومات",
  executive_management: "الإدارة التنفيذية",
  super_admin: "مدير النظام"
};

const implementationRoles = new Set(["implementation", "execution", "implementation_engineer", "close_request"]);

export function Layout({
  children,
  currentUser,
  canAccessSettings,
  onLogout
}: {
  children: ReactNode;
  currentUser: CurrentUser | null;
  canAccessSettings: boolean;
  onLogout: () => void;
}) {
  const [systemName, setSystemName] = useState(() => localStorage.getItem("qib_system_name") || "");
  const [logoUrl, setLogoUrl] = useState(() => localStorage.getItem("qib_logo_url") || "");
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const [passwordErrors, setPasswordErrors] = useState<{ current_password?: string; new_password?: string; confirm_password?: string }>({});
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error" | "info"; message: string }>({ type: "success", message: "" });
  const [notificationCount, setNotificationCount] = useState(0);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [allowedScreens, setAllowedScreens] = useState<Set<string> | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("qib_sidebar_collapsed") === "true");
  const knownNotificationKeys = useRef<Set<string>>(new Set());
  const notificationsInitialized = useRef(false);

  const isEmployee = currentUser?.role === "employee";
  const canSeeScreen = (screenKey: string) => !allowedScreens || allowedScreens.has(screenKey);
  const visibleBaseNav = baseNav.filter((item) => !(isEmployee && item.hiddenForEmployee)).filter((item) => canSeeScreen(item.screenKey));
  const nav = canAccessSettings
    ? [
        ...visibleBaseNav,
        { label: "إدارة أنواع الطلبات", href: "/request-types", icon: ScrollText, screenKey: "request_types" },
        { label: "المستخدمون والصلاحيات", href: "/users", icon: Users, screenKey: "users" },
        { label: "الإدارات", href: "/departments", icon: Building2, screenKey: "departments" },
        { label: "الأقسام المختصة", href: "/specialized-sections", icon: Network, screenKey: "specialized_sections" },
        { label: "مراقبة صحة النظام", href: "/settings/health-monitoring", icon: Activity, screenKey: "health_monitoring" },
        { label: "الإعدادات", href: "/settings", icon: Settings, screenKey: "settings" }
      ].filter((item) => canSeeScreen(item.screenKey))
    : visibleBaseNav;

  useEffect(() => {
    document.title = systemName;
  }, [systemName]);

  useEffect(() => {
    localStorage.setItem("qib_sidebar_collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    applyBrandColor(localStorage.getItem("qib_brand_color") || "#0d6337");
    applyStoredFavicon();
  }, []);

  useEffect(() => {
    function syncSystemName() {
      setSystemName(localStorage.getItem("qib_system_name") || "");
      setLogoUrl(localStorage.getItem("qib_logo_url") || "");
    }
    window.addEventListener("qib-settings-updated", syncSystemName);
    return () => window.removeEventListener("qib-settings-updated", syncSystemName);
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    apiFetch<{ system_name?: string; logo_url?: string; brand_color?: string }>("/settings/public-profile")
      .then((profile) => applyBranding(profile))
      .catch(() => undefined);
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser) {
      setAllowedScreens(null);
      return;
    }
    apiFetch<{ screens: string[] }>("/users/screen-permissions/me")
      .then((data) => setAllowedScreens(new Set(data.screens)))
      .catch(() => setAllowedScreens(null));
  }, [currentUser?.id]);

  useEffect(() => {
    knownNotificationKeys.current = new Set();
    notificationsInitialized.current = false;
    setNotificationCount(0);

    if (currentUser?.role !== "it_staff") return;

    let isActive = true;
    async function loadExecutionNotifications() {
      try {
        const data = await apiFetch<ServiceRequest[]>("/requests");
        if (!isActive) return;
        const keys = data.filter(isExecutionNotification).map(notificationKey);
        const nextSet = new Set(keys);
        const hasNew = notificationsInitialized.current && keys.some((key) => !knownNotificationKeys.current.has(key));
        knownNotificationKeys.current = nextSet;
        notificationsInitialized.current = true;
        setNotificationCount(keys.length);
        if (hasNew) {
          setFeedback({ type: "info", message: "لديك طلب جديد" });
        }
      } catch {
        if (isActive) setNotificationCount(0);
      }
    }

    loadExecutionNotifications();
    const timer = window.setInterval(loadExecutionNotifications, 15000);
    return () => {
      isActive = false;
      window.clearInterval(timer);
    };
  }, [currentUser?.id, currentUser?.role]);

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setPasswordErrors({});
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setPasswordErrors({ confirm_password: "كلمة المرور الجديدة وتأكيدها غير متطابقين" });
      return;
    }
    setPasswordSaving(true);
    try {
      await apiFetch<void>("/auth/change-password", {
        method: "POST",
        body: JSON.stringify(passwordForm)
      });
      setPasswordDialogOpen(false);
      setPasswordForm({ current_password: "", new_password: "", confirm_password: "" });
      setPasswordErrors({});
      setFeedback({ type: "success", message: "تم تغيير كلمة المرور بنجاح" });
    } catch (error) {
      setPasswordErrors(mapPasswordError(extractErrorMessage(error)));
    } finally {
      setPasswordSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950" dir="rtl">
      <FeedbackDialog open={Boolean(feedback.message)} type={feedback.type} message={feedback.message} onClose={() => setFeedback({ ...feedback, message: "" })} />
      {passwordDialogOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <form onSubmit={changePassword} className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-slate-950">تغيير كلمة المرور</h3>
                <p className="mt-1 text-sm text-slate-500">أدخل كلمة المرور الحالية ثم الجديدة.</p>
              </div>
              <button type="button" onClick={() => setPasswordDialogOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="إغلاق">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <PasswordField label="كلمة المرور الحالية" error={passwordErrors.current_password} value={passwordForm.current_password} onChange={(value) => { setPasswordErrors((current) => ({ ...current, current_password: "" })); setPasswordForm((current) => ({ ...current, current_password: value })); }} />
              <PasswordField label="كلمة المرور الجديدة" error={passwordErrors.new_password} value={passwordForm.new_password} onChange={(value) => { setPasswordErrors((current) => ({ ...current, new_password: "" })); setPasswordForm((current) => ({ ...current, new_password: value })); }} />
              <PasswordField label="تأكيد كلمة المرور الجديدة" error={passwordErrors.confirm_password} value={passwordForm.confirm_password} onChange={(value) => { setPasswordErrors((current) => ({ ...current, confirm_password: "" })); setPasswordForm((current) => ({ ...current, confirm_password: value })); }} />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setPasswordDialogOpen(false)} className="h-9 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">إلغاء</button>
              <button type="submit" disabled={passwordSaving} className="h-9 rounded-md bg-bank-700 px-4 text-sm font-semibold text-white hover:bg-bank-800 disabled:opacity-60">
                {passwordSaving ? "جاري الحفظ..." : "حفظ"}
              </button>
            </div>
          </form>
        </div>
      )}

      <aside className={`fixed right-0 top-0 hidden h-full border-l border-slate-200 bg-white transition-all duration-200 lg:block ${sidebarCollapsed ? "w-20" : "w-72"}`}>
        <div className={`flex h-full flex-col overflow-hidden ${sidebarCollapsed ? "px-4 py-4" : "px-5 py-5"}`}>
          <div className={`mb-6 flex shrink-0 items-start gap-3 ${sidebarCollapsed ? "justify-center" : "justify-between"}`}>
            <div className={sidebarCollapsed ? "hidden" : "min-w-0"}>
              {logoUrl ? (
                <img src={resolveAssetUrl(logoUrl)} alt="شعار النظام" className="mb-3 h-12 w-auto max-w-[180px] object-contain" />
              ) : (
                <p className="text-xs font-semibold uppercase tracking-widest text-bank-700">QIB</p>
              )}
              <h1 className="mt-2 text-xl font-bold leading-8 text-slate-950">{systemName}</h1>
            </div>
            <button
              type="button"
              onClick={() => setSidebarCollapsed((value) => !value)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-bank-700"
              aria-label={sidebarCollapsed ? "توسيع القائمة الجانبية" : "طي القائمة الجانبية"}
              title={sidebarCollapsed ? "توسيع القائمة" : "طي القائمة"}
            >
              {sidebarCollapsed ? <PanelRightOpen className="h-5 w-5" /> : <PanelRightClose className="h-5 w-5" />}
            </button>
          </div>

          <nav className="min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden pb-4">
            {nav.map(({ label, href, icon: Icon }) => (
              <NavLink
                key={label}
                to={href}
                aria-label={label}
                title={sidebarCollapsed ? label : undefined}
                className={({ isActive }) =>
                  `flex h-11 w-full items-center rounded-md text-sm font-medium transition ${sidebarCollapsed ? "justify-center px-0" : "gap-3 px-3 text-right"} ${
                    isActive ? "bg-bank-50 text-bank-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                  }`
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && <span>{label}</span>}
              </NavLink>
            ))}
          </nav>

          <div className="shrink-0 border-t border-slate-100 pt-4">
            <div className={`mb-4 flex items-center rounded-md bg-slate-50 ${sidebarCollapsed ? "justify-center p-2" : "gap-3 p-3"}`} title={sidebarCollapsed ? currentUser?.full_name_ar ?? "مستخدم النظام" : undefined}>
              <UserCircle className="h-8 w-8 shrink-0 text-slate-500" />
              <div className={sidebarCollapsed ? "hidden" : "min-w-0"}>
                <p className="truncate text-sm font-semibold text-slate-900">{currentUser?.full_name_ar ?? "مستخدم النظام"}</p>
                <p className="truncate text-xs text-slate-500">{currentUser ? roleLabels[currentUser.role] ?? currentUser.role : ""}</p>
                <p className="mt-1 truncate text-xs text-slate-500">{currentUser?.department?.name_ar ?? "لا توجد إدارة"}</p>
              </div>
            </div>
            <button
              onClick={() => setPasswordDialogOpen(true)}
              className={`mb-2 flex w-full items-center rounded-md text-sm text-slate-600 hover:bg-bank-50 hover:text-bank-700 ${sidebarCollapsed ? "h-10 justify-center px-0" : "gap-2 px-3 py-2"}`}
              aria-label="تغيير كلمة المرور"
              title={sidebarCollapsed ? "تغيير كلمة المرور" : undefined}
            >
              <KeyRound className="h-4 w-4 shrink-0" />
              {!sidebarCollapsed && <span>تغيير كلمة المرور</span>}
            </button>
            <button
              onClick={onLogout}
              className={`flex w-full items-center rounded-md text-sm text-slate-500 hover:bg-red-50 hover:text-red-700 ${sidebarCollapsed ? "h-10 justify-center px-0" : "gap-2 px-3 py-2"}`}
              aria-label="تسجيل الخروج"
              title={sidebarCollapsed ? "تسجيل الخروج" : undefined}
            >
              <LogOut className="h-4 w-4 shrink-0" />
              {!sidebarCollapsed && <span>تسجيل الخروج</span>}
            </button>
          </div>
        </div>
      </aside>

      <main className={`transition-all duration-200 ${sidebarCollapsed ? "lg:mr-20" : "lg:mr-72"}`}>
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-950">{systemName}</h2>
            </div>
            <div className="relative flex items-center gap-2 self-start sm:self-auto">
              {currentUser?.role === "it_staff" && (
                <button
                  type="button"
                  onClick={() => setNotificationOpen((value) => !value)}
                  className="relative flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  aria-label="الإشعارات"
                >
                  <Bell className="h-5 w-5" />
                  {notificationCount > 0 && (
                    <span className="absolute -left-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
                      {notificationCount > 9 ? "9+" : notificationCount}
                    </span>
                  )}
                </button>
              )}
              {notificationOpen && (
                <div className="absolute left-0 top-12 w-72 rounded-lg border border-slate-200 bg-white p-4 text-right shadow-xl">
                  <p className="font-bold text-slate-950">الإشعارات</p>
                  <p className="mt-2 text-sm text-slate-600">
                    {notificationCount > 0 ? `لديك ${notificationCount} طلب جديد` : "لا توجد طلبات جديدة حالياً"}
                  </p>
                </div>
              )}
              <div className="flex gap-2 lg:hidden">
                <button onClick={() => setPasswordDialogOpen(true)} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
                  تغيير كلمة المرور
                </button>
                <button onClick={onLogout} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
                  خروج
                </button>
              </div>
            </div>
          </div>
        </header>
        <div className="p-5">{children}</div>
      </main>
    </div>
  );
}

function isExecutionNotification(request: ServiceRequest) {
  const currentStep = [...(request.approvals ?? [])].sort((first, second) => first.step_order - second.step_order).find((step) => step.action === "pending");
  return request.status === "in_implementation" || Boolean(currentStep && implementationRoles.has(currentStep.role));
}

function notificationKey(request: ServiceRequest) {
  const currentStep = [...(request.approvals ?? [])].sort((first, second) => first.step_order - second.step_order).find((step) => step.action === "pending");
  return `${request.id}:${currentStep?.id ?? request.status}`;
}

function resolveAssetUrl(url: string) {
  if (!url) return "";
  if (/^https?:\/\//.test(url)) return url;
  return `${API_BASE.replace(/\/api\/v1\/?$/, "")}${url}`;
}

function PasswordField({ label, value, error, onChange }: { label: string; value: string; error?: string; onChange: (value: string) => void }) {
  return (
    <label className="block space-y-1 text-sm font-medium text-slate-700">
      {label}
      {error && <span className="block rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold leading-5 text-red-700">{error}</span>}
      <input
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        className={`h-10 w-full rounded-md border bg-white px-3 text-sm outline-none focus:ring-2 ${error ? "border-red-300 focus:border-red-500 focus:ring-red-100" : "border-slate-300 focus:border-bank-600 focus:ring-bank-100"}`}
      />
    </label>
  );
}

function extractErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : "";
  try {
    const parsed = JSON.parse(raw);
    return parsed.detail || "تعذر تغيير كلمة المرور";
  } catch {
    return raw || "تعذر تغيير كلمة المرور";
  }
}

function mapPasswordError(message: string) {
  if (message.includes("الحالية")) return { current_password: message };
  if (message.includes("تأكيد") || message.includes("متطابق")) return { confirm_password: message };
  return { new_password: message };
}
