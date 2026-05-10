import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Download,
  Edit3,
  Eye,
  FileText,
  History,
  KeyRound,
  Lock,
  LogOut,
  Network,
  Plus,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Unlock,
  Upload,
  UserCheck,
  UserCog,
  UserPlus,
  Users,
  X
} from "lucide-react";
import { api, getErrorMessage } from "../../lib/axios";
import { formatSystemDateTime } from "../../lib/datetime";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import FeedbackDialog from "../../components/ui/FeedbackDialog";

const tabs = [
  ["overview", "نظرة عامة", ShieldCheck],
  ["users", "المستخدمون", Users],
  ["roles", "الأدوار والصلاحيات", UserCog],
  ["screens", "صلاحيات الشاشات", ClipboardCheck],
  ["actions", "الصلاحيات الإجرائية", KeyRound],
  ["organization", "الهيكل الإداري", Network],
  ["import", "الاستيراد الجماعي", Upload],
  ["security", "الأمان والجلسات", Lock],
  ["delegation", "التفويض والبدلاء", UserCheck],
  ["review", "مراجعة الصلاحيات", AlertTriangle],
  ["audit", "سجل العمليات", History]
];

const roleOptions = [
  ["employee", "موظف"],
  ["direct_manager", "مدير مباشر"],
  ["it_staff", "مختص تنفيذ"],
  ["administration_manager", "مدير إدارة"],
  ["executive_management", "الإدارة التنفيذية"],
  ["super_admin", "مدير النظام"]
];

const roleLabel = new Map(roleOptions);
const relationOptions = [
  ["employee", "موظف"],
  ["direct_manager", "مدير مباشر"],
  ["administrative_permission", "صلاحية إدارية"]
];
const relationLabel = new Map(relationOptions);
const permissionLevels = [
  ["no_access", "لا يوجد"],
  ["view", "عرض"],
  ["create", "إضافة"],
  ["edit", "تعديل"],
  ["delete", "حذف"],
  ["export", "تصدير"],
  ["manage", "إدارة"]
];

const emptyUserForm = {
  full_name_ar: "",
  full_name_en: "",
  username: "",
  email: "",
  employee_id: "",
  mobile: "",
  job_title: "",
  department_id: "",
  manager_id: "",
  relationship_type: "employee",
  role: "employee",
  administrative_section: "",
  password: "",
  force_password_change: true,
  password_expires_at: "",
  allowed_login_from_ip: "",
  notes: "",
  is_active: true
};

const emptyRoleForm = {
  name_ar: "",
  name_en: "",
  code: "",
  description: "",
  is_active: true
};

const emptyDelegationForm = {
  delegator_user_id: "",
  delegate_user_id: "",
  delegation_scope: "approvals_only",
  start_date: "",
  end_date: "",
  reason: "",
  is_active: true
};

function initialData() {
  return {
    overview: null,
    users: [],
    departments: [],
    specializedSections: [],
    roles: [],
    screenMatrix: null,
    actionMatrix: null,
    securityPolicy: null,
    orgTree: [],
    orgIssues: [],
    importBatches: [],
    sessions: [],
    attempts: [],
    delegations: [],
    accessReview: null,
    auditLogs: []
  };
}

