import { useEffect, useMemo, useState } from "react";
import { Edit3, KeyRound, Search, ShieldCheck, UserPlus, UserRoundX, Users } from "lucide-react";
import { api, getErrorMessage } from "../../lib/axios";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const roles = [
  ["employee", "موظف"],
  ["direct_manager", "مدير مباشر"],
  ["it_staff", "موظف تقنية معلومات"],
  ["it_manager", "مدير تقنية المعلومات"],
  ["information_security", "أمن المعلومات"],
  ["executive_management", "الإدارة التنفيذية"],
  ["super_admin", "مدير النظام"]
];

const relationRoles = new Set(["employee", "direct_manager"]);
const managerRoleKeys = new Set(["direct_manager", "it_manager", "executive_management", "super_admin"]);
const seniorManagerRoles = new Set(["it_manager", "executive_management", "super_admin"]);

function isTemporarilyLocked(user) {
  if (!user.locked_until) return false;
  const lockedUntil = new Date(user.locked_until);
  return !Number.isNaN(lockedUntil.getTime()) && lockedUntil > new Date();
}

function userStatus(user) {
  if (!user.is_active) {
    return { label: "معطل", className: "bg-slate-100 text-slate-500" };
  }
  if (isTemporarilyLocked(user)) {
    return { label: "معطل مؤقتاً", className: "bg-amber-50 text-amber-700" };
  }
  return { label: "نشط", className: "bg-emerald-50 text-emerald-700" };
}

const empty = {
  full_name_ar: "",
  full_name_en: "",
  username: "",
  email: "",
  employee_id: "",
  mobile: "",
  department_id: "",
  manager_id: "",
  administrative_section: "",
  role: "employee",
  password: "Change@12345",
  is_active: true
};

