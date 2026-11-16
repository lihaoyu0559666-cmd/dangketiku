import json
import re
import os

def calibrate():
    print("开始校准答案解析...")
    
    with open('questions.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    questions = data.get('questions', [])
    
    # 匹配解析中给出答案的正则模式
    patterns = [
        r"故正确答案为\s*([A-F、，,和与及\s]+)",
        r"正确答案是\s*([A-F、，,和与及\s]+)",
        r"因此选择\s*([A-F、，,和与及\s]+)",
        r"故本题选\s*([A-F、，,和与及\s]+)",
        r"选项\s*([A-F、，,和与及\s]+)\s*正确",
        r"因此选\s*([A-F、，,和与及\s]+)",
        r"答案为\s*([A-F、，,和与及\s]+)",
        r"正确选项是\s*([A-F、，,和与及\s]+)",
        r"正确答案为\s*([A-F、，,和与及\s]+)",
        r"因此，正确答案为\s*([A-F、，,和与及\s]+)",
        r"故选\s*([A-F、，,和与及\s]+)",
        r"答案是\s*([A-F、，,和与及\s]+)",
        r"应选\s*([A-F、，,和与及\s]+)"
    ]
    
    mismatch_count = 0
    
    for q in questions:
        ans = q.get('answer', '').strip()
        exp = q.get('explanation', '')
        q_type = q.get('type', '')
        
        if not exp or '填空题' in q_type:
            continue
            
        found_ans = None
        
        for p in patterns:
            match = re.search(p, exp)
            if match:
                match_str = match.group(1).strip()
                # 提取字母 A-F
                letters = re.findall(r'[A-F]', match_str)
                if letters:
                    found_ans = "".join(sorted(letters))
                break
                
        if found_ans:
            # 提取原答案的字母
            ans_letters = re.findall(r'[A-F]', ans)
            ans_sorted = "".join(sorted(ans_letters))
            
            if found_ans != ans_sorted and "【校准注意】" not in exp:
                mismatch_count += 1
                warning = f"\n\n【校准注意】：AI生成的解析得出的答案（{found_ans}）与题库标准答案（{ans}）存在不一致，请以标准答案或进一步查证为准。"
                q['explanation'] = exp + warning
                print(f"[{q['id']}] 标准答案: {ans}, 解析得出: {found_ans}")
                
    if mismatch_count > 0:
        print(f"共发现 {mismatch_count} 处不一致，正在更新 questions.json 和 questions.js ...")
        
        # 写入 questions.json
        with open('questions.json', 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            
        # 写入 questions.js
        js_content = 'window.QUESTION_BANK_DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';'
        with open('questions.js', 'w', encoding='utf-8') as f:
            f.write(js_content)
            
        print("更新完成！")
    else:
        print("未发现新的不一致项，无需更新。")

if __name__ == '__main__':
    calibrate()
