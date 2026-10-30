// 保存処理（localStorage / Cookie をユーザーが選べる。壊れたデータや保存不可でも落ちないようにする）
(function () {
  "use strict";
  const HISTORY_KEY = "fomoChecker.history.v1"; // localStorage用キー
  const COOKIE_KEY = "fomoHistory";             // Cookie用キー
  const PREF_KEY = "fomoChecker.storageMode";   // 保存方法の選択を覚えるキー
  const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;    // Cookieの有効期間（1年）

  // 保存方法の定義（説明文はここで管理）
  const MODES = {
    local: {
      label: "ローカルストレージ",
      description: "アプリ情報をデバイスに保存します。しかし使用時にダウンロードが必要です。"
    },
    cookie: {
      label: "クッキー",
      description: "アプリ情報をブラウザに保存します。しかしデータが消える可能性があります。"
    }
  };
  const MAX_ENTRIES = { local: 50, cookie: 30 };

  const isValidEntry = (e) =>
    e && typeof e.date === "string" && !isNaN(Date.parse(e.date)) &&
    ["fomo", "f1", "f2", "f3"].every((k) => typeof e[k] === "number" && isFinite(e[k]));

  // ---------- Cookieの基本操作 ----------
  function readCookie(name) {
    try {
      const hit = document.cookie.split("; ").find((c) => c.startsWith(name + "="));
      return hit ? decodeURIComponent(hit.slice(name.length + 1)) : "";
    } catch (err) { return ""; }
  }
  function writeCookie(name, value, maxAge) {
    try {
      const secure = location.protocol === "https:" ? "; Secure" : "";
      document.cookie = name + "=" + encodeURIComponent(value) + "; max-age=" + maxAge + "; path=/; SameSite=Lax" + secure;
    } catch (err) { /* 何もしない */ }
  }

  // ---------- 履歴の変換（Cookieは容量が小さいので短い形式にする） ----------
  // 1件 = "分(36進):FOMO:F1:F2:F3"（得点は100倍の整数）、件の区切りは "|"
  function encodeList(list) {
    return list.map((e) => [
      Math.floor(Date.parse(e.date) / 60000).toString(36),
      Math.round(e.fomo * 100), Math.round(e.f1 * 100), Math.round(e.f2 * 100), Math.round(e.f3 * 100)
    ].join(":")).join("|");
  }
  function decodeList(text) {
    if (!text) return [];
    return text.split("|").map((part) => {
      const p = part.split(":");
      if (p.length !== 5) return null;
      const minutes = parseInt(p[0], 36);
      const nums = p.slice(1).map((n) => parseInt(n, 10) / 100);
      if (!isFinite(minutes) || nums.some((n) => !isFinite(n))) return null;
      return { date: new Date(minutes * 60000).toISOString(), fomo: nums[0], f1: nums[1], f2: nums[2], f3: nums[3] };
    }).filter(isValidEntry);
  }

  // ---------- 保存方法の選択 ----------
  function getMode() {
    let v = "";
    try { v = localStorage.getItem(PREF_KEY) || ""; } catch (err) { /* 何もしない */ }
    if (!v) v = readCookie(PREF_KEY);
    if (MODES[v]) return v;
    // 初期設定はクッキー。ただしクッキーが使えない環境（file://で開いた場合など）ではローカルストレージにする
    return cookieWorks() ? "cookie" : "local";
  }
  // クッキーが実際に使えるかを確認する
  function cookieWorks() {
    writeCookie("fomoTest", "1", 60);
    const ok = readCookie("fomoTest") === "1";
    writeCookie("fomoTest", "", 0);
    return ok;
  }
  function savePref(mode) {
    try { localStorage.setItem(PREF_KEY, mode); } catch (err) { /* 何もしない */ }
    writeCookie(PREF_KEY, mode, COOKIE_MAX_AGE);
  }

  // ---------- 方法ごとの読み書き ----------
  function readList(mode) {
    if (mode === "cookie") return decodeList(readCookie(COOKIE_KEY));
    try {
      const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter(isValidEntry) : [];
    } catch (err) { return []; }
  }
  // 書き込み後に読み返して、本当に保存できたか確認する
  function writeList(mode, list) {
    const trimmed = list.slice(-MAX_ENTRIES[mode]);
    if (mode === "cookie") {
      writeCookie(COOKIE_KEY, encodeList(trimmed), COOKIE_MAX_AGE);
      return readList("cookie").length === trimmed.length;
    }
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
      return true;
    } catch (err) { return false; }
  }
  function clearMode(mode) {
    if (mode === "cookie") writeCookie(COOKIE_KEY, "", 0);
    else { try { localStorage.removeItem(HISTORY_KEY); } catch (err) { /* 何もしない */ } }
  }

  // 保存方法を切り替える。これまでの履歴は新しい方法へ移す。成功したらtrue
  function setMode(newMode) {
    if (!MODES[newMode]) return false;
    const oldMode = getMode();
    if (newMode === oldMode) return true;
    const oldList = readList(oldMode);
    if (oldList.length > 0 && !writeList(newMode, oldList)) {
      clearMode(newMode); // 失敗したら元の方法のまま
      return false;
    }
    savePref(newMode);
    clearMode(oldMode);
    return true;
  }

  // ---------- 公開API ----------
  const loadHistory = () => readList(getMode());
  function saveEntry(scores) {
    const entry = { date: new Date().toISOString(), fomo: scores.fomo, f1: scores.f1, f2: scores.f2, f3: scores.f3 };
    const list = loadHistory();
    list.push(entry);
    return writeList(getMode(), list);
  }
  const clearHistory = () => clearMode(getMode());

  window.FomoApp = window.FomoApp || {};
  window.FomoApp.Storage = { loadHistory, saveEntry, clearHistory, getMode, setMode, MODES };
})();
