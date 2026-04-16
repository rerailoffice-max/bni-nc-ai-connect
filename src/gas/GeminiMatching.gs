/**
 * AI Connect v2 — Gemini APIマッチングエンジン
 * Gemini 3.1 Flash (gemini-2.0-flash) を呼び出して10グループ配置を算出する
 */

/**
 * メインのマッチング実行関数（メニューから呼び出し）
 */
function runMatching() {
  let ui;
  try { ui = SpreadsheetApp.getUi(); } catch(e) { ui = null; }
  const alert_ = (title, msg) => { if (ui) ui.alert(title, msg, ui.ButtonSet.OK); Logger.log(`${title}: ${msg}`); };

  try {
    // APIキーチェック
    if (!CONFIG.GEMINI_API_KEY) {
      alert_('エラー', 'Gemini APIキーが設定されていません。\nスクリプトプロパティに GEMINI_API_KEY を設定してください。');
      return;
    }

    // 参加者データ読み込み
    alert_('マッチング開始', '参加者データを読み込んでいます...');
    const data = loadParticipants();

    if (data.participants.length < CONFIG.GROUP_SIZE_MIN) {
      alert_('エラー', `参加者が${CONFIG.GROUP_SIZE_MIN}名未満です（現在: ${data.participants.length}名）`);
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
      alert_('エラー', `マッチングに失敗しました。\n\n${lastError}`);
      return;
    }

    // セレンディピティグループ処理（未回答者がいれば）
    const serendipity = assignSerendipityGroup(result, data.participants);

    // 結果をスプレッドシートに書き出し
    writeResults(result, data.participants, serendipity);

    const totalMembers = result.groups.reduce((s, g) => s + g.tables.reduce((ss, t) => ss + t.members.length, 0), 0);
    alert_('完了', `マッチングが完了しました！\n\n参加者: ${data.participants.length}名\nグループ数: ${result.groups.length}\n配置済み: ${totalMembers}名`);

  } catch (e) {
    alert_('エラー', `予期しないエラーが発生しました。\n\n${e.message}`);
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
  const rawResult = JSON.parse(textContent);

  // コンパクト形式（table1/table2がID配列）を正規形式に展開
  const matchingResult = expandCompactResult_(rawResult, data);

  Logger.log(`Gemini応答: ${matchingResult.groups.length}グループ`);
  return matchingResult;
}

/**
 * コンパクトなGemini出力を正規のグループ形式に展開する
 */
function expandCompactResult_(raw, data) {
  const pMap = {};
  data.participants.forEach(p => { pMap[p.id] = p; });

  const groups = raw.groups.map((g, idx) => {
    const t1Ids = g.table1 || [];
    const t2Ids = g.table2 || [];
    const tableNum = (idx + 1) * 2;

    function memberFromId(id) {
      const p = pMap[id] || {};
      return { id: id, name: p.name||'', industry: p.industry||'', chapter: p.chapter||'', category: p.category||'', disc_label: p.disc_label||'' };
    }

    const t1Members = t1Ids.map(memberFromId);
    const t2Members = t2Ids.map(memberFromId);

    // DISC集計
    const bal = { D:0, I:0, S:0, C:0 };
    [...t1Ids, ...t2Ids].forEach(id => {
      const p = pMap[id];
      if (p && p.disc_main && bal[p.disc_main] !== undefined) bal[p.disc_main]++;
    });

    return {
      group_number: g.group_number || (idx + 1),
      group_name: g.group_name || '',
      disc_balance: bal,
      tables: [
        { table_number: tableNum - 1, members: t1Members },
        { table_number: tableNum, members: t2Members }
      ],
      synergy_reason: g.synergy_reason || ''
    };
  });

  return { groups: groups };
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

## 配置ルール（全ルール必守）

### ルール1: 異業種分散（最重要・絶対守る）
- **同じind(業種グループ)の人を同グループに4名以上入れてはいけない**。これが最重要ルール。
- 10種の業種グループがある。各グループには全10業種が均等に混ざるように配置せよ。
- 「美容だけのグループ」「建設だけのグループ」は絶対に作らない。

### ルール2: パワーチーム（異業種シナジー）
- 同じtc(ターゲット顧客)を持つ**異なる業種**を同グループに配置
- 例: 不動産(1名)+リフォーム(1名)+保険(1名)+税理士(1名)=紹介チェーン
- 同業種を集めるのではなく、補完関係にある異業種を集める

### ルール3: チャプター分散
- 同じch(チャプター)は同グループに3名まで

### ルール4: 行動タイプ多様性
- 各グループにD/I/S/C全4タイプを含める（分布: D=${discDist.D}, I=${discDist.I}, S=${discDist.S}, C=${discDist.C}）

### ルール5: サイズ均等
- ${groupCount}グループ × 約${groupSize}名（±3名）

## 出力形式（コンパクト版 — membersはidの配列のみ）

{"groups":[{"group_number":1,"group_name":"テーマ名","table1":[id,id,...],"table2":[id,id,...],"synergy_reason":"説明"},...]}

- group_name: 業種シナジーのテーマ（日本語15文字以内）
- table1/table2: メンバーIDの配列（均等に分割）
- synergy_reason: パワーチーム説明（50文字以内）
- 全${participantCount}名を必ず配置（漏れ・重複不可）

## 参加者データ（${participantCount}名）
${JSON.stringify(data.participants.map(p => ({id:p.id,ind:p.industry_group,ch:p.chapter,cat:p.category,tc:p.target_customers,dm:p.disc_main})))}`;
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
    Logger.log('=== スクリーン表示用JSONデータ ===');
    Logger.log(jsonData);

    const parsed = JSON.parse(jsonData);
    const msg = `JSONデータをログに出力しました。\nグループ数: ${parsed.groups.length}\n総参加者: ${parsed.stats.total_participants}名`;
    try { SpreadsheetApp.getUi().alert('スクリーンデータ出力', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch(e2) {}
    Logger.log(msg);
  } catch (e) {
    Logger.log(`エラー: ${e.message}`);
    try { SpreadsheetApp.getUi().alert('エラー', e.message, SpreadsheetApp.getUi().ButtonSet.OK); } catch(e2) {}
  }
}
