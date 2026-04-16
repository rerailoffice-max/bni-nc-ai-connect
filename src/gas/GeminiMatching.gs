/**
 * AI Connect v2 — Gemini APIマッチングエンジン
 * Gemini 3.1 Flash (gemini-2.0-flash) を呼び出して10グループ配置を算出する
 */

/**
 * メインのマッチング実行関数（メニューから呼び出し）
 */
function runMatching() {
  const ui = SpreadsheetApp.getUi();

  try {
    // APIキーチェック
    if (!CONFIG.GEMINI_API_KEY) {
      ui.alert('エラー', 'Gemini APIキーが設定されていません。\n\nスクリプトプロパティに GEMINI_API_KEY を設定してください。', ui.ButtonSet.OK);
      return;
    }

    // 参加者データ読み込み
    ui.alert('マッチング開始', '参加者データを読み込んでいます...', ui.ButtonSet.OK);
    const data = loadParticipants();

    if (data.participants.length < CONFIG.GROUP_SIZE_MIN) {
      ui.alert('エラー', `参加者が${CONFIG.GROUP_SIZE_MIN}名未満です（現在: ${data.participants.length}名）`, ui.ButtonSet.OK);
      return;
    }

    // DISC判定結果をシートに書き出し
    writeDiscResults(data.participants);

    Logger.log(`マッチング開始: ${data.participants.length}名`);

    // Gemini APIでマッチング
    let result = null;
    let lastError = null;

    for (let attempt = 1; attempt <= CONFIG.GEMINI_MAX_RETRIES; attempt++) {
      try {
        Logger.log(`Gemini API呼び出し: ${attempt}回目`);
        result = callGeminiForMatching(data);

        // バリデーション
        const validation = validateGroups(result, data.participants);
        if (validation.isValid) {
          Logger.log('バリデーション合格');
          break;
        } else {
          Logger.log(`バリデーション不合格: ${validation.errors.join(', ')}`);
          // 自動修正を試みる
          result = fixGroupViolations(result, data.participants);
          const recheck = validateGroups(result, data.participants);
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
          Utilities.sleep(2000);
        }
      }
    }

    if (!result) {
      ui.alert('エラー', `マッチングに失敗しました。\n\n${lastError}`, ui.ButtonSet.OK);
      return;
    }

    // セレンディピティグループ処理（未回答者がいれば）
    const serendipity = assignSerendipityGroup(result, data.participants);

    // 結果をスプレッドシートに書き出し
    writeResults(result, data.participants, serendipity);

    const totalMembers = result.groups.reduce((s, g) => s + g.tables.reduce((ss, t) => ss + t.members.length, 0), 0);
    ui.alert('完了', `マッチングが完了しました！\n\n参加者: ${data.participants.length}名\nグループ数: ${result.groups.length}\n配置済み: ${totalMembers}名\n\n「マッチング結果」「グループ一覧」「マッチング根拠」シートを確認してください。`, ui.ButtonSet.OK);

  } catch (e) {
    ui.alert('エラー', `予期しないエラーが発生しました。\n\n${e.message}`, ui.ButtonSet.OK);
    Logger.log(`エラー: ${e.message}\n${e.stack}`);
  }
}

/**
 * Gemini APIを呼び出してグループ配置を取得する
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
    throw new Error(`Gemini API エラー (HTTP ${statusCode}): ${response.getContentText().substring(0, 500)}`);
  }

  const apiResult = JSON.parse(response.getContentText());
  const candidates = apiResult.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error('Gemini APIからの応答が空です');
  }

  const textContent = candidates[0].content.parts[0].text;
  const matchingResult = JSON.parse(textContent);

  Logger.log(`Gemini応答: ${matchingResult.groups.length}グループ`);
  return matchingResult;
}

/**
 * マッチング用プロンプトを構築する（v2: 10グループ × 2テーブル）
 */
