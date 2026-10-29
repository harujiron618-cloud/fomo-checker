"use strict";

/* ===== 設定 ===== */
// 生成AIの中継サーバーURL。空のままなら内蔵のルールベースのアドバイスを使う。
// ※APIキーはブラウザのコードに絶対に書かない(中継サーバー側で管理する)。
//   中継サーバーは POST {prompt} を受け取り {text} を返す想定。
const AI_ENDPOINT = "";
const STORAGE_KEY = "fomoChecker.history.v1";

/* ===== 質問項目 =====
   FOMO: Przybylski et al. (2013) の10項目を訳した【仮訳】。研究で使う場合は正式な日本語版に差し替えてください。
   スマホ: 筆者作成の【仮の項目】。SUPIQ等の日本語版が決まったら差し替えてください。 */
const FOMO_ITEMS = [
  "他の人が自分より充実した経験をしているのではないかと不安になる",
  "友達が自分より充実した経験をしているのではないかと不安になる",
  "友達が何をしているのか分からないと不安になる",
  "友達の「内輪ネタ」を理解しておくことは大切だ",
  "周りの出来事を追いかけるのに時間を使いすぎていないかと思うことがある",
  "友達と会う機会を逃すと気になる",
  "予定されていた集まりに行けないと気になる",
  "楽しい時間を過ごしたら、その様子をSNSなどで共有することが大切だ",
  "旅行や外出中も、友達が何をしているかをチェックし続ける",
  "友達と会う約束がある時、何があるのかを知っておくことが大切だ"
];
const PHONE_ITEMS = [
  "スマホを使う時間が、思っていたより長くなってしまう",
  "使うのをやめようとしても、なかなかやめられない",
  "スマホのせいで、勉強や宿題が進まないことがある",
  "夜遅くまでスマホを見て、睡眠不足になることがある",
  "スマホが手元にないと落ち着かない",
  "通知が来ると、すぐ確認せずにいられない",
  "人と一緒にいる時でも、つい画面を見てしまう",
  "スマホの使いすぎを、家族や友達に指摘されたことがある",
  "気分が落ち込んだ時、スマホを見て紛らわせることが多い",
  "スマホの使い方を減らしたいと思うことがある"
];
const ALL_ITEMS = [
  ...FOMO_ITEMS.map((t) => ({ key: "f", text: t })),
  ...PHONE_ITEMS.map((t) => ({ key: "p", text: t }))
];

/* ===== 画面要素の取得 ===== */
const $ = (id) => document.getElementById(id);
const screens = ["intro", "survey", "result"];
function show(name) { screens.forEach((s) => { $(s).hidden = s !== name; }); window.scrollTo(0, 0); }

/* ===== 履歴の保存・読込(localStorageが使えない環境でも落ちないようにする) ===== */
function loadHistory() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(data) ? data : [];
  } catch (e) { return []; }
}
function saveHistory(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(-30))); } catch (e) { /* 保存不可は無視 */ }
}

/* ===== 質問フォームの生成 ===== */
function buildForm() {
  const form = $("form");
  form.textContent = "";
  ALL_ITEMS.forEach((item, i) => {
    const fs = document.createElement("fieldset");
    const lg = document.createElement("legend");
    lg.textContent = `${i + 1}. ${item.text}`;   // textContentでXSSを防ぐ
    fs.appendChild(lg);
    const row = document.createElement("div");
    row.className = "choices";
    for (let v = 1; v <= 5; v++) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio"; input.name = "q" + i; input.value = String(v);
      const span = document.createElement("span");
      span.textContent = String(v);
      label.append(input, span);
      row.appendChild(label);
    }
    fs.appendChild(row);
    form.appendChild(fs);
  });
}

/* ===== 採点 =====(各10問・1〜5点 → 合計10〜50点) */
function readScores() {
  let f = 0, p = 0;
  for (let i = 0; i < ALL_ITEMS.length; i++) {
    const checked = document.querySelector(`input[name="q${i}"]:checked`);
    if (!checked) return null;                    // 未回答あり
    if (ALL_ITEMS[i].key === "f") f += Number(checked.value); else p += Number(checked.value);
  }
  return { fomo: f, phone: p };
}
// 目安の区分(診断ではない。仮の基準)
function level(score) { return score <= 23 ? "低め" : score <= 36 ? "ふつう" : "高め"; }

