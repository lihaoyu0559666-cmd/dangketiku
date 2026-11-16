const STORAGE_KEY = "dangke-question-bank-state";
const AUTO_NEXT_DELAY_MS = 1000;

const state = {
  payload: null,
  filteredQuestions: [],
  currentIndex: 0,
  randomMode: false,
  autoNext: true,
  showAnswer: false,
  progress: {},
  wrongSet: new Set(),
  selectedOptions: [],
  answerFeedback: null,
  autoNextTimer: null,
  reviewWrongOnly: false,
  restoredQuestionId: null,
  restoredTypeFilter: "全部",
  restoredSearchKeyword: "",
};

const elements = {
  heroStats: document.getElementById("hero-stats"),
  typeFilter: document.getElementById("type-filter"),
  searchInput: document.getElementById("search-input"),
  jumpInput: document.getElementById("jump-input"),
  jumpButton: document.getElementById("jump-button"),
  jumpStatus: document.getElementById("jump-status"),
  upload: document.getElementById("json-upload"),
  uploadTrigger: document.getElementById("json-upload-trigger"),
  localRecordBox: document.getElementById("local-record-box"),
  recordStatus: document.getElementById("record-status"),
  exportRecord: document.getElementById("export-record"),
  importRecordTrigger: document.getElementById("import-record-trigger"),
  importRecord: document.getElementById("import-record"),
  resultCount: document.getElementById("result-count"),
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
  sequentialButton: document.getElementById("mode-sequential"),
  randomButton: document.getElementById("mode-random"),
  autoNextToggle: document.getElementById("auto-next-toggle"),
  prevButton: document.getElementById("prev-question"),
  nextButton: document.getElementById("next-question"),
  prevButtonMobile: document.getElementById("prev-question-mobile"),
  nextButtonMobile: document.getElementById("next-question-mobile"),
  answerButton: document.getElementById("toggle-answer"),
  answerButtonMobile: document.getElementById("toggle-answer-mobile"),
  wrongButton: document.getElementById("toggle-wrong"),
  reviewWrongButton: document.getElementById("toggle-wrong-review"),
  clearWrongButton: document.getElementById("clear-wrong-set"),
  inlineWrongBtn: document.getElementById("inline-wrong-btn"),
  inlineWrongBtnMobile: document.getElementById("inline-wrong-btn-mobile"),
  // 移动端抽屉与快捷栏
  controlsDrawer: document.getElementById("controls-drawer"),
  drawerBackdrop: document.getElementById("drawer-backdrop"),
  openDrawerBtn: document.getElementById("open-drawer-btn"),
  closeDrawerBtn: document.getElementById("close-drawer-btn"),
  quickModeToggle: document.getElementById("quick-mode-toggle"),
  quickWrongReview: document.getElementById("quick-wrong-review"),
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

function getCurrentQuestion() {
  return state.filteredQuestions[state.currentIndex] || null;
}

function isFillQuestion(question) {
  return question?.type === "填空题";
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

function buildPersistedSnapshot() {
  const currentQuestion = getCurrentQuestion();
  const typeFilter = elements.typeFilter ? elements.typeFilter.value : (state.restoredTypeFilter || "全部");
  const searchKeyword = elements.searchInput ? elements.searchInput.value : (state.restoredSearchKeyword || "");

  state.restoredQuestionId = currentQuestion?.id || state.restoredQuestionId || null;
  state.restoredTypeFilter = typeFilter;
  state.restoredSearchKeyword = searchKeyword;

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    progress: state.progress,
    wrongIds: [...state.wrongSet],
    currentQuestionId: state.restoredQuestionId,
    typeFilter,
    searchKeyword,
    randomMode: state.randomMode,
    autoNext: state.autoNext,
    reviewWrongOnly: state.reviewWrongOnly,
  };
}

function updateRecordStatus() {
  if (!elements.recordStatus) return;
  const wrongCount = state.wrongSet.size;
  const viewedCount = Object.keys(state.progress || {}).length;
  const question = getCurrentQuestion();
  const position = state.filteredQuestions.length ? state.currentIndex + 1 : 0;
  const total = state.filteredQuestions.length;

  elements.recordStatus.textContent = question
    ? `上次做到 ${question.id}（${position}/${total}），错题 ${wrongCount} 题，已浏览 ${viewedCount} 题。`
    : `错题 ${wrongCount} 题，已浏览 ${viewedCount} 题。`;
}

function setJumpStatus(message, isError = false) {
  if (!elements.jumpStatus) return;
  elements.jumpStatus.textContent = message;
  elements.jumpStatus.classList.toggle("is-error", isError);
}

function updateJumpStatus() {
  if (!state.filteredQuestions.length) {
    setJumpStatus("当前结果为空，可输入题号如 Q00025 直接定位。", true);
    return;
  }
  setJumpStatus(`可跳 1-${state.filteredQuestions.length} 题，或输入题号如 Q00025。`);
}

function loadPersistedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    state.progress = saved.progress || {};
    state.wrongSet = new Set(saved.wrongIds || []);
    state.randomMode = Boolean(saved.randomMode);
    state.autoNext = saved.autoNext !== undefined ? Boolean(saved.autoNext) : true;
    state.reviewWrongOnly = Boolean(saved.reviewWrongOnly);
    state.restoredQuestionId = saved.currentQuestionId || null;
    state.restoredTypeFilter = saved.typeFilter || "全部";
    state.restoredSearchKeyword = saved.searchKeyword || "";
  } catch {
    state.progress = {};
    state.wrongSet = new Set();
    state.randomMode = false;
    state.autoNext = true;
    state.reviewWrongOnly = false;
    state.restoredQuestionId = null;
    state.restoredTypeFilter = "全部";
    state.restoredSearchKeyword = "";
  }
  if (elements.autoNextToggle) {
    elements.autoNextToggle.checked = state.autoNext;
  }
}