function localDateTimeToIso(value) {
  if (!value) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export default function UsersPage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [dialog, setDialog] = useState({ type: "success", message: "" });
  const [filters, setFilters] = useState({ q: "", department: "", role: "", status: "all", manager: "all" });
  const [userModal, setUserModal] = useState(null);
  const [roleModal, setRoleModal] = useState(null);
  const [details, setDetails] = useState(null);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [bulkDepartmentId, setBulkDepartmentId] = useState("");
  const [bulkManagerId, setBulkManagerId] = useState("");
  const [screenSubject, setScreenSubject] = useState({ type: "role", id: "" });
  const [screenDraft, setScreenDraft] = useState({});
  const [actionSubject, setActionSubject] = useState({ type: "role", id: "" });
  const [actionDraft, setActionDraft] = useState({});
  const [importState, setImportState] = useState({ file: null, validation: null });
  const [delegationForm, setDelegationForm] = useState(emptyDelegationForm);

  async function safeGet(path, fallback) {
    try {
      const response = await api.get(path);
      return response.data;
    } catch {
      return fallback;
    }
  }

  async function loadAll() {
    setLoading(true);
    const [
      overview,
      users,
      departments,
      specializedSections,
      roles,
      screenMatrix,
      actionMatrix,
      securityPolicy,
      orgTree,
      orgIssues,
      importBatches,
      sessions,
      attempts,
      delegations,
      accessReview,
      auditLogs
    ] = await Promise.all([
      safeGet("/users/overview", null),
      safeGet("/users", []),
      safeGet("/departments", []),
      safeGet("/settings/specialized-sections?active_only=true", []),
      safeGet("/roles", []),
      safeGet("/permissions/screens", null),
      safeGet("/permissions/actions", null),
      safeGet("/settings/security", null),
      safeGet("/users/organization/tree", []),
      safeGet("/users/organization/issues", []),
      safeGet("/users/import/batches", []),
      safeGet("/users/sessions", []),
      safeGet("/users/login-attempts", []),
      safeGet("/users/delegations", []),
      safeGet("/users/access-review", null),
      safeGet("/users/audit-logs", [])
    ]);
    setData({ overview, users, departments, specializedSections, roles, screenMatrix, actionMatrix, securityPolicy, orgTree, orgIssues, importBatches, sessions, attempts, delegations, accessReview, auditLogs });
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    const source = findPermissionSubject(data.screenMatrix, screenSubject);
    const next = {};
    (data.screenMatrix?.screens || []).forEach((screen) => {
      next[screen.key] = source?.permissions?.[screen.key] || (source?.screens?.includes(screen.key) ? "view" : "no_access");
    });
    setScreenDraft(next);
  }, [data.screenMatrix, screenSubject.type, screenSubject.id]);

  useEffect(() => {
    const source = findPermissionSubject(data.actionMatrix, actionSubject);
    setActionDraft({ ...(source?.permissions || {}) });
  }, [data.actionMatrix, actionSubject.type, actionSubject.id]);

  const usersById = useMemo(() => new Map(data.users.map((user) => [user.id, user])), [data.users]);
  const departmentsById = useMemo(() => new Map(data.departments.map((department) => [department.id, department])), [data.departments]);
  const configuredTemporaryPassword = data.securityPolicy?.temporary_password || "";
  const filteredUsers = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return data.users.filter((user) => {
      const searchOk =
        !q ||
        [user.full_name_ar, user.full_name_en, user.username, user.email, user.employee_id, user.mobile]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q));
      const deptOk = !filters.department || String(user.department_id || "") === filters.department;
      const roleOk = !filters.role || user.role === filters.role;
      const locked = user.is_locked || isTemporarilyLocked(user);
      const statusOk =
        filters.status === "all" ||
        (filters.status === "active" && user.is_active && !locked) ||
        (filters.status === "inactive" && !user.is_active) ||
        (filters.status === "locked" && locked) ||
        (filters.status === "force_password_change" && user.force_password_change) ||
        (filters.status === "never_login" && !user.last_login_at);
      const managerOk =
        filters.manager === "all" ||
        (filters.manager === "has" && user.manager_id) ||
        (filters.manager === "none" && !user.manager_id);
      return searchOk && deptOk && roleOk && statusOk && managerOk;
    });
  }, [data.users, filters]);

  function notify(message, type = "success") {
    setDialog({ type, message });
  }

  async function runAction(label, action, reload = true) {
    setBusy(label);
    try {
      await action();
      notify("تم تنفيذ العملية بنجاح");
      if (reload) await loadAll();
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setBusy("");
    }
  }

  async function openDetails(user) {
    setBusy("details");
    try {
      const response = await api.get(`/users/${user.id}`);
      setDetails(response.data);
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setBusy("");
    }
  }

  async function saveUser(event) {
    event.preventDefault();
    const form = userModal.form;
    const payload = {
      ...form,
      department_id: form.department_id ? Number(form.department_id) : null,
      manager_id: form.manager_id ? Number(form.manager_id) : null,
      role_id: null,
      specialized_section_id: null,
      password_expires_at: form.password_expires_at || null,
      mobile: form.mobile || null,
      username: form.username || null,
      job_title: form.job_title || null,
      allowed_login_from_ip: form.allowed_login_from_ip || null,
      notes: form.notes || null
    };
    if (userModal.mode === "edit" || !payload.password || payload.password === configuredTemporaryPassword) {
      delete payload.password;
    }
    await runAction("save-user", async () => {
      if (userModal.mode === "edit") await api.put(`/users/${userModal.user.id}`, payload);
      else await api.post("/users", payload);
      setUserModal(null);
    });
  }

  async function saveRole(event) {
    event.preventDefault();
    const payload = roleModal.form;
    await runAction("save-role", async () => {
      if (roleModal.mode === "edit") await api.put(`/roles/${roleModal.role.id}`, payload);
      else await api.post("/roles", payload);
      setRoleModal(null);
    });
  }

  async function saveScreenPermissions() {
    const endpoint = screenSubject.type === "role" ? `/permissions/screens/role/${screenSubject.id}` : `/permissions/screens/user/${screenSubject.id}`;
    await runAction("screen-permissions", async () => api.put(endpoint, { permissions: screenDraft }));
  }

  async function saveActionPermissions() {
    const endpoint = actionSubject.type === "role" ? `/permissions/actions/role/${actionSubject.id}` : `/permissions/actions/user/${actionSubject.id}`;
    const needsConfirm = (data.actionMatrix?.actions || []).some((action) => action.dangerous && actionDraft[action.code]);
    const confirmation_text = needsConfirm ? window.prompt("اكتب CONFIRM PERMISSIONS لتأكيد الصلاحيات الخطرة") : null;
    if (needsConfirm && confirmation_text !== "CONFIRM PERMISSIONS") return;
    await runAction("action-permissions", async () => api.put(endpoint, { permissions: actionDraft, confirmation_text }));
  }

  async function downloadImportTemplate() {
    await runAction(
      "download-template",
      async () => {
        const response = await api.get("/users/import-template", { responseType: "blob" });
        const url = URL.createObjectURL(response.data);
        const link = document.createElement("a");
        link.href = url;
        link.download = "users-import-template.xlsx";
        link.click();
        URL.revokeObjectURL(url);
      },
      false
    );
  }

  async function validateImport() {
    if (!importState.file) return notify("اختر ملف Excel أولاً", "error");
    const formData = new FormData();
    formData.append("file", importState.file);
    await runAction(
      "validate-import",
      async () => {
        const response = await api.post("/users/import/validate", formData, { headers: { "Content-Type": "multipart/form-data" } });
        setImportState((current) => ({ ...current, validation: response.data }));
      },
      false
    );
    await loadAll();
  }

  async function confirmImport() {
    const batchId = importState.validation?.batch_id;
    if (!batchId) return;
    await runAction("confirm-import", async () => api.post("/users/import/confirm", { batch_id: batchId, import_valid_only: true, confirmation_text: "IMPORT USERS" }));
    setImportState({ file: null, validation: null });
  }

  async function saveDelegation(event) {
    event.preventDefault();
    const payload = {
      ...delegationForm,
      delegator_user_id: Number(delegationForm.delegator_user_id),
      delegate_user_id: Number(delegationForm.delegate_user_id),
      start_date: localDateTimeToIso(delegationForm.start_date),
      end_date: localDateTimeToIso(delegationForm.end_date)
    };
    await runAction("delegation", async () => {
      await api.post("/users/delegations", payload);
      setDelegationForm(emptyDelegationForm);
    });
  }

  function exportUsersCsv() {
    const headers = ["الاسم العربي", "الاسم الإنجليزي", "اسم المستخدم", "البريد", "الرقم الوظيفي", "الإدارة", "الدور", "الحالة"];
    const rows = filteredUsers.map((user) => [
      user.full_name_ar,
      user.full_name_en,
      user.username || "",
      user.email,
      user.employee_id,
      departmentsById.get(user.department_id)?.name_ar || "",
      roleLabel.get(user.role) || user.role,
      statusText(user)
    ]);
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "users.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="space-y-5" dir="rtl">
      <FeedbackDialog open={Boolean(dialog.message)} type={dialog.type} message={dialog.message} onClose={() => setDialog({ ...dialog, message: "" })} />
      <Header total={data.overview?.total_users || data.users.length} loading={loading} onRefresh={loadAll} />

      <Card className="overflow-hidden">
        <div className="flex gap-2 overflow-x-auto border-b border-slate-200 bg-slate-50 p-3">
          {tabs.map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-md border px-4 text-sm font-bold transition ${
                activeTab === key ? "border-bank-600 bg-white text-bank-800 shadow-sm" : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-white"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {loading ? (
            <EmptyState title="جاري تحميل بيانات المستخدمين والصلاحيات..." />
          ) : (
            <>
              {activeTab === "overview" && <OverviewTab overview={data.overview} />}
              {activeTab === "users" && (
                <UsersTab
                  users={filteredUsers}
                  allUsers={data.users}
                  departments={data.departments}
                  filters={filters}
                  setFilters={setFilters}
                  selectedUsers={selectedUsers}
                  setSelectedUsers={setSelectedUsers}
                  onAdd={() => setUserModal({ mode: "create", form: { ...emptyUserForm, password: configuredTemporaryPassword } })}
                  onEdit={(user) => setUserModal({ mode: "edit", user, form: userToForm(user) })}
                  onDetails={openDetails}
                  onExport={exportUsersCsv}
                  onToggleActive={(user) => runAction("toggle-user", async () => api.post(`/users/${user.id}/${user.is_active ? "disable" : "enable"}`))}
                  onLock={(user) => runAction("lock-user", async () => api.post(`/users/${user.id}/${user.is_locked ? "unlock" : "lock"}`))}
                  onResetPassword={(user) => {
                    const password = window.prompt("أدخل كلمة المرور المؤقتة الجديدة، أو اتركها فارغة لاستخدام إعداد النظام", configuredTemporaryPassword);
                    if (password === null) return;
                    const admin_password = window.prompt("أدخل كلمة مرورك الحالية لتأكيد العملية");
                    if (admin_password) {
                      const normalizedPassword = password.trim();
                      const payload = { admin_password };
                      if (normalizedPassword && normalizedPassword !== configuredTemporaryPassword) payload.password = normalizedPassword;
                      runAction("reset-password", async () => api.post(`/users/${user.id}/reset-password`, payload));
                    }
                  }}
                  onTerminate={(user) => {
                    const admin_password = window.prompt("أدخل كلمة مرورك الحالية لإنهاء جلسات المستخدم");
                    if (admin_password) runAction("terminate-sessions", async () => api.post(`/users/${user.id}/terminate-sessions`, { confirmation_text: "TERMINATE", admin_password }));
                  }}
                />
              )}
              {activeTab === "roles" && (
                <RolesTab
                  roles={data.roles}
                  busy={busy}
                  onAdd={() => setRoleModal({ mode: "create", form: emptyRoleForm })}
                  onEdit={(role) => setRoleModal({ mode: "edit", role, form: roleToForm(role) })}
                  onClone={(role) => runAction("clone-role", async () => api.post(`/roles/${role.id}/clone`))}
                  onDelete={(role) => {
                    if (window.confirm(`هل تريد حذف الدور "${role.role_name_ar || role.name_ar}"؟ لا يمكن التراجع عن هذه العملية.`)) {
                      runAction("delete-role", async () => api.delete(`/roles/${role.id}`));
                    }
                  }}
                />
              )}
              {activeTab === "screens" && <ScreenPermissionsTab matrix={data.screenMatrix} subject={screenSubject} setSubject={setScreenSubject} draft={screenDraft} setDraft={setScreenDraft} onSave={saveScreenPermissions} />}
              {activeTab === "actions" && <ActionPermissionsTab matrix={data.actionMatrix} subject={actionSubject} setSubject={setActionSubject} draft={actionDraft} setDraft={setActionDraft} onSave={saveActionPermissions} />}
              {activeTab === "organization" && (
                <OrganizationTab
                  tree={data.orgTree}
                  issues={data.orgIssues}
                  users={data.users}
                  departments={data.departments}
                  selectedUsers={selectedUsers}
                  setSelectedUsers={setSelectedUsers}
                  departmentId={bulkDepartmentId}
                  setDepartmentId={setBulkDepartmentId}
                  managerId={bulkManagerId}
                  setManagerId={setBulkManagerId}
                  onAssignDepartment={() => runAction("bulk-department", async () => api.post("/users/bulk-assign-department", { user_ids: selectedUsers, department_id: Number(bulkDepartmentId) }))}
                  onAssignManager={() => runAction("bulk-manager", async () => api.post("/users/bulk-assign-manager", { user_ids: selectedUsers, manager_id: Number(bulkManagerId) }))}
                />
              )}
              {activeTab === "import" && <ImportTab state={importState} setState={setImportState} batches={data.importBatches} onTemplate={downloadImportTemplate} onValidate={validateImport} onConfirm={confirmImport} />}
              {activeTab === "security" && (
                <SecurityTab
                  sessions={data.sessions}
                  attempts={data.attempts}
                  onRevoke={(session) => runAction("revoke-session", async () => api.post(`/users/sessions/${session.id}/revoke`))}
                  onRevokeAll={() => {
                    const confirmation_text = window.prompt("اكتب REVOKE SESSIONS لإنهاء جميع الجلسات");
                    const admin_password = confirmation_text === "REVOKE SESSIONS" ? window.prompt("أدخل كلمة مرورك الحالية لتأكيد العملية") : null;
                    if (confirmation_text === "REVOKE SESSIONS" && admin_password) runAction("revoke-all", async () => api.post("/users/sessions/revoke-all", { confirmation_text, admin_password }));
                  }}
                />
              )}
              {activeTab === "delegation" && <DelegationTab users={data.users} delegations={data.delegations} form={delegationForm} setForm={setDelegationForm} onSubmit={saveDelegation} onDelete={(item) => runAction("delete-delegation", async () => api.delete(`/users/delegations/${item.id}`))} />}
              {activeTab === "review" && <AccessReviewTab review={data.accessReview} onCreate={() => runAction("create-review", async () => api.post("/users/access-review"))} onComplete={(id) => runAction("complete-review", async () => api.post(`/users/access-review/${id}/complete`))} onMark={(id) => runAction("mark-review", async () => api.post(`/users/access-review/items/${id}/mark-reviewed`))} />}
              {activeTab === "audit" && <AuditLogsTab logs={data.auditLogs} />}
            </>
          )}
        </div>
      </Card>

      {userModal && <UserFormModal modal={userModal} setModal={setUserModal} users={data.users} departments={data.departments} specializedSections={data.specializedSections} temporaryPassword={configuredTemporaryPassword} onSubmit={saveUser} />}
      {roleModal && <RoleFormModal modal={roleModal} setModal={setRoleModal} onSubmit={saveRole} />}
      {details && <UserDetailsDrawer details={details} usersById={usersById} departmentsById={departmentsById} onClose={() => setDetails(null)} />}
    </section>
  );
}

