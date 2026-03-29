/**
 * AI Connect — データ変換
 * スプレッドシートの回答データをGemini入力用JSONに変換する
 */

/**
 * 参加者回答シートからデータを読み取り、JSON形式に変換する
 * @return {Object} participants配列を含むオブジェクト
 */
function loadParticipants() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_RESPONSES);

  if (!sheet) {
    throw new Error(`シート「${CONFIG.SHEET_RESPONSES}」が見つかりません`);
  }

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    throw new Error('参加者データがありません（ヘッダー行のみ）');
  }

  // ヘッダー行をスキップして参加者データを変換
  const participants = [];
  const emailSet = new Set(); // 重複チェック用

  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    // 空行スキップ
    if (!row[0] || String(row[0]).trim() === '') continue;

    // カラム位置（Googleフォームのデフォルト: A列=タイムスタンプ, B列以降=回答）
    // タイムスタンプありの場合: B=氏名, C=チャプター, D=メール, E=業種, F=カテゴリー, G=ターゲット, H=紹介希望
    // タイムスタンプなしの場合: A=氏名, B=チャプター, C=メール, D=業種, E=カテゴリー, F=ターゲット, G=紹介希望
    const hasTimestamp = String(row[0]).match(/^\d{4}[\/-]/); // タイムスタンプ判定
    const offset = hasTimestamp ? 1 : 0;

    const name = String(row[offset] || '').trim();
    const chapter = String(row[offset + 1] || '').trim();
    const email = String(row[offset + 2] || '').trim().toLowerCase();
    const industry = String(row[offset + 3] || '').trim();
    const categoryDetail = String(row[offset + 4] || '').trim();
    const targetCustomersRaw = String(row[offset + 5] || '');
    const wantReferralsRaw = String(row[offset + 6] || '');

    // 必須フィールドチェック
    if (!name || !industry) continue;

    // 重複チェック（メールアドレスベース、最新を採用）
    if (email && emailSet.has(email)) {
      // 既存のエントリを削除（最新を採用）
      const existingIdx = participants.findIndex(p => p.email === email);
      if (existingIdx >= 0) participants.splice(existingIdx, 1);
    }
    if (email) emailSet.add(email);

    // チェックボックス回答をパース（カンマ区切り）
    const targetCustomers = parseCheckboxResponse(targetCustomersRaw);
    const wantReferralsFrom = parseCheckboxResponse(wantReferralsRaw);

    // 業種大分類を取得
    const industryGroup = CONFIG.INDUSTRY_GROUPS[industry] || 'その他';

    participants.push({
      id: participants.length + 1,
      name: name,
      chapter: chapter,
      email: email,
      industry: industry,
      industry_group: industryGroup,
      category_detail: categoryDetail,
      target_customers: targetCustomers,
      want_referrals_from: wantReferralsFrom
    });
  }

  Logger.log(`参加者データ読み込み完了: ${participants.length}名`);
  return { participants: participants };
}

/**
 * チェックボックス形式の回答をパースする
 * Googleフォームではカンマ+スペース区切りで保存される
 * @param {string} raw - 生の回答文字列
 * @return {string[]} パース済み配列
 */
function parseCheckboxResponse(raw) {
  if (!raw || raw.trim() === '') return [];
  return raw.split(/[,、;]/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * 参加者データのサマリーをログ出力（デバッグ用）
 */
function debugParticipants() {
  const data = loadParticipants();
  Logger.log(`総参加者数: ${data.participants.length}`);

  // 業種グループ別の人数
  const groupCount = {};
  data.participants.forEach(p => {
    groupCount[p.industry_group] = (groupCount[p.industry_group] || 0) + 1;
  });
  Logger.log('業種グループ別人数:');
  Object.entries(groupCount).sort((a, b) => b[1] - a[1]).forEach(([group, count]) => {
    Logger.log(`  ${group}: ${count}名`);
  });

  // チャプター別の人数
  const chapterCount = {};
  data.participants.forEach(p => {
    chapterCount[p.chapter] = (chapterCount[p.chapter] || 0) + 1;
  });
  Logger.log('チャプター別人数:');
  Object.entries(chapterCount).sort((a, b) => b[1] - a[1]).forEach(([chapter, count]) => {
    Logger.log(`  ${chapter}: ${count}名`);
  });
}
