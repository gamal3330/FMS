import { useEffect, useState } from "react";
import { api, getErrorMessage } from "../../lib/axios";
import { applyBranding } from "../../lib/branding";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const defaults = {
  system_name: "",
  language: "ar",
  session_timeout_minutes: 60,
  upload_max_file_size_mb: 10,
  allowed_file_extensions: "pdf,docx,xlsx,png,jpg",
  logo_url: "",
  brand_color: "#0d6337"
};

export default function GeneralSettings({ notify }) {
  const [form, setForm] = useState(defaults);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    try {
      const { data } = await api.get("/settings/general-profile");
      setForm(data);
      applyLocalSettings(data);
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
    try {
      const { data } = await api.put("/settings/general-profile", {
        ...form,
        language: "ar",
        session_timeout_minutes: Number(form.session_timeout_minutes),
        upload_max_file_size_mb: Number(form.upload_max_file_size_mb)
      });
      setForm(data);
      applyLocalSettings(data);
      notify("تم حفظ الإعدادات العامة");
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    }
  }

  async function uploadLogo(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const { data } = await api.post("/settings/general-profile/logo", body, { headers: { "Content-Type": "multipart/form-data" } });
      setForm(data);
      applyLocalSettings(data);
      notify("تم رفع شعار النظام بنجاح");
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    } finally {
      setUploadingLogo(false);
      event.target.value = "";
    }
  }

  return (
    <form onSubmit={save} className="grid gap-4 text-right md:grid-cols-2" dir="rtl">
      <Field label="اسم النظام" value={form.system_name} onChange={(value) => setForm({ ...form, system_name: value })} />
      <label className="block space-y-2 text-sm font-medium text-slate-700">
        لون هوية النظام HEX
        <div className="grid grid-cols-[56px_1fr] gap-2">
          <input type="color" value={form.brand_color || "#0d6337"} onChange={(event) => setForm({ ...form, brand_color: event.target.value })} className="h-10 w-full rounded-md border border-slate-300 bg-white p-1" />
          <Input value={form.brand_color || "#0d6337"} onChange={(event) => setForm({ ...form, brand_color: event.target.value })} pattern="^#[0-9A-Fa-f]{6}$" required className="ltr-value" />
        </div>
      </label>
      <label className="block space-y-2 text-sm font-medium text-slate-700">
        لغة النظام
        <select value="ar" disabled className="h-10 w-full rounded-md border border-slate-300 bg-slate-50 px-3 text-sm">
          <option value="ar">العربية</option>
        </select>
      </label>
      <Field label="مهلة الجلسة بالدقائق" type="number" value={form.session_timeout_minutes} onChange={(value) => setForm({ ...form, session_timeout_minutes: value })} />
      <Field label="الحد الأقصى لحجم المرفق بالميجابايت" type="number" value={form.upload_max_file_size_mb} onChange={(value) => setForm({ ...form, upload_max_file_size_mb: value })} />
      <div className="md:col-span-2">
        <Field label="امتدادات الملفات المسموحة" value={form.allowed_file_extensions} onChange={(value) => setForm({ ...form, allowed_file_extensions: value })} />
      </div>
      <div className="md:col-span-2 rounded-md border border-slate-200 bg-white p-4">
        <p className="text-sm font-bold text-slate-700">شعار النظام</p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          {form.logo_url ? (
            <img src={resolveAssetUrl(form.logo_url)} alt="شعار النظام" className="h-16 w-auto max-w-[160px] object-contain" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-md border border-dashed border-slate-300 text-xs text-slate-400">Logo</div>
          )}
          <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            {uploadingLogo ? "جاري الرفع..." : "رفع شعار"}
            <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={uploadLogo} disabled={uploadingLogo} className="hidden" />
          </label>
        </div>
      </div>
      {error && <p className="md:col-span-2 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex gap-3 md:col-span-2">
        <Button type="submit">حفظ</Button>
        <button type="button" onClick={() => { setForm(defaults); applyLocalSettings(defaults); }} className="h-10 rounded-md border border-slate-300 px-4 text-sm font-semibold">إعادة ضبط</button>
      </div>
    </form>
  );
}

function applyLocalSettings(settings) {
  applyBranding({
    system_name: settings.system_name || defaults.system_name,
    logo_url: settings.logo_url || null,
    brand_color: settings.brand_color || defaults.brand_color
  });
  document.documentElement.lang = "ar";
  document.documentElement.dir = "rtl";
  document.body.dir = "rtl";
}

function resolveAssetUrl(url) {
  if (!url) return "";
  if (/^https?:\/\//.test(url)) return url;
  return `${api.defaults.baseURL?.replace(/\/api\/v1\/?$/, "")}${url}`;
}

function Field({ label, value, onChange, type = "text" }) {
  return (
    <label className="block space-y-2 text-sm font-medium text-slate-700">
      {label}
      <Input type={type} value={value ?? ""} onChange={(event) => onChange(event.target.value)} required />
    </label>
  );
}