function Header({ total, loading, onRefresh }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-bold text-bank-700">إدارة الهوية والوصول</p>
          <h2 className="mt-2 text-2xl font-black text-slate-950">المستخدمون والصلاحيات</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">إدارة المستخدمين، الأدوار، صلاحيات الشاشات، الجلسات، التفويض، ومراجعات الامتثال من مركز واحد.</p>
        </div>
        <div className="flex items-center gap-3">
          <MetricPill label="إجمالي المستخدمين" value={total} />
          <Button type="button" onClick={onRefresh} disabled={loading} className="gap-2 bg-white text-bank-700 ring-1 ring-bank-200 hover:bg-bank-50">
            <RotateCcw className="h-4 w-4" />
            تحديث
          </Button>
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ overview }) {
  if (!overview) return <EmptyState title="لا تتوفر بيانات النظرة العامة حالياً." />;
  const cards = [
    ["إجمالي المستخدمين", overview.total_users, Users],
    ["المستخدمون النشطون", overview.active_users, CheckCircle2],
    ["المستخدمون المعطلون", overview.inactive_users, X],
    ["المستخدمون المقفلون", overview.locked_users, Lock],
    ["بدون مدير مباشر", overview.without_manager, AlertTriangle],
    ["بدون إدارة", overview.without_department, Building2],
    ["بصلاحيات إدارية", overview.admin_users, ShieldCheck],
    ["الجلسات النشطة", overview.active_sessions, LogOut],
    ["آخر استيراد", formatSystemDateTime(overview.last_import_at), Upload],
    ["آخر تعديل صلاحيات", formatSystemDateTime(overview.last_permission_change_at), KeyRound]
  ];
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map(([label, value, Icon]) => (
          <Card key={label} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-slate-500">{label}</p>
                <p className="mt-2 text-2xl font-black text-slate-950">{value ?? "-"}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-bank-50 text-bank-700">
                <Icon className="h-5 w-5" />
              </div>
            </div>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="المستخدمون حسب الإدارة" rows={overview.users_by_department || []} />
        <ChartCard title="المستخدمون حسب الدور" rows={overview.users_by_role || []} />
        <ChartCard title="نشط / غير نشط" rows={overview.active_vs_inactive || []} />
      </div>
    </div>
  );
}

function UsersTab({ users, allUsers, departments, filters, setFilters, selectedUsers, setSelectedUsers, onAdd, onEdit, onDetails, onExport, onToggleActive, onLock, onResetPassword, onTerminate }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-[1.7fr_1fr_1fr_1fr_1fr_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-400" />
          <Input value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} className="pr-9" placeholder="بحث بالاسم، البريد، اسم المستخدم أو الرقم الوظيفي" />
        </div>
        <Select value={filters.department} onChange={(event) => setFilters({ ...filters, department: event.target.value })}>
          <option value="">كل الإدارات</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>{department.name_ar}</option>
          ))}
        </Select>
        <Select value={filters.role} onChange={(event) => setFilters({ ...filters, role: event.target.value })}>
          <option value="">كل الأدوار</option>
          {roleOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
          <option value="all">كل الحالات</option>
          <option value="active">نشط</option>
          <option value="inactive">غير نشط</option>
          <option value="locked">مقفل</option>
          <option value="force_password_change">بانتظار تغيير كلمة المرور</option>
          <option value="never_login">لم يسجل الدخول</option>
        </Select>
        <Select value={filters.manager} onChange={(event) => setFilters({ ...filters, manager: event.target.value })}>
          <option value="all">كل المديرين</option>
          <option value="has">لديه مدير</option>
          <option value="none">بدون مدير</option>
        </Select>
        <Button type="button" onClick={onExport} className="gap-2 bg-white text-bank-700 ring-1 ring-bank-200 hover:bg-bank-50"><Download className="h-4 w-4" />تصدير</Button>
        <Button type="button" onClick={onAdd} className="gap-2"><UserPlus className="h-4 w-4" />إضافة مستخدم</Button>
      </div>
      <DataTable
        headers={["", "الاسم العربي", "اسم المستخدم", "البريد الإلكتروني", "الرقم الوظيفي", "الإدارة", "المدير المباشر", "العلاقة", "الدور", "الحالة", "آخر دخول", "الإجراءات"]}
        rows={users.map((user) => [
          <input key="check" type="checkbox" checked={selectedUsers.includes(user.id)} onChange={(event) => setSelectedUsers(event.target.checked ? [...selectedUsers, user.id] : selectedUsers.filter((id) => id !== user.id))} />,
          <StrongCell key="name" title={user.full_name_ar} subtitle={user.full_name_en} />,
          user.username || "-",
          user.email,
          user.employee_id,
          user.department?.name_ar || departments.find((department) => department.id === user.department_id)?.name_ar || "-",
          allUsers.find((item) => item.id === user.manager_id)?.full_name_ar || "-",
          relationLabel.get(user.relationship_type) || "-",
          roleLabel.get(user.role) || user.role,
          <StatusBadge key="status" user={user} />,
          formatSystemDateTime(user.last_login_at),
          <ActionBar key="actions" actions={[
            ["عرض", Eye, () => onDetails(user)],
            ["تعديل", Edit3, () => onEdit(user)],
            [user.is_active ? "تعطيل" : "تفعيل", user.is_active ? X : CheckCircle2, () => onToggleActive(user)],
            [user.is_locked ? "فك القفل" : "قفل", user.is_locked ? Unlock : Lock, () => onLock(user)],
            ["كلمة المرور", KeyRound, () => onResetPassword(user)],
            ["إنهاء الجلسات", LogOut, () => onTerminate(user)]
          ]} />
        ])}
      />
    </div>
  );
}

