import { CheckCircle2, Eye, FileText, ImagePlus, PenLine, RefreshCw, Save, ShieldCheck, Stamp, Upload } from "lucide-react";
import type { ReactNode } from "react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Card } from "../../components/ui/card";
import { apiFetch, API_BASE } from "../../lib/api";

type TabKey = "letterheads" | "stamps" | "signatures" | "my-signature" | "settings";

type Letterhead = {
  id: number;
  name_ar: string;
  name_en?: string | null;
  code: string;
  logo_path?: string | null;
  template_pdf_path?: string | null;
  header_html?: string | null;
  footer_html?: string | null;
  primary_color: string;
  secondary_color: string;
  show_page_number: boolean;
  show_confidentiality_label: boolean;
  is_default: boolean;
  is_active: boolean;
};

type OfficialStamp = {
  id: number;
  name_ar: string;
  code: string;
  allowed_roles_json?: string[];
  is_active: boolean;
};

type UserSignature = {
  id: number;
  user_id: number;
  signature_label?: string | null;
  is_verified: boolean;
  is_active: boolean;
  uploaded_at: string;
};

type OfficialSettings = {
  default_letterhead_template_id?: number | null;
  enable_official_letterhead: boolean;
  official_message_requires_approval: boolean;
  allow_unverified_signature: boolean;
  allow_signature_upload_by_user: boolean;
  include_official_messages_in_request_pdf: boolean;
};

const tabs: Array<[TabKey, string]> = [
  ["letterheads", "قوالب الترويسة"],
  ["stamps", "الأختام الرسمية"],
  ["signatures", "إدارة التواقيع"],
  ["my-signature", "توقيعي"],
  ["settings", "الإعدادات"]
];

const emptyLetterhead = {
  name_ar: "",
  name_en: "",
  code: "",
  header_html: "{{bank_name_ar}} - {{bank_name_en}}",
  footer_html: "QIB Service Portal",
  primary_color: "#0f5132",
  secondary_color: "#9bd84e",
  show_page_number: true,
  show_confidentiality_label: true,
  is_default: false,
  is_active: true
};

const defaultSettings: OfficialSettings = {
  default_letterhead_template_id: null,
  enable_official_letterhead: true,
  official_message_requires_approval: false,
  allow_unverified_signature: false,
  allow_signature_upload_by_user: true,
  include_official_messages_in_request_pdf: true
};

