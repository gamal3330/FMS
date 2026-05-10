import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileText, History, Info, LockKeyhole, Mail, PackageCheck, RefreshCw, Settings2, Sparkles, Upload } from "lucide-react";
import { api, getErrorMessage } from "../lib/axios";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import FeedbackDialog from "../components/ui/FeedbackDialog";
import { Input } from "../components/ui/input";
import GeneralSettings from "../components/settings/GeneralSettings";
import { formatSystemDateTime } from "../lib/datetime";

const tabs = [
  ["general", "الإعدادات العامة", Settings2],
  ["email", "البريد SMTP", Mail],
  ["security", "إعدادات الأمان", LockKeyhole],
  ["about", "حول", Info]
];

export default function SettingsPage({ initialTab = "general" }) {
  const [active, setActive] = useState(isVisibleSettingsTab(initialTab) ? initialTab : "general");
  const [dialog, setDialog] = useState({ type: "success", message: "" });

  useEffect(() => {
    setActive(isVisibleSettingsTab(initialTab) ? initialTab : "general");
  }, [initialTab]);

  function notify(message, type = "success") {
    setDialog({ type, message });
  }

  return (
    <section className="min-w-0 max-w-full space-y-6" dir="rtl">
      <FeedbackDialog open={Boolean(dialog.message)} type={dialog.type} message={dialog.message} onClose={() => setDialog({ ...dialog, message: "" })} />
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-bank-700">لوحة الإدارة</p>
        <h2 className="mt-2 text-2xl font-bold text-slate-950">إعدادات النظام</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">إدارة إعدادات النظام والصلاحيات وسير العمل</p>
      </div>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="min-w-0 p-3">
          <nav className="space-y-1">
            {tabs.map(([key, label, Icon]) => (
              <button key={key} onClick={() => setActive(key)} className={`flex h-11 w-full items-center gap-3 rounded-md px-3 text-right text-sm font-semibold ${active === key ? "bg-bank-50 text-bank-700" : "text-slate-600 hover:bg-slate-50"}`}>
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>
        </Card>
        <Card className="min-w-0 overflow-hidden p-5">
          {active === "general" && <Panel title="الإعدادات العامة"><GeneralSettings notify={notify} /></Panel>}
          {active === "email" && <Panel title="إعدادات البريد SMTP"><EmailSettings notify={notify} /></Panel>}
          {active === "requestTypes" && <Panel title="أنواع الطلبات"><RequestTypesSettings notify={notify} /></Panel>}
          {active === "security" && <Panel title="إعدادات الأمان"><SecuritySettings notify={notify} /></Panel>}
          {active === "about" && <Panel title="حول النظام"><AboutSystemPanel /></Panel>}
        </Card>
      </div>
    </section>
  );
}

function isVisibleSettingsTab(tab) {
  return tabs.some(([key]) => key === tab);
}

function Panel({ title, children }) {
  return <div className="min-w-0"><h3 className="mb-5 text-xl font-bold text-slate-950">{title}</h3>{children}</div>;
}

function AboutSystemPanel() {
  const systemYear = new Intl.NumberFormat("ar", { useGrouping: false }).format(new Date().getFullYear());

  return (
    <div className="space-y-5 text-right" dir="rtl">
      <div className="rounded-lg border border-bank-100 bg-bank-50/70 p-5">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-white text-bank-700">
            <Info className="h-6 w-6" />
          </span>
          <div>
            <p className="text-lg font-black text-slate-950">بوابة خدمات بنك القطيبي الإسلامي</p>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
              منصة داخلية موحدة لاستقبال الطلبات، تتبع مراحل الاعتماد، إدارة المراسلات والوثائق، مراقبة مؤشرات الخدمة، وتوثيق الأثر التشغيلي داخل بيئة عمل مصرفية منظمة وآمنة.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <AboutItem title="إدارة الطلبات والموافقات" text="إنشاء الطلبات، بناء مسارات الموافقة، متابعة حالة التنفيذ، وتوثيق سجل الحالة لكل طلب." />
        <AboutItem title="المراسلات والوثائق" text="مراسلات داخلية مرتبطة بالطلبات، ومكتبة وثائق PDF للسياسات والتعاميم والنماذج مع صلاحيات وإقرارات اطلاع." />
        <AboutItem title="الحوكمة والصلاحيات" text="إدارة المستخدمين، الأدوار، صلاحيات الشاشات، التفويضات، وسجلات التدقيق الحساسة." />
        <AboutItem title="التشغيل والمراقبة" text="تقارير، نسخ احتياطي، مراقبة صحة النظام، وإعدادات تشغيل تساعد فرق الإدارة والدعم على المتابعة." />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <p className="text-sm font-bold text-slate-500">الإصدار المؤسسي الداخلي</p>
        <p className="mt-2 text-2xl font-black text-slate-950">بنك القطيبي الإسلامي {systemYear}</p>
      </div>
    </div>
  );
}

function AboutItem({ title, text }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="font-black text-slate-950">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
    </div>
  );
}

function RequestTypesSettings({ notify }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ request_type: "email", label_ar: "طلب بريد إلكتروني", is_enabled: true, require_attachment: false });
  const [error, setError] = useState("");

  async function load() {
    try { setItems((await api.get("/request-types")).data); } catch (error) { notify(getErrorMessage(error), "error"); }
  }
  useEffect(() => { load(); }, []);
  async function save(event) {
    event.preventDefault();
    try { await api.post("/request-types", form); notify("تم حفظ نوع الطلب"); await load(); } catch (error) { notify(getErrorMessage(error), "error"); }
  }
  return <div className="space-y-4"><form onSubmit={save} className="grid gap-3 md:grid-cols-4"><Input value={form.request_type} onChange={(e) => setForm({ ...form, request_type: e.target.value })} required /><Input value={form.label_ar} onChange={(e) => setForm({ ...form, label_ar: e.target.value })} required /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_enabled} onChange={(e) => setForm({ ...form, is_enabled: e.target.checked })} /> Enabled</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.require_attachment} onChange={(e) => setForm({ ...form, require_attachment: e.target.checked })} /> Require Attachment</label><Button type="submit">حفظ</Button></form><SimpleError error={error} /><SimpleTable headers={["Type", "Arabic Label", "Enabled", "Attachment"]} rows={items.map((i) => [i.request_type, i.label_ar, i.is_enabled ? "Yes" : "No", i.require_attachment ? "Yes" : "No"])} /></div>;
}

const defaultAISettings = {
  is_enabled: false,
  provider: "openai_compatible",
  api_base_url: "",
  api_key: "",
  api_key_configured: false,
  model_name: "gpt-4o-mini",
  max_input_chars: 6000,
  allow_message_drafting: true,
  allow_summarization: true,
  allow_reply_suggestion: true,
  mask_sensitive_data: true
};

const aiProviderHints = {
  openai_compatible: {
    apiPlaceholder: "https://provider.example/v1/chat/completions",
    modelPlaceholder: "gpt-4o-mini",
    apiKeyPlaceholder: "أدخل مفتاح الخدمة",
    note: "استخدم هذا الخيار لأي مزود يدعم Chat Completions المتوافق مع OpenAI."
  },
  ollama: {
    apiPlaceholder: "http://localhost:11434",
    modelPlaceholder: "llama3.1:8b أو qwen2.5:7b",
    apiKeyPlaceholder: "Ollama لا يحتاج API Key عادةً",
    note: "إذا كان النظام يعمل داخل Docker على نفس الجهاز، استخدم غالباً http://host.docker.internal:11434 بدلاً من localhost."
  },
  generic_http: {
    apiPlaceholder: "https://provider.example/generate",
    modelPlaceholder: "اسم النموذج لدى المزود",
    apiKeyPlaceholder: "أدخل مفتاح الخدمة إن وجد",
    note: "يرسل النظام model و prompt وينتظر text أو output في الاستجابة."
  },
  mock: {
    apiPlaceholder: "لا يحتاج رابط",
    modelPlaceholder: "mock",
    apiKeyPlaceholder: "لا يحتاج مفتاح",
    note: "مزود محلي للاختبار فقط ولا يتصل بأي خدمة خارجية."
  }
};