function RolesTab({ roles, onAdd, onEdit, onClone, onDelete }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" onClick={onAdd} className="gap-2"><Plus className="h-4 w-4" />إضافة دور</Button>
      </div>
      <DataTable
        headers={["الدور", "الكود", "الوصف", "نوع الدور", "الحالة", "عدد المستخدمين", "الإجراءات"]}
        rows={roles.map((role) => {
          const actions = [["تعديل", Edit3, () => onEdit(role)], ["استنساخ", Copy, () => onClone(role)]];
          if (!role.is_system_role) actions.push(["حذف", Trash2, () => onDelete(role), "danger"]);
          return [
            <StrongCell key="role" title={role.role_name_ar || role.name_ar} subtitle={role.role_name_en || role.name_en} />,
            role.code,
            role.description || "-",
            role.is_system_role ? <Badge color="slate">نظامي</Badge> : <Badge color="bank">مخصص</Badge>,
            role.is_active ? <Badge color="green">نشط</Badge> : <Badge color="slate">معطل</Badge>,
            role.users_count ?? 0,
            <ActionBar key="actions" actions={actions} />
          ];
        })}
      />
    </div>
  );
}

function ScreenPermissionsTab({ matrix, subject, setSubject, draft, setDraft, onSave }) {
  if (!matrix) return <EmptyState title="تعذر تحميل مصفوفة صلاحيات الشاشات." />;
  const subjectItems = subject.type === "role" ? matrix.roles : matrix.users;
  return (
    <div className="space-y-4">
      <SubjectSelector matrix={matrix} subject={subject} setSubject={setSubject} />
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>{matrix.screens.map((screen) => <th key={screen.key} className="whitespace-nowrap p-3 text-right">{screen.label}</th>)}</tr>
          </thead>
          <tbody>
            <tr>
              {matrix.screens.map((screen) => (
                <td key={screen.key} className="p-2">
                  <Select value={draft[screen.key] || "no_access"} onChange={(event) => setDraft({ ...draft, [screen.key]: event.target.value })}>
                    {permissionLevels.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </Select>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3 text-sm text-slate-500">
        <span>العنصر المحدد: {subjectItems.find((item) => String(item.id) === String(subject.id))?.name_ar || "اختر عنصرًا"}</span>
        <Button type="button" onClick={onSave} disabled={!subject.id} className="gap-2"><Save className="h-4 w-4" />حفظ صلاحيات الشاشات</Button>
      </div>
    </div>
  );
}

function ActionPermissionsTab({ matrix, subject, setSubject, draft, setDraft, onSave }) {
  if (!matrix) return <EmptyState title="تعذر تحميل الصلاحيات الإجرائية." />;
  const groups = groupBy(matrix.actions || [], "group");
  return (
    <div className="space-y-4">
      <SubjectSelector matrix={matrix} subject={subject} setSubject={setSubject} />
      <div className="grid gap-4 lg:grid-cols-2">
        {Object.entries(groups).map(([group, actions]) => (
          <Card key={group} className="p-4">
            <h3 className="mb-3 text-lg font-black text-slate-950">{group}</h3>
            <div className="space-y-2">
              {actions.map((action) => (
                <label key={action.code} className="flex items-center justify-between rounded-md border border-slate-200 p-3">
                  <span>
                    <span className="font-bold text-slate-800">{action.label}</span>
                    {action.dangerous && <span className="mr-2 rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">حساسة</span>}
                  </span>
                  <input type="checkbox" checked={Boolean(draft[action.code])} onChange={(event) => setDraft({ ...draft, [action.code]: event.target.checked })} />
                </label>
              ))}
            </div>
          </Card>
        ))}
      </div>
      <div className="flex justify-end"><Button type="button" onClick={onSave} disabled={!subject.id} className="gap-2"><Save className="h-4 w-4" />حفظ الصلاحيات الإجرائية</Button></div>
    </div>
  );
}

function OrganizationTab({ tree, issues, users, departments, selectedUsers, setSelectedUsers, departmentId, setDepartmentId, managerId, setManagerId, onAssignDepartment, onAssignManager }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-4">
          <h3 className="text-lg font-black text-slate-950">الهيكل الإداري</h3>
          <div className="mt-4 space-y-3">
            {tree.map((department) => (
              <div key={department.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between">
                  <strong>{department.name_ar}</strong>
                  <span className="text-xs text-slate-500">{department.users?.length || 0} مستخدم</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">المدير: {department.manager?.full_name_ar || "-"}</p>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <h3 className="text-lg font-black text-slate-950">ملاحظات الهيكل</h3>
          <div className="mt-4 space-y-2">
            {issues.length ? issues.map((issue, index) => <WarningLine key={index} text={`${issue.user?.full_name_ar || "-"} - ${issue.message}`} />) : <EmptyState title="لا توجد ملاحظات حالية." compact />}
          </div>
        </Card>
      </div>
      <Card className="p-4">
        <h3 className="text-lg font-black text-slate-950">إجراءات جماعية</h3>
        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_auto_1fr_auto]">
          <Select multiple value={selectedUsers.map(String)} onChange={(event) => setSelectedUsers(Array.from(event.target.selectedOptions).map((option) => Number(option.value)))} className="min-h-32">
            {users.map((user) => <option key={user.id} value={user.id}>{user.full_name_ar} - {user.employee_id}</option>)}
          </Select>
          <Select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
            <option value="">اختر إدارة</option>
            {departments.map((department) => <option key={department.id} value={department.id}>{department.name_ar}</option>)}
          </Select>
          <Button type="button" onClick={onAssignDepartment} disabled={!selectedUsers.length || !departmentId}>تعيين الإدارة</Button>
          <Select value={managerId} onChange={(event) => setManagerId(event.target.value)}>
            <option value="">اختر مديرًا</option>
            {users.map((user) => <option key={user.id} value={user.id}>{user.full_name_ar}</option>)}
          </Select>
          <Button type="button" onClick={onAssignManager} disabled={!selectedUsers.length || !managerId}>تعيين المدير</Button>
        </div>
      </Card>
    </div>
  );
}

function ImportTab({ state, setState, batches, onTemplate, onValidate, onConfirm }) {
  return (
    <div className="space-y-5">
      <Card className="p-4">
        <div className="grid gap-3 lg:grid-cols-[auto_1fr_auto_auto]">
          <Button type="button" onClick={onTemplate} className="gap-2 bg-white text-bank-700 ring-1 ring-bank-200 hover:bg-bank-50"><Download className="h-4 w-4" />تحميل القالب</Button>
          <Input type="file" accept=".xlsx,.xlsm" onChange={(event) => setState({ ...state, file: event.target.files?.[0] || null })} />
          <Button type="button" onClick={onValidate} className="gap-2"><Upload className="h-4 w-4" />تحقق من الملف</Button>
          <Button type="button" onClick={onConfirm} disabled={!state.validation?.batch_id || state.validation?.invalid_rows > 0} className="gap-2 bg-emerald-700 hover:bg-emerald-600"><CheckCircle2 className="h-4 w-4" />تأكيد الاستيراد</Button>
        </div>
      </Card>
      {state.validation && (
        <Card className="p-4">
          <h3 className="text-lg font-black text-slate-950">نتيجة التحقق</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <MetricPill label="الإجمالي" value={state.validation.total_rows} />
            <MetricPill label="الصالح" value={state.validation.valid_rows} />
            <MetricPill label="غير الصالح" value={state.validation.invalid_rows} />
            <MetricPill label="الحالة" value={state.validation.status} />
          </div>
          {state.validation.errors?.length > 0 && <DataTable headers={["الصف", "الحقل", "الخطأ"]} rows={state.validation.errors.map((error) => [error.row, error.field, error.message])} />}
        </Card>
      )}
      <DataTable headers={["الملف", "الإجمالي", "الصالح", "غير الصالح", "المستورد", "الحالة", "رفع بواسطة", "وقت الرفع"]} rows={batches.map((batch) => [batch.file_name, batch.total_rows, batch.valid_rows, batch.invalid_rows, batch.imported_rows, batch.status, batch.uploaded_by, formatSystemDateTime(batch.uploaded_at)])} />
    </div>
  );
}

function SecurityTab({ sessions, attempts, onRevoke, onRevokeAll }) {
  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button type="button" onClick={onRevokeAll} className="gap-2 bg-red-700 hover:bg-red-600"><LogOut className="h-4 w-4" />إنهاء جميع الجلسات</Button>
      </div>
      <DataTable headers={["المستخدم", "IP", "المتصفح", "وقت الدخول", "آخر نشاط", "الحالة", "الإجراء"]} rows={sessions.map((session) => [session.user_name, session.ip_address || "-", truncate(session.user_agent, 60), formatSystemDateTime(session.login_at), formatSystemDateTime(session.last_activity_at), session.is_active ? <Badge color="green">نشطة</Badge> : <Badge color="slate">منتهية</Badge>, <Button key="revoke" type="button" onClick={() => onRevoke(session)} disabled={!session.is_active} className="h-8 bg-white px-3 text-xs text-red-700 ring-1 ring-red-200 hover:bg-red-50">إنهاء</Button>])} />
      <DataTable headers={["المعرف", "المستخدم", "IP", "المتصفح", "النتيجة", "سبب الفشل", "التاريخ"]} rows={attempts.map((attempt) => [attempt.email_or_username, attempt.user_name, attempt.ip_address || "-", truncate(attempt.user_agent, 55), attempt.success ? <Badge color="green">نجاح</Badge> : <Badge color="red">فشل</Badge>, attempt.failure_reason || "-", formatSystemDateTime(attempt.created_at)])} />
    </div>
  );
}

function DelegationTab({ users, delegations, form, setForm, onSubmit, onDelete }) {
  return (
    <div className="space-y-5">
      <Card className="p-4">
        <form onSubmit={onSubmit} className="grid gap-3 lg:grid-cols-7">
          <Select value={form.delegator_user_id} onChange={(event) => setForm({ ...form, delegator_user_id: event.target.value })} required><option value="">المفوّض</option>{users.map((user) => <option key={user.id} value={user.id}>{user.full_name_ar}</option>)}</Select>
          <Select value={form.delegate_user_id} onChange={(event) => setForm({ ...form, delegate_user_id: event.target.value })} required><option value="">البديل</option>{users.map((user) => <option key={user.id} value={user.id}>{user.full_name_ar}</option>)}</Select>
          <Select value={form.delegation_scope} onChange={(event) => setForm({ ...form, delegation_scope: event.target.value })}><option value="approvals_only">الموافقات فقط</option><option value="messages_only">المراسلات فقط</option><option value="all_allowed_actions">كل الإجراءات المسموحة</option></Select>
          <Input type="datetime-local" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} required />
          <Input type="datetime-local" value={form.end_date} onChange={(event) => setForm({ ...form, end_date: event.target.value })} required />
          <Input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="السبب" />
          <Button type="submit" className="gap-2"><Plus className="h-4 w-4" />إضافة التفويض</Button>
        </form>
      </Card>
      <DataTable headers={["المفوّض", "البديل", "النطاق", "البداية", "النهاية", "الحالة", "السبب", "الإجراء"]} rows={delegations.map((item) => [item.delegator_name, item.delegate_name, delegationScope(item.delegation_scope), formatSystemDateTime(item.start_date), formatSystemDateTime(item.end_date), item.is_active ? <Badge color="green">نشط</Badge> : <Badge color="slate">متوقف</Badge>, item.reason || "-", <Button key="delete" type="button" onClick={() => onDelete(item)} className="h-8 bg-white px-3 text-xs text-red-700 ring-1 ring-red-200 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></Button>])} />
    </div>
  );
}

function AccessReviewTab({ review, onCreate, onComplete, onMark }) {
  const latest = review?.latest_review;
  const saved = review?.saved_items || [];
  const current = review?.items || [];
  return (
    <div className="space-y-5">
      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-black text-slate-950">مراجعة الصلاحيات</h3>
            <p className="mt-1 text-sm text-slate-500">تحدد الحسابات عالية الخطورة، المستخدمين غير المكتملين، والصلاحيات المباشرة.</p>
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={onCreate} className="gap-2"><ClipboardCheck className="h-4 w-4" />إنشاء مراجعة</Button>
            {latest && <Button type="button" onClick={() => onComplete(latest.id)} className="gap-2 bg-white text-bank-700 ring-1 ring-bank-200 hover:bg-bank-50">إكمال المراجعة</Button>}
          </div>
        </div>
        {latest && <p className="mt-3 text-sm text-slate-500">آخر مراجعة: {latest.review_name} - {latest.status} - {formatSystemDateTime(latest.created_at)}</p>}
      </Card>
      {saved.length > 0 ? (
        <DataTable headers={["المستخدم", "نوع الملاحظة", "الوصف", "الحالة", "الإجراء"]} rows={saved.map((item) => [item.user?.full_name_ar || "-", item.issue_type, item.description, item.status, <Button key="mark" type="button" onClick={() => onMark(item.id)} disabled={item.status === "reviewed"} className="h-8 px-3 text-xs">تمت المراجعة</Button>])} />
      ) : (
        <DataTable headers={["المستخدم", "نوع الملاحظة", "الوصف", "الحالة"]} rows={current.map((item) => [item.user?.full_name_ar || "-", item.issue_type, item.description, item.status])} />
      )}
    </div>
  );
}

function AuditLogsTab({ logs }) {
  return <DataTable headers={["الإجراء", "المستخدم المتأثر", "بواسطة", "التاريخ", "IP", "النتيجة"]} rows={logs.map((log) => [auditLabel(log.action), log.affected_user_id || "-", log.performed_by, formatSystemDateTime(log.created_at), log.ip_address || "-", log.result || "success"])} />;
}

function UserFormModal({ modal, setModal, users, departments, specializedSections, temporaryPassword, onSubmit }) {
  const form = modal.form;
  const setForm = (patch) => setModal({ ...modal, form: { ...form, ...patch } });
  const currentSectionExists = specializedSections.some((section) => section.code === form.administrative_section);
  return (
    <Modal title={modal.mode === "edit" ? "تعديل مستخدم" : "إضافة مستخدم"} onClose={() => setModal(null)}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-3">
          <Field label="الاسم العربي"><Input required value={form.full_name_ar} onChange={(event) => setForm({ full_name_ar: event.target.value })} /></Field>
          <Field label="الاسم الإنجليزي"><Input required value={form.full_name_en} onChange={(event) => setForm({ full_name_en: event.target.value })} /></Field>
          <Field label="اسم المستخدم"><Input value={form.username || ""} onChange={(event) => setForm({ username: event.target.value })} /></Field>
          <Field label="البريد الإلكتروني"><Input required type="email" value={form.email} onChange={(event) => setForm({ email: event.target.value })} /></Field>
          <Field label="الرقم الوظيفي"><Input required value={form.employee_id} onChange={(event) => setForm({ employee_id: event.target.value })} /></Field>
          <Field label="الجوال"><Input value={form.mobile || ""} onChange={(event) => setForm({ mobile: event.target.value })} /></Field>
          <Field label="المسمى الوظيفي"><Input value={form.job_title || ""} onChange={(event) => setForm({ job_title: event.target.value })} /></Field>
          <Field label="الإدارة"><Select value={form.department_id || ""} onChange={(event) => setForm({ department_id: event.target.value })}><option value="">اختر الإدارة</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name_ar}</option>)}</Select></Field>
          <Field label="المدير المباشر"><Select value={form.manager_id || ""} onChange={(event) => setForm({ manager_id: event.target.value })}><option value="">بدون مدير</option>{users.map((user) => <option key={user.id} value={user.id}>{user.full_name_ar}</option>)}</Select></Field>
          <Field label="نوع العلاقة"><Select value={form.relationship_type || "employee"} onChange={(event) => setForm({ relationship_type: event.target.value })}>{relationOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
          <Field label="الدور"><Select value={form.role} onChange={(event) => setForm({ role: event.target.value, administrative_section: event.target.value === "it_staff" ? form.administrative_section : "" })}>{roleOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
          <Field label="القسم المختص">
            <Select
              value={form.administrative_section || ""}
              disabled={form.role !== "it_staff"}
              onChange={(event) => setForm({ administrative_section: event.target.value })}
            >
              <option value="">{form.role === "it_staff" ? "اختر القسم المختص" : "لا ينطبق إلا على مختص تنفيذ"}</option>
              {form.administrative_section && !currentSectionExists && <option value={form.administrative_section}>{form.administrative_section}</option>}
              {specializedSections.map((section) => (
                <option key={section.id || section.code} value={section.code}>{section.name_ar || section.code}</option>
              ))}
            </Select>
          </Field>
          {modal.mode !== "edit" && (
            <Field label="كلمة المرور المؤقتة">
              <Input value={form.password} onChange={(event) => setForm({ password: event.target.value })} placeholder={temporaryPassword ? "مقروءة من إعدادات الأمان" : "اتركها فارغة لاستخدام إعداد النظام"} />
              <p className="mt-1 text-xs text-slate-500">اترك الحقل فارغًا ليستخدم النظام كلمة المرور المؤقتة من إعدادات الأمان.</p>
            </Field>
          )}
          <Field label="انتهاء كلمة المرور"><Input type="datetime-local" value={form.password_expires_at || ""} onChange={(event) => setForm({ password_expires_at: event.target.value })} /></Field>
          <Field label="IP مسموح"><Input value={form.allowed_login_from_ip || ""} onChange={(event) => setForm({ allowed_login_from_ip: event.target.value })} /></Field>
        </div>
        <Field label="ملاحظات"><textarea value={form.notes || ""} onChange={(event) => setForm({ notes: event.target.value })} className="min-h-24 w-full rounded-md border border-slate-300 p-3 text-sm outline-none focus:border-bank-600" /></Field>
        <div className="flex flex-wrap items-center gap-4 rounded-lg bg-slate-50 p-3">
          <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ is_active: event.target.checked })} />حساب نشط</label>
          <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.force_password_change} onChange={(event) => setForm({ force_password_change: event.target.checked })} />إجبار تغيير كلمة المرور</label>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={() => setModal(null)} className="bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">إلغاء</Button>
          <Button type="submit" className="gap-2"><Save className="h-4 w-4" />حفظ</Button>
        </div>
      </form>
    </Modal>
  );
}

function RoleFormModal({ modal, setModal, onSubmit }) {
  const form = modal.form;
  const setForm = (patch) => setModal({ ...modal, form: { ...form, ...patch } });
  return (
    <Modal title={modal.mode === "edit" ? "تعديل دور" : "إضافة دور"} onClose={() => setModal(null)}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-2">
          <Field label="اسم الدور بالعربي"><Input required value={form.name_ar} onChange={(event) => setForm({ name_ar: event.target.value })} /></Field>
          <Field label="اسم الدور بالإنجليزي"><Input value={form.name_en || ""} onChange={(event) => setForm({ name_en: event.target.value })} /></Field>
          <Field label="الكود"><Input required value={form.code} onChange={(event) => setForm({ code: event.target.value })} disabled={modal.role?.is_system_role} /></Field>
          <label className="mt-7 flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ is_active: event.target.checked })} />دور نشط</label>
        </div>
        <Field label="الوصف"><textarea value={form.description || ""} onChange={(event) => setForm({ description: event.target.value })} className="min-h-24 w-full rounded-md border border-slate-300 p-3 text-sm outline-none focus:border-bank-600" /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={() => setModal(null)} className="bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">إلغاء</Button>
          <Button type="submit" className="gap-2"><Save className="h-4 w-4" />حفظ</Button>
        </div>
      </form>
    </Modal>
  );
}

function UserDetailsDrawer({ details, usersById, departmentsById, onClose }) {
  const user = details.user;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30">
      <aside className="h-full w-full max-w-3xl overflow-y-auto bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-bank-700">ملف المستخدم</p>
            <h3 className="mt-2 text-2xl font-black text-slate-950">{user.full_name_ar}</h3>
            <p className="mt-1 text-sm text-slate-500">{user.email} - {user.employee_id}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Info label="الإدارة" value={departmentsById.get(user.department_id)?.name_ar || user.department?.name_ar || "-"} />
          <Info label="المدير المباشر" value={details.manager?.full_name_ar || usersById.get(user.manager_id)?.full_name_ar || "-"} />
          <Info label="الدور" value={roleLabel.get(user.role) || user.role} />
          <Info label="آخر دخول" value={formatSystemDateTime(user.last_login_at)} />
          <Info label="الحالة" value={statusText(user)} />
          <Info label="نوع العلاقة" value={relationLabel.get(user.relationship_type) || "-"} />
        </div>
        <Section title="صلاحيات الشاشات"><ChipList items={details.screen_permissions || []} /></Section>
        <Section title="الصلاحيات الإجرائية"><ChipList items={Object.entries(details.action_permissions || {}).filter(([, value]) => value).map(([key]) => key)} /></Section>
        <Section title="الجلسات النشطة">
          <DataTable compact headers={["IP", "المتصفح", "الدخول", "آخر نشاط", "الحالة"]} rows={(details.sessions || []).map((session) => [session.ip_address || "-", truncate(session.user_agent, 45), formatSystemDateTime(session.login_at), formatSystemDateTime(session.last_activity_at), session.is_active ? "نشطة" : "منتهية"])} />
        </Section>
        <Section title="آخر العمليات">
          <DataTable compact headers={["الإجراء", "بواسطة", "التاريخ"]} rows={(details.recent_audit_logs || []).map((log) => [auditLabel(log.action), log.performed_by, formatSystemDateTime(log.created_at)])} />
        </Section>
      </aside>
    </div>
  );
}

function SubjectSelector({ matrix, subject, setSubject }) {
  const items = subject.type === "role" ? matrix.roles || [] : matrix.users || [];
  const [userSearch, setUserSearch] = useState("");
  const query = userSearch.trim().toLowerCase();
  const selectedItem = items.find((item) => String(item.id) === String(subject.id));
  const filteredItems =
    subject.type === "user" && query
      ? items.filter((item) =>
          [item.name_ar, item.username, item.employee_id, item.email, item.role]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query))
        )
      : items;
  const visibleItems = selectedItem && !filteredItems.some((item) => item.id === selectedItem.id) ? [selectedItem, ...filteredItems] : filteredItems;
  const itemLabel = (item) => {
    if (subject.type === "role") return item.name_ar || item.role || item.code;
    return [item.name_ar, item.employee_id, item.username].filter(Boolean).join(" - ");
  };
  return (
    <div className={`grid gap-3 ${subject.type === "user" ? "lg:grid-cols-[220px_1fr_1.2fr]" : "lg:grid-cols-[220px_1fr]"}`}>
      <Select value={subject.type} onChange={(event) => {
        setUserSearch("");
        setSubject({ type: event.target.value, id: "" });
      }}>
        <option value="role">حسب الدور</option>
        <option value="user">حسب المستخدم</option>
      </Select>
      {subject.type === "user" && (
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-400" />
          <Input
            value={userSearch}
            onChange={(event) => setUserSearch(event.target.value)}
            className="pr-9"
            placeholder="ابحث بالاسم، الرقم الوظيفي، اسم المستخدم أو البريد"
          />
        </div>
      )}
      <Select value={subject.id} onChange={(event) => setSubject({ ...subject, id: event.target.value })}>
        <option value="">اختر {subject.type === "role" ? "دورًا" : "مستخدمًا"}</option>
        {visibleItems.map((item) => <option key={item.id} value={item.id}>{itemLabel(item)}</option>)}
      </Select>
    </div>
  );
}