export default function OfficialCorrespondenceSettingsPage({ initialTab = "letterheads" }: { initialTab?: TabKey }) {
  const [active, setActive] = useState<TabKey>(initialTab);
  const [letterheads, setLetterheads] = useState<Letterhead[]>([]);
  const [stamps, setStamps] = useState<OfficialStamp[]>([]);
  const [signatures, setSignatures] = useState<UserSignature[]>([]);
  const [mySignatures, setMySignatures] = useState<UserSignature[]>([]);
  const [settings, setSettings] = useState<OfficialSettings>(defaultSettings);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string }>({ type: "success", message: "" });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    const [letterheadResult, stampResult, signatureResult, mySignatureResult, settingsResult] = await Promise.allSettled([
      apiFetch<Letterhead[]>("/settings/official-letterheads"),
      apiFetch<OfficialStamp[]>("/settings/official-stamps"),
      apiFetch<UserSignature[]>("/settings/signatures"),
      apiFetch<UserSignature[]>("/signatures/me"),
      apiFetch<OfficialSettings>("/settings/official-messages")
    ]);
    if (letterheadResult.status === "fulfilled") setLetterheads(letterheadResult.value);
    if (stampResult.status === "fulfilled") setStamps(stampResult.value);
    if (signatureResult.status === "fulfilled") setSignatures(signatureResult.value);
    if (mySignatureResult.status === "fulfilled") setMySignatures(mySignatureResult.value);
    if (settingsResult.status === "fulfilled") setSettings({ ...defaultSettings, ...settingsResult.value });
    if (letterheadResult.status === "rejected") setNotice({ type: "error", message: "تعذر تحميل إعدادات المراسلات الرسمية." });
    setLoading(false);
  }

  function notify(type: "success" | "error", message: string) {
    setNotice({ type, message });
  }

  return (
    <section className="space-y-6" dir="rtl">
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-black text-bank-700">المراسلات الرسمية بترويسة البنك</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">قوالب الترويسة الرسمية</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">إدارة قوالب الخطابات الرسمية، التواقيع، الأختام، وخيارات تضمينها في مراسلات البنك.</p>
          </div>
          <button onClick={loadAll} className="inline-flex h-11 items-center gap-2 rounded-md border border-slate-200 px-4 text-sm font-black text-slate-700 hover:bg-slate-50">
            <RefreshCw className="h-4 w-4" /> تحديث
          </button>
        </div>
      </div>

      {notice.message && <div className={`rounded-lg border p-4 text-sm font-bold ${notice.type === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{notice.message}</div>}

      <Card className="p-3">
        <div className="flex gap-2 overflow-x-auto">
          {tabs.map(([key, label]) => (
            <button key={key} onClick={() => setActive(key)} className={`shrink-0 rounded-md px-4 py-2 text-sm font-black ${active === key ? "bg-bank-50 text-bank-800" : "text-slate-600 hover:bg-slate-50"}`}>
              {label}
            </button>
          ))}
        </div>
      </Card>

      {loading && <Card className="p-5 text-sm font-bold text-slate-500">جاري تحميل الإعدادات...</Card>}
      {!loading && active === "letterheads" && <LetterheadsPanel letterheads={letterheads} settings={settings} onSaved={loadAll} notify={notify} />}
      {!loading && active === "stamps" && <StampsPanel stamps={stamps} onSaved={loadAll} notify={notify} />}
      {!loading && active === "signatures" && <SignaturesPanel signatures={signatures} onSaved={loadAll} notify={notify} />}
      {!loading && active === "my-signature" && <MySignaturePanel signatures={mySignatures} onSaved={loadAll} notify={notify} />}
      {!loading && active === "settings" && <SettingsPanel settings={settings} letterheads={letterheads} onSaved={loadAll} notify={notify} />}
    </section>
  );
}

function LetterheadsPanel({ letterheads, settings, onSaved, notify }: { letterheads: Letterhead[]; settings: OfficialSettings; onSaved: () => void; notify: (type: "success" | "error", message: string) => void }) {
  const [form, setForm] = useState(emptyLetterhead);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [templatePdfFile, setTemplatePdfFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  function edit(item: Letterhead) {
    setEditingId(item.id);
    setForm({
      name_ar: item.name_ar || "",
      name_en: item.name_en || "",
      code: item.code || "",
      header_html: item.header_html || "",
      footer_html: item.footer_html || "",
      primary_color: item.primary_color || "#0f5132",
      secondary_color: item.secondary_color || "#9bd84e",
      show_page_number: Boolean(item.show_page_number),
      show_confidentiality_label: Boolean(item.show_confidentiality_label),
      is_default: Boolean(item.is_default),
      is_active: Boolean(item.is_active)
    });
    setLogoFile(null);
    setTemplatePdfFile(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, code: normalizeAssetCode(form.code) || undefined };
      const saved = await apiFetch<Letterhead>(editingId ? `/settings/official-letterheads/${editingId}` : "/settings/official-letterheads", {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify(payload)
      });
      if (logoFile) {
        const data = new FormData();
        data.append("file", logoFile);
        await apiFetch(`/settings/official-letterheads/${saved.id}/logo`, { method: "POST", body: data });
      }
      if (templatePdfFile) {
        const data = new FormData();
        data.append("file", templatePdfFile);
        await apiFetch(`/settings/official-letterheads/${saved.id}/pdf-template`, { method: "POST", body: data });
      }
      notify("success", "تم حفظ قالب الترويسة.");
      setEditingId(null);
      setLogoFile(null);
      setTemplatePdfFile(null);
      setForm(emptyLetterhead);
      onSaved();
    } catch (error) {
      notify("error", readableError(error) || "تعذر حفظ قالب الترويسة.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(item: Letterhead) {
    try {
      await apiFetch(`/settings/official-letterheads/${item.id}/status`, { method: "PATCH", body: JSON.stringify({ is_active: !item.is_active }) });
      notify("success", item.is_active ? "تم تعطيل القالب." : "تم تفعيل القالب.");
      onSaved();
    } catch {
      notify("error", "تعذر تغيير حالة القالب.");
    }
  }

  async function setDefault(item: Letterhead) {
    try {
      await apiFetch(`/settings/official-letterheads/${item.id}/set-default`, { method: "POST" });
      notify("success", "تم تعيين القالب الافتراضي.");
      onSaved();
    } catch {
      notify("error", "تعذر تعيين القالب الافتراضي.");
    }
  }

  async function preview(item: Letterhead) {
    try {
      const token = localStorage.getItem("qib_token");
      const response = await fetch(`${API_BASE}/settings/official-letterheads/${item.id}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ subject: "معاينة الترويسة الرسمية", body: "هذا نص تجريبي لمعاينة شكل الخطاب الرسمي." })
      });
      if (!response.ok) throw new Error(await response.text());
      openBlob(await response.blob(), `letterhead-${item.id}.pdf`);
    } catch {
      notify("error", "تعذر إنشاء معاينة الترويسة.");
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 p-5">
          <h2 className="text-xl font-black text-slate-950">القوالب المتاحة</h2>
          <p className="mt-1 text-sm text-slate-500">القالب الافتراضي يستخدم تلقائياً عند إنشاء مراسلة رسمية.</p>
        </div>
        <div className="divide-y divide-slate-100">
          {letterheads.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-black text-slate-950">{item.name_ar}</p>
                  {item.is_default && <Badge tone="green">افتراضي</Badge>}
                  {item.template_pdf_path && <Badge tone="green">PDF</Badge>}
                  <Badge tone={item.is_active ? "green" : "gray"}>{item.is_active ? "مفعل" : "معطل"}</Badge>
                </div>
                <p className="mt-1 text-xs font-semibold text-slate-500">{item.code}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => preview(item)} className="btn-secondary"><Eye className="h-4 w-4" /> معاينة</button>
                <button onClick={() => edit(item)} className="btn-secondary">تعديل</button>
                {!item.is_default && <button onClick={() => setDefault(item)} className="btn-secondary"><CheckCircle2 className="h-4 w-4" /> افتراضي</button>}
                <button onClick={() => toggleStatus(item)} className="btn-secondary">{item.is_active ? "تعطيل" : "تفعيل"}</button>
              </div>
            </div>
          ))}
          {!letterheads.length && <EmptyState text="لا توجد قوالب ترويسة حتى الآن." />}
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-lg font-black text-slate-950">{editingId ? "تعديل قالب" : "إضافة قالب"}</h3>
        <form onSubmit={save} className="mt-4 space-y-3">
          <Field label="الاسم بالعربي"><input required className="input" value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} /></Field>
          <Field label="الاسم بالإنجليزي"><input className="input" value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} /></Field>
          <Field label="الرمز"><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="اختياري، مثال: default_bank_letterhead" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="اللون الأساسي"><input type="color" className="input h-11" value={form.primary_color} onChange={(e) => setForm({ ...form, primary_color: e.target.value })} /></Field>
            <Field label="اللون الثانوي"><input type="color" className="input h-11" value={form.secondary_color} onChange={(e) => setForm({ ...form, secondary_color: e.target.value })} /></Field>
          </div>
          <Field label="رأس الصفحة"><textarea rows={3} className="input" value={form.header_html} onChange={(e) => setForm({ ...form, header_html: e.target.value })} /></Field>
          <Field label="تذييل الصفحة"><textarea rows={3} className="input" value={form.footer_html} onChange={(e) => setForm({ ...form, footer_html: e.target.value })} /></Field>
          <Field label="شعار القالب"><input type="file" accept="image/png,image/jpeg" className="input py-2" onChange={(e) => setLogoFile(e.target.files?.[0] || null)} /></Field>
          <Field label="قالب PDF للترويسة"><input type="file" accept="application/pdf,.pdf" className="input py-2" onChange={(e) => setTemplatePdfFile(e.target.files?.[0] || null)} /></Field>
          <p className="text-xs font-semibold text-slate-500">عند رفع قالب PDF سيتم وضع نص الخطاب فوقه تلقائياً. اتركه فارغاً لاستخدام الترويسة النصية.</p>
          <CheckBox label="إظهار رقم الصفحة" checked={form.show_page_number} onChange={(value) => setForm({ ...form, show_page_number: value })} />
          <CheckBox label="إظهار درجة السرية" checked={form.show_confidentiality_label} onChange={(value) => setForm({ ...form, show_confidentiality_label: value })} />
          <CheckBox label="قالب افتراضي" checked={form.is_default} onChange={(value) => setForm({ ...form, is_default: value })} />
          <CheckBox label="مفعل" checked={form.is_active} onChange={(value) => setForm({ ...form, is_active: value })} />
          <div className="flex gap-2">
            <button disabled={saving} className="btn-primary"><Save className="h-4 w-4" /> حفظ</button>
            {editingId && <button type="button" onClick={() => { setEditingId(null); setForm(emptyLetterhead); setLogoFile(null); setTemplatePdfFile(null); }} className="btn-secondary">إلغاء</button>}
          </div>
          {settings.default_letterhead_template_id && <p className="text-xs font-semibold text-slate-500">القالب الافتراضي الحالي: #{settings.default_letterhead_template_id}</p>}
        </form>
      </Card>
    </div>
  );
}

