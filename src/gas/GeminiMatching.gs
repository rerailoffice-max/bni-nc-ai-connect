/**
 * AI Connect — Gemini APIマッチングエンジン
 * Gemini 3.1 Flash (gemini-2.0-flash) を呼び出してテーブル配置を算出する
 */

/**
 * メインのマッチング実行関数（メニューから呼び出し）
 */
function runMatching() {
  const ui = SpreadsheetApp.getUi();

  try {
    // APIキーチェック
    if (!CONFIG.GEMINI_API_KEY) {
      ui.alert('エラー', 'Gemini APIキーが設定されていません。\n\nスクリプトプロパティに GEMINI_API_KEY を設定してください。\n（ファイル → プロジェクトの設定 → スクリプトプロパティ）', ui.ButtonSet.OK);
      return;
    }

    // 参加者データ読み込み
    ui.alert('マッチング開始', '参加者データを読み込んでいます...', ui.ButtonSet.OK);
    const data = loadParticipants();

    if (data.participants.length < CONFIG.TABLE_SIZE_MIN) {
      ui.alert('エラー', `参加者が${CONFIG.TABLE_SIZE_MIN}名未満です（現在: ${data.participants.length}名）`, ui.ButtonSet.OK);
      return;
    }

    Logger.log(`マッチング開始: ${data.participants.length}名`);

    // Gemini APIでマッチング
    let result = null;
    let lastError = null;

    for (let attempt = 1; attempt <= CONFIG.GEMINI_MAX_RETRIES; attempt++) {
      try {
        Logger.log(`Gemini API呼び出し: ${attempt}回目`);
        result = callGeminiForMatching(data);

        // バリデーション
        const validation = validateTables(result, data.participants);
        if (validation.isValid) {
          Logger.log('バリデーション合格');
          break;
        } else {
          Logger.log(`バリデーション不合格: ${validation.errors.join(', ')}`);
          // 自動修正を試みる
          result = fixTableViolations(result, data.participants);
          const recheck = validateTables(result, data.participants);
          if (recheck.isValid) {
            Logger.log('自動修正後にバリデーション合格');
            break;
          }
          lastError = `バリデーションエラー: ${recheck.errors.join(', ')}`;
        }
      } catch (e) {
        lastError = e.message;
        Logger.log(`API呼び出しエラー (${attempt}回目): ${e.message}`);
        if (attempt < CONFIG.GEMINI_MAX_RETRIES) {
          Utilities.sleep(2000); // 2秒待ってリトライ
        }
      }
    }

    if (!result) {
      ui.alert('エラー', `マッチングに失敗しました。\n\n${lastError}`, ui.ButtonSet.OK);
      return;
    }

    // 結果をスプレッドシートに書き出し
    writeResults(result, data.participants);

    ui.alert('完了', `マッチングが完了しました！\n\n参加者: ${data.participants.length}名\nテーブル数: ${result.tables.length}\n\n「マッチング結果」「テーブル一覧」シートを確認してください。`, ui.ButtonSet.OK);

  } catch (e) {
    ui.alert('エラー', `予期しないエラーが発生しました。\n\n${e.message}`, ui.ButtonSet.OK);
    Logger.log(`エラー: ${e.message}\n${e.stack}`);
  }
}

/**
 * Gemini APIを呼び出してテーブル配置を取得する
 * @param {Object} data - participants配列を含むオブジェクト
 * @return {Object} テーブル配置結果
 */
