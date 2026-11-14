export const STORAGE_KEY = ["mizu", "start", "state", "v1"].join(".");

export const ENGINES = {
  google: { name: "Google", searchUrl: "https://www.google.com/search?q=" },
  bing: { name: "Bing", searchUrl: "https://www.bing.com/search?q=" },
  baidu: { name: "百度", searchUrl: "https://www.baidu.com/s?wd=" },
  duckduckgo: { name: "DuckDuckGo", searchUrl: "https://duckduckgo.com/?q=" }
};

export const PRESETS = [
  { id: "dawn", name: "晨光" },
  { id: "mist", name: "薄雾" },
  { id: "dusk", name: "暮色" },
  { id: "paper", name: "纸白" }
];

export const DEFAULT_LINKS = [
  {
    id: "apple",
    title: "Apple",
    url: "https://www.apple.com.cn/",
    icon: "assets/icon-apple.png"
  },
  {
    id: "icloud",
    title: "iCloud",
    url: "https://www.icloud.com/",
    icon: "assets/icon-icloud.png"
  },
  {
    id: "google",
    title: "Google",
    url: "https://www.google.com/",
    icon: "assets/icon-google.png"
  },
  {
    id: "baidu",
    title: "百度",
    url: "https://www.baidu.com/",
    icon: "assets/icon-baidu.png"
  },
  {
    id: "github",
    title: "GitHub",
    url: "https://github.com/",
    icon: "assets/icon-github.svg"
  },
  {
    id: "bilibili",
    title: "哔哩哔哩",
    url: "https://www.bilibili.com/",
    icon: "assets/icon-bilibili.png"
  },
  {
    id: "zhihu",
    title: "知乎",
    url: "https://www.zhihu.com/",
    icon: "assets/icon-zhihu.png"
  },
  {
    id: "qqmail",
    title: "QQ邮箱",
    url: "https://mail.qq.com/",
    icon: "assets/icon-qqmail.png"
  }
];

export const DEFAULT_SETTINGS = {
  engine: "google",
  wallpaper: { type: "preset", value: "dawn", tone: "dark" },
  overlay: 18,
  blur: 0,
  showLabels: true,
  iconSize: 72,
  iconGap: 16,
  columns: 12
};

function cloneDefaultLinks() {
  return DEFAULT_LINKS.map((link) => ({ ...link }));
}

export function createDefaultState() {
  return {
    version: 1,
    links: cloneDefaultLinks(),
    settings: {
      ...DEFAULT_SETTINGS,
      wallpaper: { ...DEFAULT_SETTINGS.wallpaper }
    }
  };
}

export function makeId() {
  return globalThis.crypto?.randomUUID?.() ||
    `link-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeIconText(value) {
  const source = String(value || "").trim();
  if (!source) return "";

  const characters = [...source];
  const first = characters.find((character) => /[\p{L}\p{N}]/u.test(character));
  if (!first) return characters[0] || "";
  if (/\p{Script=Han}/u.test(first)) return first;

  const letters = source.match(/[\p{L}\p{N}]/gu) || [];
  return letters.slice(0, 2).join("") || first;
}

export function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  let candidate = raw;
  if (!/^[a-z][a-z\d+.-]*:/i.test(candidate)) {
    candidate = /^(localhost|127(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#].*)?$/i.test(candidate)
      ? `http://${candidate}`
      : `https://${candidate}`;
  }

  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (!url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function looksLikeAddress(value) {
  if (/\s/.test(value)) return false;
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return true;
  return /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|(?:[\w-]+\.)+[a-z]{2,})(?::\d+)?(?:[/?#].*)?$/i.test(value);
}

function normalizeLink(link) {
  if (!link || typeof link !== "object") return null;
  const url = normalizeUrl(link.url);
  const title = String(link.title || "").trim().slice(0, 36);
  if (!url || !title) return null;

  const id = String(link.id || makeId());
  let icon = typeof link.icon === "string" &&
    (/^https?:\/\//i.test(link.icon) ||
      /^data:image\//i.test(link.icon) ||
      /^assets\/[\w./-]+$/i.test(link.icon))
    ? link.icon
    : "";
  if (!icon) {
    const defaultLink = DEFAULT_LINKS.find((item) => item.id === id);
    if (defaultLink?.icon) {
      try {
        if (new URL(defaultLink.url).hostname === new URL(url).hostname) {
          icon = defaultLink.icon;
        }
      } catch {
        // Keep the generated icon fallback.
      }
    }
  }

  return {
    id,
    title,
    url,
    ...(link.iconMode === "text" ? { iconMode: "text" } : {}),
    ...(link.iconMode === "text" && normalizeIconText(link.iconText)
      ? { iconText: normalizeIconText(link.iconText) }
      : {}),
    ...(icon ? { icon } : {})
  };
}

export function normalizeState(raw) {
  const fallback = createDefaultState();
  if (!raw || typeof raw !== "object") return fallback;

  const links = Array.isArray(raw.links)
    ? raw.links.map(normalizeLink).filter(Boolean)
    : fallback.links;

  const rawSettings = raw.settings && typeof raw.settings === "object"
    ? raw.settings
    : {};
  const rawIconSize = Number(rawSettings.iconSize);
  const rawIconGap = Number(rawSettings.iconGap);
  const rawColumns = Number(rawSettings.columns);
  const rawWallpaper = rawSettings.wallpaper && typeof rawSettings.wallpaper === "object"
    ? rawSettings.wallpaper
    : DEFAULT_SETTINGS.wallpaper;

  let wallpaper = {
    type: "preset",
    value: "dawn",
    tone: "dark"
  };

  if (rawWallpaper.type === "image" &&
      typeof rawWallpaper.value === "string" &&
      rawWallpaper.value.startsWith("data:image/")) {
    wallpaper = {
      type: "image",
      value: rawWallpaper.value,
      tone: rawWallpaper.tone === "light" ? "light" : "dark"
    };
  } else if (rawWallpaper.type === "preset" &&
             PRESETS.some((preset) => preset.id === rawWallpaper.value)) {
    wallpaper = {
      type: "preset",
      value: rawWallpaper.value,
      tone: rawWallpaper.value === "paper" ? "light" : "dark"
    };
  }

  return {
    version: 1,
    links,
    settings: {
      engine: Object.hasOwn(ENGINES, rawSettings.engine)
        ? rawSettings.engine
        : DEFAULT_SETTINGS.engine,
      wallpaper,
      overlay: clamp(Number(rawSettings.overlay ?? DEFAULT_SETTINGS.overlay), 0, 60),
      blur: clamp(Number(rawSettings.blur ?? DEFAULT_SETTINGS.blur), 0, 24),
      showLabels: rawSettings.showLabels !== false,
      iconSize: Number.isFinite(rawIconSize)
        ? clamp(rawIconSize, 48, 88)
        : DEFAULT_SETTINGS.iconSize,
      iconGap: Number.isFinite(rawIconGap)
        ? clamp(rawIconGap, 4, 40)
        : DEFAULT_SETTINGS.iconGap,
      columns: Number.isFinite(rawColumns)
        ? clamp(Math.round(rawColumns), 4, 16)
        : DEFAULT_SETTINGS.columns
    }
  };
}
