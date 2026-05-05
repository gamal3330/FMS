import { useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import { api, getErrorMessage } from "../../lib/axios";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import FeedbackDialog from "../../components/ui/FeedbackDialog";
import { Input } from "../../components/ui/input";
import DynamicFieldsBuilder from "../../components/request-types/DynamicFieldsBuilder";
import RequestTypeForm from "../../components/request-types/RequestTypeForm";
import RequestTypesTable from "../../components/request-types/RequestTypesTable";
import WorkflowBuilder from "../../components/request-types/WorkflowBuilder";
import WorkflowPreview from "../../components/request-types/WorkflowPreview";

const tabs = ["البيانات الأساسية", "الحقول", "مسار الموافقات", "معاينة الموافقات"];

export default function RequestTypesPage() {
  const [items, setItems] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [sections, setSections] = useState([]);
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(false);
  const [activeTab, setActiveTab] = useState(tabs[0]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [dialog, setDialog] = useState({ type: "success", message: "" });
  const [workflowPreview, setWorkflowPreview] = useState([]);

  function notify(message, type = "success") {
    setDialog({ type, message });
  }

  async function load() {
    try {
      const { data } = await api.get("/request-types/bootstrap", { params: { search: search || undefined, status: status || undefined } });
      setItems(data.request_types || []);
      setDepartments(data.departments || []);
      setSections((data.specialized_sections || []).map((section) => [section.code, section.name_ar]));
      setSelected((current) => current || data.request_types?.[0] || null);
    } catch (error) {
      setDialog({ type: "error", message: getErrorMessage(error) });
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveType(payload) {
    try {
      const isEditing = Boolean(selected?.id) && modal !== "create";
      const { data } = isEditing
        ? await api.put(`/request-types/${selected.id}`, payload)
        : await api.post("/request-types", payload);
      notify("تم حفظ نوع الطلب");
      setModal(false);
      setActiveTab("البيانات الأساسية");
      setSelected(data);
      await load();
    } catch (error) {
      setDialog({ type: "error", message: getErrorMessage(error) });
    }
  }

  async function toggle(item) {
    try {
      const { data } = await api.patch(`/request-types/${item.id}/status`, { is_active: !item.is_active });
      notify(data.is_active ? "تم تفعيل نوع الطلب" : "تم تعطيل نوع الطلب");
      await load();
    } catch (error) {
      setDialog({ type: "error", message: getErrorMessage(error) });
    }
  }

  async function remove(item) {
    if (!confirm("هل تريد حذف نوع الطلب؟ إذا كانت هناك طلبات مرتبطة به سيتم رفض الحذف.")) return;
    try {
      await api.delete(`/request-types/${item.id}`);
      notify("تم حذف نوع الطلب");
      setSelected(null);
      await load();
    } catch (error) {
      setDialog({ type: "error", message: getErrorMessage(error) });
    }
  }

  async function previewWorkflow(showNotice = true) {
    if (!selected) return;
    try {
      setWorkflowPreview((await api.get(`/request-types/${selected.id}/workflow/preview`)).data.steps);
      if (showNotice) notify("تم تحديث معاينة المسار");
    } catch (error) {
      setDialog({ type: "error", message: getErrorMessage(error) });
    }
  }

  useEffect(() => {
    if (!selected?.id || activeTab !== "معاينة الموافقات") {
      setWorkflowPreview([]);
      return;
    }
    previewWorkflow(false);
  }, [selected?.id, activeTab]);

  return (
    <section className="space-y-6" dir="rtl">
      <FeedbackDialog open={Boolean(dialog.message)} type={dialog.type} message={dialog.message} onClose={() => setDialog({ ...dialog, message: "" })} />
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-bank-700">إدارة النظام</p>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="mt-2 text-2xl font-bold text-slate-950">إدارة أنواع الطلبات</h2>
            <p className="mt-2 text-sm text-slate-500">
              إضافة وتعديل وتعطيل وحذف أنواع الطلبات، مع إدارة الحقول ومراحل الموافقات لكل نوع.
            </p>
          </div>
          <Button onClick={() => { setSelected(null); setModal("create"); }} className="gap-2">
            <Plus className="h-4 w-4" />
            إضافة نوع طلب
          </Button>
        </div>
      </div>

      <Card className="p-5">
        <div className="mb-4 grid gap-3 md:grid-cols-[1fr_180px_auto]">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث بالاسم أو الرمز" className="pr-10" />
          </div>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-md border border-slate-300 px-3 text-sm">
            <option value="">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="inactive">متوقف</option>
          </select>
          <Button onClick={load}>بحث</Button>
        </div>
        <RequestTypesTable items={items} departments={departments} onView={(item) => setSelected(item)} onEdit={(item) => { setSelected(item); setModal("edit"); }} onToggle={toggle} onDelete={remove} />
      </Card>

      {selected && (
        <Card className="p-5">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-xl font-bold text-slate-950">{selected.name_ar}</h3>
              <p className="mt-1 text-sm text-slate-500">{selected.name_en} - {selected.code}</p>
            </div>
            <Button onClick={previewWorkflow}>معاينة المسار</Button>
          </div>
          <div className="mb-5 flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button key={tab} onClick={() => setActiveTab(tab)} className={`rounded-md px-3 py-2 text-sm font-semibold ${activeTab === tab ? "bg-bank-50 text-bank-700" : "bg-slate-100 text-slate-600"}`}>
                {tab}
              </button>
            ))}
          </div>
          {activeTab === "البيانات الأساسية" && <RequestTypeForm value={selected} onSubmit={saveType} onCancel={() => undefined} sectionsOptions={sections} />}
          {activeTab === "الحقول" && <DynamicFieldsBuilder requestTypeId={selected.id} notify={notify} />}
          {activeTab === "مسار الموافقات" && <WorkflowBuilder requestTypeId={selected.id} notify={notify} onWorkflowChange={() => previewWorkflow(false)} />}
          {activeTab === "معاينة الموافقات" && <WorkflowPreview steps={workflowPreview} />}
        </Card>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold">{modal === "edit" ? "تعديل نوع الطلب" : "إضافة نوع طلب"}</h3>
              <button onClick={() => setModal(false)} className="rounded-md px-3 py-1 text-sm hover:bg-slate-100">إغلاق</button>
            </div>
            <RequestTypeForm value={modal === "edit" ? selected : null} onSubmit={saveType} onCancel={() => setModal(false)} sectionsOptions={sections} />
          </div>
        </div>
      )}
    </section>
  );
}
