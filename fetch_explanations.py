import argparse
import json
import os
import sys
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    from openai import OpenAI
except ImportError:
    print("错误：缺少依赖库。请先在命令行运行: pip install openai")
    sys.exit(1)

API_KEY = os.environ.get("DEEPSEEK_API_KEY", "").strip()
BASE_URL = "https://api.deepseek.com"
MODEL_NAME = "deepseek-flash"  # DeepSeek-V4.1-Flash-1017

JSON_PATH = "questions.json"
JS_PATH = "questions.js"
PROGRESS_PATH = "explanation_progress.json"
DEFAULT_CONCURRENCY = 16
SAVE_EVERY = 25

file_lock = threading.Lock()
print_lock = threading.Lock()


def safe_print(msg: str) -> None:
    with print_lock:
        print(msg, flush=True)


def load_questions():
    with open(JSON_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_questions(data) -> None:
    with file_lock:
        with open(JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        js_content = (
            "window.QUESTION_BANK_DATA = "
            + json.dumps(data, ensure_ascii=False, separators=(",", ":"))
            + ";"
        )
        with open(JS_PATH, "w", encoding="utf-8") as f:
            f.write(js_content)


def write_live_progress(
    total: int,
    done_total: int,
    batch_done: int,
    batch_total: int,
    failed: int,
    start_time: float,
    recent_items: list,
    status: str = "running",
) -> None:
    elapsed = max(0.1, time.time() - start_time)
    speed = batch_done / elapsed if batch_done > 0 else 0.0
    remaining = max(0, total - done_total)
    eta_sec = int(remaining / speed) if speed > 0 else 0
    payload = {
        "model": MODEL_NAME,
        "status": status,
        "updatedAt": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
        "total": total,
        "completed": done_total,
        "percent": round(done_total / total * 100, 2) if total else 100,
        "failed": failed,
        "speedPerSec": round(speed, 2),
        "etaSeconds": eta_sec,
        "recent": recent_items,
    }
    with file_lock:
        with open(PROGRESS_PATH, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)


def build_prompt(q: dict) -> str:
    q_type = q.get("type", "单选题")
    stem = q.get("stem", "")
    options = q.get("options", {})
    answer = q.get("answer", "")

    if q_type == "判断题":
        ans_display = "A（正确）" if answer == "A" else ("B（错误）" if answer == "B" else answer)
        opt_text = "A: 正确, B: 错误"
    elif options:
        ans_display = answer
        opt_text = "；".join(f"{k}. {v}" for k, v in options.items())
    else:
        ans_display = answer
        opt_text = "（填空题，无选项）"

    return (
        f"你是一个专业的党建与党史知识解答助手。请针对以下党课题库中的【{q_type}】，"
        f"围绕给定的正确答案给出简明扼要的解析（说明为什么该答案正确、错误项为何不选，或补充相关的党章/重要会议/理论背景）。\n"
        f"解析要求：字数在 50-150 字之间，直接输出解析正文，不要重复题干，不要加 Markdown 标题。\n\n"
        f"题型：{q_type}\n"
        f"题目：{stem}\n"
        f"选项：{opt_text}\n"
        f"正确答案：{ans_display}"
    )


def ask_llm_for_explanation(client: OpenAI, q: dict) -> str | None:
    prompt = build_prompt(q)
    max_retries = 4

    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
                model=MODEL_NAME,
                messages=[
                    {"role": "system", "content": "你是一个严谨、精炼的党史与党建知识辅助教师。"},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.2,
                max_tokens=1500,
            )
            content = (response.choices[0].message.content or "").strip()
            return content if content else None
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "rate limit" in err_str.lower():
                wait_sec = 2 ** (attempt + 1)
                safe_print(f"  [频控等待] {q.get('id')} 触发 429，{wait_sec}s 后重试...")
                time.sleep(wait_sec)
            else:
                if attempt == max_retries - 1:
                    safe_print(f"  [异常] {q.get('id')} 调用失败: {e}")
                else:
                    time.sleep(1)
    return None


def main():
    parser = argparse.ArgumentParser(description="使用 DeepSeek-V4.1-Flash (deepseek-flash) 并发生成题库解析")
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY, help="并发线程数（默认 16）")
    parser.add_argument("--limit", type=int, default=0, help="仅处理前 N 道未解析题目（0 表示全量）")
    parser.add_argument("--force", action="store_true", help="强制重新生成已有解析的题目")
    args = parser.parse_args()

    if not API_KEY:
        print("错误：未检测到环境变量 DEEPSEEK_API_KEY。请先设置后再运行（例如: $env:DEEPSEEK_API_KEY='your_key'）。")
        sys.exit(1)

    print(f"初始化大模型客户端 (模型: {MODEL_NAME})...")
    client = OpenAI(api_key=API_KEY, base_url=BASE_URL)

    data = load_questions()
    questions = data.get("questions", [])
    total = len(questions)

    todo = [q for q in questions if args.force or not q.get("explanation")]
    already_has = total - len(todo)

    if args.limit > 0:
        todo = todo[: args.limit]

    print(f"题库总计 {total} 题，已有解析 {already_has} 题，本批待生成 {len(todo)} 题（并发数: {args.concurrency}）。")
    recent_queue = deque(maxlen=15)
    start_time = time.time()

    if not todo:
        write_live_progress(total, already_has, 0, 0, 0, start_time, [], status="completed")
        print("所有题目均已包含解析，无需生成。")
        return

    updated = 0
    failed = 0
    write_live_progress(total, already_has, 0, len(todo), 0, start_time, [], status="running")

    try:
        with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
            future_to_q = {executor.submit(ask_llm_for_explanation, client, q): q for q in todo}
            for idx, future in enumerate(as_completed(future_to_q), 1):
                q = future_to_q[future]
                exp = future.result()
                if exp:
                    q["explanation"] = exp
                    updated += 1
                    recent_queue.appendleft(
                        {
                            "id": q.get("id"),
                            "type": q.get("type"),
                            "stem": q.get("stem"),
                            "answer": q.get("answer"),
                            "explanation": exp,
                        }
                    )
                    if updated % SAVE_EVERY == 0 or idx == len(todo):
                        save_questions(data)
                        done_now = already_has + updated
                        pct = done_now / total * 100
                        safe_print(
                            f"--> [进度 {done_now}/{total} ({pct:.1f}%)] 本批已完成 {idx}/{len(todo)}，已同步写盘"
                        )
                    if idx % 4 == 0 or idx == len(todo):
                        write_live_progress(
                            total,
                            already_has + updated,
                            updated,
                            len(todo),
                            failed,
                            start_time,
                            list(recent_queue),
                            status="running",
                        )
                else:
                    failed += 1
                    safe_print(f"[{idx}/{len(todo)}] {q.get('id')} 解析生成失败")
    except KeyboardInterrupt:
        print("\n检测到手动中断，正在保存已生成的解析进度...")
    finally:
        if updated > 0:
            save_questions(data)
        final_done = sum(1 for q in questions if q.get("explanation"))
        write_live_progress(
            total,
            final_done,
            updated,
            len(todo),
            failed,
            start_time,
            list(recent_queue),
            status="completed" if final_done == total else "paused",
        )
        elapsed = time.time() - start_time
        print(
            f"\n本批处理结束！耗时 {elapsed:.1f}s，新增解析 {updated} 道，失败 {failed} 道，"
            f"当前题库含解析总数: {final_done}/{total} ({final_done/total*100:.1f}%)。"
        )


if __name__ == "__main__":
    main()
