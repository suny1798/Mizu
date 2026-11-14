import {
  STORAGE_KEY,
  makeId,
  normalizeState,
  normalizeUrl
} from "./data.js";

const COLORS = [
  "#687c78",
  "#a87962",
  "#75816a",
  "#887666",
  "#6b7988",
  "#98716e",
  "#758074",
  "#83726d"
];

const dom = {
  popupWallpaper: document.querySelector("#popup-wallpaper"),
  pageCard: document.querySelector("#page-card"),
  pageIcon: document.querySelector("#page-icon"),
  pageTitle: document.querySelector("#page-title"),
  pageHost: document.querySelector("#page-host"),
  addButton: document.querySelector("#add-button"),
  addLabel: document.querySelector("#add-label"),
  feedback: document.querySelector("#feedback"),
  openStart: document.querySelector("#open-start"),
  openSettings: document.querySelector("#open-settings")
};

let activeTab = null;
let currentUrl = null;
let currentTitle = "";
let bestPageIcon = "";
let bestPageIconIsHighRes = false;
let busy = false;
let readyToAdd = false;

function applyPopupWallpaper(wallpaper) {
  dom.popupWallpaper.style.backgroundImage = "";
  dom.popupWallpaper.dataset.preset = wallpaper.type === "preset"
    ? wallpaper.value
    : "custom";

  if (wallpaper.type === "image") {
    dom.popupWallpaper.style.backgroundImage = `url("${wallpaper.value}")`;
  }

}

function iconColorFor(value) {
  let hash = 0;
  for (const char of value) {
    hash = ((hash << 5) - hash + (char.codePointAt(0) || 0)) | 0;
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

function trimTitle(value) {
  return Array.from(String(value || "").replace(/\s+/g, " ").trim())
    .slice(0, 36)
    .join("");
}

function titleForTab(tab, url) {
  const candidate = trimTitle(tab.title);
  if (candidate && candidate !== tab.url) return candidate;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "未命名网页";
  }
}

function hostForUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function showMonogram(label) {
  dom.pageIcon.classList.remove("has-image");
  dom.pageIcon.replaceChildren();
  const monogram = document.createElement("span");
  monogram.className = "page-monogram";
  monogram.textContent = Array.from(label || "?").slice(0, 1).join("").toUpperCase();
  dom.pageIcon.style.background = iconColorFor(label || "?");
  dom.pageIcon.append(monogram);
}

function showPageIcon(sources, label) {
  const candidates = [...new Set(sources.filter(Boolean))];
  showMonogram(label);

  const tryNext = () => {
    const src = candidates.shift();
    if (!src) return;

    const image = new Image();
    image.referrerPolicy = "no-referrer";
    image.alt = "";
    image.addEventListener("error", tryNext, { once: true });
    image.addEventListener("load", () => {
      dom.pageIcon.replaceChildren(image);
      dom.pageIcon.classList.add("has-image");
      dom.pageIcon.style.background = "";
    }, { once: true });
    image.src = src;
  };

  tryNext();
}

function setSavedState(message = "已添加到个人收藏") {
  readyToAdd = false;
  dom.pageTitle.disabled = true;
  dom.pageCard.classList.remove("is-error");
  dom.pageCard.classList.add("is-saved");
  dom.addButton.classList.remove("is-loading", "is-error", "is-saving");
  dom.addButton.classList.add("is-saved");
  dom.addButton.disabled = true;
  dom.addLabel.textContent = "已在个人收藏中";
  dom.feedback.classList.remove("is-error");
  dom.feedback.classList.add("is-saved");
  dom.feedback.textContent = message;
}

function setErrorState(reason, feedback) {
  readyToAdd = false;
  dom.pageTitle.disabled = true;
  dom.pageCard.classList.add("is-error");
  dom.addButton.classList.remove("is-loading", "is-saving", "is-saved");
  dom.addButton.classList.add("is-error");
  dom.addButton.disabled = true;
  dom.addLabel.textContent = reason;
  dom.feedback.classList.remove("is-saved");
  dom.feedback.classList.add("is-error");
  dom.feedback.textContent = feedback;
}

function setReadyState() {
  readyToAdd = true;
  dom.pageTitle.disabled = false;
  dom.pageCard.classList.remove("is-error", "is-saved");
  dom.addButton.classList.remove("is-loading", "is-error", "is-saving", "is-saved");
  dom.feedback.classList.remove("is-error", "is-saved");
  syncTitleState();
}

function syncTitleState() {
  currentTitle = trimTitle(dom.pageTitle.value);
  dom.pageTitle.title = currentTitle;
  if (!readyToAdd) return;

  const hasTitle = Boolean(currentTitle);
  dom.addButton.disabled = !hasTitle;
  dom.addLabel.textContent = hasTitle
    ? "添加到个人收藏"
    : "请填写收藏名称";
  dom.feedback.textContent = hasTitle
    ? "名称可修改，地址会自动使用当前页面"
    : "收藏名称不能为空";
}

async function fetchActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  if (!tab) throw new Error("没有找到当前标签页");
  return tab;
}

