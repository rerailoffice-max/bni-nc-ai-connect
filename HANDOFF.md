# AI Connect v2 — MacBook Air 引き継ぎドキュメント

> 最終更新: 2026-04-27 / 担当: Claude (Opus 4.7)
> イベント: 2026-04-28 BNI National Conference 前夜祭

## 🎯 現在の状態（2026-04-27 22:00時点）

### 公開URL（QRコードURL — 絶対に変更しない）
**https://rerailoffice-max.github.io/bni-nc-ai-connect/src/screen/landing.html**

### 反映済み
- ✅ 233名（回答106 + 未回答127）の22テーブル × 11グループマッチング
- ✅ 6パワーチーム（住まい・経営参謀・食×文化・ブランド戦略・美容ヘルス・ライフ）+ 5交流テーブル
- ✅ DI/SC構成バランス
- ✅ 電話番号下4桁検索対応
- ✅ 未マッチ17名（瀧田裕子・Caleb Tang等）除外済
- ✅ # 表記削除、Table見出し拡大、モバイルでQR非表示

### 関連スプレッドシート
- **AIコネクトV2**: `1V8g2N3hYP4PT9_uTy8bzOkvJlcE1GX9kjnUzFB9fANQ`
  - `参加者回答` — フォーム回答（GASが書き込み）
  - `マッチング結果` — 22テーブル配置
  - `グループ一覧` — 11グループサマリー
- **前夜祭参加者リスト**: `1gp1P2-9xIwapdffAJ4-TysGDHWj1MorPUsZjAg7F008`

---

## 🚀 MacBook Airでのセットアップ

### 1. リポジトリをclone
```bash
cd ~/Documents
git clone https://github.com/rerailoffice-max/bni-nc-ai-connect.git
cd bni-nc-ai-connect
```

### 2. Pythonで動作確認
```bash
cd tools/matching
python3 v3_match.py | head -5  # 動けばOK
```

### 3. Claude Code（or Claude.ai Codeセッション）から作業継続
- このリポジトリのルートでClaudeを起動
- `HANDOFF.md` を読んで状況把握
- 最新コミット: `git log --oneline -5` で確認

---

## 📅 明日 4/28 のタイムライン

| 時刻 | タスク | コマンド |
|---|---|---|
| 18:00 | 受付開始（QRコード配布、回答受付） | — |
| **18:30** | **🔥 リハーサル**（推奨） | `bash tools/matching/inject.sh` |
| 18:45 | アンケート締切 | — |
| **18:46** | **本番再マッチング** | `bash tools/matching/inject.sh` |
| 18:47 | git commit + push | 下記コマンド |
| 18:50頃 | GitHub Pages反映完了 | URL叩いて確認 |
| 19:15 | イベント発表開始 | — |

### 本番コマンド（コピペで使える）

```bash
# リポジトリルートで実行
cd tools/matching
bash inject.sh

# git push
cd ../..
git add src/screen/screen.html
git commit -m "本番再マッチング 2026-04-28"
git push --no-thin origin main
```

> **注**: 通常 `git push origin main` だけで動くが、稀に `pack-objects died of signal 10` エラーが出る場合がある。その場合 `--no-thin` オプションを追加すると解消する。

---

## 🛠️ ファイル構成

```
bni-nc-ai-connect/
├── src/screen/
│   ├── landing.html       — エントリーページ（QRコード飛び先）
│   ├── screen.html        — 全グループ一覧（REAL_DATA埋込済）
│   ├── form.html          — アンケートフォーム
│   └── result.html        — 個別結果（GAS経由）
├── gas-deploy/            — Google Apps Script
│   ├── Config.gs
│   ├── DataTransform.gs   — DISC判定ロジック
│   └── WebApp.gs          — フォーム受付 + 結果API
├── tools/matching/        — Pythonマッチングスクリプト
│   ├── data.py            — 回答者データ（要更新）
│   ├── unanswered.py      — 未回答者リスト
│   ├── v3_match.py        — メインマッチングアルゴリズム
│   ├── v3_to_screen.py    — JSON → REAL_DATA変換
│   └── inject.sh          — 一発実行スクリプト
└── HANDOFF.md             — このファイル
```

---

## 📊 マッチング設計

### 11グループ × 2テーブル = 22テーブル

#### 回答者向け 6パワーチーム（業種補完 + DI/SCバランス）
1. **住まい・暮らしまるごと相談チーム** — 不動産・建築・保険・税務・施工
2. **中小企業の経営参謀チーム** — 経営コンサル・士業・人材・AI/DX
3. **食×文化×グローバル発信チーム** — 食品・飲食・書道・観光・語学
4. **ブランド戦略エキスパート集団** — Web・デザイン・PR・映像・印刷
5. **美と健康のラグジュアリーチーム** — 美容・健康・医療・ウェルネス
6. **人生に寄り添うライフパートナー** — 投資・教育・冠婚葬祭・ペット・自動車

#### 未回答者向け 5交流テーブル
7. 出会いの扉 / 8. 国境を越えて / 9. 日本の宝 / 10. アジアブリッジ / 11. ビジネスチャンス発掘

### DI/SC構成
- 各テーブル = DI型(D炎+I風) + SC型(S大地+C水) のバランスペア
- 全体DISC分布: D=42, I=49, S=18, C=14

---

## 🔥 緊急時のトラブルシューティング

### Q1. 再マッチング後、ページに反映されない
- GitHub Pagesは push後 1〜10分で反映
- ハードリフレッシュ（Cmd+Shift+R）で確認
- `git log --oneline -3` で最新コミットがpushされているか確認

### Q2. `pack-objects died of signal 10` でpush失敗
```bash
git push --no-thin origin main
```

### Q3. Pythonエラー
```bash
# data.pyの行末などに余計な文字がないか確認
python3 -c "from data import RESPONDENTS; print(len(RESPONDENTS))"
```

### Q4. 新規回答者を追加するには
1. **AIコネクトV2スプシ**の「参加者回答」シートを確認
2. `tools/matching/data.py` の `RESPONDENTS` に新エントリを追加（タプル形式）
3. `unanswered.py` から該当メンバーを削除（master_rowで照合）
4. `bash tools/matching/inject.sh` 実行

### Q5. 電話番号マップを更新するには
`v3_match.py` 上部の `PHONE_LAST4 = {...}` に追加。
キーは master_row（前夜祭参加者リストの行番号）、値は下4桁文字列。

---

## 💡 重要な注意点

### 🚨 絶対に変更しないでください
- **QRコードのURL**: `landing.html` のURL自体（QRは印刷済み）
- **landing.html のファイル名**

### ✅ 変更してOK
- `screen.html`, `result.html`, `form.html` の中身
- `tools/matching/` 配下
- スプレッドシートの内容

---

## 📞 次の作業者へ

このプロジェクトは **2026-04-28 19:15のイベント発表** に向けて動いています。

**最優先**: 18:45締切後、参加者全員のマッチング結果が公開ページに反映されること。
**目標**: 18:50までに最新マッチングをdeploy完了。

頑張ってください 🔥

---

## 🔗 関連リンク

- GitHub: https://github.com/rerailoffice-max/bni-nc-ai-connect
- 公開URL: https://rerailoffice-max.github.io/bni-nc-ai-connect/src/screen/landing.html
- AIコネクトV2スプシ: https://docs.google.com/spreadsheets/d/1V8g2N3hYP4PT9_uTy8bzOkvJlcE1GX9kjnUzFB9fANQ/
- 参加者リスト: https://docs.google.com/spreadsheets/d/1gp1P2-9xIwapdffAJ4-TysGDHWj1MorPUsZjAg7F008/
