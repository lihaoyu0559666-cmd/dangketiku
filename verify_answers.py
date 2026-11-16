import json
import os
import time
import sys
import threading
import re
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    from openai import OpenAI
except ImportError:
    print("错误：缺少依赖库。请先在命令行运行: pip install openai")
    sys.exit(1)

# ==========================================
# 配置参数
# ==========================================
API_KEY = os.environ.get("DEEPSEEK_API_KEY", "").strip()
BASE_URL = "https://api.deepseek.com" 
# 可以根据实际接口调整，当前使用 DeepSeek-V4.1-Flash ("deepseek-flash")
MODEL_NAME = "deepseek-flash"

# 文件路径
JSON_PATH = 'questions.json'
PROGRESS_PATH = 'verify_progress.json'
REPORT_PATH = 'verification_report.md'

# 线程与频控配置
CONCURRENCY = 8        # 并发线程数（可根据账号的 Rate Limit 适当调整）
SLEEP_BETWEEN_CALLS = 0.5 # 每次调用后的休眠时间，配合多线程平滑请求速度

# 锁机制，用于多线程安全写入进度与输出日志
file_lock = threading.Lock()
print_lock = threading.Lock()

def safe_print(message):
    with print_lock:
        print(message)
        sys.stdout.flush()

def load_questions():
    with open(JSON_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)