async function readSavedState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeState(result[STORAGE_KEY]);
}

function iconScore(icon) {
  const rel = String(icon.rel || "").toLowerCase();
  let score = Number(icon.size) || 0;
  if (rel.includes("apple-touch-icon")) score += 2000;
  if (icon.isSvg) score += 1800;
  if (rel.includes("mask-icon")) score -= 3000;
  if (String(icon.href || "").startsWith("data:")) score += 2500;
  return score;
}

function chooseBestPageIcon(tabIcon, discoveredIcons) {
  const best = [...discoveredIcons].sort((a, b) => iconScore(b) - iconScore(a))[0];
  if (best && iconScore(best) >= 96) {
    return { src: best.href, highRes: true };
  }
  return {
    src: tabIcon || best?.href || "",
    highRes: false
  };
}

async function discoverPageIcons(tab) {
  if (!chrome.scripting?.executeScript || !Number.isInteger(tab?.id)) return [];

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const icons = [];
        const seen = new Set();
        for (const link of document.querySelectorAll("link[rel]")) {
          const rel = String(link.rel || "").toLowerCase();
          const rels = rel.split(/\s+/);
          const isIcon = rels.some((token) =>
            token === "icon" ||
            token === "apple-touch-icon" ||
            token === "apple-touch-icon-precomposed" ||
            token === "mask-icon"
          );
          if (!isIcon || !link.href || seen.has(link.href)) continue;
          seen.add(link.href);
          const sizes = String(link.sizes?.value || "");
          const size = Math.max(
            0,
            ...(sizes.match(/\d+/g) || []).map((value) => Number(value))
          );
          icons.push({
            href: link.href,
            rel,
            size,
            isSvg: /svg/i.test(link.type || "") ||
              /\.svg(?:[?#]|$)/i.test(link.href)
          });
        }
        return icons;
      }
    });
    return Array.isArray(injection?.result) ? injection.result : [];
  } catch (error) {
    console.warn("Mizu could not read the page's icon links.", error);
    return [];
  }
}

