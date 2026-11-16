import argparse
import datetime
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# 文本清洗与正则规则
# ---------------------------------------------------------------------------

PAGE_NUM_RE = re.compile(
    r"^(?:[-—–\s]*\d+[-—–\s]*|第\s*\d+\s*页(?:\s*/\s*共\s*\d+\s*页)?|\d+\s*/\s*\d+)$"
)

SECTION_TYPE_MAP = [
    (re.compile(r"单项选择|单选题|单选"), "单选题"),
    (re.compile(r"多项选择|多选题|多选"), "多选题"),
    (re.compile(r"判断|是非"), "判断题"),
    (re.compile(r"填空"), "填空题"),
]

QUESTION_START_RE = re.compile(
    r"^\s*(?:【\s*(\d+)\s*】|[\(（]\s*(\d+)\s*[\)）]|(\d+)\s*[\.、\)）])\s*(.+)$"
)

INLINE_OPTION_SPLIT_RE = re.compile(r"(?:^|\s+)([A-F])\s*[\.、:：\)）]\s*")
OPTION_LINE_RE = re.compile(r"^\s*([A-F])\s*[\.、:：\)）]\s*(.+)$")

ANSWER_LINE_RE = re.compile(
    r"^\s*(?:【\s*)?(?:参考)?(?:正确)?答案(?:\s*】)?\s*[：:]*\s*(.+)$"
)
EXPLANATION_LINE_RE = re.compile(
    r"^\s*(?:【\s*)?(?:答案)?(?:解析|详解|说明)(?:\s*】)?\s*[：:]*\s*(.+)$"
)

TRUE_VALUES = {"对", "正确", "√", "T", "TRUE", "YES", "是"}
FALSE_VALUES = {"错", "错误", "×", "✕", "X", "F", "FALSE", "NO", "否"}


def normalize_stem_fingerprint(stem: str) -> str:
    """生成用于题干去重的归一化指纹（去除空白、标点及括号差异）。"""
    text = str(stem or "")
    text = re.sub(r"[（(]\s*[A-F√×对错TF\s]*\s*[)）]", "", text)
    text = re.sub(r"[\s\W_]+", "", text, flags=re.UNICODE)
    return text.lower()


def clean_line(line: str) -> str:
    return re.sub(r"\s+", " ", line.replace("\u3000", " ").replace("\xa0", " ")).strip()


def detect_section_type(line: str) -> Optional[str]:
    """识别如 '一、单选题'、'【多选题】' 等章节题型标题。"""
    stripped = line.strip()
    if len(stripped) > 30:
        return None
    if re.match(r"^[一二三四五六七八九十0-9【\[]", stripped) or stripped.endswith("题"):
        for pattern, q_type in SECTION_TYPE_MAP:
            if pattern.search(stripped):
                return q_type
    return None


# ---------------------------------------------------------------------------
# Word (.docx) 提取
# ---------------------------------------------------------------------------

def extract_text_from_docx(file_path: Path) -> List[str]:
    try:
        from docx import Document
    except ImportError as exc:
        raise RuntimeError("缺少 python-docx，请运行: pip install python-docx") from exc

    doc = Document(str(file_path))
    lines: List[str] = []

    for para in doc.paragraphs:
        text = clean_line(para.text)
        if text:
            lines.append(text)

    for table in doc.tables:
        for row in table.rows:
            row_cells = [clean_line(cell.text) for cell in row.cells]
            row_text = " ".join(c for c in row_cells if c)
            if row_text:
                lines.append(row_text)

    return lines


# ---------------------------------------------------------------------------
# PDF (.pdf) 强化提取：文本层排序提取 + 扫描页高分辨率 OCR 自动兜底
# ---------------------------------------------------------------------------

class OCREngineHolder:
    _engine = None

    @classmethod
    def get(cls):
        if cls._engine is None:
            try:
                from rapidocr_onnxruntime import RapidOCR
            except ImportError as exc:
                raise RuntimeError(
                    "缺少 rapidocr_onnxruntime，请运行: pip install rapidocr_onnxruntime"
                ) from exc
            cls._engine = RapidOCR()
        return cls._engine


