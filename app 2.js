// 画面表示とイベント処理
(function () {
  "use strict";

  // 必要なデータ・機能が読み込まれているかを確認（読み込み失敗時に白い画面にならないようにする）
  const App = window.FomoApp || {};
  const REQUIRED = ["QUESTIONS", "SCALES", "SCALE_LABELS", "RESEARCH", "ResearchInfo", "REFLECTIONS", "Scoring", "Feedback", "Storage"];
  const missing = REQUIRED.filter((key) => !App[key]);
  if (missing.length > 0) {
    console.error("読み込めなかった項目:", missing.join(", "));
    document.getElementById("app").textContent = "アプリを読み込めませんでした。ページを再読み込みしてください。";
    return;
  }
  const { QUESTIONS, SCALES, SCALE_LABELS, RESEARCH, ResearchInfo, REFLECTIONS, Scoring, Feedback, Storage } = App;

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

  // 文中の {{...}} で囲んだ部分を、重要な文（class="key"）にする。太字になるのは、まとめ・振り返りの枠（class="emph"）の中だけ（style.css参照）
  // テキストノードだけを作るので、文字列に含まれるHTMLは実行されない
  function rich(text) {
    return String(text).split(/\{\{(.+?)\}\}/g).map((part, i) => (i % 2 === 1 ? h("span", { class: "key" }, part) : part));
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
    h("div", null,
      h("p", { class: "note" }, rich("{{このアプリは診断ツールではありません。}}回答は、スマホやSNSとの関わり方を振り返るための参考です。結果はこの端末のブラウザに保存され、名前などの個人情報は集めません。")),
      h("p", { class: "note" }, "スマホやSNSのことで気になることや困っていることがあれば、家族や先生、学校の相談窓口など、信頼できる人にも話してみてください。"));

  // ---------- グラフの共通設定 ----------
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const prefersReducedMotion = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  // #rrggbb の色に透明度（16進2桁）を足す。それ以外の形式はそのまま返す
  const withAlpha = (color, alpha) => (/^#[0-9a-f]{6}$/i.test(color) ? color + alpha : color);

  // ライト／ダークモードに合わせて、グラフの文字と線の色をCSS変数から決める
  function applyChartTheme() {
    window.Chart.defaults.color = cssVar("--muted");
    window.Chart.defaults.borderColor = cssVar("--line");
  }

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
      h("p", { class: "note" }, "どちらも、名前などの個人情報は保存されません。あとからいつでも変更できます。"),
      rows, message);
    return card;
  }

  // 右上の設定ボタンから開く画面（回答の途中でも開ける）
  function openSettings() {
    if (document.getElementById("settings-modal")) return;
    const closeBtn = h("button", { class: "btn", onclick: close }, "閉じる");
    const overlay = h("div", { id: "settings-modal", class: "modal-backdrop", onclick: (e) => { if (e.target === overlay) close(); } },
      h("div", { class: "modal-panel", role: "dialog", "aria-modal": "true", "aria-labelledby": "settings-title" },
        h("h2", { id: "settings-title", style: "margin-top:0" }, "設定"),
        renderStorageChooser(),
        closeBtn));

    function onKey(e) {
      if (e.key === "Escape") { close(); return; }
      if (e.key !== "Tab") return;
      // Tabキーで設定画面の外へフォーカスが出ないようにする
      const first = overlay.querySelector('input[type="radio"]:checked') || overlay.querySelector("input");
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); closeBtn.focus(); }
      else if (!e.shiftKey && document.activeElement === closeBtn) { e.preventDefault(); first.focus(); }
    }
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
      h("p", null, rich("全" + QUESTIONS.length + "問・5段階で回答します（5分ほど）。{{正解や点数の良し悪しはありません。}}スマホやSNSとの関わり方を、自分のペースで振り返るためのアプリです。")),
      h("div", { class: "card" },
        h("h3", null, "はじめる前に"),
        h("ul", { class: "plain" },
          h("li", null, "名前・学校名・メールアドレスなどは入力しません。"),
          h("li", null, "回答の履歴は、この端末のブラウザに保存されます（保存方法は右上の設定で選べます）。"),
          h("li", null, rich("{{SNSやスマホを否定するものではありません。}}"))
        )
      ),
      h("button", { class: "btn", onclick: startSurvey }, "アンケートを始める"),
      h("button", { class: "btn secondary", onclick: renderHistory }, "過去の得点の推移"),
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
    const progressBar = h("div", {
      class: "progress", role: "progressbar", "aria-label": "回答の進み具合",
      "aria-valuemin": 0, "aria-valuemax": QUESTIONS.length, "aria-valuenow": 0
    }, progressFill);
    const errorBox = h("p", { class: "error", role: "alert" });
    const nextBtn = h("button", { class: "btn", onclick: onNext }, isLast ? "結果を見る" : "次へ");

    // 回答状況（プログレスバー）と「次へ」ボタンの有効状態を更新
    function refresh() {
      const answered = QUESTIONS.filter((q) => state.answers[q.id]).length;
      progressFill.style.width = (answered / QUESTIONS.length) * 100 + "%";
      progressBar.setAttribute("aria-valuenow", answered);
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
      progressBar,
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
  // レーダーチャート：今回の回答と参加者全体の平均を重ねて表示する（中心が1点、外側が5点）
  function drawRadar(canvas, scores) {
    const sample = RESEARCH.sample;
    const accent = cssVar("--accent");
    const muted = cssVar("--muted");
    const gridColor = withAlpha(muted, "59"); // 目盛り線は少し濃くして読み取りやすくする
    applyChartTheme();
    return new window.Chart(canvas, {
      type: "radar",
      data: {
        labels: SCALES.map((s) => s.short),
        datasets: [
          // 色だけに頼らないよう、平均は破線・ひし形の点で区別する
          { label: "あなたの平均点", data: SCALES.map((s) => scores[s.id]),
            borderColor: accent, backgroundColor: withAlpha(accent, "33"), borderWidth: 2, pointRadius: 4, pointBackgroundColor: accent },
          { label: sample.label, data: SCALES.map((s) => sample.means[s.id]),
            borderColor: muted, backgroundColor: "transparent", borderWidth: 2, borderDash: [6, 4], pointRadius: 4, pointStyle: "rectRot", pointBackgroundColor: muted }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: prefersReducedMotion() ? false : { duration: 400 },
        layout: { padding: 6 },
        scales: {
          r: {
            min: 1, max: 5,
            // 目盛りの数字は中心(1)と外側(5)だけにして、グラフと重なりにくくする
            ticks: { stepSize: 1, backdropColor: "transparent", callback: (v) => (v === 1 || v === 5 ? v : "") },
            grid: { color: gridColor }, angleLines: { color: gridColor },
            pointLabels: { color: cssVar("--text"), font: { size: 12 } }
          }
        },
        plugins: { legend: { position: "bottom", labels: { padding: 18 } } }
      }
    });
  }

  // グラフの代替テキスト（スクリーンリーダー用）
  function radarAltText(scores) {
    const sample = RESEARCH.sample;
    return "レーダーチャート。" + SCALES.map((s) =>
      s.label + "：あなた " + scores[s.id].toFixed(2) + "、" + sample.label + " " + sample.means[s.id].toFixed(2)).join("。");
  }

  // 数値の比較表（グラフが読み込めない場合の代わりにもなる）
  function buildCompareTable(scores) {
    const sample = RESEARCH.sample;
    const rows = SCALES.map((s) =>
      h("tr", null,
        h("th", { scope: "row" }, s.label),
        h("td", null, scores[s.id].toFixed(2)),
        h("td", null, sample.means[s.id].toFixed(2)))
    );
    return h("div", { class: "table-wrap" },
      h("table", null,
        h("caption", { class: "muted" }, "平均点（1〜5）の比較"),
        h("thead", null, h("tr", null, h("th", { scope: "col" }, "項目"), h("th", { scope: "col" }, "あなたの平均点"), h("th", { scope: "col" }, sample.label))),
        h("tbody", null, rows)));
  }

  // 研究の説明（research.js の文章をまとめて表示）
  function buildResearchDetails() {
    return h("details", null,
      h("summary", null, "この研究について"),
      h("p", null, ResearchInfo.intro),
      h("p", null, ResearchInfo.textMiningIntro),
      h("ul", { class: "plain" }, ResearchInfo.themes.map((t) => h("li", null, t.title + "（" + t.words + "）"))),
      h("p", null, ResearchInfo.comparison),
      h("p", { class: "note" }, ResearchInfo.scaleNote),
      h("ul", { class: "plain note" }, ResearchInfo.cautions.map((c) => h("li", null, rich(c))))
    );
  }

  function renderResult(scores, previous, saved) {
    const fb = Feedback.build(scores);
    const sample = RESEARCH.sample;
    // グラフ上の略称と正式名称の対応（F1などの記号は使わない）
    const abbrevNote = "グラフの項目名は略称です（" +
      SCALES.filter((s) => s.id !== "fomo").map((s) => s.short + "＝" + s.label).join("、") + "）。";

    const canvas = h("canvas", { role: "img", "aria-label": radarAltText(scores) });
    const radarBox = window.Chart
      ? h("div", { class: "chart-box radar" }, canvas)
      : h("p", { class: "muted" }, "グラフを読み込めませんでした。下の表で確認できます。");

    // 4つの項目ごとの振り返り（折りたたみ）
    const cards = SCALES.map((s) =>
      h("div", { class: "card" },
        h("h3", null, s.label + "：" + Feedback.LEVEL_LABEL[fb.levels[s.id]]),
        h("p", null, rich(fb.byScale[s.id]))
      )
    );
    const scaleDetails = h("details", null,
      h("summary", null, "4つの項目ごとの振り返りを見る"),
      h("p", { class: "note" }, rich("「あてはまらない寄り・どちらともいえない前後・あてはまる寄り」は、平均点（1〜5）を3つに分けた文章切り替え用の目安です。{{他の人との比較や、診断・正式な基準ではありません。}}")),
      cards);

    // 相対的に高い因子（同点なら複数）：「あなたの回答」「研究全体の結果」「解釈の注意」を分けて示す
    const topCard = fb.topFactorTexts.length > 0
      ? h("div", { class: "card key-card emph" },
          h("h3", null, "3つの利用傾向の中で"),
          fb.topFactorTexts.length > 1 ? h("p", { class: "muted" }, "同じくらい高い因子が複数ありました。") : null,
          fb.topFactorTexts.flatMap((t) => [
            h("p", null, h("span", { class: "layer-tag" }, "あなたの回答"), rich(t.personal + t.reflect)),
            h("p", null, h("span", { class: "layer-tag" }, "研究全体の結果"), t.study)
          ]),
          h("p", null, h("span", { class: "layer-tag" }, "解釈の注意"), rich(fb.topFactorCaution)),
          h("p", { class: "note" }, rich("{{この判定は、あなたの3つの得点どうしを比べたもので、参加者全体の平均との比較ではありません。}}")))
      : null;

    const ctx = { fb: fb, scores: scores, previous: previous, saved: saved };
    const reflectCard = h("div", { class: "card emph" },
      h("h3", null, "振り返りのために"),
      h("p", null, rich(fb.summary)),
      h("p", null, rich(fb.researchHint)),
      h("p", { class: "reflect" }, fb.reflectionPrompt),
      h("button", { class: "btn secondary", onclick: () => startReflection(ctx) }, "振り返りワークに進む（任意）"),
      h("p", { class: "note" }, "ワークの答えは保存も送信もされません。"));

    const researchRows = RESEARCH.factors.map((f) => h("li", null, f.name + "：β=" + f.beta));

    const aiArea = h("div");
    if (AI_CONFIG.endpoint) {
      const out = h("p", null);
      const btn = h("button", { class: "btn secondary" }, "AIで振り返りのヒントを作る（任意）");
      btn.addEventListener("click", async () => {
        btn.disabled = true; out.textContent = "作成中です…";
        try {
          out.textContent = await fetchAiAdvice({ scores: scores, levels: fb.levels, topFactors: fb.topFactors });
        } catch (err) {
          out.textContent = "AIによる文章は今回は表示できませんでした。上のフィードバックをご利用ください。";
        }
        btn.disabled = false;
      });
      aiArea.append(btn, out, h("p", { class: "note" }, "AIの文章は診断ではなく、振り返りのヒントです。送信されるのは得点と段階のみで、個人情報は含まれません。"));
    }

    const saveNote = saved
      ? h("p", { class: "save-note" }, "今回の結果をこの端末のブラウザ（" + Storage.MODES[Storage.getMode()].label + "）に保存しました。削除は「過去の結果」画面からできます。")
      : h("p", { class: "save-note" }, "この端末では結果を保存できませんでした。");

    mount(
      h("h1", null, "あなたの回答傾向"),
      h("p", { class: "note" }, rich("点数は、各項目の回答の平均点（1〜5）です。{{良い・悪いを示すものではなく、今回の回答の傾向を表しています。}}")),
      radarBox,
      h("p", { class: "note" }, rich("破線は" + sample.label + "（n=" + sample.n + "）です。グラフの中心が1点、外側が5点です。{{平均は基準値や正常範囲ではなく、平均との違いは良い・悪いを示すものではありません。}}")),
      h("p", { class: "note" }, abbrevNote),
      buildCompareTable(scores),
      h("h2", null, "振り返りのポイント"),
      topCard,
      reflectCard,
      scaleDetails,
      aiArea,
      h("h2", null, "研究結果との関連"),
      h("p", null, rich(ResearchInfo.connection.intro + ResearchInfo.connection.ranking)),
      h("p", null, rich(ResearchInfo.connection.r2)),
      h("p", null, rich(ResearchInfo.connection.caution)),
      h("details", null,
        h("summary", null, "詳しい数値を見る"),
        h("p", { class: "muted" }, "FOMO得点を目的変数とした重回帰分析の結果（標準化係数）"),
        h("ul", { class: "plain" }, researchRows),
        h("p", null, "R²=" + RESEARCH.r2 + "　" + RESEARCH.f + "　" + RESEARCH.p),
        h("p", { class: "muted" }, "数値の読み方"),
        h("ul", { class: "plain muted" }, ResearchInfo.statGuide.map((t) => h("li", null, t)))
      ),
      buildResearchDetails(),
      saveNote,
      previous ? h("p", { class: "muted" }, describeChange(previous, scores)) : null,
      h("button", { class: "btn", onclick: renderHistory }, "過去の結果と見比べる"),
      h("button", { class: "btn secondary", onclick: renderStart }, "最初の画面へ"),
      footerNote()
    );

    // Chart.jsが読み込めた場合のみ描画（失敗しても表で確認できる）
    if (window.Chart) {
      try { chartInstance = drawRadar(canvas, scores); }
      catch (err) { console.error("レーダーチャートを描画できませんでした:", err); }
    }
  }

  // ---------- 振り返りワーク（任意。答えは画面内のメモリだけに置き、保存も送信もしない） ----------
  const reflect = { ctx: null, steps: [], index: 0, picks: {} };

  const factorName = (id) => SCALES.find((s) => s.id === id).label;

  // 質問の順序：共通の質問 → 相対的に高かった因子の問い → 最後の質問
  function buildReflectionSteps(fb) {
    const steps = REFLECTIONS.common.map((q) => ({ kind: "choose", id: q.id, title: q.question, options: q.options }));
    fb.topFactors.forEach((id) => steps.push({
      kind: "think", id: id, title: "『" + factorName(id) + "』について、思い出してみましょう", prompts: REFLECTIONS.factors[id]
    }));
    steps.push({ kind: "choose", id: "final", title: REFLECTIONS.final.question, options: REFLECTIONS.final.options });
    return steps;
  }

  function startReflection(ctx) {
    reflect.ctx = ctx; reflect.steps = buildReflectionSteps(ctx.fb); reflect.index = 0; reflect.picks = {};
    renderReflection();
  }

  function leaveReflection() {
    const ctx = reflect.ctx;
    reflect.ctx = null; reflect.steps = []; reflect.picks = {}; // 答えは破棄する
    renderResult(ctx.scores, ctx.previous, ctx.saved);
  }

  function renderReflection() {
    const total = reflect.steps.length;
    const privacyNote = h("p", { class: "note" }, "ここでの答えは、保存も送信もされません。この画面を閉じると消えます。");

    // 最後まで終わったとき：選んだ「意識してみたいこと」を振り返って終わる
    if (reflect.index >= total) {
      const chosen = Array.from(reflect.picks.final || []);
      mount(
        h("h1", null, "振り返りワーク"),
        h("h2", null, "今日のまとめ"),
        chosen.length > 0
          ? h("div", { class: "card" }, h("h3", null, "意識してみたいこと"), h("ul", { class: "plain" }, chosen.map((c) => h("li", null, c))))
          : h("p", { class: "muted" }, "今回は、意識してみたいことを選ばずに終わりました。それも一つの選び方です。"),
        h("p", null, REFLECTIONS.closing),
        privacyNote,
        h("button", { class: "btn", onclick: leaveReflection }, "結果に戻る"),
        h("button", { class: "btn secondary", onclick: () => { reflect.ctx = null; reflect.picks = {}; renderStart(); } }, "最初の画面へ"),
        footerNote()
      );
      return;
    }

    const step = reflect.steps[reflect.index];
    let body;
    if (step.kind === "choose") {
      const picked = reflect.picks[step.id] || (reflect.picks[step.id] = new Set());
      body = h("fieldset", { class: "question" },
        h("legend", null, step.title),
        h("p", { class: "muted" }, "当てはまるものをいくつでも選べます。答えたくないときは、選ばずに進めます。"),
        step.options.map((opt) => {
          const input = h("input", { type: "checkbox", value: opt });
          input.checked = picked.has(opt);
          input.addEventListener("change", () => { if (input.checked) picked.add(opt); else picked.delete(opt); });
          return h("label", { class: "choice-row" }, input, h("span", null, opt));
        }));
    } else {
      body = h("div", { class: "card" },
        h("h3", null, step.title),
        h("p", { class: "muted" }, "答えを入力する必要はありません。頭の中で考えてみてください。"),
        h("ul", { class: "plain" }, step.prompts.map((p) => h("li", null, p))));
    }

    mount(
      h("h1", null, "振り返りワーク"),
      h("p", { class: "muted" }, "（任意）" + (reflect.index + 1) + " / " + total),
      body,
      privacyNote,
      h("button", { class: "btn", onclick: () => { reflect.index += 1; renderReflection(); } }, reflect.index === total - 1 ? "おわる" : "次へ"),
      reflect.index > 0 ? h("button", { class: "btn secondary", onclick: () => { reflect.index -= 1; renderReflection(); } }, "戻る") : null,
      h("button", { class: "btn secondary", onclick: leaveReflection }, "結果に戻る")
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
    const canvas = h("canvas", { role: "img", "aria-label": "回答傾向の推移グラフ。数値は下の表にあります。" });
    const rows = list.slice().reverse().map((e) =>
      h("tr", null, h("td", null, fmtDate(e.date)), SCALES.map((s) => h("td", null, e[s.id].toFixed(2))))
    );

    mount(
      h("h1", null, "過去の結果"),
      h("p", { class: "note" }, rich("回答傾向の推移です。{{数値の増減は良し悪しを表すものではありません。}}")),
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
      try {
        applyChartTheme();
        chartInstance = new window.Chart(canvas, {
          type: "line",
          data: {
            labels: list.map((e) => fmtDate(e.date)),
            datasets: SCALES.map((s, i) => ({
              label: s.short, data: list.map((e) => e[s.id]), borderColor: colors[i], backgroundColor: colors[i], tension: 0.2, pointRadius: 4
            }))
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            animation: prefersReducedMotion() ? false : { duration: 400 },
            scales: { y: { min: 1, max: 5, ticks: { stepSize: 1 } } }
          }
        });
      } catch (err) { console.error("履歴グラフを描画できませんでした:", err); }
    }
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
