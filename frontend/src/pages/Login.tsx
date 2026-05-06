import { FormEvent, useEffect, useState } from "react";
import { Eye, EyeOff, Landmark, LockKeyhole } from "lucide-react";
import { API_BASE } from "../lib/api";
import { applyBrandColor, applyBranding, applyStoredFavicon } from "../lib/branding";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

type PublicProfile = {
  system_name?: string;
  logo_url?: string | null;
  brand_color?: string | null;
  login_identifier_mode?: "email" | "employee_id" | "email_or_employee_id";
};

export function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [systemName, setSystemName] = useState(() => localStorage.getItem("qib_system_name") || "");
  const [logoUrl, setLogoUrl] = useState(() => localStorage.getItem("qib_logo_url") || "");
  const [email, setEmail] = useState("admin@qib.internal-bank.qa");
  const [loginIdentifierMode, setLoginIdentifierMode] = useState<PublicProfile["login_identifier_mode"]>("email_or_employee_id");
  const [password, setPassword] = useState("Admin@12345");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = systemName;
  }, [systemName]);

  useEffect(() => {
    applyBrandColor(localStorage.getItem("qib_brand_color") || "#0d6337");
    applyStoredFavicon();
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/settings/public-profile`)
      .then((response) => (response.ok ? response.json() : null))
      .then((profile: PublicProfile | null) => {
        if (!profile) return;
        applyBranding(profile);
        if (profile.system_name) setSystemName(profile.system_name);
        setLogoUrl(profile.logo_url || "");
        setLoginIdentifierMode(profile.login_identifier_mode || "email_or_employee_id");
        if (profile.brand_color) applyBrandColor(profile.brand_color);
      })
      .catch(() => undefined);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        setError(await readLoginError(response));
        return;
      }

      const data = await response.json();
      onLogin(data.access_token);
    } catch {
      setError("الخدمة غير متاحة حالياً. يرجى المحاولة لاحقاً.");
    } finally {
      setIsLoading(false);
    }
  }

  const identifierLabel = loginIdentifierMode === "employee_id" ? "الرقم الوظيفي" : loginIdentifierMode === "email" ? "البريد الإلكتروني" : "البريد الإلكتروني أو الرقم الوظيفي";
  const identifierType = loginIdentifierMode === "employee_id" ? "text" : "text";
  const identifierAutocomplete = loginIdentifierMode === "employee_id" ? "username" : "email";

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950" dir="rtl">
      <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_480px]">
        <section className="relative hidden overflow-hidden bg-bank-900 lg:block">
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at 20% 20%, rgb(var(--bank-100) / .42), transparent 30%), linear-gradient(135deg, rgb(var(--bank-900)), rgb(var(--bank-700)) 58%, rgb(var(--bank-600)))"
            }}
          />
          <div className="relative flex h-full flex-col justify-between p-12 text-black">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-black/10 ring-1 ring-black/20">
                <Landmark className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-semibold text-black">QIB</p>
                <p className="text-sm text-black/75">{systemName}</p>
              </div>
            </div>

            <div className="max-w-3xl pb-6">
              <h1 className="text-5xl font-bold leading-tight">{systemName}</h1>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-black/80">
                منصة داخلية موحدة لاستقبال الطلبات، تتبع مراحل الاعتماد، مراقبة مؤشرات الخدمة، وتوثيق الأثر التشغيلي.
              </p>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center bg-white px-6 py-10">
          <form onSubmit={submit} className="w-full max-w-sm space-y-6">
            <div>
              {logoUrl ? (
                <img src={resolveAssetUrl(logoUrl)} alt="شعار النظام" className="mb-5 h-14 w-auto max-w-[180px] object-contain" />
              ) : (
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-md bg-bank-700 text-white">
                  <LockKeyhole className="h-6 w-6" />
                </div>
              )}
              <p className="text-sm font-semibold text-bank-700">{systemName}</p>
              <h2 className="mt-2 text-3xl font-bold text-slate-950">تسجيل الدخول</h2>
            </div>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              {identifierLabel}
              <Input value={email} onChange={(event) => setEmail(event.target.value)} type={identifierType} autoComplete={identifierAutocomplete} required />
            </label>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              كلمة المرور
              <div className="relative">
                <Input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  className="pl-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700">
                {error}
              </div>
            )}

            <Button className="w-full" type="submit" disabled={isLoading}>
              {isLoading ? "جاري التحقق..." : "دخول"}
            </Button>
          </form>
        </section>
      </div>
    </main>
  );
}

async function readLoginError(response: Response) {
  try {
    const data = await response.json();
    if (typeof data.detail === "string") return data.detail;
  } catch {
    return "تعذر تسجيل الدخول. يرجى التحقق من البريد الإلكتروني وكلمة المرور.";
  }
  return "تعذر تسجيل الدخول. يرجى التحقق من البريد الإلكتروني وكلمة المرور.";
}

function resolveAssetUrl(url: string) {
  if (!url) return "";
  if (/^https?:\/\//.test(url)) return url;
  return `${API_BASE.replace(/\/api\/v1\/?$/, "")}${url}`;
}
