const DEFAULT_BRAND_COLOR = "#0d6337";

export function applyBranding(settings: { system_name?: string; logo_url?: string | null; brand_color?: string | null }) {
  if (settings.system_name) {
    localStorage.setItem("qib_system_name", settings.system_name);
    document.title = settings.system_name;
  }
  if (settings.logo_url) localStorage.setItem("qib_logo_url", settings.logo_url);
  else if ("logo_url" in settings) localStorage.removeItem("qib_logo_url");
  applyBrandColor(settings.brand_color || localStorage.getItem("qib_brand_color") || DEFAULT_BRAND_COLOR);
  window.dispatchEvent(new Event("qib-settings-updated"));
}

export function applyBrandColor(hex: string) {
  const normalized = /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : DEFAULT_BRAND_COLOR;
  localStorage.setItem("qib_brand_color", normalized);
  const root = document.documentElement;
  root.style.setProperty("--bank-50", hexToRgbString(mixWithWhite(normalized, 0.93)));
  root.style.setProperty("--bank-100", hexToRgbString(mixWithWhite(normalized, 0.82)));
  root.style.setProperty("--bank-600", hexToRgbString(mixWithWhite(normalized, 0.08)));
  root.style.setProperty("--bank-700", hexToRgbString(normalized));
  root.style.setProperty("--bank-900", hexToRgbString(mixWithBlack(normalized, 0.45)));
}

function hexToRgbString(hex: string) {
  const value = hex.replace("#", "");
  return `${parseInt(value.slice(0, 2), 16)} ${parseInt(value.slice(2, 4), 16)} ${parseInt(value.slice(4, 6), 16)}`;
}

function mixWithWhite(hex: string, amount: number) {
  return mix(hex, "#ffffff", amount);
}

function mixWithBlack(hex: string, amount: number) {
  return mix(hex, "#000000", amount);
}

function mix(first: string, second: string, amount: number) {
  const a = first.replace("#", "");
  const b = second.replace("#", "");
  const channels = [0, 2, 4].map((index) => {
    const firstValue = parseInt(a.slice(index, index + 2), 16);
    const secondValue = parseInt(b.slice(index, index + 2), 16);
    return Math.round(firstValue * (1 - amount) + secondValue * amount).toString(16).padStart(2, "0");
  });
  return `#${channels.join("")}`;
}