function persistState() {
  const snapshot = buildPersistedSnapshot();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  updateRecordStatus();
}

function buildHeroStats(meta) {
  if (!elements.heroStats) return;
  const cards = [
    { label: "题库总量", value: meta.totalQuestions || 0 },
    { label: "待复核题", value: meta.conflictItems || 0 },
    { label: "题型种类", value: Object.keys(meta.typeCounts || {}).length },
    { label: "更新日期", value: (meta.generatedAt || "").slice(0, 10) || "-" },
  ];

  elements.heroStats.innerHTML = cards
    .map(
      (card) =>
        `<div class="stat-card"><strong>${card.value}</strong><span>${card.label}</span></div>`,
    )
    .join("");
}

function populateTypeFilter(questions) {
  const types = [...new Set(questions.map((question) => question.type))];
  elements.typeFilter.innerHTML = ['<option value="全部">全部题型</option>']
    .concat(types.map((type) => `<option value="${type}">${type}</option>`))
    .join("");
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeAnswerLabels(answer = "") {
  return [...new Set(String(answer).toUpperCase().replace(/[^A-Z]/g, "").split("").filter(Boolean))];
}

function isSelectableQuestion(question) {
  return Boolean(question && Object.keys(question.options || {}).length);
}

function isMultiSelectQuestion(question) {
  if (!question) {
    return false;
  }
  if (question.type === "多选题") {
    return true;
  }
  return normalizeAnswerLabels(question.answer).length > 1;
}

function getSelectedAnswerLabel() {
  return state.selectedOptions.slice().sort().join("");
}

function getCorrectAnswerText(question) {
  const labels = normalizeAnswerLabels(question.answer);
  if (!labels.length) {
    return question.answer || "暂无答案";
  }
  const detail = labels
    .map((label) => {
      const value = question.options?.[label];
      return value ? `${label}. ${value}` : label;
    })
    .join("；");
  return detail || question.answer;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderStemHtml(question) {
  const rawStem = escapeHtml(question.stem || "");
  if (!isFillQuestion(question) || !question.answer) {
    return rawStem;
  }
  const safeAns = escapeHtml(question.answer);
  if (state.showAnswer) {
    const revealedBadge = `<span class="blank-mask is-revealed">${safeAns}</span>`;
    if (/（\s*）/.test(rawStem)) {
      return rawStem.replace(/（\s*）/g, `（${revealedBadge}）`);
    }
    if (/\(\s*\)/.test(rawStem)) {
      return rawStem.replace(/\(\s*\)/g, `(${revealedBadge})`);
    }
    return `${rawStem} ${revealedBadge}`;
  }
  // 未显示答案时：渲染可点击胶带遮罩，点击可直接翻开
  const interactiveMask = `<span class="blank-mask" data-blank-toggle="1" title="点击查看填空答案">点击看答案</span>`;
  if (/（\s*）/.test(rawStem)) {
    return rawStem.replace(/（\s*）/g, `（${interactiveMask}）`);
  }
  if (/\(\s*\)/.test(rawStem)) {
    return rawStem.replace(/\(\s*\)/g, `(${interactiveMask})`);
  }
  return `${rawStem} ${interactiveMask}`;
}

function setAnswerFeedback(type, message) {
  elements.answerBox.className = `answer-box ${type}`;
  elements.answerBox.innerHTML = message;
  elements.answerBox.classList.remove("hidden");
}

function clearAnswerFeedback() {
  elements.answerBox.className = "answer-box hidden";
  elements.answerBox.innerHTML = "";
}

function clearAutoNextTimer() {
  if (state.autoNextTimer) {
    window.clearTimeout(state.autoNextTimer);
    state.autoNextTimer = null;
  }
}

function updateWrongReviewControls() {
  const wrongCount = state.wrongSet.size;
  elements.reviewWrongButton.textContent = state.reviewWrongOnly
    ? `退出错题 (${wrongCount})`
    : `错题复习 (${wrongCount})`;
  elements.reviewWrongButton.classList.toggle("is-active", state.reviewWrongOnly);
  elements.reviewWrongButton.classList.toggle("button--solid", state.reviewWrongOnly);
  elements.clearWrongButton.disabled = wrongCount === 0;

  if (elements.quickWrongReview) {
    elements.quickWrongReview.textContent = state.reviewWrongOnly
      ? `退出错题 (${wrongCount})`
      : `错题本 (${wrongCount})`;
    elements.quickWrongReview.classList.toggle("button--solid", state.reviewWrongOnly);
    elements.quickWrongReview.classList.toggle("button--secondary", !state.reviewWrongOnly);
  }
}

function resetInteractionState() {
  clearAutoNextTimer();
  state.selectedOptions = [];
  state.answerFeedback = null;
  state.showAnswer = false;
}

function applyFilters({ preserveQuestionId = false } = {}) {
  const typeValue = elements.typeFilter.value;
  const keyword = normalizeText(elements.searchInput.value);
  const currentQuestion = getCurrentQuestion();
  const targetQuestionId = preserveQuestionId
    ? state.restoredQuestionId || currentQuestion?.id || null
    : null;

  let nextQuestions = (state.payload?.questions || []).filter((question) => {
    const matchType = typeValue === "全部" || question.type === typeValue;
    if (!matchType) {
      return false;
    }

    if (state.reviewWrongOnly && !state.wrongSet.has(question.id)) {
      return false;
    }

    if (!keyword) {
      return true;
    }

    const haystack = [
      question.id,
      question.type,
      question.stem,
      question.answer,
      Object.entries(question.options || {})
        .map(([key, value]) => `${key}.${value}`)
        .join(" "),
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(keyword);
  });

  if (state.randomMode) {
    nextQuestions = [...nextQuestions];
    for (let index = nextQuestions.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [nextQuestions[index], nextQuestions[swapIndex]] = [
        nextQuestions[swapIndex],
        nextQuestions[index],
      ];
    }
  }

  state.filteredQuestions = nextQuestions;

  if (targetQuestionId) {
    const foundIndex = state.filteredQuestions.findIndex((question) => question.id === targetQuestionId);
    state.currentIndex = foundIndex >= 0 ? foundIndex : 0;
  } else {
    state.currentIndex = Math.min(state.currentIndex, Math.max(state.filteredQuestions.length - 1, 0));
  }

  state.restoredQuestionId = null;
  resetInteractionState();
  updateSummary();
  updateWrongReviewControls();

  if (!state.filteredQuestions.length) {
    renderEmptyState();
    updateJumpStatus();
    persistState();
    return;
  }

  markCurrentVisited();
  renderQuestion();
  updateJumpStatus();
  persistState();
}

function renderEmptyState() {
  elements.questionMeta.innerHTML = "";
  elements.questionStem.textContent = "没有匹配到题目";
  elements.optionList.innerHTML = "";
  elements.optionActions.classList.add("hidden");
  clearAnswerFeedback();
  elements.noteBox.classList.add("hidden");
  elements.explanationBox.classList.add("hidden");
  if (elements.viewExplanationMobile) elements.viewExplanationMobile.classList.add("hidden");
  elements.questionPosition.textContent = "0 / 0";
  elements.progressLabel.textContent = "进度 0%";
  elements.progressFill.style.width = "0%";
  updateRecordStatus();
}

function updateSummary() {
  const total = state.filteredQuestions.length;
  elements.resultCount.textContent = state.reviewWrongOnly
    ? `错题复习 ${total} 题`
    : `当前结果 ${total} 题`;
  elements.sequentialButton.classList.toggle("is-active", !state.randomMode);
  elements.randomButton.classList.toggle("is-active", state.randomMode);
  if (elements.quickModeToggle) {
    elements.quickModeToggle.textContent = state.randomMode ? "随机模式" : "顺序模式";
    elements.quickModeToggle.classList.toggle("is-active", state.randomMode);
  }
}

function renderQuestion() {
  const question = state.filteredQuestions[state.currentIndex];
  if (!question) {
    renderEmptyState();
    return;
  }

  const progressValue = Math.round(((state.currentIndex + 1) / state.filteredQuestions.length) * 100);
  const isWrong = state.wrongSet.has(question.id);
  const visitCount = state.progress[question.id] || 0;

  const metaPills = [
    `<div class="meta-pill">${question.id}</div>`,
    `<div class="meta-pill meta-pill--type">${question.type}</div>`,
    `<div class="meta-pill">已练 ${visitCount} 次</div>`,
  ];

  if (isWrong) {
    metaPills.push(`<div class="meta-pill meta-pill--wrong">★ 错题本</div>`);
  }

  elements.questionMeta.innerHTML = metaPills.join("");
  elements.questionStem.innerHTML = renderStemHtml(question);

  const stemLen = (question.stem || "").length;
  if (stemLen < 50) {
    elements.questionStem.style.fontSize = "clamp(19px, 2vw, 23px)";
  } else if (stemLen < 110) {
    elements.questionStem.style.fontSize = "clamp(18px, 1.8vw, 21px)";
  } else {
    elements.questionStem.style.fontSize = "clamp(16px, 1.6vw, 19px)";
  }

  elements.optionList.innerHTML = renderOptions(question);
  elements.optionList.classList.toggle("is-compact-grid", shouldUseCompactOptionGrid(question));
  renderOptionActions(question);
  renderAnswerState(question);

  const ansBtnText = state.showAnswer ? "隐藏答案" : "显示答案";
  if (elements.answerButton) {
    elements.answerButton.classList.remove("hidden");
    elements.answerButton.textContent = ansBtnText;
  }
  if (elements.answerButtonMobile) {
    elements.answerButtonMobile.classList.remove("hidden");
    elements.answerButtonMobile.textContent = ansBtnText;
  }

  const shouldShowExplanation = state.showAnswer || state.answerFeedback;
  const userNotes = filterUserFacingNotes(question.notes);
  const noteText = userNotes.length ? userNotes.join("；") : "";
  if (noteText) {
    elements.noteBox.innerHTML = `<strong>备注：</strong>${noteText}`;
    elements.noteBox.classList.toggle("hidden", !shouldShowExplanation);
  } else {
    elements.noteBox.classList.add("hidden");
  }

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

  elements.questionPosition.textContent = `${state.currentIndex + 1} / ${state.filteredQuestions.length}`;
  elements.progressLabel.textContent = `当前进度 ${progressValue}%`;
  elements.progressFill.style.width = `${progressValue}%`;

  if (elements.wrongButton) {
    elements.wrongButton.classList.remove("hidden");
    elements.wrongButton.textContent = isWrong ? "★ 移出错题本" : "☆ 加入错题本";
  }

  if (isWrong) {
    if (elements.inlineWrongBtn) {
      elements.inlineWrongBtn.textContent = "移出错题";
      elements.inlineWrongBtn.classList.remove("hidden");
    }
    if (elements.inlineWrongBtnMobile && state.reviewWrongOnly) {
      elements.inlineWrongBtnMobile.classList.remove("hidden");
    } else if (elements.inlineWrongBtnMobile) {
      elements.inlineWrongBtnMobile.classList.add("hidden");
    }
  } else {
    if (elements.inlineWrongBtn) elements.inlineWrongBtn.classList.add("hidden");
    if (elements.inlineWrongBtnMobile) elements.inlineWrongBtnMobile.classList.add("hidden");
  }

  updateRecordStatus();
}

function renderOptions(question) {
  const entries = Object.entries(question.options || {});
  if (!entries.length) {
    return "";
  }

  const correctLabels = new Set(normalizeAnswerLabels(question.answer));
  const selectedLabels = new Set(state.selectedOptions);
  const answered = Boolean(state.answerFeedback);

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
  const selectable = isSelectableQuestion(question);
  const isMulti = isMultiSelectQuestion(question);
  const answered = Boolean(state.answerFeedback);

  elements.optionActions.classList.toggle("hidden", !selectable || !isMulti);
  elements.submitAnswer.disabled = answered || !state.selectedOptions.length;
  elements.resetSelection.disabled = answered || !state.selectedOptions.length;
}

function renderAnswerState(question) {
  const currentFeedback = state.answerFeedback;

  if (currentFeedback) {
    setAnswerFeedback(currentFeedback.type, currentFeedback.message);
    return;
  }

  if (!state.showAnswer) {
    clearAnswerFeedback();
    return;
  }

  if (isFillQuestion(question)) {
    const reviewText = question.reviewReason
      ? `<br /><strong>复核提示：</strong>${question.reviewReason}`
      : "";
    setAnswerFeedback("is-info", `<strong>填空答案：</strong>${question.answer || "暂无答案"}${reviewText}`);
    return;
  }

  const answerText = getCorrectAnswerText(question);
  const reviewText = question.reviewReason
    ? `<br /><strong>复核提示：</strong>${question.reviewReason}`
    : "";
  setAnswerFeedback("is-info", `<strong>标准答案：</strong>${answerText}${reviewText}`);
}

function buildResultMessage(question, isCorrect) {
  const selectedAnswer = getSelectedAnswerLabel() || "未作答";
  const correctAnswer = getCorrectAnswerText(question);
  const reviewText = question.reviewReason
    ? `<br /><strong>复核提示：</strong>${question.reviewReason}`
    : "";

  if (isCorrect) {
    return {
      type: "is-correct",
      message: `<strong>回答正确！</strong> 你的选择：${selectedAnswer}${reviewText}`,
    };
  }

  return {
    type: "is-incorrect",
    message: `<strong>回答错误</strong>（已自动加入错题本）<br />你的选择：${selectedAnswer}<br /><strong>正确答案：</strong>${correctAnswer}${reviewText}`,
  };
}

function queueAutoNext() {
  clearAutoNextTimer();
  if (!state.autoNext) {
    return;
  }
  if (state.currentIndex >= state.filteredQuestions.length - 1) {
    return;
  }
  state.autoNextTimer = window.setTimeout(() => {
    state.autoNextTimer = null;
    goToQuestion(state.currentIndex + 1);
  }, AUTO_NEXT_DELAY_MS);
}

function submitCurrentAnswer() {
  const question = state.filteredQuestions[state.currentIndex];
  if (!question || !isSelectableQuestion(question) || state.answerFeedback) {
    return;
  }

  const expectedLabels = normalizeAnswerLabels(question.answer).sort().join("");
  const actualLabels = getSelectedAnswerLabel();
  const isCorrect = expectedLabels && expectedLabels === actualLabels;
  if (!isCorrect) {
    state.wrongSet.add(question.id);
    persistState();
  }
  state.answerFeedback = buildResultMessage(question, isCorrect);
  state.showAnswer = true;
  updateWrongReviewControls();
  renderQuestion();

  if (isCorrect) {
    queueAutoNext();
  }
}

function handleOptionSelection(label) {
  const question = state.filteredQuestions[state.currentIndex];
  if (!question || !isSelectableQuestion(question)) {
    return;
  }
  if (state.answerFeedback) {
    return;
  }

  if (isMultiSelectQuestion(question)) {
    if (state.selectedOptions.includes(label)) {
      state.selectedOptions = state.selectedOptions.filter((item) => item !== label);
    } else {
      state.selectedOptions = [...state.selectedOptions, label].sort();
    }

    renderQuestion();
    return;
  }

  state.selectedOptions = [label];
  submitCurrentAnswer();
}

function markCurrentVisited() {
  const question = state.filteredQuestions[state.currentIndex];
  if (!question) {
    return;
  }
  state.progress[question.id] = (state.progress[question.id] || 0) + 1;
  persistState();
}

function goToQuestion(nextIndex) {
  if (!state.filteredQuestions.length) {
    return;
  }
  state.currentIndex = Math.max(0, Math.min(nextIndex, state.filteredQuestions.length - 1));
  resetInteractionState();
  markCurrentVisited();
  renderQuestion();
  updateJumpStatus();
  persistState();
}

function jumpToQuestion() {
  const rawValue = elements.jumpInput.value.trim();
  if (!rawValue) {
    setJumpStatus("请输入序号或题目 ID（如 Q00025）。", true);
    return;
  }

  const normalizedId = rawValue.toUpperCase();
  if (/^Q\d+$/.test(normalizedId)) {
    const currentMatchIndex = state.filteredQuestions.findIndex((question) => question.id === normalizedId);
    if (currentMatchIndex >= 0) {
      goToQuestion(currentMatchIndex);
      setJumpStatus(`已跳转到 ${normalizedId}。`);
      closeDrawer();
      return;
    }

    const existsInBank = state.payload?.questions?.some((question) => question.id === normalizedId);
    if (!existsInBank) {
      setJumpStatus(`没有找到题目 ${normalizedId}。`, true);
      return;
    }

    state.reviewWrongOnly = false;
    elements.typeFilter.value = "全部";
    elements.searchInput.value = "";
    state.currentIndex = 0;
    state.restoredQuestionId = normalizedId;
    applyFilters({ preserveQuestionId: true });
    setJumpStatus(`已跳转到 ${normalizedId}（已切回全题库）。`);
    closeDrawer();
    return;
  }

  const targetIndex = Number(rawValue);
  if (!Number.isInteger(targetIndex) || targetIndex < 1) {
    setJumpStatus("请输入正整数序号，或 Q00025 格式 ID。", true);
    return;
  }

  if (!state.filteredQuestions.length) {
    setJumpStatus("当前结果为空，无法按序号跳转。", true);
    return;
  }

  if (targetIndex > state.filteredQuestions.length) {
    setJumpStatus(`当前仅 ${state.filteredQuestions.length} 题，无法跳到第 ${targetIndex} 题。`, true);
    return;
  }

  goToQuestion(targetIndex - 1);
  setJumpStatus(`已跳转到第 ${targetIndex} 题。`);
  closeDrawer();
}

function attachEvents() {
  // 移动端抽屉事件
  if (elements.openDrawerBtn) elements.openDrawerBtn.addEventListener("click", openDrawer);
  if (elements.closeDrawerBtn) elements.closeDrawerBtn.addEventListener("click", closeDrawer);
  if (elements.drawerBackdrop) elements.drawerBackdrop.addEventListener("click", closeDrawer);

  elements.typeFilter.addEventListener("change", () => {
    state.currentIndex = 0;
    applyFilters();
    closeDrawer();
  });

  elements.searchInput.addEventListener("input", () => {
    state.currentIndex = 0;
    applyFilters();
  });

  elements.jumpButton.addEventListener("click", () => {
    jumpToQuestion();
  });

  elements.jumpInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    jumpToQuestion();
  });

  elements.sequentialButton.addEventListener("click", () => {
    state.randomMode = false;
    state.currentIndex = 0;
    applyFilters();
  });

  elements.randomButton.addEventListener("click", () => {
    state.randomMode = true;
    state.currentIndex = 0;
    applyFilters();
  });

  if (elements.quickModeToggle) {
    elements.quickModeToggle.addEventListener("click", () => {
      state.randomMode = !state.randomMode;
      state.currentIndex = 0;
      applyFilters();
    });
  }

  if (elements.autoNextToggle) {
    elements.autoNextToggle.addEventListener("change", (e) => {
      state.autoNext = e.target.checked;
      persistState();
    });
  }

  elements.prevButton.addEventListener("click", () => goToQuestion(state.currentIndex - 1));
  elements.nextButton.addEventListener("click", () => goToQuestion(state.currentIndex + 1));
  if (elements.prevButtonMobile) elements.prevButtonMobile.addEventListener("click", () => goToQuestion(state.currentIndex - 1));
  if (elements.nextButtonMobile) elements.nextButtonMobile.addEventListener("click", () => goToQuestion(state.currentIndex + 1));

  const toggleAnswerHandler = () => {
    state.showAnswer = !state.showAnswer;
    if (!state.showAnswer && !state.answerFeedback) {
      clearAnswerFeedback();
    }
    renderQuestion();
  };

  elements.answerButton.addEventListener("click", toggleAnswerHandler);
  if (elements.answerButtonMobile) {
    elements.answerButtonMobile.addEventListener("click", toggleAnswerHandler);
  }

  // 填空题点击题干内胶带遮罩直接看答案
  elements.questionStem.addEventListener("click", (event) => {
    const mask = event.target.closest("[data-blank-toggle]");
    if (!mask) return;
    state.showAnswer = true;
    renderQuestion();
  });

  const toggleWrongHandler = () => {
    const question = state.filteredQuestions[state.currentIndex];
    if (!question) {
      return;
    }
    if (state.wrongSet.has(question.id)) {
      state.wrongSet.delete(question.id);
    } else {
      state.wrongSet.add(question.id);
    }
    persistState();
    if (state.reviewWrongOnly) {
      state.currentIndex = Math.min(state.currentIndex, Math.max(state.filteredQuestions.length - 2, 0));
      applyFilters();
      return;
    }
    updateWrongReviewControls();
    renderQuestion();
  };

  elements.wrongButton.addEventListener("click", toggleWrongHandler);
  if (elements.inlineWrongBtn) elements.inlineWrongBtn.addEventListener("click", toggleWrongHandler);
  if (elements.inlineWrongBtnMobile) elements.inlineWrongBtnMobile.addEventListener("click", toggleWrongHandler);

  const toggleWrongReviewMode = () => {
    state.reviewWrongOnly = !state.reviewWrongOnly;
    state.currentIndex = 0;
    applyFilters();
    closeDrawer();
  };

  elements.reviewWrongButton.addEventListener("click", toggleWrongReviewMode);
  if (elements.quickWrongReview) {
    elements.quickWrongReview.addEventListener("click", toggleWrongReviewMode);
  }

  elements.clearWrongButton.addEventListener("click", () => {
    if (!state.wrongSet.size) {
      return;
    }
    const shouldClear = window.confirm("确认清空错题集吗？");
    if (!shouldClear) {
      return;
    }
    state.wrongSet.clear();
    if (state.reviewWrongOnly) {
      state.currentIndex = 0;
      applyFilters();
      return;
    }
    persistState();
    updateWrongReviewControls();
    renderQuestion();
  });

  elements.exportRecord.addEventListener("click", () => {
    const snapshot = buildPersistedSnapshot();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "dangke-study-record.json";
    link.click();
    URL.revokeObjectURL(url);
  });

  elements.importRecordTrigger.addEventListener("click", () => {
    elements.importRecord.click();
  });

  elements.importRecord.addEventListener("change", async (event) => {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const saved = JSON.parse(text);
      if (!saved || typeof saved !== "object") throw new Error("Invalid format");
      state.progress = saved.progress || {};
      state.wrongSet = new Set(saved.wrongIds || []);
      state.randomMode = Boolean(saved.randomMode);
      state.reviewWrongOnly = Boolean(saved.reviewWrongOnly);
      state.restoredQuestionId = saved.currentQuestionId || null;
      state.restoredTypeFilter = saved.typeFilter || "全部";
      state.restoredSearchKeyword = saved.searchKeyword || "";
      initWithPayload(state.payload);
      alert("记录导入成功！");
    } catch (err) {
      console.error(err);
      alert("导入的记录文件格式有误，请确保导入的是此前导出的 json 文件。");
    } finally {
      elements.importRecord.value = "";
    }
  });

  elements.optionList.addEventListener("click", (event) => {
    const optionButton = event.target.closest("[data-option-label]");
    if (!optionButton) {
      return;
    }
    handleOptionSelection(optionButton.dataset.optionLabel);
  });

  elements.submitAnswer.addEventListener("click", () => {
    submitCurrentAnswer();
  });

  elements.resetSelection.addEventListener("click", () => {
    if (state.answerFeedback) {
      return;
    }
    state.selectedOptions = [];
    renderQuestion();
  });

  if (elements.uploadTrigger) {
    elements.uploadTrigger.addEventListener("click", () => {
      elements.upload.click();
    });
  }

  elements.upload.addEventListener("change", async (event) => {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }
    const text = await file.text();
    const payload = JSON.parse(text);
    initWithPayload(payload);
    closeDrawer();
  });

  if (elements.viewExplanationMobile) {
    elements.viewExplanationMobile.addEventListener("click", () => {
      elements.explanationModal.classList.remove("hidden");
    });
  }

  if (elements.modalClose) {
    elements.modalClose.addEventListener("click", () => {
      elements.explanationModal.classList.add("hidden");
    });
  }

  if (elements.modalOverlay) {
    elements.modalOverlay.addEventListener("click", () => {
      elements.explanationModal.classList.add("hidden");
    });
  }

  // 全键盘快捷键支持
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
    } else if (key === " ") {
      event.preventDefault();
      toggleAnswerHandler();
    } else if (key === "ENTER") {
      const q = getCurrentQuestion();
      if (q && isMultiSelectQuestion(q) && state.selectedOptions.length && !state.answerFeedback) {
        event.preventDefault();
        submitCurrentAnswer();
      }
    } else if (key === "S") {
      event.preventDefault();
      toggleWrongHandler();
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
  state.currentIndex = 0;
  resetInteractionState();
  buildHeroStats(payload.meta || {});
  populateTypeFilter(payload.questions || []);
  elements.typeFilter.value = [...elements.typeFilter.options].some(
    (option) => option.value === state.restoredTypeFilter,
  )
    ? state.restoredTypeFilter
    : "全部";
  elements.searchInput.value = state.restoredSearchKeyword;
  updateWrongReviewControls();
  applyFilters({ preserveQuestionId: true });
}

async function bootstrap() {
  loadPersistedState();
  attachEvents();

  try {
    const payload = await loadPayload();
    initWithPayload(payload);
  } catch (error) {
    elements.resultCount.textContent = "自动加载失败";
    elements.questionStem.textContent = "请打开控制面板中的“数据备份与手动加载”选择 questions.json";
    elements.optionList.innerHTML = "";
    elements.answerBox.classList.add("hidden");
    elements.noteBox.classList.add("hidden");
  }
}

bootstrap();