function callGeminiForMatching(data) {
  const prompt = buildMatchingPrompt(data);
  const url = `${CONFIG.GEMINI_ENDPOINT}${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: CONFIG.GEMINI_TEMPERATURE,
      topP: 0.8,
      maxOutputTokens: CONFIG.GEMINI_MAX_OUTPUT_TOKENS,
      responseMimeType: 'application/json'
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const statusCode = response.getResponseCode();

  if (statusCode !== 200) {
    throw new Error(`Gemini API エラー (HTTP ${statusCode}): ${response.getContentText()}`);
  }

  const apiResult = JSON.parse(response.getContentText());

  // レスポンスからJSONテキストを抽出
  const candidates = apiResult.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error('Gemini APIからの応答が空です');
  }

  const textContent = candidates[0].content.parts[0].text;
  const matchingResult = JSON.parse(textContent);

  Logger.log(`Gemini応答: ${matchingResult.tables.length}テーブル`);
  return matchingResult;
}

/**
 * マッチング用プロンプトを構築する
 * @param {Object} data - participants配列を含むオブジェクト
 * @return {string} プロンプト文字列
 */
function buildMatchingPrompt(data) {
  const participantCount = data.participants.length;
  const idealTableSize = 6;
  const tableCount = Math.round(participantCount / idealTableSize);

  return `あなたはBNI（ビジネス紹介ネットワーク）のコンタクトサークル配置の専門家です。

以下の${participantCount}名の参加者を、${CONFIG.TABLE_SIZE_MIN}〜${CONFIG.TABLE_SIZE_MAX}名のテーブルに最適配置してください。

## 配置ルール（優先度順）

### ルール1: 同業種回避（最優先）
同じindustry_groupの人は同テーブルに2名以上入れないでください。
ただし、同じindustry_groupの参加者が多すぎて物理的に不可能な場合は、最大2名まで許容します。

### ルール2: シナジー最大化
以下の条件を満たすペアを同テーブルに配置してください：
a. Aのwant_referrals_fromにBのindustry_groupが含まれる（AがBからの紹介を求めている）
b. AとBのtarget_customersに重複がある（同じ顧客層を持つ異業種 = 相互紹介が起きやすい）
c. Aのcategory_detailの内容がBの事業に関連する（補完関係をあなたが判断）

### ルール3: チャプター分散
同じchapterのメンバーは異なるテーブルに分けてください（普段会える人より、新しい出会いを優先）。
ただし、同チャプターの参加者が多い場合は、最大2名まで許容します。

### ルール4: テーブルサイズ均等化
各テーブルは${CONFIG.TABLE_SIZE_MIN}〜${CONFIG.TABLE_SIZE_MAX}名で、テーブル間の人数差は最大1名にしてください。
目安: 約${tableCount}テーブル

## 出力形式
以下のJSON形式で正確に出力してください。余計なテキストは含めないでください。

{
  "tables": [
    {
      "table_number": 1,
      "theme": "テーブルのテーマ名（日本語、10文字以内）",
      "members": [
        {"id": 1, "name": "名前", "industry": "業種", "chapter": "チャプター"}
      ],
      "synergy_reason": "このテーブルのシナジーの説明（日本語、50文字以内）"
    }
  ],
  "total_tables": ${tableCount},
  "total_participants": ${participantCount}
}

## 参加者データ
${JSON.stringify(data.participants, null, 2)}`;
}

/**
 * マッチング結果をスプレッドシートに書き出す
 * @param {Object} result - Geminiからのテーブル配置結果
 * @param {Object[]} participants - 参加者配列
 */
function writeResults(result, participants) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 参加者のメール・カテゴリー詳細をIDで引けるようにする
  const pMap = {};
  participants.forEach(p => { pMap[p.id] = p; });

  // --- マッチング結果シート（参加者ごとの一覧） ---
  let resultSheet = ss.getSheetByName(CONFIG.SHEET_RESULTS);
  if (!resultSheet) {
    resultSheet = ss.insertSheet(CONFIG.SHEET_RESULTS);
  }
  resultSheet.clearContents();

  // ヘッダー
  const resultHeaders = ['テーブル番号', 'テーブルテーマ', 'ID', '氏名', 'チャプター', '業種', '業種グループ', 'カテゴリー詳細', 'メールアドレス', 'シナジー理由'];
  resultSheet.getRange(1, 1, 1, resultHeaders.length).setValues([resultHeaders]);
  resultSheet.getRange(1, 1, 1, resultHeaders.length).setFontWeight('bold');
  resultSheet.getRange(1, 1, 1, resultHeaders.length).setBackground('#CF2030');
  resultSheet.getRange(1, 1, 1, resultHeaders.length).setFontColor('#FFFFFF');

  // データ書き込み
  const resultRows = [];
  result.tables.forEach(table => {
    table.members.forEach(member => {
      const p = pMap[member.id] || {};
      resultRows.push([
        table.table_number,
        table.theme || '',
        member.id,
        member.name,
        member.chapter || p.chapter || '',
        member.industry || p.industry || '',
        p.industry_group || '',
        p.category_detail || '',
        p.email || '',
        table.synergy_reason || ''
      ]);
    });
  });

  if (resultRows.length > 0) {
    resultSheet.getRange(2, 1, resultRows.length, resultHeaders.length).setValues(resultRows);
  }

  // --- テーブル一覧シート（テーブルごとのサマリー） ---
  let tableSheet = ss.getSheetByName(CONFIG.SHEET_TABLES);
  if (!tableSheet) {
    tableSheet = ss.insertSheet(CONFIG.SHEET_TABLES);
  }
  tableSheet.clearContents();

  const tableHeaders = ['テーブル番号', 'テーマ', '人数', 'メンバー', '業種構成', 'シナジー理由'];
  tableSheet.getRange(1, 1, 1, tableHeaders.length).setValues([tableHeaders]);
  tableSheet.getRange(1, 1, 1, tableHeaders.length).setFontWeight('bold');
  tableSheet.getRange(1, 1, 1, tableHeaders.length).setBackground('#CF2030');
  tableSheet.getRange(1, 1, 1, tableHeaders.length).setFontColor('#FFFFFF');

  const tableRows = result.tables.map(table => {
    const memberNames = table.members.map(m => m.name).join('、');
    const industries = table.members.map(m => m.industry).join('、');
    return [
      table.table_number,
      table.theme || '',
      table.members.length,
      memberNames,
      industries,
      table.synergy_reason || ''
    ];
  });

  if (tableRows.length > 0) {
    tableSheet.getRange(2, 1, tableRows.length, tableHeaders.length).setValues(tableRows);
  }

  // 列幅自動調整
  resultSheet.autoResizeColumns(1, resultHeaders.length);
  tableSheet.autoResizeColumns(1, tableHeaders.length);

  Logger.log(`結果書き込み完了: ${resultRows.length}行（${result.tables.length}テーブル）`);
}

/**
 * スクリーンHTML用のJSONデータを生成する
 * @return {string} JSON文字列
 */
function generateScreenData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resultSheet = ss.getSheetByName(CONFIG.SHEET_RESULTS);

  if (!resultSheet || resultSheet.getLastRow() < 2) {
    throw new Error('マッチング結果がありません。先にマッチングを実行してください。');
  }

  const data = resultSheet.getDataRange().getValues();
  const tables = {};

  // ヘッダー行をスキップ
  for (let i = 1; i < data.length; i++) {
    const tableNum = data[i][0];
    const theme = data[i][1];
    const synergy = data[i][9];

    if (!tables[tableNum]) {
      tables[tableNum] = {
        table_number: tableNum,
        theme: theme,
        members: [],
        synergy_reason: synergy
      };
    }

    tables[tableNum].members.push({
      name: data[i][3],
      chapter: data[i][4],
      industry: data[i][5]
    });
  }

  return JSON.stringify({
    tables: Object.values(tables).sort((a, b) => a.table_number - b.table_number),
    generated_at: new Date().toISOString()
  });
}

/**
 * スクリーンHTML出力（メニューから呼び出し）
 */
function exportScreenHTML() {
  try {
    const jsonData = generateScreenData();
    const ui = SpreadsheetApp.getUi();

    // JSONをログに出力（コピーしてHTMLに貼り付ける用）
    Logger.log('=== スクリーン表示用JSONデータ ===');
    Logger.log(jsonData);

    ui.alert('スクリーンデータ出力',
      `JSONデータをログに出力しました。\n\n表示 → ログ からコピーしてスクリーンHTMLに埋め込んでください。\n\nテーブル数: ${JSON.parse(jsonData).tables.length}`,
      ui.ButtonSet.OK);
  } catch (e) {
    SpreadsheetApp.getUi().alert('エラー', e.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}