/* ===== アドバイス ===== */
function localAdvice(s) {
  const lf = level(s.fomo), lp = level(s.phone);
  const tips = [];
  if (lf === "高め") tips.push("「みんな楽しそう」に見えるSNSは、実際は一部を切り取ったものです。見る時間を決めてみましょう。");
  else tips.push("人の様子が気になりすぎない、いいバランスです。この感覚を大事にしましょう。");
  if (lp === "高め") tips.push("寝る30分前はスマホを手の届かない所に置く、通知を一部オフにするなど、小さな工夫から始めてみましょう。");
  else if (lp === "ふつう") tips.push("勉強中だけ通知を切るなど、ひとつだけルールを作ると効果的です。");
  else tips.push("スマホとの距離感は良好です。");
  if (lf === "高め" && lp === "高め") tips.push("不安でスマホを開く流れができているかも。つらい時は、信頼できる人に話してみてください。");
  return tips.join("\n");
}
async function getAdvice(s) {
  if (!AI_ENDPOINT) return localAdvice(s);
  const prompt = `高校生向けに、やさしく具体的に150字以内でアドバイスしてください。診断や断定はしないこと。` +
    `FOMO得点${s.fomo}/50(${level(s.fomo)})、スマホ使用の得点${s.phone}/50(${level(s.phone)})。`;
  try {
    const res = await fetch(AI_ENDPOINT, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    return typeof data.text === "string" && data.text ? data.text : localAdvice(s);
  } catch (e) { return localAdvice(s); }           // 失敗時は内蔵アドバイスに切替
}

/* ===== 結果表示 ===== */
function renderScores(s) {
  const box = $("scores");
  box.textContent = "";
  [["FOMO", s.fomo], ["スマホ使用", s.phone]].forEach(([name, v]) => {
    const row = document.createElement("div");
    row.className = "score";
    row.textContent = `${name}:${v} / 50(${level(v)})`;
    box.appendChild(row);
  });
}
// 推移グラフ(外部ライブラリなしのSVG折れ線)
function renderChart(history) {
  const box = $("chart");
  box.textContent = "";
  if (history.length < 2) { box.textContent = "2回以上チェックすると推移が表示されます。"; return; }
  const W = 300, H = 140, pad = 24;
  const pts = history.map((h, i) => {
    const x = pad + (i * (W - pad * 2)) / (history.length - 1);
    const y = H - pad - ((h.fomo - 10) / 40) * (H - pad * 2);
    return [x, y];
  });
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const line = document.createElementNS(NS, "polyline");
  line.setAttribute("points", pts.map((p) => p.join(",")).join(" "));
  line.setAttribute("fill", "none"); line.setAttribute("stroke", "var(--accent)"); line.setAttribute("stroke-width", "2");
  svg.appendChild(line);
  pts.forEach(([x, y]) => {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", "3.5"); c.setAttribute("fill", "var(--accent)");
    svg.appendChild(c);
  });
  [["10点", H - pad], ["50点", pad]].forEach(([t, y]) => {   // 目盛り
    const tx = document.createElementNS(NS, "text");
    tx.setAttribute("x", 2); tx.setAttribute("y", y + 4); tx.setAttribute("font-size", "9"); tx.setAttribute("fill", "var(--sub)");
    tx.textContent = t; svg.appendChild(tx);
  });
  box.appendChild(svg);
  const cap = document.createElement("p");
  cap.className = "note";
  cap.textContent = `FOMO得点の推移(直近${history.length}回)`;
  box.appendChild(cap);
}
function showResult(s, history, withAdvice) {
  show("result");
  renderScores(s);
  renderChart(history);
  const adv = $("advice");
  if (!withAdvice) { adv.textContent = "過去の結果の表示です。"; return; }
  adv.textContent = "アドバイスを作成中…";
  getAdvice(s).then((t) => { adv.textContent = t; adv.style.whiteSpace = "pre-line"; });
}

/* ===== ダークモード ===== */
function applyTheme(t) { document.documentElement.setAttribute("data-theme", t); try { localStorage.setItem("fomoChecker.theme", t); } catch (e) {} }
function initTheme() {
  let t = null;
  try { t = localStorage.getItem("fomoChecker.theme"); } catch (e) {}
  if (t) applyTheme(t);   // 未設定なら端末設定(CSSのprefers-color-scheme)に従う
}
$("themeToggle").addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme")
    || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(cur === "dark" ? "light" : "dark");
});

/* ===== イベント ===== */
$("startBtn").addEventListener("click", () => { buildForm(); $("error").textContent = ""; show("survey"); });
$("submitBtn").addEventListener("click", () => {
  const s = readScores();
  if (!s) { $("error").textContent = "未回答の質問があります。すべて答えてください。"; return; }
  const history = loadHistory();
  history.push({ date: new Date().toISOString(), fomo: s.fomo, phone: s.phone });
  saveHistory(history);
  showResult(s, history, true);
});
$("historyBtn").addEventListener("click", () => {
  const h = loadHistory();
  if (!h.length) { alert("まだ履歴がありません。"); return; }
  showResult(h[h.length - 1], h, false);
});
$("retryBtn").addEventListener("click", () => show("intro"));
$("clearBtn").addEventListener("click", () => {
  if (confirm("履歴をすべて削除しますか?")) { try { localStorage.removeItem(STORAGE_KEY); } catch (e) {} show("intro"); }
});

initTheme();