def _ocr_pixmap_lines(pix) -> List[str]:
    ocr = OCREngineHolder.get()
    img_bytes = pix.tobytes("png")
    result, _ = ocr(img_bytes)
    if not result:
        return []

    # RapidOCR 返回 [[box, text, score], ...]，box 为四个顶点坐标
    items = []
    for item in result:
        box, text, _score = item[0], item[1], item[2]
        y_top = min(pt[1] for pt in box)
        x_left = min(pt[0] for pt in box)
        items.append((y_top, x_left, clean_line(text)))

    # 按行聚类（y 坐标相差 <= 12 像素视为同一行），行内按 x 排序拼接
    items.sort(key=lambda t: (t[0], t[1]))
    merged_lines: List[str] = []
    current_y = None
    current_row: List[Tuple[float, str]] = []

    for y, x, text in items:
        if not text:
            continue
        if current_y is None or abs(y - current_y) <= 12:
            current_row.append((x, text))
            if current_y is None:
                current_y = y
        else:
            current_row.sort(key=lambda t: t[0])
            merged_lines.append(" ".join(t[1] for t in current_row))
            current_y = y
            current_row = [(x, text)]

    if current_row:
        current_row.sort(key=lambda t: t[0])
        merged_lines.append(" ".join(t[1] for t in current_row))

    return merged_lines


def _extract_pdf_text_blocks(page) -> List[str]:
    """按阅读顺序（y0, x0）提取 PDF 文本层，保留物理行。"""
    blocks = page.get_text("blocks")
    # block: (x0, y0, x1, y1, text, block_no, block_type)
    text_blocks = [b for b in blocks if len(b) >= 7 and b[6] == 0 and str(b[4]).strip()]
    text_blocks.sort(key=lambda b: (round(b[1], 1), round(b[0], 1)))

    lines: List[str] = []
    for b in text_blocks:
        for raw_line in str(b[4]).splitlines():
            cleaned = clean_line(raw_line)
            if cleaned:
                lines.append(cleaned)
    return lines


def _should_fallback_to_ocr(text_lines: List[str], page) -> bool:
    """判断当前 PDF 页是否需要走 OCR（纯扫描图片或文字极少）。"""
    joined = "".join(text_lines)
    non_space_len = len(re.sub(r"\s+", "", joined))
    if non_space_len < 20:
        images = page.get_images(full=False)
        if images or non_space_len == 0:
            return True
    # 检测是否存在大量乱码替换符
    if joined.count("\ufffd") >= 5:
        return True
    return False


def _merge_broken_pdf_lines(raw_lines: List[str]) -> List[str]:
    """过滤页码行，并合并 PDF 中因行宽导致的错误断行。"""
    filtered: List[str] = []
    for line in raw_lines:
        if PAGE_NUM_RE.match(line):
            continue
        filtered.append(line)

    merged: List[str] = []
    for line in filtered:
        is_structural = bool(
            QUESTION_START_RE.match(line)
            or OPTION_LINE_RE.match(line)
            or ANSWER_LINE_RE.match(line)
            or EXPLANATION_LINE_RE.match(line)
            or detect_section_type(line)
        )
        if is_structural or not merged:
            merged.append(line)
        else:
            prev = merged[-1]
            # 若上一行以句末标点结尾且当前行像新段，可独立；否则拼接修复断行
            if prev.endswith(("。", "？", "！", "；", "：", ":")):
                merged.append(line)
            else:
                # 中英文衔接处理
                sep = " " if re.search(r"[A-Za-z0-9]$", prev) and re.match(r"^[A-Za-z0-9]", line) else ""
                merged[-1] = prev + sep + line
    return merged


def extract_text_from_pdf(file_path: Path, force_ocr: bool = False, ocr_dpi: int = 220) -> Tuple[List[str], Dict[str, int]]:
    try:
        import pymupdf
    except ImportError as exc:
        raise RuntimeError("缺少 pymupdf，请运行: pip install pymupdf") from exc

    doc = pymupdf.open(str(file_path))
    all_raw_lines: List[str] = []
    stats = {"total_pages": len(doc), "text_pages": 0, "ocr_pages": 0}

    for page_idx, page in enumerate(doc):
        text_lines = [] if force_ocr else _extract_pdf_text_blocks(page)
        if force_ocr or _should_fallback_to_ocr(text_lines, page):
            pix = page.get_pixmap(dpi=ocr_dpi)
            ocr_lines = _ocr_pixmap_lines(pix)
            all_raw_lines.extend(ocr_lines)
            stats["ocr_pages"] += 1
        else:
            all_raw_lines.extend(text_lines)
            stats["text_pages"] += 1

    doc.close()
    return _merge_broken_pdf_lines(all_raw_lines), stats