async function initialise() {
  try {
    let storedState;
    try {
      storedState = await readSavedState();
    } catch (error) {
      console.error(error);
      storedState = normalizeState(null);
    }
    applyPopupWallpaper(storedState.settings.wallpaper);

    activeTab = await fetchActiveTab();
    dom.pageHost.textContent = "正在读取地址";
    dom.pageHost.title = "";

    if (typeof activeTab.url !== "string" || !activeTab.url) {
      dom.pageTitle.value = "这个页面无法读取";
      dom.pageHost.textContent = "Chrome 内部页面";
      showMonogram("·");
      setErrorState("无法收藏此页面", "Chrome 内部页面不允许扩展读取网址。");
      return;
    }

    if (activeTab.url.startsWith(chrome.runtime.getURL(""))) {
      dom.pageTitle.value = "Mizu 起始页";
      dom.pageHost.textContent = "扩展页面";
      showPageIcon(["assets/icon-128.png"], "M");
      setErrorState("当前已是起始页", "在普通网页上点击扩展图标，即可快速收藏。");
      return;
    }

    currentUrl = normalizeUrl(activeTab.url);
    if (!currentUrl) {
      dom.pageTitle.value = trimTitle(activeTab.title) || "当前页面";
      dom.pageHost.textContent = activeTab.url.split(":")[0] || "";
      showMonogram(dom.pageTitle.value);
      setErrorState("无法收藏此页面", "只支持普通的 http 或 https 网页。");
      return;
    }

    currentTitle = titleForTab(activeTab, currentUrl);
    const host = hostForUrl(currentUrl);
    dom.pageTitle.value = currentTitle;
    dom.pageTitle.title = String(activeTab.title || currentTitle);
    dom.pageHost.textContent = host;
    dom.pageHost.title = currentUrl;

    const fallbackIcon = `${new URL(currentUrl).origin}/favicon.ico`;
    const discoveredIcons = await discoverPageIcons(activeTab);
    const iconChoice = chooseBestPageIcon(activeTab.favIconUrl, discoveredIcons);
    bestPageIcon = iconChoice.src;
    bestPageIconIsHighRes = iconChoice.highRes;
    showPageIcon(
      [bestPageIcon, activeTab.favIconUrl, fallbackIcon],
      currentTitle
    );

    const existingLink = storedState.links.find((link) => link.url === currentUrl);
    if (existingLink) {
      if (bestPageIcon &&
          (bestPageIconIsHighRes || !existingLink.icon)) {
        existingLink.icon = bestPageIcon;
        await chrome.storage.local.set({ [STORAGE_KEY]: storedState });
      }
      setSavedState("这个页面之前已经收藏过");
      return;
    }

    setReadyState();
  } catch (error) {
    console.error(error);
    dom.pageTitle.value = "无法读取当前页面";
    dom.pageHost.textContent = "请关闭弹窗后重试";
    showMonogram("·");
    setErrorState("无法收藏此页面", "没有取得当前标签页的访问权限。");
  }
}

async function addCurrentPage() {
  const title = trimTitle(dom.pageTitle.value);
  if (busy || !currentUrl || !title) {
    dom.pageTitle.focus();
    return;
  }
  currentTitle = title;
  busy = true;
  dom.addButton.disabled = true;
  dom.addButton.classList.add("is-saving");
  dom.addLabel.textContent = "正在收藏…";
  dom.feedback.textContent = "正在写入本地收藏";

  try {
    const state = await readSavedState();
    if (state.links.some((link) => link.url === currentUrl)) {
      setSavedState("这个页面之前已经收藏过");
      return;
    }

    state.links.push({
      id: makeId(),
      title,
      url: currentUrl,
      ...(bestPageIcon ? { icon: bestPageIcon } : {})
    });
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
    setSavedState("起始页会自动更新");
  } catch (error) {
    console.error(error);
    dom.addButton.classList.remove("is-saving");
    dom.addButton.classList.add("is-error");
    dom.addLabel.textContent = "收藏失败";
    dom.feedback.classList.add("is-error");
    dom.feedback.textContent = "浏览器本地存储空间可能已经满了。";
  } finally {
    busy = false;
  }
}

async function openTab(url) {
  try {
    await chrome.tabs.create(url ? { url } : {});
    window.close();
  } catch (error) {
    console.error(error);
  }
}

dom.addButton.addEventListener("click", addCurrentPage);
dom.pageTitle.addEventListener("input", syncTitleState);
dom.pageTitle.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    if (!dom.addButton.disabled) addCurrentPage();
  }
});
dom.openStart.addEventListener("click", () => openTab());
dom.openSettings.addEventListener("click", () => {
  openTab(chrome.runtime.getURL("newtab.html#settings"));
});

initialise();
