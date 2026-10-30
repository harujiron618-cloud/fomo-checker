// 採点ロジック（画面表示とは独立）
(function () {
  "use strict";

  // 文面切り替え用の目安（正式なカットオフ値ではない。1〜5を3等分した設定値）
  const LEVEL_THRESHOLDS = { lowMax: 2.33, midMax: 3.66 };
  // F1〜F3の最高と最低の差がこの値未満なら「明確な差なし」とする
  const NO_DIFFERENCE_RANGE = 0.5;

  const round2 = (n) => Math.round(n * 100) / 100;

  // 回答の検証：全質問に1〜5の整数が入っているか
  function validateAnswers(answers, questions) {
    if (!answers || typeof answers !== "object") return false;
    return questions.every((q) => Number.isInteger(answers[q.id]) && answers[q.id] >= 1 && answers[q.id] <= 5);
  }

  // 尺度ごとの平均点を計算
  function calcScores(answers, questions, scales) {
    const scores = {};
    scales.forEach((s) => {
      const items = questions.filter((q) => q.scale === s.id);
      const sum = items.reduce((acc, q) => acc + answers[q.id], 0);
      scores[s.id] = items.length ? round2(sum / items.length) : 0;
    });
    return scores;
  }

  // 平均点 → "low" / "mid" / "high"（文面用）
  function getLevel(score) {
    if (score <= LEVEL_THRESHOLDS.lowMax) return "low";
    else if (score <= LEVEL_THRESHOLDS.midMax) return "mid";
    else return "high";
  }

  // F1・F2・F3のうち本人の中で相対的に高い因子を判定（差が小さければnull）
  function getTopFactor(scores) {
    const f1 = scores.f1, f2 = scores.f2, f3 = scores.f3;
    const range = Math.max(f1, f2, f3) - Math.min(f1, f2, f3);
    if (range < NO_DIFFERENCE_RANGE) return null;
    if (f1 >= f2 && f1 >= f3) return "f1";
    else if (f2 >= f3) return "f2";
    else return "f3";
  }

  window.FomoApp = window.FomoApp || {};
  window.FomoApp.Scoring = { validateAnswers, calcScores, getLevel, getTopFactor, LEVEL_THRESHOLDS, NO_DIFFERENCE_RANGE };
})();
