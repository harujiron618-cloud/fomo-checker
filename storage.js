// localStorageの読み書き（壊れたデータや保存不可でも落ちないようにする）
(function () {
  "use strict";
  const KEY = "fomoChecker.history.v1";
  const MAX_ENTRIES = 50;

  const isValidEntry = (e) =>
    e && typeof e.date === "string" && ["fomo", "f1", "f2", "f3"].every((k) => typeof e[k] === "number" && isFinite(e[k]));

  function loadHistory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter(isValidEntry) : [];
    } catch (err) {
      return [];
    }
  }

  // 保存に成功したらtrue
  function saveEntry(scores) {
    try {
      const entry = { date: new Date().toISOString(), fomo: scores.fomo, f1: scores.f1, f2: scores.f2, f3: scores.f3 };
      const list = loadHistory();
      list.push(entry);
      localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_ENTRIES)));
      return true;
    } catch (err) {
      return false;
    }
  }

  function clearHistory() {
    try { localStorage.removeItem(KEY); } catch (err) { /* 何もしない */ }
  }

  window.FomoApp = window.FomoApp || {};
  window.FomoApp.Storage = { loadHistory, saveEntry, clearHistory };
})();
