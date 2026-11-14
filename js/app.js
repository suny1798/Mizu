import {
  DEFAULT_SETTINGS,
  ENGINES,
  PRESETS,
  STORAGE_KEY,
  clamp,
  createDefaultState,
  looksLikeAddress,
  makeId,
  normalizeIconText,
  normalizeState,
  normalizeUrl
} from "./data.js";

const MONOGRAM_COLORS = [
  "#687c78",
  "#a87962",
  "#75816a",
  "#887666",
  "#6b7988",
  "#98716e",
  "#758074",
  "#83726d"
];

const HISTORY_MAX_RESULTS = 80;
const LONG_PRESS_DELAY = 380;
const LONG_PRESS_MOVE_TOLERANCE = 7;

const isExtension = Boolean(
  globalThis.chrome?.runtime?.id &&
  globalThis.chrome?.storage?.local
);

const dom = {
  wallpaper: document.querySelector("#wallpaper"),
  searchForm: document.querySelector("#search-form"),
  searchInput: document.querySelector("#search-input"),
  searchShortcut: document.querySelector("#search-shortcut"),
  settingsButton: document.querySelector("#settings-button"),
  historyButton: document.querySelector("#history-button"),
  historyLayer: document.querySelector("#history-layer"),
  historyBackdrop: document.querySelector("#history-backdrop"),
  historyPanel: document.querySelector("#history-panel"),
  historyClose: document.querySelector("#history-close"),
  historySearch: document.querySelector("#history-search"),
  historySearchClear: document.querySelector("#history-search-clear"),
  historyCount: document.querySelector("#history-count"),
  historyList: document.querySelector("#history-list"),
  collection: document.querySelector(".collection"),
  collectionHint: document.querySelector("#collection-hint"),
  editButton: document.querySelector("#edit-button"),
  favoritesGrid: document.querySelector("#favorites-grid"),
  contextMenu: document.querySelector("#home-context-menu"),
  contextEditHome: document.querySelector("#context-edit-home"),
  contextEditSite: document.querySelector("#context-edit-site"),
  contextFinishEdit: document.querySelector("#context-finish-edit"),
  linkDialog: document.querySelector("#link-dialog"),
  linkDialogTitle: document.querySelector("#link-dialog-title"),
  linkDialogClose: document.querySelector("#link-dialog-close"),
  linkCancel: document.querySelector("#link-cancel"),
  linkForm: document.querySelector("#link-form"),
  linkName: document.querySelector("#link-name"),
  linkUrl: document.querySelector("#link-url"),
  linkPreviewIcon: document.querySelector("#link-preview-icon"),
  linkPreviewName: document.querySelector("#link-preview-name"),
  iconModeButtons: [...document.querySelectorAll("[data-icon-mode]")],
  iconTextField: document.querySelector("#icon-text-field"),
  linkIconText: document.querySelector("#link-icon-text"),
  formError: document.querySelector("#form-error"),
  settingsLayer: document.querySelector("#settings-layer"),
  settingsSheet: document.querySelector("#settings-sheet"),
  settingsBackdrop: document.querySelector("#settings-backdrop"),
  settingsClose: document.querySelector("#settings-close"),
  wallpaperOptions: document.querySelector("#wallpaper-options"),
  wallpaperUpload: document.querySelector("#wallpaper-upload"),
  wallpaperUploadLabel: document.querySelector(".upload-label"),
  wallpaperFile: document.querySelector("#wallpaper-file"),
  overlayRange: document.querySelector("#overlay-range"),
  overlayOutput: document.querySelector("#overlay-output"),
  blurRange: document.querySelector("#blur-range"),
  blurOutput: document.querySelector("#blur-output"),
  engineSelect: document.querySelector("#engine-select"),
  labelsToggle: document.querySelector("#labels-toggle"),
  iconSizeRange: document.querySelector("#icon-size-range"),
  iconSizeOutput: document.querySelector("#icon-size-output"),
  iconGapRange: document.querySelector("#icon-gap-range"),
  iconGapOutput: document.querySelector("#icon-gap-output"),
  columnsRange: document.querySelector("#columns-range"),
  columnsOutput: document.querySelector("#columns-output"),
  resetButton: document.querySelector("#reset-button"),
  toast: document.querySelector("#toast"),
  toastMessage: document.querySelector("#toast-message"),
  toastAction: document.querySelector("#toast-action")
};

let state;
let editing = false;
let dialogMode = "add";
let dialogLinkId = null;
let dialogIconMode = "online";
let iconTextComposing = false;
let draggedId = null;
let pointerDrag = null;
let pointerPressTimer = 0;
let suppressClickUntil = 0;
let settingsIsOpen = false;
let settingsCloseTimer = 0;
let historyIsOpen = false;
let historyCloseTimer = 0;
let historySearchTimer = 0;
let historyRequest = 0;
let toastTimer = 0;
let saveTimer = 0;
let pendingRemoval = null;
let resetArmed = false;
let resetTimer = 0;
let lastFocusedElement = null;
let previewIconRequest = 0;
let contextMenuLinkId = null;
const iconCache = new Map();
const iconRequestTokens = new WeakMap();

async function loadState() {
  try {
    if (isExtension) {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      return normalizeState(stored[STORAGE_KEY]);
    }

    const value = localStorage.getItem(STORAGE_KEY);
    return normalizeState(value ? JSON.parse(value) : null);
  } catch (error) {
    console.warn("Mizu could not load local data.", error);
    return createDefaultState();
  }
}

async function saveNow() {
  window.clearTimeout(saveTimer);
  saveTimer = 0;

  try {
    if (isExtension) {
      await chrome.storage.local.set({ [STORAGE_KEY]: state });
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
    return true;
  } catch (error) {
    console.error("Mizu could not save local data.", error);
    showToast("保存失败，请检查浏览器存储空间");
    return false;
  }
}

function scheduleSave(delay = 160) {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNow, delay);
}

function applyWallpaper() {
  const { wallpaper } = state.settings;
  dom.wallpaper.style.backgroundImage = "";
  dom.wallpaper.dataset.preset = wallpaper.type === "preset"
    ? wallpaper.value
    : "custom";

  if (wallpaper.type === "image") {
    dom.wallpaper.style.backgroundImage = `url("${wallpaper.value}")`;
  }

  const tone = wallpaper.tone === "light" ? "light" : "dark";
  document.documentElement.dataset.tone = tone;
  document.documentElement.style.setProperty("--veil-alpha", String(state.settings.overlay / 100));
  document.documentElement.style.setProperty("--wallpaper-blur", `${state.settings.blur}px`);
}

