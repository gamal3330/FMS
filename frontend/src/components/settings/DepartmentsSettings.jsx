import { useEffect, useMemo, useState } from "react";
import { Edit3, Plus, Search, Trash2, UserCheck } from "lucide-react";
import { api, getErrorMessage } from "../../lib/axios";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const empty = { name_ar: "", name_en: "", code: "", manager_id: "", is_active: true };

export default function DepartmentsSettings({ notify }) {
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const [{ data: departments }, usersResponse] = await Promise.all([
        api.get("/departments", { params: { search: search || undefined } }),
        api.get("/users").catch(() => ({ data: [] }))
      ]);
      setItems(departments);
      setUsers(Array.isArray(usersResponse.data) ? usersResponse.data : []);
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    }
  }

  useEffect(() => {
    load();
  }, []);

  const usersById = useMemo(() => new Map(users.map((user) => [Number(user.id), user])), [users]);
  const managerCandidates = useMemo(() => {
    const managerRoles = new Set(["direct_manager", "it_manager", "executive_management", "super_admin"]);
    return users
      .filter((user) => user.is_active && !user.is_locked && managerRoles.has(user.role))
      .sort((first, second) => String(first.full_name_ar || "").localeCompare(String(second.full_name_ar || ""), "ar"));
  }, [users]);

  async function save(event) {
    event.preventDefault();
    setError("");
    const payload = { ...form, manager_id: form.manager_id ? Number(form.manager_id) : null };
    try {
      if (editingId) {
        await api.put(`/departments/${editingId}`, payload);
        notify("تم تعديل الإدارة");
      } else {
        await api.post("/departments", payload);
        notify("تمت إضافة الإدارة");
      }
      setForm(empty);
      setEditingId(null);
      await load();
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    }
  }

  async function remove(id) {
    try {
      await api.delete(`/departments/${id}`);
      notify("تم حذف الإدارة");
      await load();
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={save} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-950">{editingId ? "تعديل إدارة" : "إضافة إدارة"}</h3>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setForm(empty);
                setEditingId(null);
              }}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-bold"
            >
              إلغاء التعديل
            </button>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="اسم الإدارة بالعربية">
            <Input value={form.name_ar} onChange={(event) => setForm({ ...form, name_ar: event.target.value })} required />
          </Field>
          <Field label="اسم الإدارة بالإنجليزية">
            <Input value={form.name_en} onChange={(event) => setForm({ ...form, name_en: event.target.value })} required />
          </Field>
          <Field label="رمز الإدارة">
            <Input value={form.code ?? ""} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="مثال: hr" required />
          </Field>
          <Field label="مدير الإدارة">
            <select
              value={form.manager_id ?? ""}
              onChange={(event) => setForm({ ...form, manager_id: event.target.value })}
              className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-bank-500 focus:ring-2 focus:ring-bank-100"
            >
              <option value="">بدون مدير إدارة</option>
              {managerCandidates.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name_ar || user.email} - {roleLabel(user.role)}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex h-10 items-center gap-2 self-end rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold">
            <input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} />
            إدارة نشطة
          </label>
        </div>

        <div className="flex justify-end">
          <Button type="submit" className="gap-2">
            <Plus className="h-4 w-4" />
            {editingId ? "حفظ التعديل" : "إضافة إدارة"}
          </Button>
        </div>
      </form>
      <div className="relative">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input value={search} onChange={(event) => setSearch(event.target.value)} onKeyUp={load} placeholder="البحث عن إدارة" className="pr-10" />
      </div>
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <Table headers={["اسم الإدارة بالعربية", "اسم الإدارة بالإنجليزية", "رمز الإدارة", "مدير الإدارة", "الحالة", "الإجراء"]}>
        {items.map((item) => (
          <tr key={item.id}>
            <td className="p-3">{item.name_ar}</td>
            <td className="p-3">{item.name_en}</td>
            <td className="p-3">{item.code}</td>
            <td className="p-3">
              <ManagerCell manager={usersById.get(Number(item.manager_id))} managerId={item.manager_id} />
            </td>
            <td className="p-3">
              <span className={`rounded-md px-3 py-1 text-xs font-bold ${item.is_active ? "bg-bank-50 text-bank-700" : "bg-slate-100 text-slate-500"}`}>
                {item.is_active ? "نشطة" : "متوقفة"}
              </span>
            </td>
            <td className="flex gap-2 p-3">
              <button onClick={() => { setEditingId(item.id); setForm({ ...item, manager_id: item.manager_id ?? "" }); }} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50"><Edit3 className="h-3 w-3" /> تعديل</button>
              <button onClick={() => remove(item.id)} className="rounded-md border border-red-200 px-3 py-1 text-xs text-red-700 hover:bg-red-50"><Trash2 className="h-3 w-3" /></button>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function ManagerCell({ manager, managerId }) {
  if (!managerId) {
    return <span className="rounded-md bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">لم يحدد</span>;
  }
  if (!manager) {
    return <span className="rounded-md bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">مستخدم #{managerId}</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-bank-50 text-bank-700">
        <UserCheck className="h-4 w-4" />
      </span>
      <div>
        <p className="font-bold text-slate-900">{manager.full_name_ar || manager.email}</p>
        <p className="text-xs text-slate-500">{roleLabel(manager.role)}</p>
      </div>
    </div>
  );
}

function roleLabel(role) {
  return {
    employee: "موظف",
    direct_manager: "مدير مباشر",
    it_staff: "مختص تنفيذ",
    it_manager: "مدير إدارة",
    information_security: "أمن المعلومات (دور قديم)",
    executive_management: "الإدارة التنفيذية",
    super_admin: "مدير النظام"
  }[role] || role || "-";
}

function Field({ label, children }) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-bold">{label}</span>
      {children}
    </label>
  );
}

function Table({ headers, children }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-slate-50">
          <tr>{headers.map((header) => <th key={header} className="p-3 text-right">{header}</th>)}</tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}
