export const STORAGE_KEY = ["mizu", "start", "state", "v1"].join(".");
export const BACKUP_FORMAT = "mizu-backup";
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_MAX_BYTES = 16 * 1024 * 1024;

const WALLPAPER_DATA_URL_PATTERN =
  /^data:image\/(?:png|jpe?g|webp|gif|avif);base64,[a-z0-9+/=]+$/i;

export const ENGINES = {
  google: { name: "Google", searchUrl: "https://www.google.com/search?q=" },
  bing: { name: "Bing", searchUrl: "https://www.bing.com/search?q=" },
  baidu: { name: "百度", searchUrl: "https://www.baidu.com/s?wd=" },
  duckduckgo: { name: "DuckDuckGo", searchUrl: "https://duckduckgo.com/?q=" }
};

export const PRESETS = [
  { id: "dawn", name: "默认", tone: "light" },
  { id: "mist", name: "薄雾", tone: "dark" },
  { id: "dusk", name: "暮色", tone: "dark" },
  { id: "paper", name: "纸白", tone: "light" }
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
  wallpaper: { type: "preset", value: "dawn", tone: "light" },
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

export function createBackup(state, appVersion) {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: String(appVersion || ""),
    state: normalizeState(state)
  };
}

export function parseBackup(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("备份文件内容无效");
  }
  if (raw.format !== BACKUP_FORMAT) {
    throw new Error("这不是 Mizu 备份文件");
  }
  if (raw.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(
      Number(raw.formatVersion) > BACKUP_FORMAT_VERSION
        ? "备份来自更新版本的 Mizu，请先更新扩展"
        : "备份文件版本不受支持"
    );
  }

  const rawState = raw.state;
  if (!rawState ||
      typeof rawState !== "object" ||
      Array.isArray(rawState) ||
      !Array.isArray(rawState.links) ||
      !rawState.settings ||
      typeof rawState.settings !== "object" ||
      Array.isArray(rawState.settings)) {
    throw new Error("备份中的收藏或设置数据不完整");
  }

  const state = normalizeState(rawState);
  if (state.links.length !== rawState.links.length) {
    throw new Error("备份中有无法识别的收藏数据");
  }
  if (rawState.settings.wallpaper?.type === "image" &&
      state.settings.wallpaper.type !== "image") {
    throw new Error("备份中的壁纸数据无效");
  }

  return {
    exportedAt: Number.isFinite(Date.parse(raw.exportedAt))
      ? new Date(raw.exportedAt).toISOString()
      : "",
    appVersion: String(raw.appVersion || "").slice(0, 32),
    state
  };
}

export function mergeStates(currentState, importedState) {
  const current = normalizeState(currentState);
  const imported = normalizeState(importedState);
  const urls = new Set(current.links.map((link) => link.url));
  const ids = new Set(current.links.map((link) => link.id));
  const additions = [];

  for (const link of imported.links) {
    if (urls.has(link.url)) continue;
    urls.add(link.url);

    let id = link.id;
    while (ids.has(id)) id = makeId();
    ids.add(id);
    additions.push({ ...link, id });
  }

  return normalizeState({
    version: 1,
    links: [
      ...current.links.map((link) => ({ ...link })),
      ...additions
    ],
    settings: {
      ...imported.settings,
      wallpaper: { ...imported.settings.wallpaper }
    }
  });
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
  const rawOverlay = Number(rawSettings.overlay);
  const rawBlur = Number(rawSettings.blur);
  const rawWallpaper = rawSettings.wallpaper && typeof rawSettings.wallpaper === "object"
    ? rawSettings.wallpaper
    : DEFAULT_SETTINGS.wallpaper;

  let wallpaper = {
    type: "preset",
    value: "dawn",
    tone: "light"
  };

  if (rawWallpaper.type === "image" &&
      typeof rawWallpaper.value === "string" &&
      WALLPAPER_DATA_URL_PATTERN.test(rawWallpaper.value)) {
    wallpaper = {
      type: "image",
      value: rawWallpaper.value,
      tone: rawWallpaper.tone === "light" ? "light" : "dark"
    };
  } else if (rawWallpaper.type === "preset" &&
             PRESETS.some((preset) => preset.id === rawWallpaper.value)) {
    const preset = PRESETS.find((item) => item.id === rawWallpaper.value);
    wallpaper = {
      type: "preset",
      value: rawWallpaper.value,
      tone: preset.tone
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
      overlay: Number.isFinite(rawOverlay)
        ? clamp(rawOverlay, 0, 60)
        : DEFAULT_SETTINGS.overlay,
      blur: Number.isFinite(rawBlur)
        ? clamp(rawBlur, 0, 24)
        : DEFAULT_SETTINGS.blur,
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