export default function UserSettings({ notify }) {
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [administrativeSections, setAdministrativeSections] = useState([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [query, setQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [administrativeSection, setAdministrativeSection] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [permissionsDialog, setPermissionsDialog] = useState(null);
  const [availableScreens, setAvailableScreens] = useState([]);
  const [selectedScreens, setSelectedScreens] = useState([]);
  const [permissionsSaving, setPermissionsSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [usersResponse, departmentsResponse, sectionsResponse] = await Promise.all([
        api.get("/users"),
        api.get("/departments"),
        api.get("/settings/specialized-sections", { params: { active_only: true } })
      ]);
      setUsers(usersResponse.data);
      setDepartments(departmentsResponse.data);
      setAdministrativeSections(sectionsResponse.data.map((section) => ({ value: section.code, label: section.name_ar, name_en: section.name_en || "" })));
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const selectedDepartmentId = form.department_id ? Number(form.department_id) : null;
  const departmentNameById = useMemo(() => new Map(departments.map((item) => [item.id, item.name_ar])), [departments]);
  const userNameById = useMemo(() => new Map(users.map((item) => [item.id, item.full_name_ar])), [users]);
  const roleLabelByKey = useMemo(() => new Map(roles), []);

  const departmentByAdministrativeSection = useMemo(() => {
    return new Map(
      administrativeSections.map((section) => [
        section.value,
        departments.find((department) => {
          const text = `${department.name_ar || ""} ${department.name_en || ""} ${department.code || ""}`.toLowerCase();
          return [section.value, section.label, section.name_en].filter(Boolean).some((keyword) => text.includes(String(keyword).toLowerCase()));
        })
      ])
    );
  }, [departments, administrativeSections]);

  const managerOptions = useMemo(() => {
    return users.filter((user) => {
      if (!user.is_active || !managerRoleKeys.has(user.role) || user.id === editingId) return false;
      if (!selectedDepartmentId) return seniorManagerRoles.has(user.role);
      if (user.role === "direct_manager") return user.department_id === selectedDepartmentId;
      return seniorManagerRoles.has(user.role);
    });
  }, [users, editingId, selectedDepartmentId]);

  const filteredUsers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return users.filter((user) => {
      const matchesQuery =
        !normalized ||
        [user.full_name_ar, user.full_name_en, user.username, user.email, user.employee_id, user.mobile]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalized));
      const matchesDepartment = !departmentFilter || String(user.department_id || "") === departmentFilter;
      const matchesRole = !roleFilter || user.role === roleFilter;
      const locked = isTemporarilyLocked(user);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && user.is_active && !locked) ||
        (statusFilter === "disabled" && (!user.is_active || locked)) ||
        (statusFilter === "locked" && locked);
      return matchesQuery && matchesDepartment && matchesRole && matchesStatus;
    });
  }, [users, query, departmentFilter, roleFilter, statusFilter]);

  const activeCount = users.filter((user) => user.is_active && !isTemporarilyLocked(user)).length;
  const departmentManagersCount = users.filter((user) => user.role === "direct_manager").length;
  const linkedCount = users.filter((user) => user.department_id && user.manager_id).length;

  function updateField(field, value) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "role" && value !== "it_staff") {
        next.administrative_section = "";
        setAdministrativeSection("");
      }
      if (field === "department_id") {
        const nextDepartmentId = value ? Number(value) : null;
        const selectedManager = users.find((user) => String(user.id) === String(current.manager_id));
        if (selectedManager?.role === "direct_manager" && selectedManager.department_id !== nextDepartmentId) {
          next.manager_id = "";
        }
      }
      if (field === "role" && value === "direct_manager") {
        next.manager_id = "";
      }
      return next;
    });
  }

  function selectAdministrativeSection(value) {
    setAdministrativeSection(value);
    const matchedDepartment = departmentByAdministrativeSection.get(value);
    setForm((current) => ({
      ...current,
      role: current.role === "employee" || current.role === "direct_manager" ? "it_staff" : current.role,
      administrative_section: value,
      department_id: matchedDepartment ? String(matchedDepartment.id) : current.department_id
    }));
  }

  function resetForm() {
    setEditingId(null);
    setForm(empty);
    setAdministrativeSection("");
    setError("");
  }

  function edit(user) {
    setEditingId(user.id);
    setForm({
      full_name_ar: user.full_name_ar || "",
      full_name_en: user.full_name_en || "",
      username: user.username || "",
      email: user.email || "",
      employee_id: user.employee_id || "",
      mobile: user.mobile || "",
      department_id: user.department_id ? String(user.department_id) : "",
      manager_id: user.manager_id ? String(user.manager_id) : "",
      administrative_section: user.administrative_section || "",
      role: user.role || "employee",
      password: "Change@12345",
      is_active: Boolean(user.is_active)
    });
    setAdministrativeSection(user.administrative_section || "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function buildPayload() {
    return {
      employee_id: form.employee_id.trim(),
      username: form.username.trim() || null,
      full_name_ar: form.full_name_ar.trim(),
      full_name_en: form.full_name_en.trim(),
      email: form.email.trim(),
      mobile: form.mobile.trim() || null,
      role: form.role,
      administrative_section: form.role === "it_staff" ? form.administrative_section || administrativeSection || null : null,
      department_id: form.department_id ? Number(form.department_id) : null,
      manager_id: form.manager_id ? Number(form.manager_id) : null,
      is_active: Boolean(form.is_active)
    };
  }

  async function save(event) {
    event.preventDefault();
    if (form.role === "it_staff" && !(form.administrative_section || administrativeSection)) {
      const message = "اختر القسم المختص لموظف تقنية المعلومات قبل الحفظ.";
      setError(message);
      notify(message, "error");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = buildPayload();
      if (editingId) {
        await api.put(`/users/${editingId}`, payload);
        notify("تم تحديث بيانات المستخدم");
      } else {
        await api.post("/users", { ...payload, password: form.password || "Change@12345" });
        notify("تم إنشاء المستخدم وربطه بالإدارة والمدير المباشر");
      }
      resetForm();
      await load();
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function disable(id) {
    if (!window.confirm("هل تريد تعطيل هذا المستخدم؟")) return;
    try {
      await api.post(`/users/${id}/disable`);
      notify("تم تعطيل المستخدم");
      await load();
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    }
  }

  async function resetPassword(id) {
    if (!window.confirm("سيتم تعيين كلمة المرور المؤقتة إلى Change@12345. هل تريد المتابعة؟")) return;
    try {
      await api.post(`/users/${id}/reset-password`, { password: "Change@12345" });
      notify("تمت إعادة تعيين كلمة المرور إلى Change@12345");
      await load();
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    }
  }

  async function openPermissions(user) {
    setPermissionsDialog(user);
    setPermissionsSaving(true);
    try {
      const response = await api.get(`/users/${user.id}/screen-permissions`);
      setAvailableScreens(response.data.available_screens || []);
      setSelectedScreens(response.data.screens || []);
    } catch (error) {
      notify(getErrorMessage(error), "error");
      setPermissionsDialog(null);
    } finally {
      setPermissionsSaving(false);
    }
  }

  async function savePermissions(event) {
    event.preventDefault();
    if (!permissionsDialog) return;
    setPermissionsSaving(true);
    try {
      await api.put(`/users/${permissionsDialog.id}/screen-permissions`, { screens: selectedScreens });
      notify("تم حفظ صلاحيات الوصول للشاشات");
      setPermissionsDialog(null);
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setPermissionsSaving(false);
    }
  }

  function toggleScreen(screenKey) {
    setSelectedScreens((current) => current.includes(screenKey) ? current.filter((key) => key !== screenKey) : [...current, screenKey]);
  }

  const relationMode = relationRoles.has(form.role) ? form.role : "advanced";

  return (
    <div className="space-y-5" dir="rtl">
      {permissionsDialog && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <form onSubmit={savePermissions} className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-950">صلاحيات الوصول للشاشات</h3>
                <p className="mt-1 text-sm text-slate-500">{permissionsDialog.full_name_ar}</p>
              </div>
              <button type="button" onClick={() => setPermissionsDialog(null)} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100">×</button>
            </div>
            <div className="grid gap-2">
              {availableScreens.map((screen) => (
                <label key={screen.key} className="flex items-center gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-800">
                  <input type="checkbox" checked={selectedScreens.includes(screen.key)} onChange={() => toggleScreen(screen.key)} />
                  {screen.label}
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setPermissionsDialog(null)} className="h-9 rounded-md border border-slate-300 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">إلغاء</button>
              <Button type="submit" disabled={permissionsSaving}>{permissionsSaving ? "جاري الحفظ..." : "حفظ الصلاحيات"}</Button>
            </div>
          </form>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard icon={Users} label="إجمالي المستخدمين" value={users.length} />
        <MetricCard icon={ShieldCheck} label="حسابات نشطة" value={activeCount} />
        <MetricCard icon={UserPlus} label="مديرو الإدارات" value={departmentManagersCount} hint={`${linkedCount} مستخدم مرتبط بإدارة ومدير`} />
      </div>

      <form onSubmit={save} className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-base font-bold text-slate-950">{editingId ? "تعديل مستخدم" : "إضافة مستخدم جديد"}</h4>
            <p className="mt-1 text-xs text-slate-500">اختر علاقة المستخدم داخل الإدارة، ثم حدد الصلاحية والقسم المختص عند الحاجة.</p>
          </div>
          {editingId && (
            <Button type="button" onClick={resetForm} className="border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
              إلغاء التعديل
            </Button>
          )}
        </div>

        <div className="mb-4 rounded-md border border-bank-100 bg-white p-3">
          <p className="mb-2 text-xs font-bold text-slate-600">العلاقة داخل الإدارة</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <RelationButton active={relationMode === "employee"} onClick={() => updateField("role", "employee")} title="موظف" description="يرتبط بمدير مباشر داخل نفس الإدارة" />
            <RelationButton active={relationMode === "direct_manager"} onClick={() => updateField("role", "direct_manager")} title="مدير مباشر" description="يظهر كمدير لموظفي الإدارة المختارة" />
            <RelationButton active={relationMode === "advanced"} onClick={() => updateField("role", "it_staff")} title="صلاحية إدارية" description="أدوار تقنية المعلومات أو الإدارة العليا" />
          </div>
          {relationMode === "advanced" && (
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 text-xs font-bold text-slate-600">القسم المختص</p>
              <div className="grid gap-2 md:grid-cols-4">
                {administrativeSections.map((section) => {
                  const matchedDepartment = departmentByAdministrativeSection.get(section.value);
                  return (
                    <button
                      key={section.value}
                      type="button"
                      onClick={() => selectAdministrativeSection(section.value)}
                      className={`rounded-md border p-3 text-right text-sm font-bold transition ${
                        administrativeSection === section.value ? "border-bank-600 bg-bank-50 text-bank-800" : "border-slate-200 bg-white text-slate-700 hover:border-bank-200"
                      }`}
                    >
                      {section.label}
                      {!matchedDepartment && <span className="mt-1 block text-[11px] font-medium text-amber-700">اختر الإدارة يدوياً</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="الاسم العربي"><Input value={form.full_name_ar} onChange={(event) => updateField("full_name_ar", event.target.value)} required /></Field>
          <Field label="الاسم الإنجليزي"><Input value={form.full_name_en} onChange={(event) => updateField("full_name_en", event.target.value)} required /></Field>
          <Field label="اسم المستخدم"><Input value={form.username} onChange={(event) => updateField("username", event.target.value)} /></Field>
          <Field label="البريد الإلكتروني"><Input type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} required /></Field>
          <Field label="الرقم الوظيفي"><Input value={form.employee_id} onChange={(event) => updateField("employee_id", event.target.value)} required /></Field>
          <Field label="رقم الجوال"><Input value={form.mobile} onChange={(event) => updateField("mobile", event.target.value)} /></Field>
          <Field label="الإدارة">
            <Select value={form.department_id} onChange={(event) => updateField("department_id", event.target.value)} required>
              <option value="">اختر الإدارة</option>
              {departments.map((item) => <option key={item.id} value={item.id}>{item.name_ar}</option>)}
            </Select>
          </Field>
          <Field label={form.role === "employee" ? "المدير المباشر من نفس الإدارة" : "المدير الأعلى"}>
            <Select value={form.manager_id} onChange={(event) => updateField("manager_id", event.target.value)} disabled={form.role === "direct_manager"}>
              <option value="">{form.role === "direct_manager" ? "مدير الإدارة لا يحتاج مدير مباشر" : "اختر المدير المباشر"}</option>
              {managerOptions.map((user) => <option key={user.id} value={user.id}>{user.full_name_ar} - {roleLabelByKey.get(user.role) || user.role}</option>)}
            </Select>
          </Field>
          <Field label="صلاحية النظام">
            <Select value={form.role} onChange={(event) => updateField("role", event.target.value)}>
              {roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          {!editingId && <Field label="كلمة المرور المؤقتة"><Input type="text" value={form.password} onChange={(event) => updateField("password", event.target.value)} required /></Field>}
          <label className="flex h-10 items-center gap-2 self-end rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={form.is_active} onChange={(event) => updateField("is_active", event.target.checked)} />
            حساب نشط
          </label>
          <Button type="submit" disabled={saving} className="self-end">
            {saving ? "جار الحفظ..." : editingId ? "حفظ التعديل" : "إضافة المستخدم"}
          </Button>
        </div>
      </form>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(280px,1fr)_220px_220px_180px]">
          <div className="relative">
            <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pr-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث بالاسم أو البريد أو الرقم الوظيفي" />
          </div>
          <Select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
            <option value="">كل الإدارات</option>
            {departments.map((item) => <option key={item.id} value={item.id}>{item.name_ar}</option>)}
          </Select>
          <Select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="">كل الصلاحيات</option>
            {roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="disabled">معطل</option>
            <option value="locked">معطل مؤقتاً</option>
          </Select>
        </div>
      </div>

      {error && <p className="rounded-md bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[1180px] text-sm">
          <thead className="bg-slate-50 text-xs font-bold text-slate-500">
            <tr>
              {["المستخدم", "البريد", "الرقم الوظيفي", "الإدارة", "المدير المباشر", "الصلاحية", "الحالة", "الإجراءات"].map((header) => (
                <th key={header} className="p-3 text-right">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan="8" className="p-6 text-center text-slate-500">جار تحميل المستخدمين...</td></tr>}
            {!loading && filteredUsers.length === 0 && <tr><td colSpan="8" className="p-6 text-center text-slate-500">لا توجد نتائج مطابقة</td></tr>}
            {!loading && filteredUsers.map((user) => {
              const status = userStatus(user);
              return (
                <tr key={user.id} className="hover:bg-slate-50/80">
                  <td className="p-3"><p className="font-bold text-slate-950">{user.full_name_ar}</p><p className="mt-1 text-xs text-slate-500">{user.full_name_en}</p></td>
                  <td className="p-3 text-slate-600"><p>{user.email}</p><p className="mt-1 text-xs">{user.mobile || "-"}</p></td>
                  <td className="p-3 font-semibold text-slate-700">{user.employee_id}</td>
                  <td className="p-3">{departmentNameById.get(user.department_id) || "-"}</td>
                  <td className="p-3">{userNameById.get(user.manager_id) || (user.role === "direct_manager" ? "مدير الإدارة" : "-")}</td>
                  <td className="p-3"><span className="rounded-full bg-bank-50 px-3 py-1 text-xs font-bold text-bank-700">{roleLabelByKey.get(user.role) || user.role}</span></td>
                  <td className="p-3"><span className={`rounded-full px-3 py-1 text-xs font-bold ${status.className}`}>{status.label}</span></td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      <IconButton label="تعديل" onClick={() => edit(user)} icon={Edit3} />
                      <IconButton label="صلاحيات الشاشات" onClick={() => openPermissions(user)} icon={ShieldCheck} />
                      <IconButton label="إعادة كلمة المرور" onClick={() => resetPassword(user.id)} icon={KeyRound} />
                      {user.is_active && <IconButton label="تعطيل" onClick={() => disable(user.id)} icon={UserRoundX} danger />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RelationButton({ active, onClick, title, description }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-md border p-3 text-right transition ${active ? "border-bank-600 bg-bank-50 text-bank-800" : "border-slate-200 bg-white text-slate-700 hover:border-bank-200"}`}>
      <p className="text-sm font-bold">{title}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
    </button>
  );
}

function Field({ label, children }) {
  return <label className="space-y-1"><span className="text-xs font-bold text-slate-600">{label}</span>{children}</label>;
}

function Select({ className = "", ...props }) {
  return <select className={`h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100 disabled:bg-slate-100 disabled:text-slate-500 ${className}`} {...props} />;
}

function MetricCard({ icon: Icon, label, value, hint }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-2 text-2xl font-black text-slate-950">{value}</p></div>
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-bank-50 text-bank-700"><Icon className="h-5 w-5" /></div>
      </div>
      {hint && <p className="mt-3 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function IconButton({ label, icon: Icon, danger = false, ...props }) {
  return (
    <button type="button" title={label} className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-bold transition ${danger ? "border-red-200 text-red-700 hover:bg-red-50" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`} {...props}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
