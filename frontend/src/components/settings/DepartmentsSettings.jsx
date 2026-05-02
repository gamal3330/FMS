import { useEffect, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { api, getErrorMessage } from "../../lib/axios";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const empty = { name_ar: "", name_en: "", code: "", manager_id: "", is_active: true };

export default function DepartmentsSettings({ notify }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const { data } = await api.get("/departments", { params: { search: search || undefined } });
      setItems(data);
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    }
  }

  useEffect(() => {
    load();
  }, []);

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
      <form onSubmit={save} className="grid gap-3 rounded-md border border-slate-200 p-4 md:grid-cols-3">
        <Input placeholder="اسم الإدارة بالعربية" value={form.name_ar} onChange={(event) => setForm({ ...form, name_ar: event.target.value })} required />
        <Input placeholder="اسم الإدارة بالإنجليزية" value={form.name_en} onChange={(event) => setForm({ ...form, name_en: event.target.value })} required />
        <Input placeholder="رمز الإدارة" value={form.code ?? ""} onChange={(event) => setForm({ ...form, code: event.target.value })} required />
        <Input placeholder="رقم المدير" value={form.manager_id ?? ""} onChange={(event) => setForm({ ...form, manager_id: event.target.value })} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /> Active</label>
        <Button type="submit" className="gap-2"><Plus className="h-4 w-4" /> {editingId ? "حفظ التعديل" : "إضافة إدارة"}</Button>
      </form>
      <div className="relative">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input value={search} onChange={(event) => setSearch(event.target.value)} onKeyUp={load} placeholder="البحث عن إدارة" className="pr-10" />
      </div>
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <Table headers={["Arabic", "English", "Code", "Manager", "Status", "Actions"]}>
        {items.map((item) => (
          <tr key={item.id}>
            <td className="p-3">{item.name_ar}</td>
            <td className="p-3">{item.name_en}</td>
            <td className="p-3">{item.code}</td>
            <td className="p-3">{item.manager_id ?? "-"}</td>
            <td className="p-3">{item.is_active ? "Active" : "Inactive"}</td>
            <td className="flex gap-2 p-3">
              <button onClick={() => { setEditingId(item.id); setForm({ ...item, manager_id: item.manager_id ?? "" }); }} className="rounded-md border px-3 py-1 text-xs">Edit</button>
              <button onClick={() => remove(item.id)} className="rounded-md border border-red-200 px-3 py-1 text-xs text-red-700"><Trash2 className="h-3 w-3" /></button>
            </td>
          </tr>
        ))}
      </Table>
    </div>
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