function StampsPanel({ stamps, onSaved, notify }: { stamps: OfficialStamp[]; onSaved: () => void; notify: (type: "success" | "error", message: string) => void }) {
  const [form, setForm] = useState({ name_ar: "", code: "", allowed_roles_json: "" });
  const [editing, setEditing] = useState<OfficialStamp | null>(null);
  const [file, setFile] = useState<File | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      if (editing) {
        await apiFetch(`/settings/official-stamps/${editing.id}`, {
          method: "PUT",
          body: JSON.stringify({ ...form, allowed_roles_json: parseRoles(form.allowed_roles_json), is_active: editing.is_active })
        });
      } else {
        if (!file) {
          notify("error", "يرجى اختيار صورة الختم.");
          return;
        }
        const data = new FormData();
        data.append("name_ar", form.name_ar);
        data.append("code", form.code);
        data.append("allowed_roles_json", form.allowed_roles_json);
        data.append("file", file);
        await apiFetch("/settings/official-stamps", { method: "POST", body: data });
      }
      notify("success", "تم حفظ الختم الرسمي.");
      setEditing(null);
      setFile(null);
      setForm({ name_ar: "", code: "", allowed_roles_json: "" });
      onSaved();
    } catch (error) {
      notify("error", readableError(error) || "تعذر حفظ الختم الرسمي.");
    }
  }

  async function toggle(item: OfficialStamp) {
    try {
      await apiFetch(`/settings/official-stamps/${item.id}/status`, { method: "PATCH", body: JSON.stringify({ is_active: !item.is_active }) });
      notify("success", item.is_active ? "تم تعطيل الختم." : "تم تفعيل الختم.");
      onSaved();
    } catch {
      notify("error", "تعذر تغيير حالة الختم.");
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 p-5"><h2 className="text-xl font-black text-slate-950">الأختام الرسمية</h2></div>
        <div className="divide-y divide-slate-100">
          {stamps.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-black text-slate-950">{item.name_ar}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">{item.code} · {(item.allowed_roles_json || []).join(", ") || "كل الأدوار المصرح لها"}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setEditing(item); setForm({ name_ar: item.name_ar, code: item.code, allowed_roles_json: (item.allowed_roles_json || []).join(",") }); }} className="btn-secondary">تعديل</button>
                <button onClick={() => toggle(item)} className="btn-secondary">{item.is_active ? "تعطيل" : "تفعيل"}</button>
              </div>
            </div>
          ))}
          {!stamps.length && <EmptyState text="لا توجد أختام رسمية بعد." />}
        </div>
      </Card>
      <Card className="p-5">
        <h3 className="flex items-center gap-2 text-lg font-black text-slate-950"><Stamp className="h-5 w-5" /> {editing ? "تعديل ختم" : "إضافة ختم"}</h3>
        <form onSubmit={save} className="mt-4 space-y-3">
          <Field label="اسم الختم"><input required className="input" value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} /></Field>
          <Field label="الرمز"><input required className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="bank_stamp" /></Field>
          <Field label="الأدوار المسموحة"><input className="input" value={form.allowed_roles_json} onChange={(e) => setForm({ ...form, allowed_roles_json: e.target.value })} placeholder="super_admin,administration_manager" /></Field>
          {!editing && <Field label="صورة الختم"><input required type="file" accept="image/png,image/jpeg" className="input py-2" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>}
          <div className="flex gap-2">
            <button className="btn-primary"><Save className="h-4 w-4" /> حفظ</button>
            {editing && <button type="button" onClick={() => { setEditing(null); setForm({ name_ar: "", code: "", allowed_roles_json: "" }); }} className="btn-secondary">إلغاء</button>}
          </div>
        </form>
      </Card>
    </div>
  );
}

