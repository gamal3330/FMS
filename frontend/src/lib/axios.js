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

export function getErrorMessage(error) {
  const detail = error?.response?.data?.detail;

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

  return "تعذر تنفيذ العملية. يرجى المحاولة مرة أخرى.";
}
