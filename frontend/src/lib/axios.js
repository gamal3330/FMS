import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1"
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("qib_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401 && localStorage.getItem("qib_token")) {
      localStorage.removeItem("qib_token");
      window.dispatchEvent(new Event("qib-session-ended"));
    }
    return Promise.reject(error);
  }
);

export function getErrorMessage(error) {
  if (!error?.response) {
    return error?.message || "تعذر الاتصال بالخادم. تحقق من تشغيل النظام ثم حاول مرة أخرى.";
  }

  const detail = error?.response?.data?.detail;
  const data = error?.response?.data;

  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") return item;

        const fieldName = Array.isArray(item?.loc)
          ? item.loc.filter((part) => part !== "body").join(".")
          : "";
        const message = item?.msg || "قيمة غير صحيحة";

        return fieldName ? `${fieldName}: ${message}` : message;
      })
      .join("\n");
  }

  if (typeof detail === "string") return detail;

  if (detail && typeof detail === "object") {
    return detail.message || detail.msg || JSON.stringify(detail);
  }

  if (typeof data === "string" && data.trim()) {
    return data;
  }

  if (data && typeof data === "object") {
    return data.message || data.msg || data.error || JSON.stringify(data);
  }

  if (error?.response?.status) {
    return `تعذر تنفيذ العملية. رمز الخطأ: ${error.response.status}`;
  }

  return "تعذر تنفيذ العملية. يرجى المحاولة مرة أخرى.";
}