function SignaturesPanel({ signatures, onSaved, notify }: { signatures: UserSignature[]; onSaved: () => void; notify: (type: "success" | "error", message: string) => void }) {
  async function verify(item: UserSignature) {
    try {
      await apiFetch(`/settings/signatures/${item.id}/verify`, { method: "POST" });
      notify("success", "تم توثيق التوقيع.");
      onSaved();
    } catch {
      notify("error", "تعذر توثيق التوقيع.");
    }
  }

  async function toggle(item: UserSignature) {
    try {
      await apiFetch(`/settings/signatures/${item.id}/status`, { method: "PATCH", body: JSON.stringify({ is_active: !item.is_active }) });
      notify("success", item.is_active ? "تم تعطيل التوقيع." : "تم تفعيل التوقيع.");
      onSaved();
    } catch {
      notify("error", "تعذر تغيير حالة التوقيع.");
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 p-5">
        <h2 className="text-xl font-black text-slate-950">إدارة التواقيع</h2>
        <p className="mt-1 text-sm text-slate-500">توثيق أو تعطيل تواقيع المستخدمين قبل استخدامها في الخطابات الرسمية.</p>
      </div>
      <div className="divide-y divide-slate-100">
        {signatures.map((item) => (
          <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-black text-slate-950">{item.signature_label || "توقيع مستخدم"} <span className="text-sm text-slate-500">#{item.user_id}</span></p>
              <div className="mt-2 flex gap-2"><Badge tone={item.is_verified ? "green" : "amber"}>{item.is_verified ? "موثق" : "غير موثق"}</Badge><Badge tone={item.is_active ? "green" : "gray"}>{item.is_active ? "مفعل" : "معطل"}</Badge></div>
            </div>
            <div className="flex gap-2">
              {!item.is_verified && <button onClick={() => verify(item)} className="btn-secondary"><ShieldCheck className="h-4 w-4" /> توثيق</button>}
              <button onClick={() => toggle(item)} className="btn-secondary">{item.is_active ? "تعطيل" : "تفعيل"}</button>
            </div>
          </div>
        ))}
        {!signatures.length && <EmptyState text="لا توجد تواقيع مرفوعة." />}
      </div>
    </Card>
  );
}

function MySignaturePanel({ signatures, onSaved, notify }: { signatures: UserSignature[]; onSaved: () => void; notify: (type: "success" | "error", message: string) => void }) {
  const [label, setLabel] = useState("توقيعي الرسمي");
  const [file, setFile] = useState<File | null>(null);

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      notify("error", "اختر صورة التوقيع أولاً.");
      return;
    }
    try {
      const data = new FormData();
      data.append("signature_label", label);
      data.append("file", file);
      await apiFetch("/signatures/me", { method: "POST", body: data });
      notify("success", "تم رفع التوقيع. يحتاج إلى توثيق قبل الاستخدام إذا كانت السياسة تمنع التواقيع غير الموثقة.");
      setFile(null);
      onSaved();
    } catch {
      notify("error", "تعذر رفع التوقيع. استخدم صورة PNG أو JPG بحجم مناسب.");
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-xl font-black text-slate-950"><PenLine className="h-5 w-5" /> توقيعي</h2>
        <form onSubmit={upload} className="mt-4 space-y-3">
          <Field label="اسم التوقيع"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
          <Field label="صورة التوقيع"><input required type="file" accept="image/png,image/jpeg" className="input py-2" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
          <button className="btn-primary"><Upload className="h-4 w-4" /> رفع التوقيع</button>
        </form>
      </Card>
      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 p-5"><h3 className="text-lg font-black text-slate-950">التواقيع الخاصة بي</h3></div>
        <div className="divide-y divide-slate-100">
          {signatures.map((item) => (
            <div key={item.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-black text-slate-950">{item.signature_label || "توقيع"}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">{formatDate(item.uploaded_at)}</p>
              </div>
              <div className="flex gap-2"><Badge tone={item.is_verified ? "green" : "amber"}>{item.is_verified ? "موثق" : "بانتظار التوثيق"}</Badge><Badge tone={item.is_active ? "green" : "gray"}>{item.is_active ? "مفعل" : "معطل"}</Badge></div>
            </div>
          ))}
          {!signatures.length && <EmptyState text="لم تقم برفع توقيع بعد." />}
        </div>
      </Card>
    </div>
  );
}

function SettingsPanel({ settings, letterheads, onSaved, notify }: { settings: OfficialSettings; letterheads: Letterhead[]; onSaved: () => void; notify: (type: "success" | "error", message: string) => void }) {
  const [form, setForm] = useState<OfficialSettings>(settings);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      await apiFetch("/settings/official-messages", { method: "PUT", body: JSON.stringify(form) });
      notify("success", "تم حفظ إعدادات المراسلات الرسمية.");
      onSaved();
    } catch {
      notify("error", "تعذر حفظ إعدادات المراسلات الرسمية.");
    }
  }

  return (
    <Card className="p-5">
      <form onSubmit={save} className="grid gap-4 lg:grid-cols-2">
        <Field label="الترويسة الافتراضية">
          <select className="input" value={form.default_letterhead_template_id || ""} onChange={(e) => setForm({ ...form, default_letterhead_template_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">اختر قالباً</option>
            {letterheads.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.name_ar}</option>)}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2 lg:col-span-2">
          <CheckBox label="تفعيل الترويسة الرسمية في المراسلات" checked={form.enable_official_letterhead} onChange={(value) => setForm({ ...form, enable_official_letterhead: value })} />
          <CheckBox label="تتطلب المراسلة الرسمية اعتماداً قبل الإرسال" checked={form.official_message_requires_approval} onChange={(value) => setForm({ ...form, official_message_requires_approval: value })} />
          <CheckBox label="السماح باستخدام توقيع غير موثق" checked={form.allow_unverified_signature} onChange={(value) => setForm({ ...form, allow_unverified_signature: value })} />
          <CheckBox label="السماح للمستخدم برفع توقيعه" checked={form.allow_signature_upload_by_user} onChange={(value) => setForm({ ...form, allow_signature_upload_by_user: value })} />
          <CheckBox label="تضمين المراسلات الرسمية في PDF الطلب" checked={form.include_official_messages_in_request_pdf} onChange={(value) => setForm({ ...form, include_official_messages_in_request_pdf: value })} />
        </div>
        <div className="lg:col-span-2">
          <button className="btn-primary"><Save className="h-4 w-4" /> حفظ الإعدادات</button>
        </div>
      </form>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-black text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function CheckBox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex min-h-12 items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 text-sm font-black text-slate-800">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Badge({ tone, children }: { tone: "green" | "amber" | "gray"; children: ReactNode }) {
  const classes = tone === "green" ? "bg-emerald-50 text-emerald-800" : tone === "amber" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${classes}`}>{children}</span>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="p-6 text-center text-sm font-bold text-slate-500">{text}</div>;
}

function parseRoles(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizeAssetCode(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function readableError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "");
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.detail === "string") return parsed.detail;
    if (Array.isArray(parsed?.detail)) {
      const first = parsed.detail[0];
      const field = Array.isArray(first?.loc) ? first.loc[first.loc.length - 1] : "";
      if (field === "code") return "الرمز اختياري، وإذا كتبته يجب أن يكون حروفاً إنجليزية وأرقاماً وشرطة سفلية فقط.";
      if (field === "name_ar") return "اسم قالب الترويسة بالعربي مطلوب ويجب أن يكون حرفين على الأقل.";
      return first?.msg || "بيانات غير مكتملة.";
    }
  } catch {
    undefined;
  }
  if (raw.includes("403")) return "لا تملك صلاحية إدارة قوالب الترويسة الرسمية.";
  if (raw.includes("code")) return "الرمز اختياري، وإذا كتبته يجب أن يكون حروفاً إنجليزية وأرقاماً وشرطة سفلية فقط.";
  return raw.replace(/^Error:\s*/, "");
}

function openBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}