function applyLayout() {
  const { iconSize, iconGap, columns } = state.settings;
  const tileWidth = iconSize + 14;
  const gap = iconGap;
  document.documentElement.style.setProperty("--favorite-icon-size", `${iconSize}px`);
  document.documentElement.style.setProperty("--favorite-tile-width", `${tileWidth}px`);
  document.documentElement.style.setProperty("--favorite-gap", `${gap}px`);
  document.documentElement.style.setProperty(
    "--favorite-monogram-size",
    `${Math.round(iconSize * .57)}px`
  );
  document.documentElement.style.setProperty(
    "--favorite-remove-left",
    `${Math.round(tileWidth / 2 + iconSize / 2 - 20)}px`
  );
  const visibleCount = state.links.length + (editing ? 1 : 0);
  const rowCount = Math.min(Math.max(visibleCount, 1), columns);
  const rowWidth = rowCount * tileWidth + Math.max(0, rowCount - 1) * gap;
  document.documentElement.style.setProperty(
    "--favorites-row-width",
    `${rowWidth}px`
  );
  dom.favoritesGrid.style.maxWidth =
    `${columns * tileWidth + Math.max(0, columns - 1) * gap}px`;
}

function applyUiState() {
  const { settings } = state;
  applyWallpaper();
  applyLayout();

  dom.collection.classList.toggle("hide-labels", !settings.showLabels);
  dom.overlayRange.value = String(settings.overlay);
  dom.overlayOutput.value = `${settings.overlay}%`;
  dom.blurRange.value = String(settings.blur);
  dom.blurOutput.value = `${settings.blur} px`;
  dom.engineSelect.value = settings.engine;
  dom.labelsToggle.checked = settings.showLabels;
  dom.iconSizeRange.value = String(settings.iconSize);
  dom.iconSizeOutput.value = `${settings.iconSize} px`;
  dom.iconGapRange.value = String(settings.iconGap);
  dom.iconGapOutput.value = `${settings.iconGap} px`;
  dom.columnsRange.value = String(settings.columns);
  dom.columnsOutput.value = `${settings.columns} 个`;

  for (const button of dom.wallpaperOptions.querySelectorAll("[data-preset]")) {
    const isActive = settings.wallpaper.type === "preset" &&
      button.dataset.preset === settings.wallpaper.value;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  }

  dom.wallpaperUpload.classList.toggle("is-active", settings.wallpaper.type === "image");
  dom.wallpaperUploadLabel.textContent = settings.wallpaper.type === "image"
    ? "更换当前壁纸"
    : "选择电脑中的图片";
}

function iconColorFor(link) {
  let hash = 0;
  for (const char of link.title + link.url) {
    hash = ((hash << 5) - hash + char.codePointAt(0)) | 0;
  }
  return MONOGRAM_COLORS[Math.abs(hash) % MONOGRAM_COLORS.length];
}

function faviconUrlsFor(linkOrUrl) {
  const link = typeof linkOrUrl === "string"
    ? { url: linkOrUrl }
    : linkOrUrl;
  const candidates = [];
  const add = (value) => {
    if (value && !candidates.includes(value)) candidates.push(value);
  };
  add(link?.icon);
  if (link?.icon && /^data:image\//i.test(link.icon)) return candidates;

  try {
    const parsed = new URL(link?.url);
    if (!["http:", "https:"].includes(parsed.protocol)) return candidates;
    add(`${parsed.origin}/apple-touch-icon.png`);
    add(`${parsed.origin}/apple-touch-icon-precomposed.png`);
    add(`${parsed.origin}/favicon.svg`);
    add(`${parsed.origin}/favicon.ico`);
  } catch {
    // Keep any explicitly supplied icon.
  }
  return candidates;
}

function isVectorIcon(src) {
  return /^data:image\/svg\+xml/i.test(src) ||
    /\.svg(?:[?#]|$)/i.test(src);
}

function loadIconSource(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.alt = "";
    image.draggable = false;
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";

    let settled = false;
    const timer = window.setTimeout(() => {
      image.src = "";
      finish(null);
    }, 3500);
    const finish = (value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(value);
    };

    image.onload = () => finish({
      image,
      src,
      width: image.naturalWidth || 0,
      height: image.naturalHeight || 0,
      vector: isVectorIcon(src)
    });
    image.onerror = () => finish(null);
    image.src = src;
  });
}

async function resolveIcon(link) {
  const key = `${link.url || ""}\n${link.icon || ""}`;
  if (!iconCache.has(key)) {
    iconCache.set(key, (async () => {
      let best = null;
      for (const src of faviconUrlsFor(link)) {
        const candidate = await loadIconSource(src);
        if (!candidate) continue;
        if (!best ||
            candidate.vector ||
            candidate.width * candidate.height > best.width * best.height) {
          best = candidate;
        }
        if (candidate.vector || candidate.width >= 96 || candidate.height >= 96) {
          break;
        }
      }
      return best;
    })());
  }
  return iconCache.get(key);
}

function monogramTextFor(link) {
  return normalizeIconText(link.iconText) ||
    normalizeIconText(link.title) ||
    "?";
}

function monogramFor(link) {
  const element = document.createElement("span");
  const label = monogramTextFor(link);
  element.className = "favorite-monogram";
  element.style.setProperty("--monogram", iconColorFor(link));
  element.textContent = label;
  element.dataset.length = String([...label].length);
  element.setAttribute("aria-hidden", "true");
  return element;
}

function paintIcon(container, link) {
  container.replaceChildren();
  const fallback = monogramFor(link);
  container.append(fallback);
  if (link.iconMode === "text") return;

  const token = Symbol("icon-request");
  iconRequestTokens.set(container, token);
  resolveIcon(link).then((icon) => {
    if (!icon ||
        !container.isConnected ||
        iconRequestTokens.get(container) !== token) {
      return;
    }
    const image = icon.image.cloneNode();
    image.alt = "";
    image.draggable = false;
    image.referrerPolicy = "no-referrer";
    container.replaceChildren(image);
  });
}

function createFavoriteElement(link, index) {
  const tile = document.createElement("a");
  tile.className = "favorite";
  tile.href = link.url;
  tile.target = "_blank";
  tile.rel = "noopener noreferrer";
  tile.dataset.id = link.id;
  tile.title = `${link.title}\n${link.url}`;
  tile.style.animationDelay = `${Math.min(index * 22, 180)}ms`;

  const icon = document.createElement("span");
  icon.className = "favorite-icon";
  paintIcon(icon, link);

  const name = document.createElement("span");
  name.className = "favorite-name";
  name.textContent = link.title;

  const remove = document.createElement("button");
  remove.className = "remove-favorite";
  remove.type = "button";
  remove.setAttribute("aria-label", `移除 ${link.title}`);
  remove.innerHTML = `
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="m3 3 6 6M9 3 3 9"></path>
    </svg>
  `;
  remove.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    removeLink(link.id);
  });

  tile.addEventListener("click", (event) => {
    if (editing) {
      event.preventDefault();
      openLinkDialog("edit", link.id);
      return;
    }
    event.preventDefault();
    openInNewTab(link.url);
  });

  tile.addEventListener("auxclick", (event) => {
    if (editing || event.button !== 1) return;
    event.preventDefault();
    openInNewTab(link.url);
  });

  tile.addEventListener("pointerdown", (event) => {
    beginLongPress(event, link, tile);
  });

  tile.addEventListener("contextmenu", (event) => {
    if ((pointerDrag?.active && pointerDrag.id === link.id) ||
        performance.now() < suppressClickUntil) {
      event.preventDefault();
      return;
    }
    openHomeContextMenu(event, link);
  });

  tile.addEventListener("keydown", (event) => {
    if (!editing) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openLinkDialog("edit", link.id);
      return;
    }
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && event.altKey) {
      event.preventDefault();
      moveLinkBy(link.id, event.key === "ArrowLeft" ? -1 : 1);
    }
  });

  tile.draggable = editing;
  tile.addEventListener("dragstart", handleDragStart);
  tile.addEventListener("dragend", handleDragEnd);

  tile.append(icon, name, remove);
  return tile;
}

