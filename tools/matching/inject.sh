#!/bin/bash
# v3_result.json を screen.html に注入するワンライナースクリプト
# 使い方: bash inject.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
export PYTHONPATH="$SCRIPT_DIR"

# 1. マッチング再計算
python3 v3_match.py > v3_result.json 2>v3_log.txt
echo "=== マッチングログ ==="
cat v3_log.txt

# 2. REAL_DATA + スプシ用JSON生成
mkdir -p v3
python3 v3_to_screen.py

# 3. screen.html にREAL_DATA注入
python3 << EOF
import json, re, sys
with open('$SCRIPT_DIR/v3/real_data.json') as f:
    real_data = json.load(f)
real_data_js = json.dumps(real_data, ensure_ascii=False)
SCREEN_PATH = '$SCRIPT_DIR/../../src/screen/screen.html'
with open(SCREEN_PATH) as f:
    html = f.read()

pattern = r'const REAL_DATA = \{.*?\};'
m = re.search(pattern, html, re.DOTALL)
if not m:
    print('ERROR: const REAL_DATA = ... のパターンが見つかりません', file=sys.stderr)
    sys.exit(1)

new_html = re.sub(pattern, f'const REAL_DATA = {real_data_js};', html, count=1, flags=re.DOTALL)
total = sum(len(t['members']) for g in real_data['groups'] for t in g['tables'])

if new_html == html:
    print(f'ℹ️  REAL_DATAは既に最新（{len(real_data["groups"])}グループ / {total}名）— 変更なし')
else:
    with open(SCREEN_PATH, 'w') as f:
        f.write(new_html)
    print(f'✅ screen.html 更新完了: {len(real_data["groups"])}グループ / {total}名')
EOF

echo ""
echo "=== 次のステップ ==="
echo "git add ../../src/screen/screen.html"
echo "git commit -m 'マッチング更新'"
echo "git push --no-thin origin main"