function buildMatchingPrompt(data) {
  const participantCount = data.participants.length;
  const groupCount = CONFIG.GROUP_COUNT;
  const groupSize = Math.round(participantCount / groupCount);

  // DISC分布集計
  const discDist = { D: 0, I: 0, S: 0, C: 0 };
  data.participants.forEach(p => { discDist[p.disc_main]++; });

  return `あなたはBNI（ビジネス紹介ネットワーク）のパワーチーム編成の専門家です。

以下の${participantCount}名の参加者を、${groupCount}グループ（各グループ2テーブル）に最適配置してください。

## 配置ルール（優先度順）

### ルール1: パワーチーム編成（最重要）
- 同じtarget_customersを持つ異業種同士を同グループに（同顧客層マッチ）
- categoryの意味的な補完関係を判断（例: 不動産×リフォーム×保険×税理士の紹介チェーン）
- **「このグループならリファーラル（ビジネス紹介）が生まれる」** 組み合わせを最優先

### ルール2: 同業種回避
- 同じindustry_groupの人は同グループに最大3-4名まで（${groupSize}名中）
- できるだけ少なく。完全回避が無理な場合のフォールバック

### ルール3: 行動タイプの多様性
- 各グループにD(炎)/I(風)/S(大地)/C(水)の全4タイプを含める
- 現在の分布: D=${discDist.D}名, I=${discDist.I}名, S=${discDist.S}名, C=${discDist.C}名
- S型・C型が少ない場合、各グループに最低${CONFIG.DISC.SC_MIN_PER_GROUP}名ずつ保証

### ルール4: チャプター分散
- 同チャプターのメンバーは同グループに3名まで

### ルール5: グループサイズ均等化
- ${groupCount}グループ × 約${groupSize}名、グループ間の差は最大±3名
- 各グループ内の2テーブルも均等（差±1名）
- テーブル番号: グループ1はTable 1,2 / グループ2はTable 3,4 / ... / グループ${groupCount}はTable ${groupCount*2-1},${groupCount*2}

## 出力形式
以下のJSON形式で正確に出力してください。

{
  "groups": [
    {
      "group_number": 1,
      "group_name": "パワーチームテーマ名（日本語、15文字以内）",
      "disc_balance": {"D": 5, "I": 6, "S": 5, "C": 4},
      "tables": [
        {
          "table_number": 1,
          "members": [
            {"id": 1, "name": "氏名", "industry": "業種", "chapter": "チャプター", "category": "カテゴリー", "disc_label": "炎風"}
          ]
        },
        {
          "table_number": 2,
          "members": [...]
        }
      ],
      "synergy_reason": "このグループのシナジー説明（日本語、80文字以内）"
    }
  ],
  "total_groups": ${groupCount},
  "total_participants": ${participantCount}
}

**重要**:
- 全${participantCount}名を必ずいずれかのグループに配置すること（漏れ不可）
- 1人を複数グループに配置しないこと（重複不可）
- group_nameは「住宅ワンストップ」「中小企業の成長支援」のような業種シナジーを表すテーマ名
- synergy_reasonはパワーチームの紹介チェーンと行動タイプの多様性を含む説明

## 参加者データ（${participantCount}名）
${JSON.stringify(data.participants, null, 1)}`;
}

/**
 * マッチング結果をスプレッドシートに書き出す
 */