function createAddElement() {
  const button = document.createElement("button");
  button.className = "add-favorite";
  button.type = "button";
  button.setAttribute("aria-label", "添加网站");
  button.innerHTML = `
    <span class="add-favorite-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M12 5v14M5 12h14"></path>
      </svg>
    </span>
    <span>添加</span>
  `;
  button.addEventListener("click", () => openLinkDialog("add"));
  return button;
}

function renderFavorites() {
  const fragment = document.createDocumentFragment();
  state.links.forEach((link, index) => {
    fragment.append(createFavoriteElement(link, index));
  });

  if (editing || state.links.length === 0) {
    fragment.append(createAddElement());
  }

  dom.favoritesGrid.replaceChildren(fragment);
  applyLayout();
}

function setEditing(nextValue) {
  editing = Boolean(nextValue);
  dom.collection.classList.toggle("is-editing", editing);
  dom.collectionHint.textContent = editing
    ? "拖动排序 · alt + ← / → 移动 · 点击图标编辑"
    : "";
  dom.editButton.textContent = editing ? "完成" : "编辑";
  dom.editButton.setAttribute("aria-pressed", editing ? "true" : "false");
  closeHomeContextMenu();
  renderFavorites();
}

function closeHomeContextMenu() {
  dom.contextMenu.hidden = true;
  contextMenuLinkId = null;
}

function positionHomeContextMenu(x, y) {
  dom.contextMenu.hidden = false;
  const margin = 8;
  const rect = dom.contextMenu.getBoundingClientRect();
  const left = Math.min(
    Math.max(margin, x),
    window.innerWidth - rect.width - margin
  );
  const top = Math.min(
    Math.max(margin, y),
    window.innerHeight - rect.height - margin
  );
  dom.contextMenu.style.left = `${left}px`;
  dom.contextMenu.style.top = `${top}px`;
}

function openHomeContextMenu(event, link) {
  event.preventDefault();
  contextMenuLinkId = link.id;
  dom.contextEditHome.hidden = editing;
  dom.contextEditSite.hidden = !editing;
  dom.contextFinishEdit.hidden = !editing;

  const tile = event.currentTarget;
  const tileRect = tile?.getBoundingClientRect?.();
  const x = event.clientX || (tileRect?.left ?? 0) + (tileRect?.width ?? 0) / 2;
  const y = event.clientY || (tileRect?.top ?? 0) + (tileRect?.height ?? 0) / 2;
  positionHomeContextMenu(x, y);

  const firstItem = [dom.contextEditHome, dom.contextEditSite, dom.contextFinishEdit]
    .find((item) => !item.hidden);
  firstItem?.focus();
}

function moveLinkBy(id, delta) {
  const from = state.links.findIndex((link) => link.id === id);
  const to = clamp(from + delta, 0, state.links.length - 1);
  if (from < 0 || from === to) return;

  const [link] = state.links.splice(from, 1);
  state.links.splice(to, 0, link);
  saveNow();
  renderFavorites();

  const nextTile = dom.favoritesGrid.querySelector(`[data-id="${CSS.escape(id)}"]`);
  nextTile?.focus();
}

function handleDragStart(event) {
  if (!editing) {
    event.preventDefault();
    return;
  }
  const tile = event.currentTarget;
  draggedId = tile.dataset.id;
  tile.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedId);
}

function handleDragEnd() {
  if (!draggedId) return;
  const tiles = [...dom.favoritesGrid.querySelectorAll(".favorite[data-id]")];
  const order = new Map(tiles.map((tile, index) => [tile.dataset.id, index]));
  state.links.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  state.links.forEach((link) => {
    dom.favoritesGrid.querySelector(`[data-id="${CSS.escape(link.id)}"]`)?.classList.remove("is-dragging");
  });
  draggedId = null;
  saveNow();
  renderFavorites();
}