# ---------------------------------------------------------------------------
# 题目解析与结构化
# ---------------------------------------------------------------------------

def _split_inline_options(text: str) -> Dict[str, str]:
    """拆分同一行中的多个选项，例如 'A. 选项1 B. 选项2 C. 选项3 D. 选项4'。"""
    matches = list(INLINE_OPTION_SPLIT_RE.finditer(text))
    if not matches:
        return {}
    options: Dict[str, str] = {}
    for i, m in enumerate(matches):
        label = m.group(1).upper()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        val = clean_line(text[start:end])
        if val:
            options[label] = val
    return options


def _extract_embedded_answer_from_stem(stem: str) -> Tuple[str, str]:
    """尝试从题干括号中提取内嵌答案，如 '党章规定（ A ）。' -> 清理括号并提取 A。"""
    # 匹配全角或半角括号内仅含选项字母或对错符号
    pattern = re.compile(r"([（(])\s*([A-F]{1,6}|[√×对错TF])\s*([)）])")
    m = pattern.search(stem)
    if not m:
        return stem, ""
    extracted = m.group(2).strip().upper()
    cleaned_stem = pattern.sub(r"\1 \3", stem, count=1)
    return cleaned_stem, extracted


def _normalize_judge_answer(raw_ans: str) -> Optional[str]:
    token = raw_ans.strip().upper()
    if token in TRUE_VALUES:
        return "A"
    if token in FALSE_VALUES:
        return "B"
    return None


def _finalize_question(raw_q: Dict[str, Any], default_type: Optional[str]) -> Optional[Dict[str, Any]]:
    stem = clean_line(raw_q["stem"])
    if not stem:
        return None

    options: Dict[str, str] = raw_q["options"]
    answer = clean_line(raw_q["answer"])
    explanation = clean_line(raw_q["explanation"])

    # 若未显式出现答案行，尝试从题干括号提取
    if not answer:
        stem, embedded = _extract_embedded_answer_from_stem(stem)
        if embedded:
            answer = embedded

    # 判断题标准化
    judge_ans = _normalize_judge_answer(answer)
    q_type = raw_q.get("hint_type") or default_type

    if judge_ans is not None and (not options or set(options.keys()) <= {"A", "B"}):
        q_type = "判断题"
        if not options:
            options = {"A": "正确", "B": "错误"}
        answer = judge_ans
    elif options:
        letters = sorted(set(re.findall(r"[A-F]", answer.upper())))
        if letters:
            answer = "".join(letters)
            if len(letters) > 1:
                q_type = "多选题"
            elif q_type != "判断题":
                q_type = "单选题"
        else:
            q_type = q_type or "单选题"
    else:
        q_type = q_type or "填空题"

    return {
        "id": "",
        "type": q_type,
        "stem": stem,
        "options": options,
        "answer": answer,
        "notes": [],
        "dedupeStatus": "unique",
        "reviewReason": "" if answer else "未提取到答案，请人工复核",
        "sourceFiles": [raw_q["source"]],
        "explanation": explanation,
    }