def load_progress():
    if os.path.exists(PROGRESS_PATH):
        try:
            with open(PROGRESS_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_progress(progress_data):
    with file_lock:
        with open(PROGRESS_PATH, 'w', encoding='utf-8') as f:
            json.dump(progress_data, f, ensure_ascii=False, indent=2)

def generate_markdown_report(questions_dict, progress_data):
    """
    根据已完成的核验结果生成 Markdown 格式的报告
    """
    total = len(questions_dict)
    checked = len(progress_data)
    
    incorrect_list = []
    correct_count = 0
    fail_count = 0
    
    for q_id, result in progress_data.items():
        if result.get("status") == "failed":
            fail_count += 1
            continue
        
        is_correct = result.get("is_correct", True)
        if is_correct:
            correct_count += 1
        else:
            incorrect_list.append({
                "id": q_id,
                "type": result.get("type"),
                "stem": result.get("stem"),
                "options": result.get("options"),
                "given_answer": result.get("given_answer"),
                "correct_answer": result.get("correct_answer"),
                "reason": result.get("reason")
            })
            
    accuracy = (correct_count / (checked - fail_count) * 100) if (checked - fail_count) > 0 else 0
    
    lines = []
    lines.append("# 党课题库答案真实性核验报告")
    lines.append(f"\n*   **核验模型**: `{MODEL_NAME}`")
    lines.append(f"*   **核验时间**: {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime())}")
    lines.append(f"*   **题库总数**: {total} 道")
    lines.append(f"*   **已完成核验**: {checked} 道 (进度: {checked/total*100:.2f}%)")
    lines.append(f"*   **答案正确数**: {correct_count} 道")
    lines.append(f"*   **答案有误数**: {len(incorrect_list)} 道")
    lines.append(f"*   **API核验失败数**: {fail_count} 道")
    lines.append(f"*   **核验正确率**: **{accuracy:.2f}%** (正确数 / 已核验有效数)")
    lines.append("\n## 一、核验结果概述")
    lines.append("本报告通过调用大语言模型，将题库中的题目、选项、给出答案与官方党史党纪、标准教材进行多维对比校验，找出其中可能存在的答案错误。")
    
    if incorrect_list:
        lines.append(f"\n## 二、异常题目详情 (共 {len(incorrect_list)} 道)")
        lines.append("以下题目经大模型核验，其记录的答案可能存在真实性/准确性问题，请人工重点复核：\n")
        
        for idx, item in enumerate(incorrect_list):
            lines.append(f"### {idx+1}. 题目 ID: `{item['id']}` [{item['type']}]")
            lines.append(f"*   **题干**: {item['stem']}")
            if item['options']:
                options_str = ", ".join([f"{k}: {v}" for k, v in item['options'].items()])
                lines.append(f"*   **选项**: {options_str}")
            lines.append(f"*   **系统录入答案**: `<kbd>{item['given_answer']}</kbd>`")
            lines.append(f"*   **大模型核对答案**: **`<kbd style='color:green;'>{item['correct_answer']}</kbd>`**")
            lines.append(f"*   **核验依据**: {item['reason']}")
            lines.append("\n" + "-"*40 + "\n")
    else:
        lines.append("\n## 二、异常题目详情")
        lines.append("当前已核验的题目中，未发现录入答案与大模型校对答案不一致的题目。")
        
    with file_lock:
        with open(REPORT_PATH, 'w', encoding='utf-8') as f:
            f.write("\n".join(lines))

def verify_single_question(client, q):
    q_id = q.get('id')
    q_type = q.get('type', '')
    stem = q.get('stem', '')
    options = q.get('options', {})
    answer = q.get('answer', '')
    
    options_str = json.dumps(options, ensure_ascii=False) if options else "无选项"
    
    prompt = f"""你是一个专业的党建与党史知识核验专家。请仔细核对以下题目的给定答案是否完全正确（真实、准确，符合官方党史党规与标准党建教材）。

题目类型：{q_type}
题目题干：{stem}
题目选项：{options_str}
给定的当前答案：{answer}

【核验规则】：
1. 对于选择题（单选、多选），请确认“给定的当前答案”是否为唯一或最符合官方规定的答案。
2. 对于判断题，确认“给定的当前答案”（A代表正确，B代表错误）是否与事实相符。
3. 对于填空题，确认“给定的当前答案”字词是否精准无误。
4. 如果发现错误，请指出正确答案，并给出详细的核验依据。

请【严格且仅】以 JSON 格式回复，不要包含任何 Markdown 代码块包裹（如 ```json ），也不要包含任何其他解释性文字，只输出合法的 JSON 内容。格式要求如下：
{{
  "is_correct": true 或 false（如果当前答案正确则填 true，有任何不正确、错字或多选少选等不一致情况填 false）,
  "correct_answer": "正确答案（字符串，如 'A' 或 'ABC' 或填空题的内容。如果当前答案正确，请保持与当前答案完全一致）",
  "reason": "核验依据与理由说明（详细说明为什么正确或为什么错误）"
}}"""

    max_retries = 4
    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
                model=MODEL_NAME,
                messages=[
                    {"role": "system", "content": "你是一个只输出 JSON 格式数据的党史党建知识库核验助手。"},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.1,  # 降低随机性，确保严谨
                max_tokens=500
            )
            raw_content = response.choices[0].message.content.strip()
            
            # 清理可能被 markdown 代码块包裹的 json
            if raw_content.startswith("```json"):
                raw_content = raw_content[7:]
            if raw_content.startswith("```"):
                raw_content = raw_content[3:]
            if raw_content.endswith("```"):
                raw_content = raw_content[:-3]
            raw_content = raw_content.strip()
            
            try:
                res = json.loads(raw_content)
            except Exception as json_err:
                # Regex fallback for loose JSON parsing (handling unescaped newlines in strings)
                is_correct_match = re.search(r'"is_correct"\s*:\s*(true|false)', raw_content, re.IGNORECASE)
                correct_ans_match = re.search(r'"correct_answer"\s*:\s*"([^"]*)"', raw_content)
                reason_match = re.search(r'"reason"\s*:\s*"(.*?)"\s*\}', raw_content, re.DOTALL)
                if not reason_match:
                    reason_match = re.search(r'"reason"\s*:\s*"([^"]*)"', raw_content, re.DOTALL)
                
                if is_correct_match and correct_ans_match and reason_match:
                    res = {
                        "is_correct": is_correct_match.group(1).lower() == "true",
                        "correct_answer": correct_ans_match.group(1),
                        "reason": reason_match.group(1).replace("\n", " ").strip()
                    }
                else:
                    raise json_err
            
            # 补全辅助字段，方便报告生成
            res["status"] = "success"
            res["type"] = q_type
            res["stem"] = stem
            res["options"] = options
            res["given_answer"] = answer
            
            return q_id, res
            
        except Exception as e:
            err_str = str(e)
            # 处理并发频控 (Rate Limit) 429 错误
            if "429" in err_str or "rate limit" in err_str.lower() or "too many requests" in err_str.lower():
                backoff = 2 ** (attempt + 1)
                safe_print(f"警告: 题目 {q_id} 请求触发频控，等待 {backoff} 秒后重试...")
                time.sleep(backoff)
            else:
                # 其他网络或解析异常
                safe_print(f"警告: 题目 {q_id} 请求失败 (尝试 {attempt+1}/{max_retries}): {e}")
                time.sleep(1)
                
    # 达到最大尝试次数仍失败
    return q_id, {
        "status": "failed",
        "reason": f"API调用失败或解析 JSON 错误"
    }

def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--test':
        limit_count = 5
        print(f"已启用测试模式，仅核验前 {limit_count} 道题目...")
    else:
        limit_count = None
        print("已启用全量核验模式...")

    if not API_KEY:
        print("错误：未检测到环境变量 DEEPSEEK_API_KEY。请先设置后再运行（例如: $env:DEEPSEEK_API_KEY='your_key'）。")
        sys.exit(1)

    print("初始化大模型客户端 (DeepSeek)...")
    client = OpenAI(api_key=API_KEY, base_url=BASE_URL)
    
    print("加载题库文件...")
    data = load_questions()
    questions = data.get('questions', [])
    questions_dict = {q['id']: q for q in questions}
    
    if limit_count:
        questions = questions[:limit_count]
        
    total_to_verify = len(questions)
    
    print("加载历史进度...")
    progress_data = load_progress()
    
    # 筛选未完成核验的题目
    todo_questions = [q for q in questions if q['id'] not in progress_data or progress_data[q['id']].get('status') == 'failed']
    
    already_done = total_to_verify - len(todo_questions)
    print(f"本次需核验总数: {total_to_verify} 道，其中已核验: {already_done} 道，待核验: {len(todo_questions)} 道。")
    
    if not todo_questions:
        print("没有需要核验的题目，正在生成最终报告...")
        generate_markdown_report(questions_dict, progress_data)
        print(f"报告已更新至 {REPORT_PATH}")
        return

    print(f"开始核验流程 (并发线程数: {CONCURRENCY})...")
    
    # 使用 ThreadPoolExecutor 进行多线程并发核验
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
        futures = []
        for q in todo_questions:
            # 提交任务
            futures.append(executor.submit(verify_single_question, client, q))
            
        completed_count = already_done
        error_found_count = sum(1 for q_id, r in progress_data.items() if r.get('status') == 'success' and not r.get('is_correct', True))
        
        for future in as_completed(futures):
            q_id, result = future.result()
            
            # 更新进度字典
            progress_data[q_id] = result
            save_progress(progress_data)
            
            completed_count += 1
            
            # 统计异常数量
            if result.get('status') == 'success' and not result.get('is_correct', True):
                error_found_count += 1
                status_tag = "【异常!】"
            elif result.get('status') == 'failed':
                status_tag = "【失败】"
            else:
                status_tag = "【正常】"
                
            safe_print(f"[{completed_count}/{total_to_verify}] 题目 {q_id} 核验完成 {status_tag} | 累计已发现异常: {error_found_count} 道")
            
            # 每完成 5 道题或最后一题时生成/更新报告
            if completed_count % 5 == 0 or completed_count == total_to_verify:
                generate_markdown_report(questions_dict, progress_data)

    print(f"\n核验工作已完成！")
    print(f"核验结果进度文件: {PROGRESS_PATH}")
    print(f"核验结果报告文件: {REPORT_PATH}")

if __name__ == '__main__':
    main()
