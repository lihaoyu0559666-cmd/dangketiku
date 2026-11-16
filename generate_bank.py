import json
import os

# 1. 这里填写你准备好的 JSON 文件名
INPUT_JSON_FILE = 'questions_2.json'
# 2. 这里填写要生成的目标 JS 文件名
OUTPUT_JS_FILE = 'questions_2.js'

def main():
    if not os.path.exists(INPUT_JSON_FILE):
        print(f"错误: 找不到文件 {INPUT_JSON_FILE}。请先准备好该 JSON 文件。")
        return

    try:
        with open(INPUT_JSON_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        js_content = 'window.QUESTION_BANK_DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';'
        
        with open(OUTPUT_JS_FILE, 'w', encoding='utf-8') as f:
            f.write(js_content)
            
        print(f"成功将 {INPUT_JSON_FILE} 转换为了 {OUTPUT_JS_FILE} ！您现在可以在网页上查看题库二了。")
    except Exception as e:
        print(f"转换失败，请检查 JSON 格式是否正确: {e}")

if __name__ == '__main__':
    main()