def parse_lines_to_questions(lines: List[str], source_name: str) -> List[Dict[str, Any]]:
    questions: List[Dict[str, Any]] = []
    current_section_type: Optional[str] = None
    current_q: Optional[Dict[str, Any]] = None
    last_field: Optional[str] = None  # "stem" | "explanation"

    def flush():
        nonlocal current_q
        if current_q:
            finalized = _finalize_question(current_q, current_section_type)
            if finalized:
                questions.append(finalized)
            current_q = None

    for line in lines:
        sec_type = detect_section_type(line)
        if sec_type:
            flush()
            current_section_type = sec_type
            last_field = None
            continue

        q_match = QUESTION_START_RE.match(line)
        if q_match:
            flush()
            body = clean_line(q_match.group(4))
            # 检查题干行末尾是否直接带了同行选项
            inline_opts = _split_inline_options(body)
            if inline_opts and re.search(r"\s+A\s*[\.、:：\)）]", body):
                first_opt_pos = re.search(r"\s+A\s*[\.、:：\)）]", body).start()
                stem_part = body[:first_opt_pos].strip()
                opt_part = body[first_opt_pos:].strip()
                inline_opts = _split_inline_options(opt_part)
            else:
                stem_part = body
                inline_opts = {}

            current_q = {
                "stem": stem_part,
                "options": inline_opts,
                "answer": "",
                "explanation": "",
                "hint_type": current_section_type,
                "source": source_name,
            }
            last_field = "stem"
            continue

        if not current_q:
            continue

        ans_match = ANSWER_LINE_RE.match(line)
        if ans_match:
            current_q["answer"] = clean_line(ans_match.group(1))
            last_field = None
            continue

        exp_match = EXPLANATION_LINE_RE.match(line)
        if exp_match:
            current_q["explanation"] = clean_line(exp_match.group(1))
            last_field = "explanation"
            continue

        opt_match = OPTION_LINE_RE.match(line)
        if opt_match:
            inline_opts = _split_inline_options(line)
            if inline_opts:
                current_q["options"].update(inline_opts)
            else:
                current_q["options"][opt_match.group(1).upper()] = clean_line(opt_match.group(2))
            last_field = None
            continue

        # 续行追加
        if last_field == "explanation":
            current_q["explanation"] += " " + line
        elif last_field == "stem":
            current_q["stem"] += line

    flush()
    return questions


# ---------------------------------------------------------------------------
# 题库去重与合并
# ---------------------------------------------------------------------------

def _next_question_id(existing_questions: List[Dict[str, Any]], prefix: str = "Q") -> int:
    max_num = 0
    for q in existing_questions:
        m = re.search(r"(\d+)$", str(q.get("id", "")))
        if m:
            max_num = max(max_num, int(m.group(1)))
    return max_num + 1


def merge_and_dedupe(
    existing_data: Dict[str, Any],
    new_questions: List[Dict[str, Any]],
) -> Tuple[Dict[str, Any], Dict[str, int]]:
    existing_questions = list(existing_data.get("questions", []))
    fp_index: Dict[str, int] = {}

    for idx, q in enumerate(existing_questions):
        fp = normalize_stem_fingerprint(q.get("stem", ""))
        if fp:
            fp_index[fp] = idx

    added = 0
    deduped = 0
    enriched = 0
    next_num = _next_question_id(existing_questions)

    for q in new_questions:
        fp = normalize_stem_fingerprint(q.get("stem", ""))
        if not fp:
            continue

        if fp in fp_index:
            deduped += 1
            exist_q = existing_questions[fp_index[fp]]
            # 合并来源文件名
            src_set = set(exist_q.get("sourceFiles") or [])
            for src in q.get("sourceFiles") or []:
                if src not in src_set:
                    exist_q.setdefault("sourceFiles", []).append(src)
            # 若原题缺少解析而新题有解析，自动补全
            if not exist_q.get("explanation") and q.get("explanation"):
                exist_q["explanation"] = q["explanation"]
                enriched += 1
            continue

        q["id"] = f"Q{next_num:05d}"
        next_num += 1
        fp_index[fp] = len(existing_questions)
        existing_questions.append(q)
        added += 1

    type_counts: Dict[str, int] = {}
    conflict_items = 0
    for q in existing_questions:
        t = q.get("type") or "其他"
        type_counts[t] = type_counts.get(t, 0) + 1
        if q.get("reviewReason"):
            conflict_items += 1

    merged_data = {
        "meta": {
            "generatedAt": datetime.datetime.now().isoformat(timespec="seconds"),
            "totalQuestions": len(existing_questions),
            "typeCounts": type_counts,
            "conflictItems": conflict_items,
        },
        "questions": existing_questions,
    }
    summary = {
        "extracted": len(new_questions),
        "added": added,
        "deduped": deduped,
        "enriched": enriched,
        "total_after_merge": len(existing_questions),
    }
    return merged_data, summary