function AISettingsPanel({ notify }) {
  const [form, setForm] = useState(defaultAISettings);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [settingsResponse, logsResponse] = await Promise.all([
        api.get("/settings/ai"),
        api.get("/settings/ai/usage-logs")
      ]);
      setForm({ ...defaultAISettings, ...settingsResponse.data, api_key: "" });
      setLogs(logsResponse.data || []);
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateProvider(value) {
    setForm((current) => {
      const next = { ...current, provider: value };
      if (value === "ollama" && (!current.api_base_url || current.api_base_url.includes("/v1/chat/completions"))) {
        next.api_base_url = "http://localhost:11434";
      }
      if (value === "ollama" && (!current.model_name || current.model_name === "gpt-4o-mini" || current.model_name === "mock")) {
        next.model_name = "llama3.1:8b";
      }
      if (value === "mock") {
        next.api_base_url = "";
        next.model_name = "mock";
      }
      return next;
    });
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        is_enabled: Boolean(form.is_enabled),
        provider: form.provider || "openai_compatible",
        api_base_url: form.api_base_url || null,
        api_key: form.api_key || null,
        model_name: form.model_name || "gpt-4o-mini",
        max_input_chars: Number(form.max_input_chars || 6000),
        allow_message_drafting: Boolean(form.allow_message_drafting),
        allow_summarization: Boolean(form.allow_summarization),
        allow_reply_suggestion: Boolean(form.allow_reply_suggestion),
        mask_sensitive_data: Boolean(form.mask_sensitive_data)
      };
      const { data } = await api.put("/settings/ai", payload);
      setForm({ ...defaultAISettings, ...data, api_key: "" });
      notify("تم حفظ إعدادات المساعد الذكي");
      await load();
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    setError("");
    try {
      const { data } = await api.post("/settings/ai/test");
      setTestResult(data);
      notify(data.message, data.ok ? "success" : "error");
      await load();
    } catch (error) {
      const message = getErrorMessage(error);
      setTestResult({ ok: false, message });
      setError(message);
      notify(message, "error");
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">جاري تحميل إعدادات الذكاء الاصطناعي...</div>;
  }
  const providerHint = aiProviderHints[form.provider || "openai_compatible"] || aiProviderHints.openai_compatible;

  return (
    <form onSubmit={save} className="space-y-5 text-right" dir="rtl">
      <div className="rounded-lg border border-bank-100 bg-bank-50/70 p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white text-bank-700">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <p className="font-bold text-slate-950">المساعد الذكي للمراسلات</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              المساعد يولد مسودات واقتراحات فقط، ولا يستطيع إرسال أو اعتماد أو حذف أي رسالة.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Toggle label="تفعيل المساعد الذكي" checked={Boolean(form.is_enabled)} onChange={(value) => update("is_enabled", value)} />
        <Toggle label="إخفاء البيانات الحساسة" checked={Boolean(form.mask_sensitive_data)} onChange={(value) => update("mask_sensitive_data", value)} />
        <Toggle label="السماح بتوليد الرسائل" checked={Boolean(form.allow_message_drafting)} onChange={(value) => update("allow_message_drafting", value)} />
        <Toggle label="السماح بتلخيص المراسلات" checked={Boolean(form.allow_summarization)} onChange={(value) => update("allow_summarization", value)} />
        <Toggle label="السماح باقتراح الردود" checked={Boolean(form.allow_reply_suggestion)} onChange={(value) => update("allow_reply_suggestion", value)} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block space-y-2 text-sm font-medium text-slate-700">
          مزود الخدمة
          <select value={form.provider || "openai_compatible"} onChange={(event) => updateProvider(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100">
            <option value="openai_compatible">OpenAI-compatible Chat Completions</option>
            <option value="ollama">Ollama محلي</option>
            <option value="generic_http">Generic HTTP Text API</option>
            <option value="mock">Mock محلي للاختبار</option>
          </select>
        </label>
        <LabeledInput label="API Base URL" value={form.api_base_url || ""} onChange={(event) => update("api_base_url", event.target.value)} placeholder={providerHint.apiPlaceholder} />
        <LabeledInput label="Model Name" value={form.model_name || ""} onChange={(event) => update("model_name", event.target.value)} placeholder={providerHint.modelPlaceholder} />
        <LabeledInput label="الحد الأقصى لطول النص" type="number" min="100" max="50000" value={form.max_input_chars || 6000} onChange={(event) => update("max_input_chars", event.target.value)} />
        <label className="block space-y-2 text-sm font-medium text-slate-700 md:col-span-2">
          API Key
          <Input type="password" value={form.api_key || ""} onChange={(event) => update("api_key", event.target.value)} placeholder={form.api_key_configured ? "تم حفظ مفتاح سابق. اتركه فارغاً للإبقاء عليه." : providerHint.apiKeyPlaceholder} />
        </label>
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600 md:col-span-2">
          {providerHint.note}
        </p>
      </div>

      <SimpleError error={error} />
      {testResult && (
        <div className={`rounded-lg border p-4 ${testResult.ok ? "border-emerald-100 bg-emerald-50 text-emerald-800" : "border-red-100 bg-red-50 text-red-800"}`}>
          <div className="flex items-start gap-3">
            {testResult.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />}
            <div>
              <p className="text-sm font-black">{testResult.message}</p>
              {testResult.sample && <p className="mt-2 rounded-md bg-white/70 p-3 text-sm leading-7 text-slate-700">{testResult.sample}</p>}
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ إعدادات الذكاء الاصطناعي"}</Button>
        <button type="button" onClick={testConnection} disabled={testing || saving} className="inline-flex h-10 items-center gap-2 rounded-md border border-bank-200 bg-bank-50 px-4 text-sm font-bold text-bank-800 hover:bg-bank-100 disabled:cursor-not-allowed disabled:opacity-60">
          <RefreshCw className={`h-4 w-4 ${testing ? "animate-spin" : ""}`} />
          {testing ? "جاري اختبار الاتصال..." : "اختبار الاتصال"}
        </button>
        <button type="button" onClick={load} className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">تحديث السجل</button>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h4 className="font-bold text-slate-950">سجل استخدام المساعد الذكي</h4>
            <p className="mt-1 text-sm text-slate-500">لا يتم تخزين نصوص المطالبات الكاملة، فقط أطوال الإدخال والإخراج والحالة.</p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{logs.length}</span>
        </div>
        <SimpleTable
          headers={["المستخدم", "الخاصية", "التاريخ", "الحالة"]}
          rows={logs.map((log) => [
            log.user_name || log.user_id || "-",
            aiFeatureLabel(log.feature),
            formatSystemDateTime(log.created_at),
            log.status === "success" ? "ناجح" : `فشل${log.error_message ? ` - ${log.error_message}` : ""}`
          ])}
        />
      </div>
    </form>
  );
}

function aiFeatureLabel(value) {
  const labels = {
    draft: "توليد مسودة",
    improve: "تحسين الصياغة",
    formalize: "جعلها رسمية",
    shorten: "اختصار النص",
    suggest_reply: "اقتراح رد",
    summarize: "تلخيص",
    missing_info: "فحص المعلومات الناقصة"
  };
  return labels[value] || value;
}

const defaultMessageTypes = [
  { value: "internal_correspondence", label: "مراسلة داخلية", is_system: true },
  { value: "official_correspondence", label: "مراسلة رسمية", is_system: true },
  { value: "clarification_request", label: "طلب استيضاح", is_system: true },
  { value: "reply_to_clarification", label: "رد على استيضاح", is_system: true },
  { value: "approval_note", label: "ملاحظة موافقة", is_system: true },
  { value: "rejection_reason", label: "سبب رفض", is_system: true },
  { value: "implementation_note", label: "ملاحظة تنفيذ", is_system: true },
  { value: "notification", label: "إشعار", is_system: true },
  { value: "circular", label: "تعميم", is_system: true }
];

const messageRoleOptions = [
  { id: "employee", label: "موظف" },
  { id: "direct_manager", label: "مدير مباشر" },
  { id: "it_staff", label: "مختص تنفيذ" },
  { id: "administration_manager", label: "مدير إدارة" },
  { id: "executive_management", label: "الإدارة التنفيذية" },
  { id: "super_admin", label: "مدير النظام" }
];

function MessageTemplatesSettings({ notify }) {
  const [templates, setTemplates] = useState([]);
  const [messageTypes, setMessageTypes] = useState(defaultMessageTypes);
  const [messageSettings, setMessageSettings] = useState({
    enabled: true,
    enable_attachments: true,
    enable_drafts: true,
    enable_templates: true,
    enable_signatures: true,
    enable_circulars: true,
    enable_department_broadcasts: true,
    enable_read_receipts: true,
    enable_linked_requests: true,
    max_attachment_mb: 25,
    max_recipients: 200,
    default_message_type: "internal_correspondence",
    allowed_user_ids: [],
    blocked_user_ids: [],
    allowed_department_ids: [],
    blocked_department_ids: [],
    circular_allowed_roles: [],
    circular_allowed_user_ids: [],
    department_broadcast_allowed_roles: [],
    department_broadcast_allowed_user_ids: [],
    template_allowed_roles: [],
    template_allowed_user_ids: []
  });
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [typesSaving, setTypesSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [settingsResponse, templatesResponse, typesResponse, usersResponse, departmentsResponse] = await Promise.all([
        api.get("/messages/settings"),
        api.get("/messages/templates"),
        api.get("/messages/types"),
        api.get("/users"),
        api.get("/settings/departments")
      ]);
      setMessageSettings(settingsResponse.data);
      setTemplates(templatesResponse.data);
      setMessageTypes(typesResponse.data.length ? typesResponse.data : defaultMessageTypes);
      setUsers(usersResponse.data || []);
      setDepartments(departmentsResponse.data || []);
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

  function updateTemplate(index, field, value) {
    setTemplates((current) => current.map((template, itemIndex) => (itemIndex === index ? { ...template, [field]: value } : template)));
  }

  function updateMessageType(index, field, value) {
    setMessageTypes((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)));
  }

  function updateMessageSetting(field, value) {
    setMessageSettings((current) => ({ ...current, [field]: value }));
  }

  function toggleMessageSettingList(field, id) {
    setMessageSettings((current) => {
      const list = Array.isArray(current[field]) ? current[field] : [];
      return { ...current, [field]: list.includes(id) ? list.filter((item) => item !== id) : [...list, id] };
    });
  }

  async function saveMessageSettings() {
    setSettingsSaving(true);
    setError("");
    try {
      const { auto_refresh_seconds: _autoRefreshSeconds, ...settingsWithoutPolling } = messageSettings;
      const payload = {
        ...settingsWithoutPolling,
        max_attachment_mb: Number(messageSettings.max_attachment_mb || 25),
        max_recipients: Number(messageSettings.max_recipients || 200)
      };
      const { data } = await api.put("/messages/settings", payload);
      setMessageSettings(data);
      notify("تم حفظ إعدادات المراسلات");
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    } finally {
      setSettingsSaving(false);
    }
  }

  function addMessageType() {
    setMessageTypes((current) => [
      ...current,
      { value: `custom_type_${Date.now()}`, label: "تصنيف جديد", is_system: false }
    ]);
  }

  function removeMessageType(index) {
    const item = messageTypes[index];
    if (item?.is_system) {
      notify("لا يمكن حذف التصنيفات الأساسية، يمكن تعديل الاسم فقط.", "error");
      return;
    }
    if (!window.confirm("هل تريد حذف هذا التصنيف؟ تأكد أنه غير مستخدم في القوالب الحالية.")) return;
    setMessageTypes((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function saveMessageTypes() {
    setTypesSaving(true);
    setError("");
    try {
      const { data } = await api.put("/messages/types", { types: messageTypes });
      setMessageTypes(data);
      notify("تم حفظ تصنيفات المراسلات");
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    } finally {
      setTypesSaving(false);
    }
  }

  function addTemplate() {
    const key = `custom_${Date.now()}`;
    setTemplates((current) => [
      ...current,
      {
        key,
        label: "قالب جديد",
        message_type: "internal_correspondence",
        subject: "",
        body: ""
      }
    ]);
  }

  function removeTemplate(index) {
    if (!window.confirm("هل تريد حذف هذا القالب من القائمة؟")) return;
    setTemplates((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const { data } = await api.put("/messages/templates", { templates });
      setTemplates(data);
      notify("تم حفظ قوالب المراسلات");
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    } finally {
      setSettingsSaving(false);
    }
  }

  if (loading) {
    return <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">جاري تحميل قوالب المراسلات...</div>;
  }

  return (
    <form onSubmit={save} className="space-y-5 text-right" dir="rtl">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h4 className="font-bold text-slate-950">التحكم العام بالمراسلات</h4>
            <p className="mt-1 text-sm leading-6 text-slate-500">تحكم في تشغيل المراسلات، المرفقات، المسودات، التواقيع، القوالب، التعاميم، وسجل القراءة. يتم تحديث الوارد لحظياً عبر WebSocket.</p>
          </div>
          <Button type="button" onClick={saveMessageSettings} disabled={settingsSaving}>{settingsSaving ? "جاري الحفظ..." : "حفظ إعدادات المراسلات"}</Button>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Toggle label="تفعيل المراسلات" checked={Boolean(messageSettings.enabled)} onChange={(value) => updateMessageSetting("enabled", value)} />
          <Toggle label="تفعيل المرفقات" checked={Boolean(messageSettings.enable_attachments)} onChange={(value) => updateMessageSetting("enable_attachments", value)} />
          <Toggle label="تفعيل المسودات" checked={Boolean(messageSettings.enable_drafts)} onChange={(value) => updateMessageSetting("enable_drafts", value)} />
          <Toggle label="تفعيل القوالب" checked={Boolean(messageSettings.enable_templates)} onChange={(value) => updateMessageSetting("enable_templates", value)} />
          <Toggle label="تفعيل التواقيع" checked={Boolean(messageSettings.enable_signatures)} onChange={(value) => updateMessageSetting("enable_signatures", value)} />
          <Toggle label="تفعيل التعاميم" checked={Boolean(messageSettings.enable_circulars)} onChange={(value) => updateMessageSetting("enable_circulars", value)} />
          <Toggle label="تعميم حسب الإدارات" checked={Boolean(messageSettings.enable_department_broadcasts)} onChange={(value) => updateMessageSetting("enable_department_broadcasts", value)} />
          <Toggle label="إظهار سجل القراءة" checked={Boolean(messageSettings.enable_read_receipts)} onChange={(value) => updateMessageSetting("enable_read_receipts", value)} />
          <Toggle label="ربط الرسائل بالطلبات" checked={Boolean(messageSettings.enable_linked_requests)} onChange={(value) => updateMessageSetting("enable_linked_requests", value)} />
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <LabeledInput label="أقصى حجم للمرفق MB" type="number" min="1" max="100" value={messageSettings.max_attachment_mb || 25} onChange={(event) => updateMessageSetting("max_attachment_mb", event.target.value)} />
          <LabeledInput label="أقصى عدد مستلمين" type="number" min="1" max="1000" value={messageSettings.max_recipients || 200} onChange={(event) => updateMessageSetting("max_recipients", event.target.value)} />
          <label className="block space-y-2 text-sm font-medium text-slate-700">
            التصنيف الافتراضي
            <select value={messageSettings.default_message_type || "internal_correspondence"} onChange={(event) => updateMessageSetting("default_message_type", event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100">
              {messageTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4">
          <h4 className="font-bold text-slate-950">صلاحيات متقدمة للمراسلات</h4>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            اترك القوائم فارغة للسماح لكل مستخدمي المراسلات، أو حدّد أدواراً وموظفين لتقييد كل ميزة.
          </p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <MessageScopeBox
            title="من يستطيع إرسال تعميم"
            description="يتحكم في تصنيف الرسالة: تعميم."
            items={messageRoleOptions}
            selected={messageSettings.circular_allowed_roles || []}
            onToggle={(id) => toggleMessageSettingList("circular_allowed_roles", id)}
          />
          <MessageScopeBox
            title="موظفون مسموح لهم بالتعاميم"
            description="استثناءات مباشرة لإرسال التعاميم حتى لو لم يكن دورهم محدداً."
            items={users.map((user) => ({ id: user.id, label: user.full_name_ar, hint: user.email }))}
            selected={messageSettings.circular_allowed_user_ids || []}
            onToggle={(id) => toggleMessageSettingList("circular_allowed_user_ids", id)}
          />
          <MessageScopeBox
            title="من يستطيع تعميم حسب الإدارات"
            description="يتحكم في أداة اختيار إدارة أو أكثر داخل رسالة جديدة."
            items={messageRoleOptions}
            selected={messageSettings.department_broadcast_allowed_roles || []}
            onToggle={(id) => toggleMessageSettingList("department_broadcast_allowed_roles", id)}
          />
          <MessageScopeBox
            title="موظفون مسموح لهم بتعميم الإدارات"
            description="استثناءات مباشرة لاستخدام أداة تعميم حسب الإدارات."
            items={users.map((user) => ({ id: user.id, label: user.full_name_ar, hint: user.email }))}
            selected={messageSettings.department_broadcast_allowed_user_ids || []}
            onToggle={(id) => toggleMessageSettingList("department_broadcast_allowed_user_ids", id)}
          />
          <MessageScopeBox
            title="من يستطيع استخدام القوالب"
            description="يتحكم في ظهور زر القوالب داخل محرر الرسائل."
            items={messageRoleOptions}
            selected={messageSettings.template_allowed_roles || []}
            onToggle={(id) => toggleMessageSettingList("template_allowed_roles", id)}
          />
          <MessageScopeBox
            title="موظفون مسموح لهم بالقوالب"
            description="استثناءات مباشرة لاستخدام قوالب المراسلات."
            items={users.map((user) => ({ id: user.id, label: user.full_name_ar, hint: user.email }))}
            selected={messageSettings.template_allowed_user_ids || []}
            onToggle={(id) => toggleMessageSettingList("template_allowed_user_ids", id)}
          />
        </div>
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={saveMessageSettings} disabled={settingsSaving}>{settingsSaving ? "جاري الحفظ..." : "حفظ الصلاحيات المتقدمة"}</Button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4">
          <h4 className="font-bold text-slate-950">نطاق المراسلات حسب الموظف أو الإدارة</h4>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            إذا تركت قوائم السماح فارغة فالنظام يسمح لكل من لديه صلاحية شاشة المراسلات. قوائم المنع لها أولوية دائماً.
          </p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <MessageScopeBox
            title="موظفون مسموح لهم"
            description="عند تحديد موظفين هنا، لن يستطيع غيرهم استخدام المراسلات إلا إذا كانت إدارتهم مسموحة."
            items={users.map((user) => ({ id: user.id, label: user.full_name_ar, hint: user.email }))}
            selected={messageSettings.allowed_user_ids || []}
            onToggle={(id) => toggleMessageSettingList("allowed_user_ids", id)}
          />
          <MessageScopeBox
            title="موظفون ممنوعون"
            description="يتم منع هؤلاء الموظفين من الإرسال والاستقبال حتى لو كانت إدارتهم مسموحة."
            items={users.map((user) => ({ id: user.id, label: user.full_name_ar, hint: user.email }))}
            selected={messageSettings.blocked_user_ids || []}
            onToggle={(id) => toggleMessageSettingList("blocked_user_ids", id)}
            danger
          />
          <MessageScopeBox
            title="إدارات مسموحة"
            description="عند تحديد إدارات هنا، يصبح استخدام المراسلات محصوراً بهذه الإدارات والموظفين المسموحين."
            items={departments.map((department) => ({ id: department.id, label: department.name_ar, hint: department.code }))}
            selected={messageSettings.allowed_department_ids || []}
            onToggle={(id) => toggleMessageSettingList("allowed_department_ids", id)}
          />
          <MessageScopeBox
            title="إدارات ممنوعة"
            description="يتم منع كل موظفي هذه الإدارات من الإرسال والاستقبال."
            items={departments.map((department) => ({ id: department.id, label: department.name_ar, hint: department.code }))}
            selected={messageSettings.blocked_department_ids || []}
            onToggle={(id) => toggleMessageSettingList("blocked_department_ids", id)}
            danger
          />
        </div>
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={saveMessageSettings} disabled={settingsSaving}>{settingsSaving ? "جاري الحفظ..." : "حفظ نطاق المراسلات"}</Button>
        </div>
      </div>

      <div className="rounded-lg border border-bank-100 bg-bank-50/70 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white text-bank-700">
              <FileText className="h-5 w-5" />
            </span>
            <div>
              <p className="font-bold text-slate-950">قوالب جاهزة للرسائل الرسمية والمتكررة</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">يمكن استخدام المتغير <span className="font-mono">{`{request_number}`}</span> وسيتم استبداله برقم الطلب المرتبط عند تطبيق القالب.</p>
            </div>
          </div>
          <button type="button" onClick={addTemplate} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-bank-700 px-4 text-sm font-bold text-white hover:bg-bank-800">
            <FileText className="h-4 w-4" />
            إضافة قالب
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h4 className="font-bold text-slate-950">تصنيفات الرسائل</h4>
            <p className="mt-1 text-sm leading-6 text-slate-500">أضف تصنيفاً جديداً أو عدّل أسماء التصنيفات التي تظهر في شاشة المراسلات والقوالب.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={addMessageType} className="h-10 rounded-md border border-bank-200 bg-bank-50 px-4 text-sm font-bold text-bank-800 hover:bg-bank-100">إضافة تصنيف</button>
            <Button type="button" onClick={saveMessageTypes} disabled={typesSaving}>{typesSaving ? "جاري الحفظ..." : "حفظ التصنيفات"}</Button>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {messageTypes.map((item, index) => (
            <div key={`${item.value}-${index}`} className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
              <LabeledInput label="الرمز" value={item.value || ""} disabled={Boolean(item.is_system)} onChange={(event) => updateMessageType(index, "value", event.target.value)} placeholder="مثال: internal_note" />
              <LabeledInput label="الاسم بالعربي" value={item.label || ""} onChange={(event) => updateMessageType(index, "label", event.target.value)} />
              <button type="button" onClick={() => removeMessageType(index)} disabled={Boolean(item.is_system)} className="h-10 rounded-md border border-red-200 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">
                حذف
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {templates.map((template, index) => (
          <div key={template.key || index} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-black text-slate-950">{template.label || "قالب بدون اسم"}</p>
              <button type="button" onClick={() => removeTemplate(index)} className="h-9 rounded-md border border-red-200 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-50">
                حذف القالب
              </button>
            </div>
            <div className="grid gap-3 lg:grid-cols-[220px_220px_1fr]">
              <LabeledInput label="اسم القالب" value={template.label || ""} onChange={(event) => updateTemplate(index, "label", event.target.value)} />
              <label className="block space-y-2 text-sm font-medium text-slate-700">
                التصنيف
                <select
                  value={template.message_type || "internal_correspondence"}
                  onChange={(event) => updateTemplate(index, "message_type", event.target.value)}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100"
                >
                  {messageTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <LabeledInput label="موضوع الرسالة" value={template.subject || ""} onChange={(event) => updateTemplate(index, "subject", event.target.value)} />
            </div>
            <label className="mt-3 block space-y-2 text-sm font-medium text-slate-700">
              نص القالب
              <textarea
                value={template.body || ""}
                onChange={(event) => updateTemplate(index, "body", event.target.value)}
                rows={6}
                className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-7 outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100"
              />
            </label>
          </div>
        ))}
      </div>

      <SimpleError error={error} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={saving} className="gap-2">
          <FileText className="h-4 w-4" />
          {saving ? "جاري الحفظ..." : "حفظ القوالب"}
        </Button>
        <button type="button" onClick={load} className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">إعادة تحميل</button>
      </div>
    </form>
  );
}

function MessageScopeBox({ title, description, items, selected, onToggle, danger = false }) {
  const [term, setTerm] = useState("");
  const filtered = items.filter((item) => `${item.label} ${item.hint || ""}`.toLowerCase().includes(term.trim().toLowerCase())).slice(0, 120);
  return (
    <div className={`rounded-lg border p-4 ${danger ? "border-red-100 bg-red-50/40" : "border-bank-100 bg-bank-50/40"}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h5 className="font-bold text-slate-950">{title}</h5>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-bold ${danger ? "bg-red-100 text-red-700" : "bg-bank-100 text-bank-800"}`}>{selected.length}</span>
      </div>
      <Input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="بحث" />
      <div className="mt-3 max-h-64 space-y-1 overflow-y-auto rounded-md border border-white/80 bg-white p-2">
        {filtered.map((item) => (
          <label key={item.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-slate-50">
            <span className="min-w-0">
              <span className="block truncate font-semibold text-slate-800">{item.label}</span>
              {item.hint && <span className="block truncate text-xs text-slate-500">{item.hint}</span>}
            </span>
            <input type="checkbox" checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} />
          </label>
        ))}
        {filtered.length === 0 && <p className="p-3 text-center text-xs text-slate-500">لا توجد نتائج.</p>}
      </div>
    </div>
  );
}

const emailDefaults = {
  smtp_host: "",
  smtp_port: 587,
  smtp_from_email: "",
  smtp_from_name: "",
  smtp_username: "",
  smtp_password: "",
  smtp_tls: true,
  email_approvals: true,
  email_rejections: true,
  request_completed: true,
  daily_summary: false
};

function EmailSettings({ notify }) {
  const [form, setForm] = useState(emailDefaults);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get("/settings/notifications")
      .then(({ data }) => setForm({ ...emailDefaults, ...data, smtp_password: data.smtp_password || "" }))
      .catch((error) => {
        const message = getErrorMessage(error);
        setError(message);
        notify(message, "error");
      })
      .finally(() => setLoading(false));
  }, []);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        smtp_port: Number(form.smtp_port || 587),
        smtp_host: form.smtp_host || null,
        smtp_from_email: form.smtp_from_email || null,
        smtp_from_name: form.smtp_from_name || null,
        smtp_username: form.smtp_username || null,
        smtp_password: form.smtp_password || null
      };
      const { data } = await api.put("/settings/notifications", payload);
      setForm({ ...emailDefaults, ...data, smtp_password: data.smtp_password || "" });
      notify("تم حفظ إعدادات البريد SMTP");
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">جاري تحميل إعدادات البريد...</div>;
  }

  return (
    <form onSubmit={save} className="space-y-5 text-right" dir="rtl">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-bank-50 text-bank-700">
            <Mail className="h-5 w-5" />
          </span>
          <div>
            <p className="font-bold text-slate-950">ربط البريد الإلكتروني SMTP</p>
            <p className="mt-1 text-sm leading-6 text-slate-500">تستخدم هذه البيانات لإرسال إشعارات الموافقات والرفض واكتمال الطلبات من بريد رسمي.</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <EmailField label="خادم SMTP" value={form.smtp_host || ""} onChange={(value) => update("smtp_host", value)} />
        <EmailField label="منفذ SMTP" type="number" value={form.smtp_port} onChange={(value) => update("smtp_port", value)} />
        <EmailField label="بريد الإرسال" type="email" value={form.smtp_from_email || ""} onChange={(value) => update("smtp_from_email", value)} />
        <EmailField label="اسم المرسل" value={form.smtp_from_name || ""} onChange={(value) => update("smtp_from_name", value)} />
        <EmailField label="اسم مستخدم SMTP" value={form.smtp_username || ""} onChange={(value) => update("smtp_username", value)} />
        <EmailField label="كلمة مرور SMTP" type="password" value={form.smtp_password || ""} onChange={(value) => update("smtp_password", value)} />
      </div>

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2">
        <Toggle label="استخدام TLS" checked={Boolean(form.smtp_tls)} onChange={(value) => update("smtp_tls", value)} />
        <Toggle label="إرسال إشعار عند الموافقة" checked={Boolean(form.email_approvals)} onChange={(value) => update("email_approvals", value)} />
        <Toggle label="إرسال إشعار عند الرفض" checked={Boolean(form.email_rejections)} onChange={(value) => update("email_rejections", value)} />
        <Toggle label="إرسال إشعار عند اكتمال الطلب" checked={Boolean(form.request_completed)} onChange={(value) => update("request_completed", value)} />
        <Toggle label="إرسال ملخص يومي" checked={Boolean(form.daily_summary)} onChange={(value) => update("daily_summary", value)} />
      </div>

      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ إعدادات البريد"}</Button>
        <button type="button" onClick={() => setForm(emailDefaults)} className="h-10 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">تفريغ الإعدادات</button>
      </div>
    </form>
  );
}

function SecuritySettings({ notify }) {
  const [form, setForm] = useState({});
  const [error, setError] = useState("");
  useEffect(() => { api.get("/settings/security").then(({ data }) => setForm(data)).catch((e) => notify(getErrorMessage(e), "error")); }, []);
  async function save(event) {
    event.preventDefault();
    const numeric = { password_min_length: Number(form.password_min_length), lock_after_failed_attempts: Number(form.lock_after_failed_attempts), password_expiry_days: Number(form.password_expiry_days) };
    const payload = {
      password_min_length: numeric.password_min_length,
      lock_after_failed_attempts: numeric.lock_after_failed_attempts,
      password_expiry_days: numeric.password_expiry_days,
      require_uppercase: Boolean(form.require_uppercase),
      require_numbers: Boolean(form.require_numbers),
      require_special_chars: Boolean(form.require_special_chars),
      mfa_enabled: Boolean(form.mfa_enabled),
      login_identifier_mode: form.login_identifier_mode || "email_or_employee_id",
      temporary_password: form.temporary_password || "Change@12345"
    };
    try { setForm((await api.put("/settings/security", payload)).data); notify("تم حفظ سياسة الأمان"); } catch (e) { notify(getErrorMessage(e), "error"); }
  }
  const toggles = [
    ["require_uppercase", "اشتراط حرف كبير"],
    ["require_numbers", "اشتراط أرقام"],
    ["require_special_chars", "اشتراط رموز خاصة"]
  ];
  return <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
    <label className="block space-y-2 text-sm font-medium text-slate-700 md:col-span-2">
      طريقة تسجيل الدخول
      <select value={form.login_identifier_mode || "email_or_employee_id"} onChange={(e) => setForm({ ...form, login_identifier_mode: e.target.value })} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100">
        <option value="email_or_employee_id">البريد الإلكتروني أو الرقم الوظيفي</option>
        <option value="email">البريد الإلكتروني فقط</option>
        <option value="employee_id">الرقم الوظيفي فقط</option>
      </select>
      <span className="block text-xs font-normal text-slate-500">يتم تطبيق هذا الخيار على شاشة تسجيل الدخول فقط، ولا يغير بيانات المستخدمين.</span>
    </label>
    <LabeledInput label="الحد الأدنى لطول كلمة المرور" type="number" min="1" value={form.password_min_length || ""} onChange={(e) => setForm({ ...form, password_min_length: e.target.value })} />
    <LabeledInput label="قفل الحساب بعد عدد محاولات فاشلة" type="number" value={form.lock_after_failed_attempts || ""} onChange={(e) => setForm({ ...form, lock_after_failed_attempts: e.target.value })} />
    <LabeledInput label="مدة صلاحية كلمة المرور بالأيام" type="number" value={form.password_expiry_days || ""} onChange={(e) => setForm({ ...form, password_expiry_days: e.target.value })} />
    <label className="block space-y-2 text-sm font-medium text-slate-700 md:col-span-2">
      كلمة المرور المؤقتة الافتراضية
      <Input type="text" value={form.temporary_password || ""} onChange={(e) => setForm({ ...form, temporary_password: e.target.value })} placeholder="مثال: Change@12345" required />
      <span className="block text-xs font-normal text-slate-500">تستخدم عند إنشاء مستخدم جديد بدون كلمة مرور، وعند إعادة تعيين كلمة مرور المستخدم، وعند استيراد المستخدمين من Excel إذا ترك الحقل فارغاً.</span>
    </label>
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <p className="mb-3 text-sm font-bold text-slate-700">قواعد كلمة المرور والدخول</p>
      <div className="space-y-3">
        {toggles.map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={Boolean(form[key])} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} /> {label}</label>)}
      </div>
    </div>
    <SimpleError error={error} />
    <Button type="submit">حفظ سياسة الأمان</Button>
  </form>;
}

export function DatabaseSettings({ notify }) {
  const dbTabs = [
    ["overview", "نظرة عامة"],
    ["backups", "النسخ الاحتياطية"],
    ["restore", "الاستعادة"],
    ["reset", "إعادة الضبط"],
    ["maintenance", "الصيانة"],
    ["tables", "الجداول"],
    ["activity", "سجل العمليات"],
    ["settings", "الإعدادات"]
  ];
  const backupTypeLabels = { database_only: "قاعدة البيانات فقط", attachments_only: "المرفقات فقط", full_backup: "نسخة كاملة" };
  const resetScopeLabels = {
    clear_requests_only: "حذف الطلبات فقط",
    clear_messages_only: "حذف المراسلات فقط",
    clear_attachments_only: "حذف المرفقات فقط",
    clear_users_except_admin: "حذف المستخدمين مع إبقاء مدير النظام",
    clear_audit_logs: "حذف سجلات التدقيق",
    reset_demo_data_only: "حذف بيانات التجربة فقط",
    full_system_reset: "إعادة ضبط كاملة للنظام"
  };
  const [activeTab, setActiveTab] = useState("overview");
  const [status, setStatus] = useState(null);
  const [backups, setBackups] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [tables, setTables] = useState([]);
  const [activity, setActivity] = useState([]);
  const [backupSettings, setBackupSettings] = useState(null);
  const [backupType, setBackupType] = useState("full_backup");
  const [restoreFile, setRestoreFile] = useState(null);
  const [restorePreview, setRestorePreview] = useState(null);
  const [restoreForm, setRestoreForm] = useState({ admin_password: "", confirmation_text: "", restore_uploads: true });
  const [resetScope, setResetScope] = useState("clear_requests_only");
  const [resetPreviewData, setResetPreviewData] = useState(null);
  const [resetForm, setResetForm] = useState({ admin_password: "", confirmation_text: "", delete_upload_files: false, understand_risk: false });
  const [maintenanceResult, setMaintenanceResult] = useState(null);
  const [migrationStatus, setMigrationStatus] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function loadAll() {
    setError("");
    try {
      const [statusRes, backupsRes, jobsRes, tablesRes, activityRes, settingsRes, migrationRes] = await Promise.all([
        api.get("/settings/database/status"),
        api.get("/settings/database/backups"),
        api.get("/settings/database/jobs"),
        api.get("/settings/database/tables"),
        api.get("/settings/database/activity-log"),
        api.get("/settings/database/backup-settings"),
        api.get("/settings/database/migrations/status")
      ]);
      setStatus(statusRes.data);
      setBackups(backupsRes.data || []);
      setJobs(jobsRes.data || []);
      setTables(tablesRes.data || []);
      setActivity(activityRes.data || []);
      setBackupSettings(settingsRes.data);
      setMigrationStatus(migrationRes.data);
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    }
  }

  useEffect(() => { loadAll(); }, []);

  async function runAction(label, action) {
    setBusy(label);
    setError("");
    try {
      await action();
      await loadAll();
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    } finally {
      setBusy("");
    }
  }

  async function createManualBackup() {
    await runAction("backup", async () => {
      await api.post("/settings/database/backup", { backup_type: backupType });
      notify("تم إنشاء النسخة الاحتياطية");
    });
  }

  async function downloadBackup(backup) {
    await runAction(`download-${backup.id}`, async () => {
      const response = await api.get(`/settings/database/backups/${backup.id}/download`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = backup.file_name;
      link.click();
      URL.revokeObjectURL(url);
      notify("تم تنزيل النسخة الاحتياطية");
    });
  }

  async function decryptBackup(backup) {
    const admin_password = window.prompt("أدخل كلمة مرور مدير النظام لفك تشفير النسخة");
    if (!admin_password) return;
    await runAction(`decrypt-${backup.id}`, async () => {
      const response = await api.post(
        `/settings/database/backups/${backup.id}/decrypt-download`,
        { admin_password, confirmation_text: "DECRYPT BACKUP" },
        { responseType: "blob" }
      );
      const fileName = backup.file_name.endsWith(".enc") ? backup.file_name.slice(0, -4) : `${backup.file_name}.zip`;
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      notify("تم فك تشفير النسخة وتنزيلها");
    });
  }

  async function verifyBackup(backup) {
    await runAction(`verify-${backup.id}`, async () => {
      await api.post(`/settings/database/backups/${backup.id}/verify`);
      notify("تم التحقق من سلامة النسخة");
    });
  }

  async function deleteBackup(backup) {
    const admin_password = window.prompt("أدخل كلمة مرور مدير النظام لحذف النسخة الاحتياطية");
    if (!admin_password) return;
    const confirmation_text = window.prompt("اكتب DELETE BACKUP للتأكيد");
    if (confirmation_text !== "DELETE BACKUP") return notify("عبارة التأكيد غير صحيحة", "error");
    await runAction(`delete-${backup.id}`, async () => {
      await api.delete(`/settings/database/backups/${backup.id}`, { data: { admin_password, confirmation_text } });
      notify("تم حذف النسخة الاحتياطية");
    });
  }

  async function validateRestore(event) {
    event.preventDefault();
    if (!restoreFile) return notify("اختر ملف النسخة أولاً", "error");
    await runAction("restore-validate", async () => {
      const body = new FormData();
      body.append("file", restoreFile);
      const { data } = await api.post("/settings/database/restore/validate", body, { headers: { "Content-Type": "multipart/form-data" } });
      setRestorePreview(data);
      notify("تم التحقق من النسخة. راجع المعاينة قبل التنفيذ.");
    });
  }

  async function confirmRestore(event) {
    event.preventDefault();
    if (!restorePreview?.restore_token) return notify("يجب التحقق من النسخة قبل الاستعادة", "error");
    await runAction("restore-confirm", async () => {
      await api.post("/settings/database/restore/confirm", { restore_token: restorePreview.restore_token, ...restoreForm });
      notify("تم تنفيذ الاستعادة");
      setRestoreFile(null);
      setRestorePreview(null);
      setRestoreForm({ admin_password: "", confirmation_text: "", restore_uploads: true });
    });
  }

  async function loadResetPreview() {
    await runAction("reset-preview", async () => {
      const { data } = await api.get(`/settings/database/reset-preview?scope=${encodeURIComponent(resetScope)}`);
      setResetPreviewData(data);
    });
  }

  async function executeReset(event) {
    event.preventDefault();
    await runAction("reset", async () => {
      await api.post("/settings/database/reset", { scope: resetScope, ...resetForm });
      notify("تم تنفيذ إعادة الضبط");
      setResetForm({ admin_password: "", confirmation_text: "", delete_upload_files: false, understand_risk: false });
      setResetPreviewData(null);
    });
  }

  async function runMaintenance(path, label) {
    await runAction(path, async () => {
      const { data } = await api.post(`/settings/database/${path}`);
      setMaintenanceResult(data);
      notify(label);
    });
  }

  async function runMigrations() {
    const admin_password = window.prompt("أدخل كلمة مرور مدير النظام لتشغيل الترحيلات");
    if (!admin_password) return;
    const confirmation_text = window.prompt("اكتب RUN MIGRATIONS للتأكيد");
    if (confirmation_text !== "RUN MIGRATIONS") return notify("عبارة التأكيد غير صحيحة", "error");
    await runAction("migrations-run", async () => {
      await api.post("/settings/database/migrations/run", { admin_password, confirmation_text });
      notify("تم فحص وتشغيل الترحيلات المعلقة");
    });
  }

  async function saveBackupSettings(event) {
    event.preventDefault();
    await runAction("backup-settings", async () => {
      const payload = { ...backupSettings, retention_count: Number(backupSettings.retention_count || 7) };
      const { data } = await api.put("/settings/database/backup-settings", payload);
      setBackupSettings(data);
      notify("تم حفظ إعدادات النسخ الاحتياطي");
    });
  }

  const latestJob = jobs[0];

  return (
    <div className="space-y-5" dir="rtl">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h4 className="text-lg font-black text-slate-950">إدارة قاعدة البيانات</h4>
            <p className="mt-1 text-sm leading-6 text-slate-500">مركز تحكم آمن للنسخ الاحتياطية، الاستعادة، الصيانة، الجداول، وسجل العمليات.</p>
          </div>
          <Button type="button" onClick={loadAll} disabled={Boolean(busy)} className="gap-2 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
            <RefreshCw className="h-4 w-4" /> تحديث
          </Button>
        </div>
        {latestJob && (
          <div className="mt-4 rounded-md border border-bank-100 bg-bank-50/60 p-3">
            <div className="mb-2 flex items-center justify-between text-sm font-bold text-slate-700">
              <span>آخر مهمة: {databaseJobLabel(latestJob.job_type)} - {databaseStatusLabel(latestJob.status)}</span>
              <span>{latestJob.progress}%</span>
            </div>
            <div className="h-2 rounded-full bg-white"><div className="h-2 rounded-full bg-bank-600" style={{ width: `${Math.min(latestJob.progress || 0, 100)}%` }} /></div>
            {latestJob.message && <p className="mt-2 text-xs text-slate-500">{latestJob.message}</p>}
          </div>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto rounded-lg border border-slate-200 bg-white p-2">
        {dbTabs.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setActiveTab(key)} className={`h-10 shrink-0 rounded-md px-4 text-sm font-bold ${activeTab === key ? "bg-bank-700 text-white" : "bg-slate-50 text-slate-700 hover:bg-bank-50"}`}>
            {label}
          </button>
        ))}
      </div>

      <SimpleError error={error} />

      {activeTab === "overview" && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricBox label="حالة الاتصال" value={databaseStatusLabel(status?.status)} />
            <MetricBox label="نوع قاعدة البيانات" value={status?.database_type || "-"} />
            <MetricBox label="اسم قاعدة البيانات" value={status?.database_name || "-"} />
            <MetricBox label="زمن الاستجابة" value={`${status?.latency_ms ?? "-"} ms`} />
            <MetricBox label="حجم قاعدة البيانات" value={`${status?.size_mb ?? 0} MB`} />
            <MetricBox label="عدد الجداول" value={status?.tables_count ?? "-"} />
            <MetricBox label="عدد السجلات" value={status?.records_count ?? "-"} />
            <MetricBox label="آخر نسخة احتياطية" value={formatDateTime(status?.last_backup_at)} />
            <MetricBox label="آخر استعادة" value={formatDateTime(status?.last_restore_at)} />
            <MetricBox label="آخر صيانة" value={formatDateTime(status?.last_maintenance_at)} />
          </div>
          <WarningBox title="بيانات آمنة فقط" text="لا يتم عرض اسم المستخدم أو كلمة المرور أو رابط الاتصال الكامل بقاعدة البيانات في هذه الشاشة." />
        </div>
      )}

      {activeTab === "backups" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <label className="block space-y-2 text-sm font-bold text-slate-700">
                نوع النسخة
                <select value={backupType} onChange={(event) => setBackupType(event.target.value)} className="h-10 rounded-md border border-slate-300 bg-white px-3">
                  {Object.entries(backupTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <Button type="button" onClick={createManualBackup} disabled={busy === "backup"} className="gap-2">
                <Download className="h-4 w-4" /> {busy === "backup" ? "جاري النسخ..." : "إنشاء نسخة احتياطية"}
              </Button>
            </div>
          </div>
          <SimpleTable
            headers={["اسم النسخة", "نوع النسخة", "الحجم", "تاريخ الإنشاء", "أنشأها", "الحالة", "تم التحقق؟", "الإجراءات"]}
            rows={backups.map((backup) => [
              backup.file_name,
              backupTypeLabels[backup.backup_type] || backup.backup_type,
              formatBytes(backup.file_size),
              formatDateTime(backup.created_at),
              backup.created_by_name || "-",
              databaseStatusLabel(backup.status),
              backup.verified_at ? formatDateTime(backup.verified_at) : "لا",
              <div key={backup.id} className="flex flex-wrap gap-2">
                <button type="button" onClick={() => downloadBackup(backup)} className="rounded-md border px-2 py-1 text-xs font-bold">تحميل</button>
                {(backup.metadata_json?.encrypted || backup.file_name?.endsWith(".enc")) && (
                  <button type="button" onClick={() => decryptBackup(backup)} className="rounded-md border border-bank-200 px-2 py-1 text-xs font-bold text-bank-800">فك التشفير</button>
                )}
                <button type="button" onClick={() => verifyBackup(backup)} className="rounded-md border px-2 py-1 text-xs font-bold">تحقق</button>
                <button type="button" onClick={() => deleteBackup(backup)} className="rounded-md border border-red-200 px-2 py-1 text-xs font-bold text-red-700">حذف</button>
              </div>
            ])}
          />
        </div>
      )}

      {activeTab === "restore" && (
        <div className="space-y-4">
          <WarningBox title="استعادة آمنة متعددة المراحل" text="لن يتم الاسترداد بمجرد رفع الملف. يجب التحقق من النسخة، مراجعة المعاينة، إدخال كلمة مرور مدير النظام، وكتابة RESTORE DATABASE." />
          <form onSubmit={validateRestore} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h4 className="mb-3 font-bold text-slate-950">1. رفع النسخة والتحقق منها</h4>
            <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
              <input type="file" accept=".zip,.db,.sqlite,.sqlite3" onChange={(event) => setRestoreFile(event.target.files?.[0] || null)} className="h-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
              <Button type="submit" disabled={busy === "restore-validate"}>{busy === "restore-validate" ? "جاري التحقق..." : "تحقق من النسخة"}</Button>
            </div>
          </form>
          {restorePreview && (
            <form onSubmit={confirmRestore} className="rounded-lg border border-amber-200 bg-amber-50/70 p-4">
              <h4 className="font-bold text-slate-950">2. معاينة الاستعادة والتأكيد الأمني</h4>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {Object.entries(restorePreview.preview || {}).map(([key, value]) => <MetricBox key={key} label={key} value={typeof value === "boolean" ? (value ? "نعم" : "لا") : String(value ?? "-")} />)}
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <LabeledInput label="كلمة مرور مدير النظام" type="password" value={restoreForm.admin_password} onChange={(event) => setRestoreForm({ ...restoreForm, admin_password: event.target.value })} />
                <LabeledInput label="عبارة التأكيد" value={restoreForm.confirmation_text} onChange={(event) => setRestoreForm({ ...restoreForm, confirmation_text: event.target.value })} placeholder="RESTORE DATABASE" />
                <Toggle label="استعادة المرفقات إن وجدت" checked={Boolean(restoreForm.restore_uploads)} onChange={(value) => setRestoreForm({ ...restoreForm, restore_uploads: value })} />
              </div>
              <Button type="submit" disabled={busy === "restore-confirm"} className="mt-4 bg-amber-700 hover:bg-amber-800">
                {busy === "restore-confirm" ? "جاري الاستعادة..." : "تنفيذ الاستعادة"}
              </Button>
            </form>
          )}
        </div>
      )}

      {activeTab === "reset" && (
        <div className="space-y-4">
          <DangerBox title="إجراء عالي الخطورة" text="سيتم إنشاء نسخة احتياطية كاملة تلقائياً قبل إعادة الضبط. لا يتم حذف ملفات النسخ الاحتياطية أو Docker volumes." />
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <label className="block space-y-2 text-sm font-bold text-slate-700">
                نطاق إعادة الضبط
                <select value={resetScope} onChange={(event) => setResetScope(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3">
                  {Object.entries(resetScopeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <Button type="button" onClick={loadResetPreview} disabled={busy === "reset-preview"} className="self-end">عرض المعاينة</Button>
            </div>
          </div>
          {resetPreviewData && (
            <form onSubmit={executeReset} className="rounded-lg border border-red-200 bg-red-50/60 p-4">
              <h4 className="font-bold text-slate-950">معاينة التأثير</h4>
              <SimpleTable headers={["الجدول", "عدد السجلات"]} rows={(resetPreviewData.tables || []).map((row) => [row.table_name, row.records_count])} />
              {(resetPreviewData.warnings || []).map((item) => <p key={item} className="mt-2 text-sm font-semibold text-red-700">- {item}</p>)}
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <LabeledInput label="كلمة مرور مدير النظام" type="password" value={resetForm.admin_password} onChange={(event) => setResetForm({ ...resetForm, admin_password: event.target.value })} />
                <LabeledInput label="عبارة التأكيد" value={resetForm.confirmation_text} onChange={(event) => setResetForm({ ...resetForm, confirmation_text: event.target.value })} placeholder="RESET DATABASE" />
                <Toggle label="أفهم أن هذا الإجراء قد يؤثر على بيانات النظام" checked={Boolean(resetForm.understand_risk)} onChange={(value) => setResetForm({ ...resetForm, understand_risk: value })} />
                <Toggle label="حذف ملفات المرفقات أيضاً" checked={Boolean(resetForm.delete_upload_files)} onChange={(value) => setResetForm({ ...resetForm, delete_upload_files: value })} />
              </div>
              <Button type="submit" disabled={busy === "reset"} className="mt-4 bg-red-700 hover:bg-red-800">{busy === "reset" ? "جاري التنفيذ..." : "تنفيذ إعادة الضبط"}</Button>
            </form>
          )}
        </div>
      )}

      {activeTab === "maintenance" && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[
              ["maintenance/test-connection", "اختبار الاتصال"],
              ["maintenance/check-integrity", "فحص سلامة قاعدة البيانات"],
              ["maintenance/optimize", "تحسين قاعدة البيانات"],
              ["maintenance/reindex", "إعادة بناء الفهارس"],
              ["maintenance/analyze", "تحديث إحصائيات قاعدة البيانات"],
              ["maintenance/clean-temp", "تنظيف الملفات المؤقتة"],
              ["maintenance/check-orphan-attachments", "فحص المرفقات اليتيمة"]
            ].map(([path, label]) => <button key={path} type="button" onClick={() => runMaintenance(path, label)} className="rounded-lg border border-slate-200 bg-white p-4 text-right text-sm font-bold shadow-sm hover:bg-bank-50">{label}</button>)}
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h4 className="font-bold text-slate-950">الترحيلات</h4>
            <p className="mt-2 text-sm text-slate-600">{migrationStatus?.message || "لم يتم تحميل حالة الترحيلات."}</p>
            <Button type="button" onClick={runMigrations} disabled={busy === "migrations-run"} className="mt-3">تشغيل الترحيلات المعلقة</Button>
          </div>
          {maintenanceResult && <pre className="overflow-auto rounded-lg border bg-slate-950 p-4 text-xs leading-6 text-white">{JSON.stringify(maintenanceResult, null, 2)}</pre>}
        </div>
      )}

      {activeTab === "tables" && (
        <SimpleTable headers={["اسم الجدول", "التصنيف", "عدد السجلات", "الحجم", "الوصف"]} rows={tables.map((table) => [table.table_name, table.category, table.records_count, `${table.size_mb || 0} MB`, table.description])} />
      )}

      {activeTab === "activity" && (
        <SimpleTable headers={["الإجراء", "المستخدم", "التاريخ", "عنوان IP", "النتيجة", "التفاصيل"]} rows={activity.map((item) => [databaseActionLabel(item.action), item.user || "-", formatDateTime(item.created_at), item.ip_address || "-", item.result, JSON.stringify(item.details || {})])} />
      )}

      {activeTab === "settings" && backupSettings && (
        <form onSubmit={saveBackupSettings} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Toggle label="تفعيل النسخ الاحتياطي التلقائي" checked={Boolean(backupSettings.auto_backup_enabled)} onChange={(value) => setBackupSettings({ ...backupSettings, auto_backup_enabled: value })} />
            <Toggle label="تضمين المرفقات" checked={Boolean(backupSettings.include_uploads)} onChange={(value) => setBackupSettings({ ...backupSettings, include_uploads: value })} />
            <Toggle label="ضغط النسخ" checked={Boolean(backupSettings.compress_backups)} onChange={(value) => setBackupSettings({ ...backupSettings, compress_backups: value })} />
            <Toggle label="تشفير النسخ" checked={Boolean(backupSettings.encrypt_backups)} onChange={(value) => setBackupSettings({ ...backupSettings, encrypt_backups: value })} />
            <Toggle label="إشعار عند فشل النسخ" checked={Boolean(backupSettings.notify_on_failure)} onChange={(value) => setBackupSettings({ ...backupSettings, notify_on_failure: value })} />
            <LabeledInput label="وقت النسخ الاحتياطي" type="time" value={backupSettings.backup_time || "02:00"} onChange={(event) => setBackupSettings({ ...backupSettings, backup_time: event.target.value })} />
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              التكرار
              <select value={backupSettings.frequency || "daily"} onChange={(event) => setBackupSettings({ ...backupSettings, frequency: event.target.value })} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3">
                <option value="daily">يومي</option>
                <option value="weekly">أسبوعي</option>
                <option value="monthly">شهري</option>
              </select>
            </label>
            <LabeledInput label="عدد النسخ المحتفظ بها" type="number" min="1" max="365" value={backupSettings.retention_count || 7} onChange={(event) => setBackupSettings({ ...backupSettings, retention_count: event.target.value })} />
            <LabeledInput label="مسار حفظ النسخ" value={backupSettings.backup_location || "backups"} onChange={(event) => setBackupSettings({ ...backupSettings, backup_location: event.target.value })} />
          </div>
          <Button type="submit" disabled={busy === "backup-settings"} className="mt-4">{busy === "backup-settings" ? "جاري الحفظ..." : "حفظ الإعدادات"}</Button>
        </form>
      )}
    </div>
  );
}

function WarningBox({ title, text }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-amber-700" />
        <div>
          <h4 className="font-bold text-slate-950">{title}</h4>
          <p className="mt-1 text-sm leading-6 text-slate-600">{text}</p>
        </div>
      </div>
    </div>
  );
}

function DangerBox({ title, text }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50/70 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-red-700" />
        <div>
          <h4 className="font-bold text-red-950">{title}</h4>
          <p className="mt-1 text-sm leading-6 text-red-700">{text}</p>
        </div>
      </div>
    </div>
  );
}

function databaseStatusLabel(value) {
  const labels = {
    healthy: "سليمة",
    warning: "تحذير",
    critical: "حرجة",
    ready: "جاهزة",
    corrupted: "تالفة",
    deleted: "محذوفة",
    deleted_by_retention: "محذوفة بسياسة الاحتفاظ",
    success: "ناجحة",
    failed: "فاشلة",
    running: "قيد التنفيذ",
    pending: "بانتظار التنفيذ",
    validated: "تم التحقق"
  };
  return labels[value] || value || "-";
}

function databaseJobLabel(value) {
  const labels = { backup: "نسخ احتياطي", restore: "استعادة", reset: "إعادة ضبط", maintenance: "صيانة", migration: "ترحيلات" };
  return labels[value] || value || "-";
}

function databaseActionLabel(value) {
  const labels = {
    database_status_viewed: "عرض حالة قاعدة البيانات",
    backup_created: "إنشاء نسخة احتياطية",
    backup_downloaded: "تنزيل نسخة احتياطية",
    backup_verified: "التحقق من نسخة احتياطية",
    backup_deleted: "حذف نسخة احتياطية",
    restore_validated: "التحقق من الاستعادة",
    restore_started: "بدء الاستعادة",
    restore_completed: "اكتمال الاستعادة",
    reset_preview_viewed: "عرض معاينة إعادة الضبط",
    reset_completed: "تنفيذ إعادة الضبط",
    maintenance_run: "تنفيذ صيانة",
    migration_run: "تشغيل ترحيلات",
    backup_settings_saved: "حفظ إعدادات النسخ"
  };
  return labels[value] || value || "-";
}

function UpdateManagementSettings({ notify }) {
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState({ updates: [], migrations: [] });
  const [busy, setBusy] = useState("");

  async function load() {
    try {
      const [statusResponse, historyResponse] = await Promise.all([
        api.get("/updates/status"),
        api.get("/updates/history")
      ]);
      setStatus(statusResponse.data);
      setHistory(historyResponse.data);
    } catch (error) {
      notify(getErrorMessage(error), "error");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function checkUpdates() {
    setBusy("check");
    try {
      const { data } = await api.post("/updates/check");
      setStatus(data);
      notify(data.update_available ? "يوجد تحديث جاهز للمراجعة" : "النظام محدّث ولا توجد تحديثات معلقة");
      await load();
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setBusy("");
    }
  }

  async function applyUpdate() {
    if (!window.confirm("سيتم تنفيذ تحديثات قاعدة البيانات المعلقة وتسجيل رقم الإصدار. هل تريد المتابعة؟")) return;
    setBusy("apply");
    try {
      const { data } = await api.post("/updates/apply");
      notify(data.message || "تم تنفيذ التحديث بنجاح");
      await load();
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setBusy("");
    }
  }

  const updates = history.updates || [];
  const migrations = history.migrations || [];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h4 className="font-bold text-slate-950">مسار الإنتاج: Git + Docker</h4>
          <p className="mt-1 text-sm leading-6 text-slate-600">للخادم الرئيسي المتصل بالمستودع: اسحب الكود، أعد بناء Docker، ثم نفّذ التحديث من هذه الصفحة.</p>
        </div>
        <div className="rounded-lg border border-bank-100 bg-bank-50/70 p-4">
          <h4 className="font-bold text-slate-950">المسار المحلي: ZIP</h4>
          <p className="mt-1 text-sm leading-6 text-slate-600">للخادم الداخلي: ارفع حزمة ZIP من تبويب التحديث المحلي، أعد التشغيل، ثم نفّذ migrations من هنا.</p>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <MetricBox label="الإصدار الحالي" value={status?.current_version || "-"} />
        <MetricBox label="آخر إصدار متاح" value={status?.latest_version || "-"} />
        <MetricBox label="حالة النظام" value={status?.system_status || "-"} />
        <MetricBox label="آخر تحديث" value={formatDateTime(status?.last_update?.finished_at || status?.last_update?.started_at)} />
      </div>

      <div className={`rounded-lg border p-4 ${status?.update_available ? "border-amber-200 bg-amber-50/70" : "border-emerald-200 bg-emerald-50/70"}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            {status?.update_available ? <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-amber-700" /> : <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-emerald-700" />}
            <div>
              <h4 className="font-bold text-slate-950">{status?.update_available ? "يوجد تحديث أو migration معلّق" : "النظام محدّث"}</h4>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                مجلد التحديثات: {status?.updates_dir || "updates"} - التحديثات المعلقة: {(status?.pending_migrations || []).length}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={checkUpdates} disabled={Boolean(busy)} className="gap-2 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
              <RefreshCw className={`h-4 w-4 ${busy === "check" ? "animate-spin" : ""}`} /> فحص التحديثات
            </Button>
            <Button type="button" onClick={applyUpdate} disabled={Boolean(busy) || !status?.update_available} className="gap-2">
              <PackageCheck className="h-4 w-4" /> {busy === "apply" ? "جاري التنفيذ..." : "تنفيذ التحديث"}
            </Button>
          </div>
        </div>
      </div>

      {(status?.pending_migrations || []).length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="mb-3 flex items-center gap-2 font-bold text-slate-950"><History className="h-4 w-4" /> تحديثات قاعدة البيانات المعلقة</h4>
          <SimpleTable
            headers={["Migration", "الإصدار", "Checksum"]}
            rows={(status.pending_migrations || []).map((item) => [item.migration_id, item.version, String(item.checksum || "").slice(0, 12)])}
          />
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h4 className="mb-3 font-bold text-slate-950">سجل التحديثات</h4>
        <SimpleTable
          headers={["من إصدار", "إلى إصدار", "الحالة", "الرسالة", "وقت التنفيذ"]}
          rows={updates.map((item) => [item.from_version || "-", item.to_version, item.status, item.message || "-", formatDateTime(item.finished_at || item.started_at)])}
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h4 className="mb-3 font-bold text-slate-950">سجل migrations المنفذة</h4>
        <SimpleTable
          headers={["Migration", "الإصدار", "الحالة", "الزمن", "التاريخ"]}
          rows={migrations.map((item) => [item.migration_id, item.version, item.status, item.execution_ms ? `${item.execution_ms} ms` : "-", formatDateTime(item.applied_at)])}
        />
      </div>
    </div>
  );
}

function LocalUpdateSettings({ notify }) {
  const [status, setStatus] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [preflightBusy, setPreflightBusy] = useState("");
  const [applyBusy, setApplyBusy] = useState("");
  const [restartBusy, setRestartBusy] = useState(false);
  const [preflightResult, setPreflightResult] = useState(null);
  const [applyResult, setApplyResult] = useState(null);

  async function loadStatus() {
    try {
      setStatus((await api.get("/settings/local-updates/status")).data);
    } catch (error) {
      notify(getErrorMessage(error), "error");
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function uploadPackage(event) {
    event.preventDefault();
    if (!file) {
      notify("اختر ملف التحديث أولًا.", "error");
      return;
    }

    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const { data } = await api.post("/settings/local-updates/upload", body, { headers: { "Content-Type": "multipart/form-data" } });
      setFile(null);
      notify(`تم رفع حزمة التحديث وفحصها بنجاح. النسخة: ${data.version || "غير محدد"}`);
      await loadStatus();
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function runPreflight(item) {
    setPreflightBusy(item.id);
    setPreflightResult(null);
    try {
      const { data } = await api.post(`/settings/local-updates/${item.id}/preflight`);
      setPreflightResult(data);
      notify(data.ready ? "الحزمة جاهزة للتطبيق" : data.summary, data.ready ? "success" : "error");
      await loadStatus();
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setPreflightBusy("");
    }
  }

  async function applyPackage(item) {
    if (!window.confirm("سيتم تطبيق ملفات التحديث بدون إعادة تشغيل تلقائي. تم حفظ نسخة احتياطية؟")) return;
    setApplyBusy(item.id);
    setApplyResult(null);
    try {
      const { data } = await api.post(`/settings/local-updates/${item.id}/apply`);
      setApplyResult(data);
      notify("تم تطبيق ملفات التحديث. أعد تشغيل النظام يدويًا لتفعيل التغييرات.");
      await loadStatus();
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setApplyBusy("");
    }
  }

  async function restartBackend() {
    if (!window.confirm("سيتم إعادة تشغيل خدمة الباكند الآن. قد يتوقف النظام لعدة ثوان. هل تريد المتابعة؟")) return;
    setRestartBusy(true);
    try {
      const { data } = await api.post("/settings/local-updates/restart");
      notify(data.message || "تم إرسال أمر إعادة التشغيل");
      window.setTimeout(() => {
        window.location.reload();
      }, 6000);
    } catch (error) {
      notify(getErrorMessage(error), "error");
      setRestartBusy(false);
    }
  }

  const packages = status?.packages || [];
  const needsRestart = packages.some((item) => String(item.status || "").includes("بانتظار إعادة التشغيل")) || Boolean(applyResult?.restart_required);

  return (
    <div className="min-w-0 space-y-5">
      <div className="min-w-0 rounded-lg border border-bank-100 bg-bank-50/70 p-4">
        <h4 className="font-bold text-slate-950">رفع حزمة تحديث محلية</h4>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          هذا المسار مخصص للسيرفر الداخلي أو بدون اتصال GitHub. ارفع حزمة ZIP مبنية من السكربت، ثم افحصها وطبّقها وأعد التشغيل، وبعدها نفّذ migrations من إدارة التحديثات.
        </p>
        <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-3">
          <MetricBox label="الصيغة المطلوبة" value="ZIP" />
          <MetricBox label="الحجم الأقصى" value={formatBytes(status?.max_size_bytes || 0)} />
          <MetricBox label="المجلدات المطلوبة" value={(status?.required_roots || ["backend", "frontend", "scripts"]).join(" / ")} />
        </div>
      </div>

      <form onSubmit={uploadPackage} className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
          <input
            type="file"
            accept=".zip,application/zip"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            className="h-10 min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          <Button type="button" onClick={loadStatus} disabled={busy} className="gap-2 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
            <RefreshCw className="h-4 w-4" /> تحديث القائمة
          </Button>
          <Button type="submit" disabled={busy} className="gap-2">
            <Upload className="h-4 w-4" /> {busy ? "جاري الرفع..." : "رفع وفحص"}
          </Button>
        </div>
      </form>

      <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
          <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-amber-700" />
          <div>
            <h4 className="font-bold text-slate-950">ملاحظة مهمة</h4>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              تطبيق التحديث يستبدل الملفات فقط ولا ينفذ migrations مباشرة. بعد إعادة التشغيل افتح إدارة التحديثات واضغط فحص التحديثات ثم تنفيذ التحديث.
            </p>
          </div>
          </div>
          <Button type="button" onClick={restartBackend} disabled={restartBusy || !needsRestart} className="gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${restartBusy ? "animate-spin" : ""}`} />
            {restartBusy ? "جاري إعادة التشغيل..." : "إعادة تشغيل الباكند"}
          </Button>
        </div>
      </div>

      <div className="max-w-full overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-50 text-xs font-bold text-slate-600">
            <tr>
              <th className="p-3 text-right">الملف</th>
              <th className="p-3 text-right">النسخة</th>
              <th className="p-3 text-right">وقت الرفع</th>
              <th className="p-3 text-right">الحجم</th>
              <th className="p-3 text-right">عدد الملفات</th>
              <th className="p-3 text-right">الحالة</th>
              <th className="p-3 text-right">الإجراء</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {packages.map((item) => (
              <tr key={item.id}>
                <td className="p-3 font-semibold text-slate-900">{item.original_filename}</td>
                <td className="p-3 text-slate-700">{item.version || "غير محدد"}</td>
                <td className="p-3 text-slate-600">{formatDateTime(item.uploaded_at)}</td>
                <td className="p-3 text-slate-600">{formatBytes(item.compressed_size_bytes || 0)}</td>
                <td className="p-3 text-slate-600">{item.files_count || 0}</td>
                <td className="p-3"><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">{item.status || "جاهز"}</span></td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => runPreflight(item)} disabled={Boolean(preflightBusy) || Boolean(applyBusy)} className="h-9 gap-2 border border-slate-300 bg-white px-3 text-xs text-slate-700 hover:bg-slate-50">
                      <RefreshCw className={`h-3.5 w-3.5 ${preflightBusy === item.id ? "animate-spin" : ""}`} />
                      {preflightBusy === item.id ? "جاري الفحص..." : "فحص قابلية التطبيق"}
                    </Button>
                    <Button type="button" onClick={() => applyPackage(item)} disabled={Boolean(preflightBusy) || Boolean(applyBusy) || !item.last_preflight?.ready} className="h-9 gap-2 bg-amber-700 px-3 text-xs hover:bg-amber-800 disabled:opacity-50">
                      <Upload className="h-3.5 w-3.5" />
                      {applyBusy === item.id ? "جاري التطبيق..." : "تطبيق التحديث"}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {packages.length === 0 && (
              <tr>
                <td colSpan="7" className="p-5 text-center text-sm text-slate-500">لا توجد حزم تحديث مرفوعة حتى الآن.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {preflightResult && (
        <div className={`rounded-lg border p-4 ${preflightResult.ready ? "border-emerald-200 bg-emerald-50/70" : "border-red-200 bg-red-50/70"}`}>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h4 className={`font-bold ${preflightResult.ready ? "text-emerald-900" : "text-red-900"}`}>{preflightResult.summary}</h4>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                النسخة: {preflightResult.version || "غير محدد"} - الملفات: {preflightResult.files_count || 0} - الحجم بعد الفك: {formatBytes(preflightResult.uncompressed_size_bytes || 0)}
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${preflightResult.ready ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
              {preflightResult.ready ? "جاهزة" : "غير جاهزة"}
            </span>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {(preflightResult.checks || []).map((check) => (
              <div key={check.name} className="rounded-md border border-white/80 bg-white p-3">
                <p className={`text-sm font-bold ${check.passed ? "text-emerald-800" : "text-red-800"}`}>{check.passed ? "نجح" : "لم ينجح"} - {check.name}</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">{check.message}</p>
              </div>
            ))}
          </div>
          {(preflightResult.warnings || []).length > 0 && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {preflightResult.warnings.join(" ")}
            </div>
          )}
        </div>
      )}

      {applyResult && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4">
          <h4 className="font-bold text-emerald-900">تم تطبيق التحديث بدون إعادة تشغيل تلقائي</h4>
          <p className="mt-1 text-sm leading-6 text-slate-600">{applyResult.message}</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <MetricBox label="النسخة" value={applyResult.version || "غير محدد"} />
            <MetricBox label="مسار rollback" value={applyResult.rollback_path || "-"} />
            <MetricBox label="نسخة قاعدة البيانات" value={applyResult.database_backup || "-"} />
          </div>
          {(applyResult.next_steps || []).length > 0 && (
            <div className="mt-3 rounded-md border border-emerald-200 bg-white p-3 text-sm text-slate-700">
              <p className="mb-2 font-bold text-slate-950">الخطوات التالية</p>
              <div className="flex flex-wrap gap-2">
                {applyResult.next_steps.map((step) => (
                  <span key={step} className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">{step}</span>
                ))}
              </div>
            </div>
          )}
          <div className="mt-4 flex justify-end">
            <Button type="button" onClick={restartBackend} disabled={restartBusy} className="gap-2 bg-slate-900 hover:bg-slate-800">
              <RefreshCw className={`h-4 w-4 ${restartBusy ? "animate-spin" : ""}`} />
              {restartBusy ? "جاري إعادة التشغيل..." : "إعادة تشغيل الباكند الآن"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SimpleError({ error }) { return error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p> : null; }
function SimpleTable({ headers, rows }) { return <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[680px] text-sm"><thead className="bg-slate-50"><tr>{headers.map((h) => <th key={h} className="p-3 text-right">{h}</th>)}</tr></thead><tbody className="divide-y">{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="p-3">{c}</td>)}</tr>)}</tbody></table></div>; }
function EmailField({ label, value, onChange, type = "text" }) { return <label className="block space-y-2 text-sm font-medium text-slate-700">{label}<Input type={type} value={value ?? ""} onChange={(event) => onChange(event.target.value)} /></label>; }
function Toggle({ label, checked, onChange }) { return <label className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-bank-700" /></label>; }
function LabeledInput({ label, ...props }) { return <label className="block space-y-2 text-sm font-medium text-slate-700">{label}<Input {...props} /></label>; }
function MetricBox({ label, value }) { return <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-2 break-words text-lg font-black text-slate-950">{value}</p></div>; }
function formatBytes(value) { if (!value) return "0 B"; const units = ["B", "KB", "MB", "GB"]; const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1); return `${(value / Math.pow(1024, index)).toFixed(index ? 1 : 0)} ${units[index]}`; }
function formatDateTime(value) { return formatSystemDateTime(value); }
