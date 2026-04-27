# tools/matching — AI Connect v2 マッチングスクリプト

## クイックスタート（明日の本番用）

```bash
cd tools/matching
bash inject.sh   # マッチング再計算 + screen.html注入
cd ../..
git add src/screen/screen.html
git commit -m "再マッチング"
git push --no-thin origin main
```

## ファイル構成

| ファイル | 役割 |
|---|---|
| `data.py` | 回答者データ（タプル一覧）+ 業種マッピング |
| `unanswered.py` | 未回答者データ |
| `v3_match.py` | メインアルゴリズム（DI/SCバランス + パワーチーム振分） |
| `v3_to_screen.py` | マッチング結果 → REAL_DATA変換 |
| `inject.sh` | 一発実行用 |

## 新規回答者を追加する手順

1. **AIコネクトV2スプシ「参加者回答」**をブラウザで開いて新規回答者を確認
2. `data.py` の `RESPONDENTS` に追加:
   ```python
   ("氏名", "チャプター", "カテゴリー", "業種",
    "Q7", "Q8", "Q9", master_row),  # master_row=参加者リストの行番号
   ```
3. `unanswered.py` から該当者を削除（同じ master_row のエントリ）
4. **電話番号下4桁** を `v3_match.py` の `PHONE_LAST4` に追加:
   ```python
   PHONE_LAST4 = {
       ...,
       master_row: "1234",  # 下4桁
   }
   ```
5. `bash inject.sh` 実行

## DISC算出ロジック

Q7/Q8/Q9 の回答 (A/B/C/D) を以下に変換:
- A → D (炎/Driver)
- B → I (風/Influencer)
- C → S (大地/Steady)
- D → C (水/Compliance)

カウントしてメインタイプ + サブタイプを決定（同点はQ7→Q8→Q9優先）。
