// 画面表示とイベント処理
(function () {
  "use strict";
  const { QUESTIONS, SCALES, SCALE_LABELS, RESEARCH, ResearchInfo, Scoring, Feedback, Storage } = window.FomoApp;

  const PAGE_SIZE = 3; // 1ページの質問数
  const TOTAL_PAGES = Math.ceil(QUESTIONS.length / PAGE_SIZE);
  // 生成AI接続口：サーバー側のURLを入れると補助ボタンが表示される（APIキーはここに書かない）
  const AI_CONFIG = { endpoint: "", timeoutMs: 15000 };

  const state = { answers: {}, page: 0 };
  const root = document.getElementById("app");
  let chartInstance = null;

  // 要素作成の補助関数（innerHTMLを使わずXSSを避ける）
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v);
    });
    children.flat().forEach((c) => {
      if (c == null || c === false) return;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    });
    return el;
  }

  // 画面を差し替える
  function mount(...nodes) {
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    // 配列やnullが混ざっていても文字列化されないよう、展開して除外する
    root.replaceChildren(...nodes.flat().filter((n) => n != null && n !== false));
    window.scrollTo(0, 0);
    root.focus();
  }

  const fmtDate = (iso) =>
    new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

  const footerNote = () =>
    h("p", { class: "muted" }, "このアプリは診断ツールではありません。回答は、スマホやSNSとの関わり方を振り返るための参考です。結果はこの端末のブラウザに保存され、名前などの個人情報は集めません。");

  // ---------- 設定（保存方法の選択） ----------
  function renderStorageChooser() {
    const message = h("p", { class: "muted", role: "status" });
    const current = Storage.getMode();
    const rows = Object.keys(Storage.MODES).map((key) => {
      const input = h("input", { type: "radio", name: "storageMode", value: key });
      input.checked = key === current;
      input.addEventListener("change", () => {
        if (Storage.setMode(key)) {
          message.textContent = "保存方法を「" + Storage.MODES[key].label + "」に変更しました。これまでの履歴も移しました。";
        } else {
          message.textContent = "この保存方法は今の環境では使えませんでした。元の方法のままです。";
          card.querySelector('input[name="storageMode"][value="' + Storage.getMode() + '"]').checked = true;
        }
      });
      return h("label", { class: "choice-row" }, input,
        h("span", null, h("strong", null, Storage.MODES[key].label), h("br"), h("span", { class: "muted" }, Storage.MODES[key].description)));
    });
    const card = h("div", { class: "card" },
      h("h3", null, "結果の保存方法"),
      h("p", { class: "muted" }, "どちらも、名前などの個人情報は保存されません。あとからいつでも変更できます。"),
      rows, message);
    return card;
  }

  // 右上の設定ボタンから開く画面（回答の途中でも開ける）
  function openSettings() {
    if (document.getElementById("settings-modal")) return;
    const closeBtn = h("button", { class: "btn", onclick: close }, "閉じる");
    const overlay = h("div", { id: "settings-modal", class: "modal-backdrop", onclick: (e) => { if (e.target === overlay) close(); } },
      h("div", { class: "modal-panel", role: "dialog", "aria-modal": "true", "aria-label": "設定" },
        h("h2", { style: "margin-top:0" }, "設定"),
          closeBtn));
    function onKey(e) { if (e.key === "Escape") close(); }
    function close() { overlay.remove(); document.removeEventListener("keydown", onKey); settingsBtn.focus(); }
    document.addEventListener("keydown", onKey);
    document.body.append(overlay);
    closeBtn.focus();
  }

  const settingsBtn = h("button", { id: "settings-btn", class: "settings-btn", "aria-label": "設定（保存方法）", onclick: openSettings }, "\u2699\uFE0E");

  // ---------- 開始画面 ----------
  function renderStart() {
    mount(
      h("h1", null, "FOMOチェッカー"),
      h("p", { class: "tagline" }, "画面よりも、目の前の『今』を。"),
      h("p", null, "全30問・5段階で回答します（5分ほど）。正解や点数の良し悪しはありません。スマホやSNSとの関わり方を、自分のペースで振り返るためのアプリです。"),
      h("div", { class: "card" },
        h("h3", null, "はじめる前に"),
        h("ul", { class: "plain" },
          h("li", null, "名前・学校名・メールアドレスなどは入力しません。"),
          h("li", null, "回答の履歴は、この端末のブラウザに保存されます（保存方法は右上の設定で選べます）。"),
          h("li", null, "SNSやスマホを否定するものではありません。")
        )
      ),
      renderStorageChooser(),
      h("button", { class: "btn", onclick: startSurvey }, "アンケートを始める"),
      h("button", { class: "btn secondary", onclick: renderHistory }, "過去の得点の推移"),
      h("button", { class: "btn secondary", onclick: () => renderResearch(renderStart) }, "研究について"),
      footerNote()
    );
  }

  function startSurvey() { state.answers = {}; state.page = 0; renderSurvey(); }

  // ---------- アンケート画面 ----------
  function renderSurvey() {
    const start = state.page * PAGE_SIZE;
    const pageQuestions = QUESTIONS.slice(start, start + PAGE_SIZE);
    const isLast = state.page === TOTAL_PAGES - 1;

    const progressText = h("span");
    const progressFill = h("div");
    const errorBox = h("p", { class: "error", role: "alert" });
    const nextBtn = h("button", { class: "btn", onclick: onNext }, isLast ? "結果を見る" : "次へ");

    // 回答状況（プログレスバー）と「次へ」ボタンの有効状態を更新
    function refresh() {
      const answered = QUESTIONS.filter((q) => state.answers[q.id]).length;
      progressFill.style.width = (answered / QUESTIONS.length) * 100 + "%";
      progressText.textContent = "回答済み " + answered + " / " + QUESTIONS.length;
      nextBtn.disabled = !pageQuestions.every((q) => state.answers[q.id]);
    }

    function onNext() {
      if (!pageQuestions.every((q) => state.answers[q.id])) {
        errorBox.textContent = "回答していない質問があります。";
        return;
      }
      if (isLast) finishSurvey();
      else { state.page += 1; renderSurvey(); }
    }

    const fields = pageQuestions.map((q, i) =>
      h("fieldset", { class: "question" },
        h("legend", null, "Q" + (start + i + 1) + ". " + q.text),
        h("div", { class: "choices" },
          SCALE_LABELS.map((label, idx) => {
            const value = idx + 1;
            const input = h("input", { type: "radio", name: q.id, value: value, "aria-label": label });
            input.checked = state.answers[q.id] === value;
            input.addEventListener("change", () => { state.answers[q.id] = value; errorBox.textContent = ""; refresh(); });
            return h("label", null, input, h("span", null, value));
          })
        ),
        h("div", { class: "scale-hint" }, h("span", null, "1 " + SCALE_LABELS[0]), h("span", null, "5 " + SCALE_LABELS[4]))
      )
    );

    mount(
      h("div", { class: "progress", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": QUESTIONS.length }, progressFill),
      h("p", { class: "muted" }, progressText, "　（" + (state.page + 1) + " / " + TOTAL_PAGES + " ページ）"),
      fields, errorBox, nextBtn,
      state.page > 0
        ? h("button", { class: "btn secondary", onclick: () => { state.page -= 1; renderSurvey(); } }, "戻る")
        : h("button", { class: "btn secondary", onclick: renderStart }, "最初の画面へ")
    );
    refresh();
  }

  // ---------- 採点して結果へ ----------
  function finishSurvey() {
    if (!Scoring.validateAnswers(state.answers, QUESTIONS)) {
      // 未回答があれば最初の未回答ページへ戻す
      const idx = QUESTIONS.findIndex((q) => !state.answers[q.id]);
      state.page = Math.max(0, Math.floor(idx / PAGE_SIZE));
      renderSurvey();
      return;
    }
    const scores = Scoring.calcScores(state.answers, QUESTIONS, SCALES);
    const previous = Storage.loadHistory().slice(-1)[0] || null;
    const saved = Storage.saveEntry(scores); // 結果表示時に1回だけ保存
    renderResult(scores, previous, saved);
  }

  // ---------- 結果画面 ----------
  function renderResult(scores, previous, saved) {
    const fb = Feedback.build(scores);

    const bars = SCALES.map((s) =>
      h("div", { class: "bar-row" },
        h("div", { class: "bar-label" }, h("span", null, s.label), h("span", null, scores[s.id].toFixed(2) + " / 5")),
        h("div", { class: "bar-track" }, h("div", { class: "bar-fill", style: "width:" + (scores[s.id] / 5) * 100 + "%" }))
      )
    );

    const cards = SCALES.map((s) =>
      h("div", { class: "card" },
        h("h3", null, s.label + "：" + Feedback.LEVEL_LABEL[fb.levels[s.id]]),
        h("p", null, fb.byScale[s.id])
      )
    );

    const researchRows = RESEARCH.factors.map((f) => h("li", null, f.name + "：β=" + f.beta));

    const aiArea = h("div");
    if (AI_CONFIG.endpoint) {
      const out = h("p", null);
      const btn = h("button", { class: "btn secondary" }, "AIで振り返りのヒントを作る（任意）");
      btn.addEventListener("click", async () => {
        btn.disabled = true; out.textContent = "作成中です…";
        try {
          out.textContent = await fetchAiAdvice({ scores: scores, levels: fb.levels, topFactor: fb.topFactor });
        } catch (err) {
          out.textContent = "AIによる文章は今回は表示できませんでした。上のフィードバックをご利用ください。";
        }
        btn.disabled = false;
      });
      aiArea.append(btn, out, h("p", { class: "muted" }, "AIの文章は診断ではなく、振り返りのヒントです。送信されるのは得点と段階のみで、個人情報は含まれません。"));
    }

    mount(
      h("h1", null, "あなたの回答傾向"),
      h("p", { class: "muted" }, "点数は平均（1〜5）です。良い・悪いを示すものではなく、今回の回答の傾向を表しています。"),
      bars,
      h("h2", null, "振り返りのヒント"),
      cards,
      fb.topFactorText ? h("div", { class: "card" }, h("h3", null, "3つの利用傾向の中で"), h("p", null, fb.topFactorText)) : null,
      h("div", { class: "card" }, h("h3", null, "まとめ"), h("p", null, fb.summary)),
      h("div", { class: "card" }, h("h3", null, "自分に問いかけてみよう"), h("p", null, ResearchInfo.reflectionPrompt)),
      aiArea,
      h("h2", null, "研究結果との関連"),
      h("p", null, "今回の研究では、3つのスマホ利用傾向の中で『ネットコミュニケーションへの没頭』がFOMOと最も強い関連を示しました。これは「一緒に高くなりやすい傾向」を示す結果であり、SNSがFOMOを引き起こすといった因果関係や、あなたの状態を決めるものではありません。"),
      h("details", null,
        h("summary", null, "詳しい数値を見る"),
        h("p", { class: "muted" }, "FOMO得点を目的変数とした重回帰分析の結果（標準化係数）"),
        h("ul", { class: "plain" }, researchRows),
        h("p", null, "R²=" + RESEARCH.r2 + "　" + RESEARCH.f + "　" + RESEARCH.p)
      ),
      saved ? h("p", { class: "muted" }, "今回の結果を「" + Storage.MODES[Storage.getMode()].label + "」に保存しました。") : h("p", { class: "muted" }, "この端末では結果を保存できませんでした。"),
      previous ? h("p", { class: "muted" }, describeChange(previous, scores)) : null,
      h("button", { class: "btn", onclick: renderHistory }, "過去の結果と見比べる"),
      h("button", { class: "btn secondary", onclick: () => renderResearch(() => renderResult(scores, previous, saved)) }, "研究について詳しく見る"),
      h("button", { class: "btn secondary", onclick: renderStart }, "最初の画面へ"),
      footerNote()
    );
  }

  // 前回との比較（良し悪しは判定せず、中立的に表現）
  function describeChange(prev, cur) {
    const changed = SCALES.some((s) => Math.abs(cur[s.id] - prev[s.id]) >= 0.3);
    return changed ? "前回と比較して回答傾向に変化がみられました。" : "前回と比べて、回答傾向に大きな変化はみられませんでした。";
  }

  // ---------- 履歴画面 ----------
  function renderHistory() {
    const list = Storage.loadHistory();
    if (list.length === 0) {
      mount(h("h1", null, "過去の結果"), h("p", null, "まだ保存された結果はありません。"),
        h("button", { class: "btn", onclick: renderStart }, "戻る"));
      return;
    }
    const colors = ["#e45756", "#4c78a8", "#54a24b", "#f2a541"];
    const canvas = h("canvas", { "aria-label": "回答傾向の推移グラフ" });
    const rows = list.slice().reverse().map((e) =>
      h("tr", null, h("td", null, fmtDate(e.date)), SCALES.map((s) => h("td", null, e[s.id].toFixed(2))))
    );

    mount(
      h("h1", null, "過去の結果"),
      h("p", { class: "muted" }, "回答傾向の推移です。数値の増減は良し悪しを表すものではありません。"),
      h("div", { class: "chart-box" }, canvas),
      list.length >= 2 ? h("p", null, describeChange(list[list.length - 2], list[list.length - 1])) : h("p", { class: "muted" }, "2回以上回答すると、前回との比較が表示されます。"),
      h("div", { class: "table-wrap" },
        h("table", null,
          h("thead", null, h("tr", null, h("th", null, "日時"), SCALES.map((s) => h("th", null, s.short)))),
          h("tbody", null, rows))),
      h("button", { class: "btn", onclick: renderStart }, "戻る"),
      h("button", { class: "btn secondary", onclick: () => {
        if (window.confirm("この端末に保存された履歴をすべて削除します。よろしいですか？")) { Storage.clearHistory(); renderHistory(); }
      } }, "履歴をすべて削除する")
    );

    // Chart.jsが読み込めた場合のみグラフを描画（失敗しても表で確認できる）
    if (window.Chart) {
      chartInstance = new window.Chart(canvas, {
        type: "line",
        data: {
          labels: list.map((e) => fmtDate(e.date)),
          datasets: SCALES.map((s, i) => ({
            label: s.short, data: list.map((e) => e[s.id]), borderColor: colors[i], backgroundColor: colors[i], tension: 0.2, pointRadius: 4
          }))
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 1, max: 5, ticks: { stepSize: 1 } } } }
      });
    }
  }

  // ---------- 研究について ----------
  // SVG要素の作成補助
  function sv(tag, attrs, ...children) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
    children.flat().forEach((c) => { if (c != null) el.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return el;
  }

  // 重回帰分析のパス図（線の太さはβの大きさに比例）
  function buildPathDiagram() {
    const shortNames = { f1: "F1 没頭", f2: "F2 優先・長時間", f3: "F3 ながら・マナー" };
    const ys = [20, 82, 144];
    const parts = [sv("title", null, "3つのスマホ利用傾向からFOMO得点へのパス図")];
    RESEARCH.factors.forEach((f, i) => {
      const y = ys[i];
      parts.push(sv("line", { class: "path-line", x1: 150, y1: y + 18, x2: 232, y2: 100, "stroke-width": Math.max(1.5, parseFloat("0" + f.beta) * 12) }));
      parts.push(sv("rect", { class: "svg-box", x: 6, y: y, width: 144, height: 36, rx: 8 }));
      parts.push(sv("text", { class: "svg-text", x: 78, y: y + 23, "text-anchor": "middle" }, shortNames[f.id]));
      parts.push(sv("text", { class: "svg-label", x: 192, y: (y + 18 + 100) / 2 + (i === 1 ? -6 : i === 0 ? -4 : 12), "text-anchor": "middle" }, "β=" + f.beta));
    });
    parts.push(sv("rect", { class: "svg-fomo", x: 232, y: 82, width: 82, height: 36, rx: 18 }));
    parts.push(sv("text", { class: "svg-fomo-text", x: 273, y: 105, "text-anchor": "middle" }, "FOMO得点"));
    return sv("svg", { viewBox: "0 0 320 190", role: "img", "aria-label": "パス図：F1が.35、F2が.22、F3が.14でFOMO得点と関連", class: "path-svg" }, parts);
  }

  function renderResearch(backFn) {
    const statLine = "R²=" + RESEARCH.r2 + "　" + RESEARCH.f + "　" + RESEARCH.p;
    mount(
      h("h1", null, "研究について"),
      h("p", null, ResearchInfo.intro),
      h("h2", null, "1. スマホ利用の3つの傾向とFOMO"),
      buildPathDiagram(),
      h("ul", { class: "plain" }, RESEARCH.factors.map((f) => h("li", null, f.name + "：β=" + f.beta))),
      h("p", { class: "muted" }, statLine),
      h("p", null, ResearchInfo.regression),
      h("h2", null, "2. 回答に多く現れた言葉"),
      h("p", null, ResearchInfo.textMiningIntro),
      ResearchInfo.themes.map((t) => h("div", { class: "card" }, h("h3", null, t.title), h("p", { class: "muted" }, t.words))),
      h("h2", null, "3. 学年・性別・所属での比較"),
      h("p", null, ResearchInfo.comparison),
      h("h2", null, "4. 結果を読むときの注意"),
      h("ul", { class: "plain" }, ResearchInfo.cautions.map((c) => h("li", null, c))),
      h("button", { class: "btn", onclick: backFn }, "戻る"),
      footerNote()
    );
  }

  // ---------- 生成AI接続口（サーバー経由） ----------
  async function fetchAiAdvice(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_CONFIG.timeoutMs);
    try {
      const res = await fetch(AI_CONFIG.endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: controller.signal
      });
      if (!res.ok) throw new Error("bad status");
      const data = await res.json();
      if (typeof data.advice !== "string" || !data.advice.trim()) throw new Error("invalid response");
      return data.advice.slice(0, 800);
    } finally {
      clearTimeout(timer);
    }
  }

  document.body.append(settingsBtn);
  // 起動（二重描画を避けるため1回だけ呼ぶ）
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderStart);
  else renderStart();
})();
