const EXAM_HISTORY_KEY = "dangke-exam-history";
const APP_STORAGE_KEY = "dangke-question-bank-state";

const state = {
  payload: null,
  filteredQuestions: [],
  currentIndex: 0,
  randomMode: false,
  showAnswer: false,
  selectedOptions: [],
  answerFeedback: null,
  autoNextTimer: null,
  isExamMode: false,
  examAnswers: {},
  examSubmitted: false,
  examHistory: [],
  currentExamId: null,
  examReviewFilter: "all",
  currentExamQuestions: null,
};

const elements = {
  heroStats: document.getElementById("hero-stats"),
  questionPosition: document.getElementById("question-position"),
  progressLabel: document.getElementById("progress-label"),
  progressFill: document.getElementById("progress-fill"),
  questionMeta: document.getElementById("question-meta"),
  questionStem: document.getElementById("question-stem"),
  optionList: document.getElementById("option-list"),
  optionActions: document.getElementById("option-actions"),
  submitAnswer: document.getElementById("submit-answer"),
  resetSelection: document.getElementById("reset-selection"),
  answerBox: document.getElementById("answer-box"),
  noteBox: document.getElementById("note-box"),
  explanationBox: document.getElementById("explanation-box"),
  viewExplanationMobile: document.getElementById("view-explanation-mobile"),
  explanationModal: document.getElementById("explanation-modal"),
  modalOverlay: document.getElementById("modal-overlay"),
  modalClose: document.getElementById("modal-close"),
  modalExplanationBody: document.getElementById("modal-explanation-body"),
  prevButton: document.getElementById("prev-question"),
  nextButton: document.getElementById("next-question"),
  prevButtonMobile: document.getElementById("prev-question-mobile"),
  nextButtonMobile: document.getElementById("next-question-mobile"),
  answerButton: document.getElementById("toggle-answer"),
  answerButtonMobile: document.getElementById("toggle-answer-mobile"),
  wrongButton: document.getElementById("toggle-wrong"),
  inlineWrongBtn: document.getElementById("inline-wrong-btn"),
  inlineWrongBtnMobile: document.getElementById("inline-wrong-btn-mobile"),

  // Exam mode elements
  generateExamButton: document.getElementById("generate-exam"),
  examTopline: document.getElementById("exam-topline"),
  examPosition: document.getElementById("exam-position"),
  exitExamButton: document.getElementById("exit-exam"),
  submitExamButton: document.getElementById("submit-exam"),
  fillInputContainer: document.getElementById("fill-input-container"),
  fillAnswerInput: document.getElementById("fill-answer-input"),
  examResultModal: document.getElementById("exam-result-modal"),
  examModalClose: document.getElementById("exam-modal-close"),
  examScoreDisplay: document.getElementById("exam-score-display"),
  examScoreDetail: document.getElementById("exam-score-detail"),
  examReviewButton: document.getElementById("exam-review-button"),
  examExitButton: document.getElementById("exam-exit-button"),
  viewExamHistoryButton: document.getElementById("view-exam-history"),
  quickHistoryBtn: document.getElementById("quick-history-btn"),
  examHistoryModal: document.getElementById("exam-history-modal"),
  examHistoryOverlay: document.getElementById("exam-history-overlay"),
  examHistoryClose: document.getElementById("exam-history-close"),
  examHistoryList: document.getElementById("exam-history-list"),
  examReviewFilterGroup: document.getElementById("exam-review-filter-group"),
  exportExamRecord: document.getElementById("export-exam-record"),
  importExamRecordTrigger: document.getElementById("import-exam-record-trigger"),
  importExamRecord: document.getElementById("import-exam-record"),
  examQuestionGrid: document.getElementById("exam-question-grid"),
  gridAnsweredSummary: document.getElementById("grid-answered-summary"),

  // 移动端抽屉
  controlsDrawer: document.getElementById("controls-drawer"),
  drawerBackdrop: document.getElementById("drawer-backdrop"),
  openDrawerBtn: document.getElementById("open-drawer-btn"),
  mobileCardTrigger: document.getElementById("mobile-card-trigger"),
  closeDrawerBtn: document.getElementById("close-drawer-btn"),
};

function openDrawer() {
  if (elements.controlsDrawer) elements.controlsDrawer.classList.add("is-open");
  if (elements.drawerBackdrop) elements.drawerBackdrop.classList.add("is-open");
}

function closeDrawer() {
  if (elements.controlsDrawer) elements.controlsDrawer.classList.remove("is-open");
  if (elements.drawerBackdrop) elements.drawerBackdrop.classList.remove("is-open");
}