def load_bank_json(json_path: Path) -> Dict[str, Any]:
    if json_path.exists():
        with open(json_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"meta": {"generatedAt": "", "totalQuestions": 0, "typeCounts": {}, "conflictItems": 0}, "questions": []}


def save_bank(data: Dict[str, Any], json_path: Path, js_path: Optional[Path] = None) -> None:
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    if js_path is not None:
        js_content = "window.QUESTION_BANK_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";"
        with open(js_path, "w", encoding="utf-8") as f:
            f.write(js_content)


def collect_input_files(inputs: List[str]) -> List[Path]:
    files: List[Path] = []
    for item in inputs:
        p = Path(item)
        if p.is_dir():
            for ext in ("*.docx", "*.pdf"):
                files.extend(sorted(p.glob(ext)))
        elif p.is_file():
            files.append(p)
        else:
            print(f"[警告] 找不到输入路径: {item}")
    return files


def main():
    parser = argparse.ArgumentParser(
        description="从 Word(.docx) 和 PDF(.pdf，含扫描版 OCR 兜底) 提取题目，并去重合并到题库。"
    )
    parser.add_argument("inputs", nargs="+", help="输入文件或文件夹路径（支持 .docx / .pdf）")
    parser.add_argument("--target-json", default="questions.json", help="目标题库 JSON 路径（默认 questions.json）")
    parser.add_argument("--target-js", default="", help="同步生成的 JS 路径（默认与 target-json 同名 .js）")
    parser.add_argument("--force-ocr", action="store_true", help="对 PDF 强制全量启用 OCR 识别")
    parser.add_argument("--ocr-dpi", type=int, default=220, help="PDF 扫描页渲染 DPI（默认 220）")
    parser.add_argument("--dry-run", action="store_true", help="仅预览提取与去重统计，不写入目标文件")
    args = parser.parse_args()

    files = collect_input_files(args.inputs)
    if not files:
        print("未找到任何可处理的 .docx 或 .pdf 文件。")
        sys.exit(1)

    all_extracted: List[Dict[str, Any]] = []
    for file_path in files:
        suffix = file_path.suffix.lower()
        print(f"正在处理: {file_path.name} ...")
        if suffix == ".docx":
            lines = extract_text_from_docx(file_path)
            qs = parse_lines_to_questions(lines, file_path.name)
            print(f"  -> Word 解析完成，提取题目 {len(qs)} 道")
            all_extracted.extend(qs)
        elif suffix == ".pdf":
            lines, pdf_stats = extract_text_from_pdf(file_path, force_ocr=args.force_ocr, ocr_dpi=args.ocr_dpi)
            qs = parse_lines_to_questions(lines, file_path.name)
            print(
                f"  -> PDF 解析完成（共 {pdf_stats['total_pages']} 页："
                f"文本页 {pdf_stats['text_pages']}，OCR 页 {pdf_stats['ocr_pages']}），"
                f"提取题目 {len(qs)} 道"
            )
            all_extracted.extend(qs)
        else:
            print(f"  -> 跳过不支持的格式: {file_path.name}")

    target_json = Path(args.target_json)
    target_js = Path(args.target_js) if args.target_js else target_json.with_suffix(".js")

    existing_data = load_bank_json(target_json)
    merged_data, summary = merge_and_dedupe(existing_data, all_extracted)

    print("\n=== 提取与去重合并结果 ===")
    print(f"本次共提取: {summary['extracted']} 道")
    print(f"去重跳过:   {summary['deduped']} 道（其中补全解析 {summary['enriched']} 道）")
    print(f"新增入库:   {summary['added']} 道")
    print(f"合并后总计: {summary['total_after_merge']} 道")
    print(f"题型分布:   {merged_data['meta']['typeCounts']}")
    print(f"待复核题目: {merged_data['meta']['conflictItems']} 道")

    if args.dry_run:
        print("\n[预览模式] 未写入目标文件。")
        return

    save_bank(merged_data, target_json, target_js)
    print(f"\n已保存至: {target_json} 和 {target_js}")


if __name__ == "__main__":
    main()