function DataTable({ headers, rows, compact = false }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-slate-700">
          <tr>{headers.map((header) => <th key={header} className={`whitespace-nowrap text-right font-black ${compact ? "p-2" : "p-3"}`}>{header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length ? rows.map((row, index) => (
            <tr key={index} className="align-top hover:bg-slate-50/70">
              {row.map((cell, cellIndex) => <td key={cellIndex} className={`${compact ? "p-2" : "p-3"} text-slate-700`}>{cell}</td>)}
            </tr>
          )) : (
            <tr><td colSpan={headers.length} className="p-6 text-center text-sm text-slate-500">لا توجد بيانات للعرض.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ActionBar({ actions }) {
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map(([label, Icon, onClick, variant]) => (
        <button
          key={label}
          type="button"
          onClick={onClick}
          title={label}
          className={`inline-flex h-8 items-center gap-1 rounded-md border bg-white px-2 text-xs font-bold ${
            variant === "danger"
              ? "border-red-200 text-red-700 hover:border-red-300 hover:bg-red-50"
              : "border-slate-200 text-slate-700 hover:border-bank-200 hover:bg-bank-50 hover:text-bank-800"
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

function Select({ className = "", children, ...props }) {
  return <select {...props} className={`h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100 ${className}`}>{children}</select>;
}

function Field({ label, children }) {
  return <label className="block text-sm font-bold text-slate-800"><span className="mb-2 block">{label}</span>{children}</label>;
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-xl font-black text-slate-950">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-md border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CardMetric({ label, value }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-2 text-xl font-black text-slate-950">{value ?? "-"}</p></div>;
}

function MetricPill({ label, value }) {
  return <div className="rounded-md border border-bank-100 bg-bank-50 px-4 py-2 text-sm"><span className="font-bold text-bank-800">{label}: </span><span className="font-black text-slate-950">{value ?? "-"}</span></div>;
}

function ChartCard({ title, rows }) {
  const max = Math.max(1, ...rows.map((row) => Number(row.value || 0)));
  return (
    <Card className="p-4">
      <h3 className="text-lg font-black text-slate-950">{title}</h3>
      <div className="mt-4 space-y-3">
        {rows.length ? rows.map((row) => (
          <div key={row.label}>
            <div className="mb-1 flex items-center justify-between text-xs font-bold text-slate-600"><span>{row.label}</span><span>{row.value}</span></div>
            <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-bank-600" style={{ width: `${Math.max(4, (Number(row.value || 0) / max) * 100)}%` }} /></div>
          </div>
        )) : <EmptyState title="لا توجد بيانات." compact />}
      </div>
    </Card>
  );
}

function StrongCell({ title, subtitle }) {
  return <div><p className="font-black text-slate-950">{title}</p>{subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}</div>;
}

function StatusBadge({ user }) {
  const locked = user.is_locked || isTemporarilyLocked(user);
  if (!user.is_active) return <Badge color="slate">غير نشط</Badge>;
  if (locked) return <Badge color="amber">مقفل</Badge>;
  if (user.force_password_change) return <Badge color="blue">تغيير كلمة المرور</Badge>;
  if (!user.last_login_at) return <Badge color="slate">لم يسجل الدخول</Badge>;
  return <Badge color="green">نشط</Badge>;
}

function Badge({ color = "slate", children }) {
  const colors = {
    green: "bg-emerald-50 text-emerald-700",
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-blue-50 text-blue-700",
    bank: "bg-bank-50 text-bank-700",
    slate: "bg-slate-100 text-slate-600"
  };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${colors[color] || colors.slate}`}>{children}</span>;
}

function EmptyState({ title, compact = false }) {
  return <div className={`rounded-lg border border-dashed border-slate-200 bg-slate-50 text-center text-sm font-bold text-slate-500 ${compact ? "p-3" : "p-8"}`}>{title}</div>;
}

function WarningLine({ text }) {
  return <div className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm font-bold text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4" />{text}</div>;
}

function Info({ label, value }) {
  return <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 font-black text-slate-950">{value || "-"}</p></div>;
}

function Section({ title, children }) {
  return <div className="mt-6"><h4 className="mb-3 text-lg font-black text-slate-950">{title}</h4>{children}</div>;
}

function ChipList({ items }) {
  return <div className="flex flex-wrap gap-2">{items.length ? items.map((item) => <Badge key={item} color="bank">{item}</Badge>) : <span className="text-sm text-slate-500">لا توجد بيانات.</span>}</div>;
}

function findPermissionSubject(matrix, subject) {
  if (!matrix || !subject.id) return null;
  const list = subject.type === "role" ? matrix.roles : matrix.users;
  return (list || []).find((item) => String(item.id) === String(subject.id));
}

function userToForm(user) {
  return {
    ...emptyUserForm,
    ...user,
    department_id: user.department_id || "",
    manager_id: user.manager_id || "",
    mobile: user.mobile || "",
    job_title: user.job_title || "",
    administrative_section: user.administrative_section || "",
    password_expires_at: toLocalDateTimeInput(user.password_expires_at),
    allowed_login_from_ip: user.allowed_login_from_ip || "",
    notes: user.notes || "",
    password: ""
  };
}

function roleToForm(role) {
  return {
    name_ar: role.role_name_ar || role.name_ar || "",
    name_en: role.role_name_en || role.name_en || "",
    code: role.code || "",
    description: role.description || "",
    is_active: role.is_active
  };
}

function toLocalDateTimeInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

function isTemporarilyLocked(user) {
  if (!user.locked_until) return false;
  const date = new Date(user.locked_until);
  return !Number.isNaN(date.getTime()) && date > new Date();
}

function statusText(user) {
  if (!user.is_active) return "غير نشط";
  if (user.is_locked || isTemporarilyLocked(user)) return "مقفل";
  if (user.force_password_change) return "بانتظار تغيير كلمة المرور";
  if (!user.last_login_at) return "لم يسجل الدخول";
  return "نشط";
}

function groupBy(rows, key) {
  return rows.reduce((groups, row) => {
    const group = row[key] || "أخرى";
    groups[group] = groups[group] || [];
    groups[group].push(row);
    return groups;
  }, {});
}

function truncate(value, length) {
  if (!value) return "-";
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

function delegationScope(value) {
  return { approvals_only: "الموافقات فقط", messages_only: "المراسلات فقط", all_allowed_actions: "كل الإجراءات المسموحة" }[value] || value;
}

function auditLabel(action) {
  const labels = {
    user_created: "إنشاء مستخدم",
    user_updated: "تعديل مستخدم",
    user_disabled: "تعطيل مستخدم",
    user_enabled: "تفعيل مستخدم",
    password_reset: "إعادة تعيين كلمة المرور",
    role_created: "إنشاء دور",
    role_updated: "تعديل دور",
    role_cloned: "استنساخ دور",
    screen_permission_changed: "تعديل صلاحيات الشاشات",
    action_permission_changed: "تعديل صلاحيات إجرائية",
    user_import_validated: "التحقق من استيراد مستخدمين",
    user_import_confirmed: "تأكيد استيراد مستخدمين",
    user_locked: "قفل مستخدم",
    user_unlocked: "فك قفل مستخدم",
    sessions_terminated: "إنهاء جلسات",
    delegation_created: "إنشاء تفويض",
    delegation_updated: "تعديل تفويض",
    delegation_deleted: "حذف تفويض",
    access_review_created: "إنشاء مراجعة صلاحيات",
    access_review_completed: "إكمال مراجعة صلاحيات"
  };
  return labels[action] || action;
}