function writeResults(result, participants, serendipity) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const pMap = {};
  participants.forEach(p => { pMap[p.id] = p; });

  // --- マッチング結果シート ---
  let resultSheet = ss.getSheetByName(CONFIG.SHEET_RESULTS);
  if (!resultSheet) resultSheet = ss.insertSheet(CONFIG.SHEET_RESULTS);
  resultSheet.clearContents();

  const resultHeaders = ['グループ番号', 'グループ名', 'テーブル番号', 'ID', '氏名', 'チャプター', '業種', '業種グループ', 'カテゴリー', '電話番号(下4桁)', 'DISCメイン', 'DISCサブ', 'DISCラベル', 'シナジー理由'];
  resultSheet.getRange(1, 1, 1, resultHeaders.length).setValues([resultHeaders]);
  resultSheet.getRange(1, 1, 1, resultHeaders.length).setFontWeight('bold');
  resultSheet.getRange(1, 1, 1, resultHeaders.length).setBackground('#CF2030');
  resultSheet.getRange(1, 1, 1, resultHeaders.length).setFontColor('#FFFFFF');

  const resultRows = [];
  result.groups.forEach(group => {
    group.tables.forEach(table => {
      table.members.forEach(member => {
        const p = pMap[member.id] || {};
        resultRows.push([
          group.group_number,
          group.group_name || '',
          table.table_number,
          member.id,
          member.name || p.name || '',
          member.chapter || p.chapter || '',
          member.industry || p.industry || '',
          p.industry_group || '',
          member.category || p.category || '',
          p.phone_last4 || '',
          p.disc_main || '',
          p.disc_sub || '',
          member.disc_label || p.disc_label || '',
          group.synergy_reason || ''
        ]);
      });
    });
  });

  // セレンディピティグループも追加
  if (serendipity) {
    serendipity.tables.forEach(table => {
      table.members.forEach(member => {
        resultRows.push([
          '✨', serendipity.group_name, table.table_number,
          member.id || '', member.name || '', member.chapter || '',
          member.industry || '未回答', '', member.category || '',
          '', '?', '?', '?', '運命が引き寄せた予期せぬ出会い'
        ]);
      });
    });
  }

  if (resultRows.length > 0) {
    resultSheet.getRange(2, 1, resultRows.length, resultHeaders.length).setValues(resultRows);
  }

  // --- グループ一覧シート ---
  let groupSheet = ss.getSheetByName(CONFIG.SHEET_GROUPS);
  if (!groupSheet) groupSheet = ss.insertSheet(CONFIG.SHEET_GROUPS);
  groupSheet.clearContents();

  const groupHeaders = ['グループ番号', 'グループ名', '人数', 'Table1人数', 'Table2人数', 'D(炎)', 'I(風)', 'S(大地)', 'C(水)', 'シナジー理由'];
  groupSheet.getRange(1, 1, 1, groupHeaders.length).setValues([groupHeaders]);
  groupSheet.getRange(1, 1, 1, groupHeaders.length).setFontWeight('bold');
  groupSheet.getRange(1, 1, 1, groupHeaders.length).setBackground('#CF2030');
  groupSheet.getRange(1, 1, 1, groupHeaders.length).setFontColor('#FFFFFF');

  const groupRows = result.groups.map(group => {
    const bal = group.disc_balance || { D: 0, I: 0, S: 0, C: 0 };
    const t1 = group.tables[0] ? group.tables[0].members.length : 0;
    const t2 = group.tables[1] ? group.tables[1].members.length : 0;
    return [
      group.group_number, group.group_name || '', t1 + t2, t1, t2,
      bal.D || 0, bal.I || 0, bal.S || 0, bal.C || 0,
      group.synergy_reason || ''
    ];
  });

  if (groupRows.length > 0) {
    groupSheet.getRange(2, 1, groupRows.length, groupHeaders.length).setValues(groupRows);
  }

  // --- マッチング根拠シート ---
  let reasonSheet = ss.getSheetByName(CONFIG.SHEET_REASONING);
  if (!reasonSheet) reasonSheet = ss.insertSheet(CONFIG.SHEET_REASONING);
  reasonSheet.clearContents();

  const reasonHeaders = ['グループ番号', 'グループ名', 'パワーチーム説明', 'DISC多様性', '業種構成', 'チャプター構成'];
  reasonSheet.getRange(1, 1, 1, reasonHeaders.length).setValues([reasonHeaders]);
  reasonSheet.getRange(1, 1, 1, reasonHeaders.length).setFontWeight('bold');
  reasonSheet.getRange(1, 1, 1, reasonHeaders.length).setBackground('#C9A84C');
  reasonSheet.getRange(1, 1, 1, reasonHeaders.length).setFontColor('#000000');

  const reasonRows = result.groups.map(group => {
    const allMembers = group.tables.flatMap(t => t.members);
    const bal = group.disc_balance || { D: 0, I: 0, S: 0, C: 0 };
    const discInfo = `D(炎):${bal.D} I(風):${bal.I} S(大地):${bal.S} C(水):${bal.C}`;

    // 業種集計
    const industryCount = {};
    allMembers.forEach(m => {
      const p = pMap[m.id];
      const ig = p ? p.industry_group : (m.industry || '不明');
      industryCount[ig] = (industryCount[ig] || 0) + 1;
    });
    const industryInfo = Object.entries(industryCount).map(([k, v]) => `${k}:${v}`).join(' / ');

    // チャプター集計
    const chapterCount = {};
    allMembers.forEach(m => {
      const ch = m.chapter || '不明';
      chapterCount[ch] = (chapterCount[ch] || 0) + 1;
    });
    const chapterInfo = Object.entries(chapterCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}:${v}`).join(' / ');

    return [
      group.group_number, group.group_name || '',
      group.synergy_reason || '',
      discInfo, industryInfo, chapterInfo
    ];
  });

  if (reasonRows.length > 0) {
    reasonSheet.getRange(2, 1, reasonRows.length, reasonHeaders.length).setValues(reasonRows);
  }

  // 列幅自動調整
  [resultSheet, groupSheet, reasonSheet].forEach(s => {
    try { s.autoResizeColumns(1, s.getLastColumn()); } catch (e) {}
  });

  Logger.log(`結果書き込み完了: ${resultRows.length}行（${result.groups.length}グループ）`);
}

/**
 * スクリーンHTML用のJSONデータを生成する（v2形式）
 */
function generateScreenData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resultSheet = ss.getSheetByName(CONFIG.SHEET_RESULTS);

  if (!resultSheet || resultSheet.getLastRow() < 2) {
    throw new Error('マッチング結果がありません。先にマッチングを実行してください。');
  }

  const data = resultSheet.getDataRange().getValues();
  const groups = {};
  let serendipityTables = {};

  for (let i = 1; i < data.length; i++) {
    const groupNum = data[i][0];
    const groupName = data[i][1];
    const tableNum = data[i][2];
    const synergyReason = data[i][13];
    const discMain = data[i][10];
    const discLabel = data[i][12];

    // DISCのemoji/cssを算出
    const typeInfo = CONFIG.DISC.TYPE_NAMES[discMain] || {};
    const discEmoji = typeInfo.emoji || '✨';
    const discCss = typeInfo.css || '';

    const member = {
      id: data[i][3],
      name: data[i][4],
      chapter: data[i][5],
      industry: data[i][6],
      disc_label: discLabel,
      disc_emoji: discEmoji,
      disc_css: discCss,
      disc_main: discMain,
      phone: data[i][9] // 下4桁のみ
    };

    if (groupNum === '✨') {
      // セレンディピティ
      if (!serendipityTables[tableNum]) {
        serendipityTables[tableNum] = { table_number: tableNum, members: [] };
      }
      serendipityTables[tableNum].members.push(member);
    } else {
      if (!groups[groupNum]) {
        groups[groupNum] = {
          group_number: groupNum,
          group_name: groupName,
          disc_balance: { D: 0, I: 0, S: 0, C: 0 },
          tables: {},
          synergy_reason: synergyReason
        };
      }
      if (!groups[groupNum].tables[tableNum]) {
        groups[groupNum].tables[tableNum] = { table_number: tableNum, members: [] };
      }
      groups[groupNum].tables[tableNum].members.push(member);
      if (discMain && groups[groupNum].disc_balance[discMain] !== undefined) {
        groups[groupNum].disc_balance[discMain]++;
      }
    }
  }

  // テーブルをobjectから配列に変換
  const groupArray = Object.values(groups)
    .sort((a, b) => a.group_number - b.group_number)
    .map(g => ({
      ...g,
      tables: Object.values(g.tables).sort((a, b) => a.table_number - b.table_number)
    }));

  const serendipityArray = Object.values(serendipityTables).sort((a, b) => a.table_number - b.table_number);

  // 統計
  const totalParticipants = groupArray.reduce((s, g) => s + g.tables.reduce((ss, t) => ss + t.members.length, 0), 0)
    + serendipityArray.reduce((s, t) => s + t.members.length, 0);

  const discDist = { D: 0, I: 0, S: 0, C: 0 };
  groupArray.forEach(g => {
    Object.keys(discDist).forEach(k => { discDist[k] += g.disc_balance[k]; });
  });

  return JSON.stringify({
    groups: groupArray,
    serendipity_group: serendipityArray.length > 0 ? {
      group_name: 'セレンディピティ — 予期せぬ出会い',
      tables: serendipityArray
    } : null,
    stats: {
      total_participants: totalParticipants,
      total_groups: groupArray.length,
      disc_distribution: discDist
    },
    generated_at: new Date().toISOString()
  }, null, 2);
}

/**
 * スクリーンHTML出力（メニューから呼び出し）
 */
function exportScreenHTML() {
  try {
    const jsonData = generateScreenData();
    const ui = SpreadsheetApp.getUi();

    Logger.log('=== スクリーン表示用JSONデータ ===');
    Logger.log(jsonData);

    const parsed = JSON.parse(jsonData);
    ui.alert('スクリーンデータ出力',
      `JSONデータをログに出力しました。\n\n表示 → ログ からコピーしてスクリーンHTMLに埋め込んでください。\n\nグループ数: ${parsed.groups.length}\n総参加者: ${parsed.stats.total_participants}名`,
      ui.ButtonSet.OK);
  } catch (e) {
    SpreadsheetApp.getUi().alert('エラー', e.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}