function keepQuestionCardInView() {
  window.requestAnimationFrame(() => {
    const card = document.getElementById("question-card");
    if (card && typeof card.scrollIntoView === "function") {
      card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });
}

// 折叠屏折叠/展开切换及 Device Posture 姿态变化时自动收起抽屉并锚定当前题目
const foldableDesktopMq = window.matchMedia("(min-width: 721px)");
if (foldableDesktopMq && foldableDesktopMq.addEventListener) {
  foldableDesktopMq.addEventListener("change", (e) => {
    if (e.matches) closeDrawer();
    keepQuestionCardInView();
  });
}
if (navigator.devicePosture && typeof navigator.devicePosture.addEventListener === "function") {
  navigator.devicePosture.addEventListener("change", () => {
    closeDrawer();
    keepQuestionCardInView();
  });
}

function shouldUseCompactOptionGrid(question) {
  const values = Object.values(question?.options || {});
  if (values.length < 2) return false;
  return values.every((v) => String(v || "").trim().length <= 16);
}

function buildHeroStats(meta) {
  if (!elements.heroStats) return;
  const cards = [
    { label: "题库总量", value: meta.totalQuestions || 0 },
    { label: "单选/多选", value: `${meta.typeCounts?.["单选题"] || 0}/${meta.typeCounts?.["多选题"] || 0}` },
    { label: "判断/填空", value: `${meta.typeCounts?.["判断题"] || 0}/${meta.typeCounts?.["填空题"] || 0}` },
    { label: "本卷题量", value: 100 },
  ];

  elements.heroStats.innerHTML = cards
    .map(
      (card) =>
        `<div class="stat-card"><strong>${card.value}</strong><span>${card.label}</span></div>`,
    )
    .join("");
}

function filterUserFacingNotes(notes) {
  if (!Array.isArray(notes)) return [];
  return notes.filter((n) => {
    const s = String(n || "");
    if (s.includes("原题记录") || s.includes("OCR来源") || s.includes("标点空白差异")) {
      return false;
    }
    return Boolean(s.trim());
  });
}

function getCurrentQuestion() {
  return state.filteredQuestions[state.currentIndex] || null;
}

function isFillQuestion(question) {
  return question?.type === "填空题";
}

function isQuestionAnswered(question) {
  const ans = state.examAnswers[question.id];
  if (isFillQuestion(question)) {
    return typeof ans === "string" && ans.trim().length > 0;
  }
  return Array.isArray(ans) && ans.length > 0;
}

function isQuestionCorrectInExam(question) {
  const userAnswer = state.examAnswers[question.id] || "";
  if (isFillQuestion(question)) {
    return typeof userAnswer === "string" && userAnswer.trim() === (question.answer || "").trim();
  }
  const expectedLabels = normalizeAnswerLabels(question.answer).sort().join("");
  const actualLabels = Array.isArray(userAnswer) ? [...userAnswer].sort().join("") : "";
  return Boolean(expectedLabels && expectedLabels === actualLabels);
}

function renderQuestionGrid() {
  if (!elements.examQuestionGrid) return;
  const questions = state.filteredQuestions || [];
  let answeredCount = 0;
  let correctCount = 0;

  const html = questions
    .map((q, idx) => {
      const classes = ["grid-cell"];
      if (idx === state.currentIndex) {
        classes.push("is-current");
      }
      if (state.examSubmitted) {
        const ok = isQuestionCorrectInExam(q);
        if (ok) {
          correctCount += 1;
          classes.push("is-correct");
        } else {
          classes.push("is-wrong");
        }
      } else if (isQuestionAnswered(q)) {
        answeredCount += 1;
        classes.push("is-answered");
      }
      return `<button type="button" class="${classes.join(" ")}" data-grid-index="${idx}">${idx + 1}</button>`;
    })
    .join("");

  elements.examQuestionGrid.innerHTML = html;
  if (elements.gridAnsweredSummary) {
    elements.gridAnsweredSummary.textContent = state.examSubmitted
      ? `答对 ${correctCount} / ${questions.length}`
      : `已答 ${answeredCount} / ${questions.length}`;
  }
}

function loadPersistedState() {
  try {
    const savedExamHistory = JSON.parse(localStorage.getItem(EXAM_HISTORY_KEY) || "[]");
    state.examHistory = Array.isArray(savedExamHistory) ? savedExamHistory : [];
  } catch {
    state.examHistory = [];
  }
}

function saveExamHistory() {
  localStorage.setItem(EXAM_HISTORY_KEY, JSON.stringify(state.examHistory));
}

function normalizeAnswerLabels(answer = "") {
  return [...new Set(String(answer).toUpperCase().replace(/[^A-Z]/g, "").split("").filter(Boolean))];
}

function isSelectableQuestion(question) {
  return Boolean(question && Object.keys(question.options || {}).length);
}

function isMultiSelectQuestion(question) {
  if (!question) return false;
  if (question.type === "多选题") return true;
  return normalizeAnswerLabels(question.answer).length > 1;
}

function getSelectedAnswerLabel() {
  return state.selectedOptions.slice().sort().join("");
}

function getCorrectAnswerText(question) {
  const labels = normalizeAnswerLabels(question.answer);
  if (!labels.length) return question.answer || "暂无答案";
  const detail = labels
    .map((label) => {
      const value = question.options?.[label];
      return value ? `${label}. ${value}` : label;
    })
    .join("；");
  return detail || question.answer;
}

function getDisplayStem(question) {
  if (!isFillQuestion(question) || !question.answer) return question.stem;
  if (!state.showAnswer && !state.examSubmitted) return question.stem;
  const annotation = `（答案：${question.answer}）`;
  if (question.stem.includes("（ ）")) return question.stem.replace(/（\s*）/g, annotation);
  if (question.stem.includes("()")) return question.stem.replace(/\(\)/g, annotation);
  return `${question.stem} [答案：${question.answer}]`;
}

function setAnswerFeedback(type, message) {
  if (!elements.answerBox) return;
  elements.answerBox.className = `answer-box ${type}`;
  elements.answerBox.innerHTML = message;
  elements.answerBox.classList.remove("hidden");
}

function clearAnswerFeedback() {
  if (!elements.answerBox) return;
  elements.answerBox.className = "answer-box hidden";
  elements.answerBox.innerHTML = "";
}

function clearAutoNextTimer() {
  if (state.autoNextTimer) {
    window.clearTimeout(state.autoNextTimer);
    state.autoNextTimer = null;
  }
}

function resetInteractionState() {
  clearAutoNextTimer();
  state.selectedOptions = [];
  state.answerFeedback = null;
  state.showAnswer = false;
}

function renderQuestion() {
  const question = state.filteredQuestions[state.currentIndex];
  if (!question) return;

  const progressValue = Math.round(((state.currentIndex + 1) / state.filteredQuestions.length) * 100);

  const metaPills = [
    `<div class="meta-pill">第 ${state.currentIndex + 1} 题 · ${question.id}</div>`,
    `<div class="meta-pill meta-pill--type">${question.type}</div>`,
  ];

  if (state.examSubmitted) {
    const isCorrectInExam = isQuestionCorrectInExam(question);
    metaPills.push(
      `<div class="meta-pill" style="font-weight: 700; color: ${isCorrectInExam ? "#0f6b3d" : "#932026"}; background: ${isCorrectInExam ? "rgba(22, 121, 75, 0.14)" : "rgba(179, 30, 35, 0.14)"}">${isCorrectInExam ? "✓ 本卷答对" : "✗ 本卷答错"}</div>`,
    );
  }

  let isGlobalWrong = false;
  try {
    const savedState = JSON.parse(localStorage.getItem(APP_STORAGE_KEY) || "{}");
    const globalWrongSet = new Set(savedState.wrongIds || []);
    isGlobalWrong = globalWrongSet.has(question.id);
  } catch (e) {}
  if (isGlobalWrong) {
    metaPills.push(`<div class="meta-pill meta-pill--wrong">★ 已标错题</div>`);
  }

  if (elements.questionMeta) elements.questionMeta.innerHTML = metaPills.join("");

  if (elements.wrongButton) {
    elements.wrongButton.classList.remove("hidden");
    elements.wrongButton.textContent = isGlobalWrong ? "★ 移出错题本" : "☆ 加入错题本";
  }

  if (state.examReviewFilter === "wrong" && isGlobalWrong) {
    if (elements.inlineWrongBtn) elements.inlineWrongBtn.classList.remove("hidden");
    if (elements.inlineWrongBtnMobile) elements.inlineWrongBtnMobile.classList.remove("hidden");
  } else {
    if (elements.inlineWrongBtn) elements.inlineWrongBtn.classList.add("hidden");
    if (elements.inlineWrongBtnMobile) elements.inlineWrongBtnMobile.classList.add("hidden");
  }

  if (isFillQuestion(question)) {
    if (elements.fillInputContainer) elements.fillInputContainer.classList.remove("hidden");
    if (elements.fillAnswerInput) {
      elements.fillAnswerInput.value = state.examAnswers[question.id] || "";
      elements.fillAnswerInput.disabled = state.examSubmitted;
    }
    state.selectedOptions = [];
  } else {
    if (elements.fillInputContainer) elements.fillInputContainer.classList.add("hidden");
    if (Array.isArray(state.examAnswers[question.id])) {
      state.selectedOptions = state.examAnswers[question.id];
    } else {
      state.selectedOptions = [];
    }
  }

  const stemText = !state.examSubmitted && isFillQuestion(question) ? question.stem : getDisplayStem(question);
  if (elements.questionStem) {
    elements.questionStem.textContent = stemText;
    const stemLen = stemText.length;
    if (stemLen < 50) {
      elements.questionStem.style.fontSize = "clamp(19px, 2vw, 23px)";
    } else if (stemLen < 110) {
      elements.questionStem.style.fontSize = "clamp(18px, 1.8vw, 21px)";
    } else {
      elements.questionStem.style.fontSize = "clamp(16px, 1.6vw, 19px)";
    }
  }

  if (elements.optionList) {
    elements.optionList.innerHTML = renderOptions(question);
    elements.optionList.classList.toggle("is-compact-grid", shouldUseCompactOptionGrid(question));
  }
  renderOptionActions(question);
  renderAnswerState(question);

  if (elements.answerButton) elements.answerButton.classList.add("hidden");
  if (elements.answerButtonMobile) elements.answerButtonMobile.classList.add("hidden");

  const shouldShowExplanation = state.showAnswer || state.answerFeedback || state.examSubmitted;

  const userNotes = filterUserFacingNotes(question.notes);
  const noteText = userNotes.length ? userNotes.join("；") : "";
  if (elements.noteBox) {
    if (noteText) {
      elements.noteBox.innerHTML = `<strong>备注：</strong>${noteText}`;
      elements.noteBox.classList.toggle("hidden", !shouldShowExplanation);
    } else {
      elements.noteBox.classList.add("hidden");
    }
  }

  if (elements.explanationBox) {
    if (question.explanation && shouldShowExplanation) {
      const formattedExplanation = `<strong>解析：</strong><br />${question.explanation.replace(/\n/g, "<br />")}`;
      elements.explanationBox.innerHTML = formattedExplanation;
      elements.explanationBox.classList.remove("hidden");
      if (elements.modalExplanationBody) {
        elements.modalExplanationBody.innerHTML = formattedExplanation;
      }
      if (elements.viewExplanationMobile) {
        elements.viewExplanationMobile.classList.remove("hidden");
      }
    } else {
      elements.explanationBox.classList.add("hidden");
      if (elements.viewExplanationMobile) {
        elements.viewExplanationMobile.classList.add("hidden");
      }
    }
  }

  if (elements.examPosition) {
    elements.examPosition.textContent = `${state.currentIndex + 1} / ${state.filteredQuestions.length}`;
  }
  if (elements.progressLabel) elements.progressLabel.textContent = `试卷进度 ${progressValue}%`;
  if (elements.progressFill) elements.progressFill.style.width = `${progressValue}%`;

  renderQuestionGrid();
}

function renderOptions(question) {
  const entries = Object.entries(question.options || {});
  if (!entries.length) {
    return "";
  }

  const correctLabels = new Set(normalizeAnswerLabels(question.answer));
  const selectedLabels = new Set(state.selectedOptions);
  const answered = state.examSubmitted ? true : Boolean(state.answerFeedback);

  return entries
    .map(([label, value]) => {
      const classes = ["option-item"];
      if (selectedLabels.has(label)) {
        classes.push("is-selected");
      }
      if (answered && correctLabels.has(label)) {
        classes.push("is-correct");
      }
      if (answered && selectedLabels.has(label) && !correctLabels.has(label)) {
        classes.push("is-wrong");
      }
      if (answered) {
        classes.push("is-disabled");
      }

      return `
        <button type="button" class="${classes.join(" ")}" data-option-label="${label}">
          <strong>${label}</strong>
          <div>${value}</div>
        </button>
      `;
    })
    .join("");
}

function renderOptionActions(question) {
  if (!elements.optionActions) return;
  const selectable = isSelectableQuestion(question);
  const isMulti = isMultiSelectQuestion(question);
  const answered = state.examSubmitted ? true : Boolean(state.answerFeedback);

  elements.optionActions.classList.toggle("hidden", !selectable || !isMulti || state.examSubmitted);
  if (elements.submitAnswer) elements.submitAnswer.disabled = answered || !state.selectedOptions.length;
  if (elements.resetSelection) elements.resetSelection.disabled = answered || !state.selectedOptions.length;
}

function renderAnswerState(question) {
  if (!state.examSubmitted) {
    clearAnswerFeedback();
    return;
  }

  let currentFeedback = state.answerFeedback;

  if (state.examSubmitted && !currentFeedback) {
    const userAnswer = state.examAnswers[question.id] || "";
    if (isFillQuestion(question)) {
      const isCorrect = typeof userAnswer === "string" && userAnswer.trim() === (question.answer || "").trim();
      currentFeedback = {
        type: isCorrect ? "is-correct" : "is-incorrect",
        message: isCorrect
          ? `<strong>回答正确！</strong> 你的回答：${userAnswer}`
          : `<strong>回答错误。</strong><br />你的回答：${userAnswer || "未作答"}<br /><strong>正确答案：</strong>${question.answer || "暂无答案"}`,
      };
    } else {
      const expectedLabels = normalizeAnswerLabels(question.answer).sort().join("");
      const actualLabels = Array.isArray(userAnswer) ? [...userAnswer].sort().join("") : "";
      const isCorrect = expectedLabels && expectedLabels === actualLabels;
      const selectedAnswer = actualLabels || "未作答";
      const correctAnswer = getCorrectAnswerText(question);

      currentFeedback = {
        type: isCorrect ? "is-correct" : "is-incorrect",
        message: isCorrect
          ? `<strong>回答正确！</strong> 你的选择：${selectedAnswer}`
          : `<strong>回答错误。</strong><br />你的选择：${selectedAnswer}<br /><strong>正确答案：</strong>${correctAnswer}`,
      };
    }
  }

  if (currentFeedback) {
    setAnswerFeedback(currentFeedback.type, currentFeedback.message);
  }
}

function submitCurrentAnswer() {
  if (state.currentIndex < state.filteredQuestions.length - 1) {
    goToQuestion(state.currentIndex + 1);
  }
}

function handleOptionSelection(label) {
  const question = state.filteredQuestions[state.currentIndex];
  if (!question || !isSelectableQuestion(question)) {
    return;
  }
  if (state.examSubmitted) {
    return;
  }

  if (isMultiSelectQuestion(question)) {
    if (state.selectedOptions.includes(label)) {
      state.selectedOptions = state.selectedOptions.filter((item) => item !== label);
    } else {
      state.selectedOptions = [...state.selectedOptions, label].sort();
    }
    state.examAnswers[question.id] = state.selectedOptions;
    renderQuestion();
    return;
  }

  state.selectedOptions = [label];
  state.examAnswers[question.id] = state.selectedOptions;
  renderQuestion();
}

function goToQuestion(nextIndex) {
  if (!state.filteredQuestions.length) return;
  state.currentIndex = Math.max(0, Math.min(nextIndex, state.filteredQuestions.length - 1));
  resetInteractionState();
  renderQuestion();
}

function getRandomQuestions(sourceArray, count) {
  const shuffled = [...sourceArray].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

function generateExam() {
  if (!state.payload || !state.payload.questions) return;

  const allQuestions = state.payload.questions;
  const singleQuestions = allQuestions.filter((q) => q.type === "单选题");
  const multiQuestions = allQuestions.filter((q) => q.type === "多选题");
  const tfQuestions = allQuestions.filter((q) => q.type === "判断题");
  const fillQuestions = allQuestions.filter((q) => q.type === "填空题");

  const examSingle = getRandomQuestions(singleQuestions, 40);
  const examMulti = getRandomQuestions(multiQuestions, 20);
  const examTf = getRandomQuestions(tfQuestions, 20);
  const examFill = getRandomQuestions(fillQuestions, 20);

  state.filteredQuestions = [...examSingle, ...examMulti, ...examTf, ...examFill];
  state.isExamMode = true;
  state.examAnswers = {};
  state.examSubmitted = false;
  state.currentIndex = 0;
  state.currentExamQuestions = state.filteredQuestions;

  if (elements.examTopline) elements.examTopline.classList.remove("hidden");
  if (elements.examReviewFilterGroup) elements.examReviewFilterGroup.classList.add("hidden");
  if (elements.submitExamButton) elements.submitExamButton.classList.remove("hidden");

  resetInteractionState();
  renderQuestion();
  closeDrawer();
}

function submitExam() {
  if (state.examSubmitted) return;
  const shouldSubmit = window.confirm("确认交卷吗？交卷后将自动判分并显示全卷解析。");
  if (!shouldSubmit) return;

  let score = 0;
  const currentWrongIds = [];
  state.filteredQuestions.forEach((question) => {
    const isCorrect = isQuestionCorrectInExam(question);
    if (isCorrect) {
      score += 1;
    } else {
      currentWrongIds.push(question.id);
    }
  });

  try {
    const savedState = JSON.parse(localStorage.getItem(APP_STORAGE_KEY) || "{}");
    const globalWrongSet = new Set(savedState.wrongIds || []);
    currentWrongIds.forEach((id) => globalWrongSet.add(id));
    savedState.wrongIds = [...globalWrongSet];
    localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(savedState));
  } catch (e) {
    console.error(e);
  }

  const examSnapshot = {
    id: Date.now().toString(),
    date: new Date().toLocaleString(),
    score: score,
    total: state.filteredQuestions.length,
    questions: state.filteredQuestions,
    answers: state.examAnswers,
  };
  state.examHistory.unshift(examSnapshot);
  if (state.examHistory.length > 20) state.examHistory.pop();
  saveExamHistory();
  state.currentExamId = examSnapshot.id;

  state.examSubmitted = true;
  if (elements.examReviewFilterGroup) elements.examReviewFilterGroup.classList.remove("hidden");
  if (elements.submitExamButton) elements.submitExamButton.classList.add("hidden");
  if (elements.examScoreDisplay) elements.examScoreDisplay.textContent = `${score}分`;
  if (elements.examScoreDetail) {
    elements.examScoreDetail.textContent = `共 ${state.filteredQuestions.length} 题，答对 ${score} 题，答错 ${state.filteredQuestions.length - score} 题（错题已自动同步至错题本）`;
  }
  if (elements.examResultModal) elements.examResultModal.classList.remove("hidden");

  renderQuestion();
}

function renderExamHistory() {
  if (!elements.examHistoryList) return;
  elements.examHistoryList.innerHTML = "";
  if (!state.examHistory.length) {
    elements.examHistoryList.innerHTML = "<div style='color: var(--muted); text-align: center; padding: 20px;'>暂无历史试卷记录</div>";
    return;
  }

  state.examHistory.forEach((exam) => {
    const item = document.createElement("div");
    item.style.padding = "12px 14px";
    item.style.border = "1px solid var(--border)";
    item.style.borderRadius = "12px";
    item.style.background = "#ffffff";
    item.style.display = "flex";
    item.style.justifyContent = "space-between";
    item.style.alignItems = "center";
    item.style.gap = "10px";
    item.style.flexWrap = "wrap";

    item.innerHTML = `
      <div>
        <div style="font-weight: 700; color: var(--accent-deep); margin-bottom: 3px;">得分: ${exam.score} / ${exam.total}</div>
        <div style="font-size: 12px; color: var(--muted);">${exam.date}</div>
      </div>
      <div style="display: flex; gap: 6px;">
        <button type="button" class="button button--solid view-btn" data-id="${exam.id}" style="padding: 6px 10px; font-size: 12px;">看全卷</button>
        <button type="button" class="button button--secondary review-wrong-btn" data-id="${exam.id}" style="padding: 6px 10px; font-size: 12px;">只看错题</button>
        <button type="button" class="button button--danger delete-btn" data-id="${exam.id}" style="padding: 6px 10px; font-size: 12px;">删除</button>
      </div>
    `;

    item.querySelector(".view-btn").addEventListener("click", () => loadExamForReview(exam.id, "all"));
    item.querySelector(".review-wrong-btn").addEventListener("click", () => loadExamForReview(exam.id, "wrong"));
    item.querySelector(".delete-btn").addEventListener("click", () => deleteExam(exam.id));

    elements.examHistoryList.appendChild(item);
  });
}

function deleteExam(id) {
  if (!window.confirm("确定要删除这条试卷记录吗？")) return;
  state.examHistory = state.examHistory.filter((e) => e.id !== id);
  saveExamHistory();
  renderExamHistory();
}

function loadExamForReview(id, filter = "all") {
  const exam = state.examHistory.find((e) => e.id === id);
  if (!exam) return;

  if (elements.examHistoryModal) elements.examHistoryModal.classList.add("hidden");
  closeDrawer();

  state.isExamMode = true;
  state.examSubmitted = true;
  state.examAnswers = exam.answers || {};
  state.currentExamId = exam.id;
  state.examReviewFilter = filter;
  if (elements.examReviewFilterGroup) {
    elements.examReviewFilterGroup.querySelectorAll(".exam-filter-btn").forEach((btn) => {
      if (btn.dataset.filter === filter) {
        btn.classList.add("button--solid");
      } else {
        btn.classList.remove("button--solid");
      }
    });
  }
  state.currentExamQuestions = exam.questions;

  if (elements.examTopline) elements.examTopline.classList.remove("hidden");
  if (elements.examReviewFilterGroup) elements.examReviewFilterGroup.classList.remove("hidden");
  if (elements.submitExamButton) elements.submitExamButton.classList.add("hidden");

  applyExamFilter();
}

function applyExamFilter() {
  if (!state.currentExamQuestions) return;

  state.filteredQuestions = state.currentExamQuestions.filter((question) => {
    if (state.examReviewFilter === "all") return true;
    const isCorrect = isQuestionCorrectInExam(question);
    if (state.examReviewFilter === "correct") return isCorrect;
    if (state.examReviewFilter === "wrong") return !isCorrect;
    return true;
  });

  state.currentIndex = 0;
  resetInteractionState();
  renderQuestion();
}

function attachEvents() {
  if (elements.openDrawerBtn) elements.openDrawerBtn.addEventListener("click", openDrawer);
  if (elements.mobileCardTrigger) elements.mobileCardTrigger.addEventListener("click", openDrawer);
  if (elements.closeDrawerBtn) elements.closeDrawerBtn.addEventListener("click", closeDrawer);
  if (elements.drawerBackdrop) elements.drawerBackdrop.addEventListener("click", closeDrawer);

  if (elements.prevButton) elements.prevButton.addEventListener("click", () => goToQuestion(state.currentIndex - 1));
  if (elements.nextButton) elements.nextButton.addEventListener("click", () => goToQuestion(state.currentIndex + 1));
  if (elements.prevButtonMobile) elements.prevButtonMobile.addEventListener("click", () => goToQuestion(state.currentIndex - 1));
  if (elements.nextButtonMobile) elements.nextButtonMobile.addEventListener("click", () => goToQuestion(state.currentIndex + 1));

  if (elements.examQuestionGrid) {
    elements.examQuestionGrid.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-grid-index]");
      if (!btn) return;
      const idx = Number(btn.dataset.gridIndex);
      if (Number.isInteger(idx)) {
        goToQuestion(idx);
        closeDrawer();
      }
    });
  }

  if (elements.fillAnswerInput) {
    elements.fillAnswerInput.addEventListener("input", (event) => {
      const question = getCurrentQuestion();
      if (!question || state.examSubmitted) return;
      state.examAnswers[question.id] = event.target.value;
      renderQuestionGrid();
    });
  }

  const toggleGlobalWrongHandler = () => {
    const question = state.filteredQuestions[state.currentIndex];
    if (!question) return;
    try {
      const savedState = JSON.parse(localStorage.getItem(APP_STORAGE_KEY) || "{}");
      const globalWrongSet = new Set(savedState.wrongIds || []);
      if (globalWrongSet.has(question.id)) {
        globalWrongSet.delete(question.id);
      } else {
        globalWrongSet.add(question.id);
      }
      savedState.wrongIds = [...globalWrongSet];
      localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(savedState));
      renderQuestion();
    } catch (e) {
      console.error(e);
    }
  };

  if (elements.wrongButton) elements.wrongButton.addEventListener("click", toggleGlobalWrongHandler);
  if (elements.inlineWrongBtn) elements.inlineWrongBtn.addEventListener("click", toggleGlobalWrongHandler);
  if (elements.inlineWrongBtnMobile) elements.inlineWrongBtnMobile.addEventListener("click", toggleGlobalWrongHandler);

  if (elements.optionList) {
    elements.optionList.addEventListener("click", (event) => {
      const optionButton = event.target.closest("[data-option-label]");
      if (!optionButton) return;
      handleOptionSelection(optionButton.dataset.optionLabel);
    });
  }

  if (elements.submitAnswer) {
    elements.submitAnswer.addEventListener("click", () => submitCurrentAnswer());
  }

  if (elements.resetSelection) {
    elements.resetSelection.addEventListener("click", () => {
      const question = getCurrentQuestion();
      if (state.examSubmitted || !question) return;
      state.selectedOptions = [];
      delete state.examAnswers[question.id];
      renderQuestion();
    });
  }

  if (elements.viewExplanationMobile) {
    elements.viewExplanationMobile.addEventListener("click", () => {
      elements.explanationModal.classList.remove("hidden");
    });
  }

  if (elements.modalClose) elements.modalClose.addEventListener("click", () => elements.explanationModal.classList.add("hidden"));
  if (elements.modalOverlay) elements.modalOverlay.addEventListener("click", () => elements.explanationModal.classList.add("hidden"));

  if (elements.generateExamButton) elements.generateExamButton.addEventListener("click", generateExam);
  if (elements.submitExamButton) elements.submitExamButton.addEventListener("click", submitExam);

  if (elements.examModalClose) elements.examModalClose.addEventListener("click", () => elements.examResultModal.classList.add("hidden"));
  if (elements.examReviewButton) {
    elements.examReviewButton.addEventListener("click", () => {
      elements.examResultModal.classList.add("hidden");
      goToQuestion(0);
    });
  }
  if (elements.examExitButton) {
    elements.examExitButton.addEventListener("click", () => {
      elements.examResultModal.classList.add("hidden");
      generateExam();
    });
  }
  if (elements.exitExamButton) {
    elements.exitExamButton.addEventListener("click", () => {
      window.location.href = "index.html";
    });
  }

  const openHistoryModal = () => {
    renderExamHistory();
    elements.examHistoryModal.classList.remove("hidden");
    closeDrawer();
  };

  if (elements.viewExamHistoryButton) elements.viewExamHistoryButton.addEventListener("click", openHistoryModal);
  if (elements.quickHistoryBtn) elements.quickHistoryBtn.addEventListener("click", openHistoryModal);

  if (elements.examHistoryClose) elements.examHistoryClose.addEventListener("click", () => elements.examHistoryModal.classList.add("hidden"));
  if (elements.examHistoryOverlay) elements.examHistoryOverlay.addEventListener("click", () => elements.examHistoryModal.classList.add("hidden"));

  if (elements.examReviewFilterGroup) {
    elements.examReviewFilterGroup.addEventListener("click", (e) => {
      const btn = e.target.closest(".exam-filter-btn");
      if (!btn) return;
      state.examReviewFilter = btn.dataset.filter;
      elements.examReviewFilterGroup.querySelectorAll(".exam-filter-btn").forEach((b) => b.classList.remove("button--solid"));
      btn.classList.add("button--solid");
      applyExamFilter();
    });
  }

  if (elements.exportExamRecord) {
    elements.exportExamRecord.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(state.examHistory, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "dangke-exam-history.json";
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  if (elements.importExamRecordTrigger) {
    elements.importExamRecordTrigger.addEventListener("click", () => {
      if (elements.importExamRecord) elements.importExamRecord.click();
    });
  }

  if (elements.importExamRecord) {
    elements.importExamRecord.addEventListener("change", async (event) => {
      const [file] = event.target.files || [];
      if (!file) return;

      try {
        const text = await file.text();
        const savedHistory = JSON.parse(text);
        if (!Array.isArray(savedHistory)) throw new Error("Invalid format");

        state.examHistory = savedHistory;
        saveExamHistory();
        renderExamHistory();
        alert("考试记录导入成功！");
      } catch (err) {
        console.error(err);
        alert("导入的文件格式有误，请确保导入的是此前导出的考试记录 json 文件。");
      } finally {
        elements.importExamRecord.value = "";
      }
    });
  }

  // 键盘快捷键
  document.addEventListener("keydown", (event) => {
    const tag = (event.target && event.target.tagName) || "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
      return;
    }
    if (event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }
    const key = event.key.toUpperCase();
    if (key === "ARROWLEFT") {
      event.preventDefault();
      goToQuestion(state.currentIndex - 1);
    } else if (key === "ARROWRIGHT") {
      event.preventDefault();
      goToQuestion(state.currentIndex + 1);
    } else if (/^[A-F]$/.test(key)) {
      const q = getCurrentQuestion();
      if (q && q.options && q.options[key]) {
        event.preventDefault();
        handleOptionSelection(key);
      }
    } else if (/^[1-6]$/.test(key)) {
      const label = String.fromCharCode(64 + Number(key));
      const q = getCurrentQuestion();
      if (q && q.options && q.options[label]) {
        event.preventDefault();
        handleOptionSelection(label);
      }
    }
  });

  // 折叠屏 / 触屏左右滑动手势切题（左滑下一题，右滑上一题）
  const questionCard = document.getElementById("question-card");
  if (questionCard) {
    let touchStartX = 0;
    let touchStartY = 0;
    questionCard.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    questionCard.addEventListener("touchend", (e) => {
      if (e.changedTouches.length !== 1) return;
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || window.getSelection()?.toString()) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) goToQuestion(state.currentIndex + 1);
        else goToQuestion(state.currentIndex - 1);
      }
    }, { passive: true });
  }
}

async function loadPayload() {
  if (window.QUESTION_BANK_DATA) return window.QUESTION_BANK_DATA;
  const response = await fetch("./questions.json");
  if (!response.ok) throw new Error("无法加载 questions.json");
  return response.json();
}

function initWithPayload(payload) {
  state.payload = payload;
  buildHeroStats(payload.meta || {});
  generateExam();
}

async function bootstrap() {
  loadPersistedState();
  attachEvents();
  try {
    const payload = await loadPayload();
    initWithPayload(payload);
  } catch (error) {
    console.error(error);
  }
}

bootstrap();
