/**
 * AI Connect v2 — GAS Web App エンドポイント
 * HTMLフォームからの回答受付 + マッチング結果のAPI提供
 */

/**
 * GETリクエスト処理
 * ?action=check&phone=xxx → マッチング結果を返す
 * ?action=status → マッチング実行状態を返す
 */
function doGet(e) {
  const action = e.parameter.action || '';

  // CORS対応のJSONレスポンス
  if (action === 'check') {
    return checkResult_(e.parameter);
  }

  if (action === 'status') {
    return jsonResponse_({ status: getMatchingStatus_() });
  }

  // デフォルト: エラー
  return jsonResponse_({ error: 'Unknown action' }, 400);
}

/**
 * POSTリクエスト処理 — フォーム回答を受け取りスプレッドシートに保存
 */
function doPost(e) {
  try {
    const params = e.parameter;

    // 必須パラメータチェック
    const name = (params.name || '').trim();
    const chapter = (params.chapter || '').trim();
    const category = (params.category || '').trim();
    const phone = (params.phone || '').trim();
    const industry = (params.industry || '').trim();
    const targetCustomers = (params.target_customers || '').trim();
    const q7 = (params.q7 || '').trim().toUpperCase();
    const q8 = (params.q8 || '').trim().toUpperCase();
    const q9 = (params.q9 || '').trim().toUpperCase();

    if (!name || !chapter || !category || !phone || !industry || !q7 || !q8 || !q9) {
      return jsonResponse_({ error: '必須項目が未入力です', success: false }, 400);
    }

    // 電話番号正規化
    const normalizedPhone = normalizePhone(phone);

    // スプレッドシートに保存
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(CONFIG.SHEET_RESPONSES);
    if (!sheet) {
      sheet = ss.insertSheet(CONFIG.SHEET_RESPONSES);
      // ヘッダー追加
      const headers = ['タイムスタンプ', '氏名', 'チャプター名', 'カテゴリー名', '電話番号', '業種', 'ターゲット顧客層', 'Q7', 'Q8', 'Q9'];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }

    // 重複チェック（電話番号ベース）
    const data = sheet.getDataRange().getValues();
    let existingRow = -1;
    for (let i = 1; i < data.length; i++) {
      const rowPhone = normalizePhone(String(data[i][4] || ''));
      if (rowPhone && rowPhone === normalizedPhone) {
        existingRow = i + 1; // 1-indexed
        break;
      }
    }

    const timestamp = new Date().toISOString();
    const rowData = [timestamp, name, chapter, category, phone, industry, targetCustomers, q7, q8, q9];

    if (existingRow > 0) {
      // 既存回答を上書き
      sheet.getRange(existingRow, 1, 1, rowData.length).setValues([rowData]);
      Logger.log(`回答更新: ${name} (${normalizedPhone})`);
    } else {
      // 新規追加
      sheet.appendRow(rowData);
      Logger.log(`新規回答: ${name} (${normalizedPhone})`);
    }

    // DISC判定結果を即時計算
    const disc = calculateDiscType(q7, q8, q9);

    return jsonResponse_({
      success: true,
      message: existingRow > 0 ? '回答を更新しました' : '回答を受け付けました',
      disc: {
        main: disc.disc_main,
        label: disc.disc_label,
        emoji: CONFIG.DISC.TYPE_NAMES[disc.disc_main].emoji,
        description: CONFIG.DISC.TYPE_NAMES[disc.disc_main].ja
      }
    });

  } catch (error) {
    Logger.log(`doPost エラー: ${error.message}`);
    return jsonResponse_({ error: error.message, success: false }, 500);
  }
}

/**
 * マッチング結果を検索して返す
 */
function checkResult_(params) {
  const query = (params.query || params.phone || params.name || '').trim();
  if (!query || query.length < 2) {
    return jsonResponse_({ error: '検索キーワードが短すぎます', found: false });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resultSheet = ss.getSheetByName(CONFIG.SHEET_RESULTS);

  if (!resultSheet || resultSheet.getLastRow() < 2) {
    return jsonResponse_({ found: false, status: 'not_ready', message: 'マッチング結果はまだありません' });
  }

  const data = resultSheet.getDataRange().getValues();
  const headers = data[0];

  // 検索: 名前 or 電話番号（部分一致）
  const digitsOnly = query.replace(/[-\s+]/g, '');
  const isPhoneSearch = /^\d{3,}$/.test(digitsOnly);

  let foundRow = null;
  for (let i = 1; i < data.length; i++) {
    if (isPhoneSearch) {
      const phoneLast4 = String(data[i][9] || ''); // 電話番号(下4桁)列
      if (phoneLast4 && digitsOnly.endsWith(phoneLast4)) {
        foundRow = data[i];
        break;
      }
    } else {
      const name = String(data[i][4] || ''); // 氏名列
      if (name.includes(query)) {
        foundRow = data[i];
        break;
      }
    }
  }

  if (!foundRow) {
    return jsonResponse_({ found: false, message: '該当する参加者が見つかりません' });
  }

  // 同じグループの全メンバーを取得
  const groupNum = foundRow[0];
  const groupMembers = [];
  let groupInfo = null;

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === groupNum) {
      groupMembers.push({
        name: data[i][4],
        chapter: data[i][5],
        industry: data[i][6],
        disc_label: data[i][12],
        table_number: data[i][2]
      });
      if (!groupInfo) {
        groupInfo = {
          group_number: data[i][0],
          group_name: data[i][1],
          table_number: data[i][2],
          synergy_reason: data[i][13]
        };
      }
    }
  }

  return jsonResponse_({
    found: true,
    person: {
      name: foundRow[4],
      group_number: foundRow[0],
      group_name: foundRow[1],
      table_number: foundRow[2],
      disc_label: foundRow[12]
    },
    group: groupInfo,
    members: groupMembers
  });
}

/**
 * マッチング実行状態を確認
 */
function getMatchingStatus_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resultSheet = ss.getSheetByName(CONFIG.SHEET_RESULTS);
  if (!resultSheet || resultSheet.getLastRow() < 2) return 'not_ready';
  return 'ready';
}

/**
 * JSONレスポンスを生成
 */
function jsonResponse_(data, statusCode) {
  const output = ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}