function handleDragOver(event) {
  if (!draggedId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";

  const target = event.target.closest?.(".favorite[data-id]");
  if (!target || target.dataset.id === draggedId) return;
  const dragging = dom.favoritesGrid.querySelector(".favorite.is-dragging");
  if (!dragging) return;

  const rect = target.getBoundingClientRect();
  const insertBefore = event.clientX < rect.left + rect.width / 2;
  dom.favoritesGrid.insertBefore(
    dragging,
    insertBefore ? target : target.nextSibling
  );
}

function clearPointerPressTimer() {
  window.clearTimeout(pointerPressTimer);
  pointerPressTimer = 0;
}

function cancelPendingLongPress() {
  clearPointerPressTimer();
  if (pointerDrag && !pointerDrag.active) pointerDrag = null;
}

function beginLongPress(event, link, tile) {
  if (editing ||
      pointerDrag ||
      event.button !== 0 ||
      event.isPrimary === false ||
      event.target.closest?.(".remove-favorite")) {
    return;
  }

  pointerDrag = {
    id: link.id,
    tile,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: 0,
    offsetY: 0,
    active: false,
    ghost: null
  };
  clearPointerPressTimer();
  pointerPressTimer = window.setTimeout(
    activatePointerDrag,
    LONG_PRESS_DELAY
  );
}

function activatePointerDrag() {
  pointerPressTimer = 0;
  const drag = pointerDrag;
  if (!drag || drag.active || editing || !drag.tile.isConnected) {
    cancelPendingLongPress();
    return;
  }

  const rect = drag.tile.getBoundingClientRect();
  const ghost = drag.tile.cloneNode(true);
  ghost.classList.remove("is-pointer-dragging");
  ghost.classList.add("favorite-drag-ghost");
  ghost.removeAttribute("href");
  ghost.removeAttribute("data-id");
  ghost.removeAttribute("title");
  ghost.setAttribute("aria-hidden", "true");
  ghost.querySelectorAll("button").forEach((button) => button.remove());
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;

  drag.offsetX = drag.startX - rect.left;
  drag.offsetY = drag.startY - rect.top;
  drag.ghost = ghost;
  drag.active = true;
  drag.tile.classList.add("is-pointer-dragging");
  drag.tile.setAttribute("aria-grabbed", "true");
  document.body.append(ghost);
  document.documentElement.classList.add("is-long-press-dragging");

  try {
    drag.tile.setPointerCapture(drag.pointerId);
  } catch {
    // Pointer capture is best-effort; document listeners still handle the drag.
  }
}

function reorderFromPointer(drag, x, y) {
  const target = document.elementFromPoint(x, y)
    ?.closest?.(".favorite[data-id]");
  if (!target ||
      target === drag.tile ||
      !dom.favoritesGrid.contains(target)) {
    return;
  }

  const rect = target.getBoundingClientRect();
  const insertBefore = x < rect.left + rect.width / 2;
  dom.favoritesGrid.insertBefore(
    drag.tile,
    insertBefore ? target : target.nextSibling
  );
}

function handlePointerDragMove(event) {
  const drag = pointerDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;

  if (!drag.active) {
    const distance = Math.hypot(
      event.clientX - drag.startX,
      event.clientY - drag.startY
    );
    if (distance > LONG_PRESS_MOVE_TOLERANCE) cancelPendingLongPress();
    return;
  }

  if (event.cancelable) event.preventDefault();
  drag.ghost.style.left = `${event.clientX - drag.offsetX}px`;
  drag.ghost.style.top = `${event.clientY - drag.offsetY}px`;
  reorderFromPointer(drag, event.clientX, event.clientY);
}

function finishPointerDrag(event) {
  const drag = pointerDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;

  clearPointerPressTimer();
  pointerDrag = null;
  if (!drag.active) return;

  try {
    drag.tile.releasePointerCapture(drag.pointerId);
  } catch {
    // The pointer may already have been released by the browser.
  }
  drag.ghost?.remove();
  drag.tile.classList.remove("is-pointer-dragging");
  drag.tile.removeAttribute("aria-grabbed");
  document.documentElement.classList.remove("is-long-press-dragging");
  suppressClickUntil = performance.now() + 300;

  const tiles = [...dom.favoritesGrid.querySelectorAll(".favorite[data-id]")];
  const order = new Map(tiles.map((tile, index) => [tile.dataset.id, index]));
  state.links.sort((left, right) =>
    (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0)
  );
  saveNow();
  renderFavorites();
}

function removeLink(id) {
  const index = state.links.findIndex((link) => link.id === id);
  if (index < 0) return;
  const [link] = state.links.splice(index, 1);
  pendingRemoval = { link, index };
  saveNow();
  renderFavorites();
  showToast(`已移除「${link.title}」`, {
    actionLabel: "撤销",
    duration: 5000,
    action: () => {
      if (!pendingRemoval) return;
      state.links.splice(pendingRemoval.index, 0, pendingRemoval.link);
      pendingRemoval = null;
      saveNow();
      renderFavorites();
      hideToast();
    }
  });
}

function showToast(message, options = {}) {
  window.clearTimeout(toastTimer);
  dom.toast.hidden = false;
  dom.toastMessage.textContent = message;
  dom.toastAction.hidden = !options.actionLabel;
  dom.toastAction.textContent = options.actionLabel || "";
  dom.toastAction.onclick = options.action || null;
  toastTimer = window.setTimeout(
    hideToast,
    Number(options.duration) || 3200
  );
}

function hideToast() {
  window.clearTimeout(toastTimer);
  dom.toast.hidden = true;
  dom.toastAction.hidden = true;
  dom.toastAction.onclick = null;
  pendingRemoval = null;
}

function searchOrOpen(value) {
  const query = value.trim();
  if (!query) return;

  if (looksLikeAddress(query)) {
    const url = normalizeUrl(query);
    if (url) {
      openInNewTab(url);
      return;
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(query)) {
      showToast("仅支持打开 http 或 https 网站");
      return;
    }
  }

  const engine = ENGINES[state.settings.engine] || ENGINES.google;
  openInNewTab(`${engine.searchUrl}${encodeURIComponent(query)}`);
}

function openInNewTab(url) {
  if (!url) return;

  if (isExtension && chrome.tabs?.create) {
    try {
      const opening = chrome.tabs.create({
        url,
        active: true
      });
      opening?.catch?.(() => {
        window.open(url, "_blank", "noopener,noreferrer");
      });
      return;
    } catch {
      // Fall through to the browser tab fallback.
    }
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

function buildWallpaperOptions() {
  const fragment = document.createDocumentFragment();
  for (const preset of PRESETS) {
    const button = document.createElement("button");
    button.className = "wallpaper-option";
    button.type = "button";
    button.dataset.preset = preset.id;
    button.setAttribute("aria-pressed", "false");
    button.innerHTML = `
      <span class="wallpaper-option-swatch" aria-hidden="true"></span>
      <span>${preset.name}</span>
    `;
    button.addEventListener("click", () => {
      state.settings.wallpaper = {
        type: "preset",
        value: preset.id,
        tone: preset.id === "paper" ? "light" : "dark"
      };
      applyUiState();
      saveNow();
    });
    fragment.append(button);
  }
  dom.wallpaperOptions.replaceChildren(fragment);
}

function setPreviewIcon(link) {
  dom.linkPreviewIcon.replaceChildren();
  const previewLink = {
    title: link.title || "?",
    url: link.url || "",
    iconMode: dialogIconMode,
    iconText: link.iconText || ""
  };
  const request = ++previewIconRequest;
  const fallback = () => {
    dom.linkPreviewIcon.replaceChildren();
    dom.linkPreviewIcon.textContent = monogramTextFor(previewLink);
    dom.linkPreviewIcon.style.background = iconColorFor(previewLink);
  };

  if (dialogIconMode === "text") {
    fallback();
    return;
  }

  dom.linkPreviewIcon.style.background = "#fff";
  resolveIcon(previewLink).then((icon) => {
    if (request !== previewIconRequest) return;
    if (!icon) {
      fallback();
      return;
    }
    const image = icon.image.cloneNode();
    image.alt = "";
    image.draggable = false;
    image.referrerPolicy = "no-referrer";
    dom.linkPreviewIcon.replaceChildren(image);
  });
}

function updateLinkPreview() {
  const title = dom.linkName.value.trim() || "新网站";
  const url = normalizeUrl(dom.linkUrl.value) || dom.linkUrl.value.trim();
  dom.linkPreviewName.textContent = title;
  setPreviewIcon({
    title,
    url,
    iconText: dom.linkIconText.value
  });
}

function setDialogIconMode(mode) {
  dialogIconMode = mode === "text" ? "text" : "online";
  dom.iconTextField.hidden = dialogIconMode !== "text";
  for (const button of dom.iconModeButtons) {
    const isActive = button.dataset.iconMode === dialogIconMode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  }
  updateLinkPreview();
}

function applyIconTextInput() {
  const iconText = normalizeIconText(dom.linkIconText.value);
  if (dom.linkIconText.value !== iconText) {
    dom.linkIconText.value = iconText;
  }
  updateLinkPreview();
}

function prettyNameFromUrl(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return "";
  try {
    const host = new URL(normalized).hostname.replace(/^www\./, "");
    const firstPart = host.split(".")[0].replace(/[-_]+/g, " ");
    return firstPart
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
      .slice(0, 36);
  } catch {
    return "";
  }
}

function openLinkDialog(mode, id = null) {
  dialogMode = mode;
  dialogLinkId = id;
  iconTextComposing = false;
  dom.linkForm.reset();
  dom.formError.hidden = true;
  dom.formError.textContent = "";
  let iconMode = "online";

  if (mode === "edit") {
    const link = state.links.find((item) => item.id === id);
    if (!link) return;
    dom.linkDialogTitle.textContent = "编辑网站";
    dom.linkName.value = link.title;
    dom.linkUrl.value = link.url;
    dom.linkIconText.value = link.iconMode === "text" ? link.iconText || "" : "";
    iconMode = link.iconMode === "text" ? "text" : "online";
  } else {
    dom.linkDialogTitle.textContent = "添加网站";
  }

  setDialogIconMode(iconMode);
  dom.linkDialog.showModal();
  window.setTimeout(() => dom.linkName.focus(), 50);
}

function closeLinkDialog() {
  if (dom.linkDialog.open) dom.linkDialog.close();
}

function finishLinkDialog(event) {
  event.preventDefault();
  dom.formError.hidden = true;

  const title = dom.linkName.value.trim();
  const url = normalizeUrl(dom.linkUrl.value);

  if (!title) {
    dom.formError.textContent = "请填写网站名称";
    dom.formError.hidden = false;
    dom.linkName.focus();
    return;
  }

  if (!url) {
    dom.formError.textContent = "请输入有效的网址，例如 github.com";
    dom.formError.hidden = false;
    dom.linkUrl.focus();
    return;
  }

  const duplicate = state.links.find(
    (link) => link.url === url && link.id !== dialogLinkId
  );
  if (duplicate) {
    dom.formError.textContent = "这个网址已经在收藏里了";
    dom.formError.hidden = false;
    return;
  }

  if (dialogMode === "edit") {
    const link = state.links.find((item) => item.id === dialogLinkId);
    if (!link) return;
    link.title = title.slice(0, 36);
    link.url = url;
    if (dialogIconMode === "text") {
      link.iconMode = "text";
      const iconText = normalizeIconText(dom.linkIconText.value);
      if (iconText) {
        link.iconText = iconText;
      } else {
        delete link.iconText;
      }
    } else {
      delete link.iconMode;
      delete link.iconText;
    }
    delete link.icon;
    showToast("已更新");
  } else {
    state.links.push({
      id: makeId(),
      title: title.slice(0, 36),
      url,
      ...(dialogIconMode === "text" ? { iconMode: "text" } : {}),
      ...(dialogIconMode === "text" && normalizeIconText(dom.linkIconText.value)
        ? { iconText: normalizeIconText(dom.linkIconText.value) }
        : {})
    });
    showToast("已添加到个人收藏");
  }

  saveNow();
  closeLinkDialog();
  renderFavorites();
}

async function imageFileToWallpaper(file) {
  if (file.size > 30 * 1024 * 1024) {
    throw new Error("图片超过 30 MB，请先压缩后再试");
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = await new Promise((resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("无法读取这张图片"));
      };
      image.src = objectUrl;
    });
  }

  const width = bitmap.width;
  const height = bitmap.height;
  const firstMaxEdge = 2560;
  const firstScale = Math.min(1, firstMaxEdge / Math.max(width, height));
  let targetWidth = Math.max(1, Math.round(width * firstScale));
  let targetHeight = Math.max(1, Math.round(height * firstScale));

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

  let dataUrl = canvas.toDataURL("image/webp", 0.87);
  if (dataUrl.length > 6_600_000) {
    const secondScale = 2200 / Math.max(width, height);
    targetWidth = Math.max(1, Math.round(width * Math.min(1, secondScale)));
    targetHeight = Math.max(1, Math.round(height * Math.min(1, secondScale)));
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    dataUrl = canvas.toDataURL("image/webp", 0.72);
  }

  if (dataUrl.length > 7_600_000) {
    throw new Error("图片压缩后仍然过大，请换一张尺寸更小的图片");
  }

  const toneCanvas = document.createElement("canvas");
  const toneContext = toneCanvas.getContext("2d", { willReadFrequently: true });
  toneCanvas.width = 48;
  toneCanvas.height = 48;
  toneContext.drawImage(bitmap, 0, 0, 48, 48);
  const pixels = toneContext.getImageData(0, 0, 48, 48).data;
  let luminanceSum = 0;
  let luminanceCount = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    luminanceSum +=
      pixels[index] * 0.2126 +
      pixels[index + 1] * 0.7152 +
      pixels[index + 2] * 0.0722;
    luminanceCount += 1;
  }
  const tone = luminanceSum / luminanceCount / 255 > 0.67 ? "light" : "dark";
  if (bitmap.close) bitmap.close();

  return { dataUrl, tone };
}

async function handleWallpaperFile(file) {
  if (!file) return;
  showToast("正在处理壁纸…", { duration: 12000 });
  const previousWallpaper = state.settings.wallpaper;
  try {
    const { dataUrl, tone } = await imageFileToWallpaper(file);
    state.settings.wallpaper = { type: "image", value: dataUrl, tone };
    applyUiState();
    const saved = await saveNow();
    if (saved) {
      showToast("壁纸已更新");
    } else {
      state.settings.wallpaper = previousWallpaper;
      applyUiState();
    }
  } catch (error) {
    console.error(error);
    state.settings.wallpaper = previousWallpaper;
    applyUiState();
    showToast(error.message || "壁纸处理失败");
  } finally {
    dom.wallpaperFile.value = "";
  }
}

function openSettings() {
  if (settingsIsOpen) return;
  window.clearTimeout(settingsCloseTimer);
  lastFocusedElement = document.activeElement;
  settingsIsOpen = true;
  dom.settingsLayer.hidden = false;
  requestAnimationFrame(() => {
    dom.settingsLayer.classList.add("is-open");
    dom.settingsClose.focus();
  });
}

function closeSettings() {
  if (!settingsIsOpen) return;
  settingsIsOpen = false;
  dom.settingsLayer.classList.remove("is-open");
  settingsCloseTimer = window.setTimeout(() => {
    dom.settingsLayer.hidden = true;
  }, 280);
  if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
}

function trapSettingsFocus(event) {
  if (event.key !== "Tab" || !settingsIsOpen) return;
  const focusable = [...dom.settingsSheet.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((element) => !element.hidden && element.offsetParent !== null);
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function historyPageTitle(item) {
  const storedTitle = String(item.title || "").trim();
  if (storedTitle) return storedTitle;

  const generatedTitle = prettyNameFromUrl(item.url || "");
  if (generatedTitle) return generatedTitle;

  try {
    return new URL(item.url).hostname.replace(/^www\./, "");
  } catch {
    return item.url || "未命名页面";
  }
}

function historyFaviconUrl(pageUrl) {
  if (!isExtension || !chrome.runtime?.getURL) return "";
  try {
    return chrome.runtime.getURL(
      `/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=32`
    );
  } catch {
    return "";
  }
}

function createHistoryMonogram(item) {
  const element = document.createElement("span");
  const title = historyPageTitle(item);
  element.className = "history-monogram";
  element.style.setProperty("--monogram", iconColorFor({
    title,
    url: item.url || ""
  }));
  element.textContent = title.trim().slice(0, 1) || "?";
  element.setAttribute("aria-hidden", "true");
  return element;
}

function createHistoryFavicon(item) {
  const wrap = document.createElement("span");
  wrap.className = "history-favicon-wrap";
  wrap.setAttribute("aria-hidden", "true");

  const src = historyFaviconUrl(item.url);
  if (!src) {
    wrap.append(createHistoryMonogram(item));
    return wrap;
  }

  const image = document.createElement("img");
  image.alt = "";
  image.loading = "lazy";
  image.referrerPolicy = "no-referrer";
  image.addEventListener("error", () => {
    wrap.replaceChildren(createHistoryMonogram(item));
  }, { once: true });
  image.src = src;
  wrap.append(image);
  return wrap;
}

function formatHistoryTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const visitedDay = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
  const daysAgo = Math.round((today - visitedDay) / 86_400_000);

  if (daysAgo === 0) {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  }
  if (daysAgo === 1) return "昨天";
  if (daysAgo > 1 && daysAgo < 7) {
    return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][
      date.getDay()
    ];
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function createHistoryEntry(item) {
  const entry = document.createElement("a");
  const title = historyPageTitle(item);
  const visitedAt = Number(item.lastVisitTime) || 0;
  const time = formatHistoryTime(visitedAt);

  entry.className = "history-item";
  entry.href = item.url;
  entry.target = "_blank";
  entry.rel = "noopener noreferrer";
  entry.title = `${title}\n${item.url}`;

  const copy = document.createElement("span");
  copy.className = "history-copy";
  const titleElement = document.createElement("span");
  titleElement.className = "history-item-title";
  titleElement.textContent = title;
  copy.append(titleElement);

  const timeElement = document.createElement("span");
  timeElement.className = "history-time";
  timeElement.textContent = time;
  if (visitedAt) {
    timeElement.title = new Date(visitedAt).toLocaleString("zh-CN", {
      hour12: false
    });
  }

  entry.append(createHistoryFavicon(item), copy);
  if (time) entry.append(timeElement);

  entry.addEventListener("click", (event) => {
    event.preventDefault();
    openInNewTab(item.url);
    closeHistory();
  });
  entry.addEventListener("auxclick", (event) => {
    if (event.button !== 1) return;
    event.preventDefault();
    openInNewTab(item.url);
    closeHistory();
  });

  return entry;
}

function renderHistoryState(kind, title, copy) {
  const state = document.createElement("div");
  state.className = "history-state";

  if (kind === "loading") {
    const loader = document.createElement("span");
    loader.className = "history-loader";
    loader.setAttribute("aria-hidden", "true");
    state.append(loader);
  } else {
    state.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4.7 8.2A8 8 0 1 1 4 14"></path>
        <path d="M4.7 3.8v4.4h4.4"></path>
        <path d="M12 7.8V12l2.8 1.8"></path>
      </svg>
    `;
  }

  const heading = document.createElement("strong");
  heading.textContent = title;
  state.append(heading);
  if (copy) {
    const description = document.createElement("span");
    description.textContent = copy;
    state.append(description);
  }
  dom.historyList.scrollTop = 0;
  dom.historyList.replaceChildren(state);
}

function renderHistory(items, query) {
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    fragment.append(createHistoryEntry(item));
  }

  if (!items.length) {
    dom.historyCount.textContent = query ? "0 条结果" : "暂无记录";
    renderHistoryState(
      "empty",
      query ? "没有找到相关历史记录" : "还没有浏览记录",
      query
        ? "试试标题中的其他关键词，或直接输入网址。"
        : "浏览网页后，最近访问的页面会出现在这里。"
    );
    dom.historyList.setAttribute("aria-busy", "false");
    return;
  }

  dom.historyCount.textContent = query
    ? `找到 ${items.length} 条`
    : `最近 ${items.length} 条`;
  dom.historyList.scrollTop = 0;
  dom.historyList.replaceChildren(fragment);
  dom.historyList.setAttribute("aria-busy", "false");
}

async function loadHistory(query = "") {
  const request = ++historyRequest;
  dom.historyCount.textContent = query ? "正在搜索…" : "正在读取…";
  dom.historyList.setAttribute("aria-busy", "true");
  renderHistoryState(
    "loading",
    query ? "正在搜索历史记录" : "正在读取历史记录"
  );

  if (!isExtension || !globalThis.chrome?.history?.search) {
    if (request !== historyRequest) return;
    dom.historyCount.textContent = "不可用";
    renderHistoryState(
      "error",
      "历史记录仅在扩展模式中可用",
      "请通过 chrome://extensions 加载 Mizu 后重试。"
    );
    dom.historyList.setAttribute("aria-busy", "false");
    return;
  }

  try {
    const results = await chrome.history.search({
      text: query,
      startTime: 0,
      maxResults: HISTORY_MAX_RESULTS
    });
    if (request !== historyRequest) return;

    const items = results
      .filter((item) => {
        try {
          return ["http:", "https:"].includes(new URL(item.url).protocol);
        } catch {
          return false;
        }
      })
      .sort(
        (left, right) =>
          (Number(right.lastVisitTime) || 0) -
          (Number(left.lastVisitTime) || 0)
      );
    renderHistory(items, query.trim());
  } catch (error) {
    if (request !== historyRequest) return;
    console.error("Mizu could not read browser history.", error);
    dom.historyCount.textContent = "读取失败";
    renderHistoryState(
      "error",
      "无法读取浏览历史",
      "请确认扩展拥有“读取浏览记录”权限，然后重新加载扩展。"
    );
    dom.historyList.setAttribute("aria-busy", "false");
  }
}

function queueHistorySearch() {
  const query = dom.historySearch.value.trim();
  dom.historySearchClear.hidden = !query;
  window.clearTimeout(historySearchTimer);
  historySearchTimer = window.setTimeout(() => loadHistory(query), 120);
}

function clearHistorySearch() {
  dom.historySearch.value = "";
  dom.historySearchClear.hidden = true;
  loadHistory("");
  dom.historySearch.focus();
}

function openHistory() {
  if (historyIsOpen) return;
  window.clearTimeout(historyCloseTimer);
  lastFocusedElement = document.activeElement;
  historyIsOpen = true;
  dom.historyLayer.hidden = false;
  dom.historyButton.setAttribute("aria-expanded", "true");
  dom.historySearch.value = "";
  dom.historySearchClear.hidden = true;
  loadHistory("");
  requestAnimationFrame(() => {
    if (!historyIsOpen) return;
    dom.historyLayer.classList.add("is-open");
    dom.historySearch.focus();
  });
}

function closeHistory() {
  if (!historyIsOpen) return;
  historyIsOpen = false;
  window.clearTimeout(historySearchTimer);
  historyRequest += 1;
  dom.historyButton.setAttribute("aria-expanded", "false");
  dom.historyLayer.classList.remove("is-open");
  historyCloseTimer = window.setTimeout(() => {
    dom.historyLayer.hidden = true;
  }, 280);
  if (lastFocusedElement instanceof HTMLElement &&
      lastFocusedElement.isConnected) {
    lastFocusedElement.focus();
  }
}

function trapHistoryFocus(event) {
  if (event.key !== "Tab" || !historyIsOpen) return;
  const focusable = [...dom.historyPanel.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((element) => !element.hidden && element.offsetParent !== null);
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function handleReset() {
  if (!resetArmed) {
    resetArmed = true;
    dom.resetButton.textContent = "再点一次，恢复默认样式";
    dom.resetButton.style.color = "rgba(255, 180, 168, .85)";
    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      resetArmed = false;
      dom.resetButton.textContent = "恢复默认样式";
      dom.resetButton.style.color = "";
    }, 3500);
    return;
  }

  resetArmed = false;
  window.clearTimeout(resetTimer);
  dom.resetButton.textContent = "恢复默认样式";
  dom.resetButton.style.color = "";
  state.settings = {
    ...DEFAULT_SETTINGS,
    engine: state.settings.engine,
    wallpaper: { ...DEFAULT_SETTINGS.wallpaper }
  };
  setEditing(false);
  applyUiState();
  saveNow();
  showToast("已恢复默认样式，收藏保持不变");
}

function handleGlobalKeydown(event) {
  const active = document.activeElement;
  const isTyping = active instanceof HTMLElement &&
    (active.matches("input, select, textarea") || active.isContentEditable);

  if (event.key === "Escape") {
    if (!dom.contextMenu.hidden) {
      closeHomeContextMenu();
      return;
    }
    if (dom.linkDialog.open) {
      closeLinkDialog();
      return;
    }
    if (historyIsOpen) {
      closeHistory();
      return;
    }
    if (settingsIsOpen) {
      closeSettings();
      return;
    }
    if (editing) {
      setEditing(false);
      return;
    }
    if (active === dom.searchInput) {
      if (dom.searchInput.value) {
        dom.searchInput.value = "";
      } else {
        dom.searchInput.blur();
      }
    }
    return;
  }

  if (historyIsOpen) return;

  if (event.key === "/" && !isTyping && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    dom.searchInput.focus();
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    dom.searchInput.focus();
    dom.searchInput.select();
  }
}

function bindEvents() {
  dom.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    searchOrOpen(dom.searchInput.value);
  });

  dom.historyButton.addEventListener("click", openHistory);
  dom.historyClose.addEventListener("click", closeHistory);
  dom.historyBackdrop.addEventListener("click", closeHistory);
  dom.historyPanel.addEventListener("keydown", trapHistoryFocus);
  dom.historySearch.addEventListener("input", queueHistorySearch);
  dom.historySearch.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    const firstResult = dom.historyList.querySelector(".history-item");
    if (!firstResult) return;
    event.preventDefault();
    firstResult.click();
  });
  dom.historySearchClear.addEventListener("click", clearHistorySearch);
  dom.settingsButton.addEventListener("click", openSettings);
  dom.settingsClose.addEventListener("click", closeSettings);
  dom.settingsBackdrop.addEventListener("click", closeSettings);
  dom.settingsSheet.addEventListener("keydown", trapSettingsFocus);
  dom.editButton.addEventListener("click", () => setEditing(!editing));
  dom.contextEditHome.addEventListener("click", () => {
    closeHomeContextMenu();
    setEditing(true);
    dom.favoritesGrid.querySelector(".favorite")?.focus();
  });
  dom.contextEditSite.addEventListener("click", () => {
    const id = contextMenuLinkId;
    closeHomeContextMenu();
    if (id) openLinkDialog("edit", id);
  });
  dom.contextFinishEdit.addEventListener("click", () => {
    closeHomeContextMenu();
    setEditing(false);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!dom.contextMenu.hidden && !dom.contextMenu.contains(event.target)) {
      closeHomeContextMenu();
    }
  });
  document.addEventListener("pointermove", handlePointerDragMove, {
    passive: false
  });
  document.addEventListener("pointerup", finishPointerDrag);
  document.addEventListener("pointercancel", finishPointerDrag);
  document.addEventListener("click", (event) => {
    if (performance.now() >= suppressClickUntil) return;
    suppressClickUntil = 0;
    event.preventDefault();
    event.stopPropagation();
  }, true);
  document.addEventListener("click", (event) => {
    if (!editing) return;
    const interactiveArea = event.target.closest?.(
      ".favorite, .add-favorite, .remove-favorite, .collection-header, .topbar, .context-menu, .glass-dialog, .sheet-layer, .history-layer, .toast"
    );
    if (!interactiveArea) setEditing(false);
  });
  window.addEventListener("resize", closeHomeContextMenu);
  window.addEventListener("scroll", closeHomeContextMenu, true);

  dom.favoritesGrid.addEventListener("dragover", handleDragOver);
  dom.favoritesGrid.addEventListener("drop", (event) => {
    event.preventDefault();
    if (draggedId) handleDragEnd();
  });

  dom.linkForm.addEventListener("submit", finishLinkDialog);
  dom.linkDialogClose.addEventListener("click", closeLinkDialog);
  dom.linkCancel.addEventListener("click", closeLinkDialog);
  dom.linkDialog.addEventListener("click", (event) => {
    if (event.target === dom.linkDialog) closeLinkDialog();
  });

  dom.linkName.addEventListener("input", updateLinkPreview);
  dom.linkUrl.addEventListener("input", updateLinkPreview);
  dom.linkIconText.addEventListener("compositionstart", () => {
    iconTextComposing = true;
  });
  dom.linkIconText.addEventListener("compositionend", () => {
    iconTextComposing = false;
    applyIconTextInput();
  });
  dom.linkIconText.addEventListener("input", (event) => {
    if (iconTextComposing || event.isComposing) return;
    applyIconTextInput();
  });
  for (const button of dom.iconModeButtons) {
    button.addEventListener("click", () => {
      setDialogIconMode(button.dataset.iconMode);
    });
  }
  dom.linkUrl.addEventListener("blur", () => {
    if (!dom.linkName.value.trim()) {
      const suggestion = prettyNameFromUrl(dom.linkUrl.value);
      if (suggestion) {
        dom.linkName.value = suggestion;
        updateLinkPreview();
      }
    }
  });

  dom.overlayRange.addEventListener("input", () => {
    state.settings.overlay = Number(dom.overlayRange.value);
    dom.overlayOutput.value = `${state.settings.overlay}%`;
    document.documentElement.style.setProperty(
      "--veil-alpha",
      String(state.settings.overlay / 100)
    );
    scheduleSave();
  });
  dom.overlayRange.addEventListener("change", saveNow);

  dom.blurRange.addEventListener("input", () => {
    state.settings.blur = Number(dom.blurRange.value);
    dom.blurOutput.value = `${state.settings.blur} px`;
    document.documentElement.style.setProperty(
      "--wallpaper-blur",
      `${state.settings.blur}px`
    );
    scheduleSave();
  });
  dom.blurRange.addEventListener("change", saveNow);

  dom.engineSelect.addEventListener("change", () => {
    state.settings.engine = dom.engineSelect.value;
    saveNow();
  });

  dom.labelsToggle.addEventListener("change", () => {
    state.settings.showLabels = dom.labelsToggle.checked;
    dom.collection.classList.toggle("hide-labels", !state.settings.showLabels);
    saveNow();
  });

  dom.iconSizeRange.addEventListener("input", () => {
    state.settings.iconSize = Number(dom.iconSizeRange.value);
    dom.iconSizeOutput.value = `${state.settings.iconSize} px`;
    applyLayout();
    scheduleSave();
  });
  dom.iconSizeRange.addEventListener("change", saveNow);

  dom.iconGapRange.addEventListener("input", () => {
    state.settings.iconGap = Number(dom.iconGapRange.value);
    dom.iconGapOutput.value = `${state.settings.iconGap} px`;
    applyLayout();
    scheduleSave();
  });
  dom.iconGapRange.addEventListener("change", saveNow);

  dom.columnsRange.addEventListener("input", () => {
    state.settings.columns = Number(dom.columnsRange.value);
    dom.columnsOutput.value = `${state.settings.columns} 个`;
    applyLayout();
    scheduleSave();
  });
  dom.columnsRange.addEventListener("change", saveNow);

  dom.wallpaperUpload.addEventListener("click", () => dom.wallpaperFile.click());
  dom.wallpaperFile.addEventListener("change", () => {
    handleWallpaperFile(dom.wallpaperFile.files?.[0]);
  });

  dom.resetButton.addEventListener("click", handleReset);
  document.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("pagehide", saveNow);
}

function applySyncedState(nextState) {
  if (JSON.stringify(nextState) === JSON.stringify(state)) return;
  state = nextState;
  applyUiState();
  renderFavorites();
}

async function syncFromStorage() {
  if (!isExtension) return;
  applySyncedState(await loadState());
}

function bindStorageSync() {
  if (!isExtension) return;

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEY]) return;
    applySyncedState(normalizeState(changes[STORAGE_KEY].newValue));
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) syncFromStorage();
  });
}

async function init() {
  dom.searchShortcut.textContent = navigator.platform.toLowerCase().includes("mac")
    ? "⌘ K"
    : "Ctrl K";
  state = await loadState();
  buildWallpaperOptions();
  bindEvents();
  bindStorageSync();
  applyUiState();
  renderFavorites();

  if (location.hash === "#settings") {
    openSettings();
    history.replaceState(null, "", location.pathname);
  }
}

init();
