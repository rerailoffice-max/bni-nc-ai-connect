/**
 * AI Connect v2 — データ変換 + DISC行動スタイル判定
 * スプレッドシートの回答データをGemini入力用JSONに変換する
 */

/**
 * 電話番号を正規化する（重複チェック・検索用）
 * +81-90-1234-5678 → 09012345678
 * 090-1234-5678 → 09012345678
 * @param {string} raw - 生の電話番号
 * @return {string} 数字のみの正規化済み電話番号
 */
function normalizePhone(raw) {
  if (!raw) return '';
  let phone = String(raw).replace(/[\s\-\(\)\.]/g, '');
  // +81 → 0 に変換
  if (phone.startsWith('+81')) {
    phone = '0' + phone.slice(3);
  } else if (phone.startsWith('81') && phone.length >= 11) {
    phone = '0' + phone.slice(2);
  }
  return phone;
}

/**
 * DISC行動スタイルを判定する
 * Q7-Q9の各回答(A/B/C/D)からメイン・サブタイプとラベルを算出
 * @param {string} q7 - Q7の回答（A/B/C/D）
 * @param {string} q8 - Q8の回答（A/B/C/D）
 * @param {string} q9 - Q9の回答（A/B/C/D）
 * @return {Object} {disc_main, disc_sub, disc_label, disc_scores}
 */
function calculateDiscType(q7, q8, q9) {
  const scores = { D: 0, I: 0, S: 0, C: 0 };
  const answers = [
    { q: 'Q7', answer: String(q7).toUpperCase().trim() },
    { q: 'Q8', answer: String(q8).toUpperCase().trim() },
    { q: 'Q9', answer: String(q9).toUpperCase().trim() }
  ];

  // スコア集計
  answers.forEach(a => {
    const type = CONFIG.DISC.ANSWER_MAP[a.answer];
    if (type) scores[type]++;
  });

  // ソート: スコア降順、同点ならQ7>Q8>Q9で先に登場したタイプ優先
  const sorted = Object.entries(scores).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return firstAppearance_(a[0], answers) - firstAppearance_(b[0], answers);
  });

  const mainType = sorted[0][0];
  const mainScore = sorted[0][1];
  const subType = sorted[1][0];
  const subScore = sorted[1][1];

  // 純粋タイプ vs 複合タイプ
  const isPure = (mainScore - subScore) >= 2;
  const compoundKey = mainType + (isPure ? mainType : subType);
  const label = CONFIG.DISC.COMPOUND_LABELS[compoundKey] || CONFIG.DISC.TYPE_NAMES[mainType].ja;

  return {
    disc_main: mainType,
    disc_sub: isPure ? mainType : subType,
    disc_label: label,
    disc_scores: scores
  };
}

/**
 * あるDISCタイプがQ7-Q9で最初に登場する位置を返す（タイブレーク用）
 */
function firstAppearance_(type, answers) {
  for (let i = 0; i < answers.length; i++) {
    if (CONFIG.DISC.ANSWER_MAP[answers[i].answer] === type) return i;
  }
  return 99; // 該当なし（スコア0のタイプ）
}

/**
 * 参加者回答シートからデータを読み取り、JSON形式に変換する
 * v2カラム: 氏名, チャプター, カテゴリー, 電話番号, 業種, ターゲット, Q7, Q8, Q9
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

  const participants = [];
  const phoneSet = new Set(); // 重複チェック用（電話番号ベース）

  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    // 空行スキップ
    if (!row[0] || String(row[0]).trim() === '') continue;

    // タイムスタンプ判定でオフセット決定
    const hasTimestamp = String(row[0]).match(/^\d{4}[\/-]/);
    const offset = hasTimestamp ? 1 : 0;

    // v2カラム: 氏名, チャプター, カテゴリー, 電話番号, 業種, ターゲット, Q7, Q8, Q9
    const name = String(row[offset] || '').trim();
    const chapter = String(row[offset + 1] || '').trim();
    const category = String(row[offset + 2] || '').trim();
    const phoneRaw = String(row[offset + 3] || '').trim();
    const industry = String(row[offset + 4] || '').trim();
    const targetCustomersRaw = String(row[offset + 5] || '');
    const q7 = String(row[offset + 6] || '').trim();
    const q8 = String(row[offset + 7] || '').trim();
    const q9 = String(row[offset + 8] || '').trim();

    // 必須フィールドチェック
    if (!name || !industry) continue;

    // 電話番号正規化
    const normalizedPhone = normalizePhone(phoneRaw);

    // 重複チェック（電話番号ベース、最新回答を採用）
    if (normalizedPhone && phoneSet.has(normalizedPhone)) {
      const existingIdx = participants.findIndex(p => p.phone === normalizedPhone);
      if (existingIdx >= 0) participants.splice(existingIdx, 1);
    }
    if (normalizedPhone) phoneSet.add(normalizedPhone);

    // ターゲット顧客層パース
    const targetCustomers = parseCheckboxResponse(targetCustomersRaw);

    // 業種大分類
    const industryGroup = CONFIG.INDUSTRY_GROUPS[industry] || 'その他';

    // DISC判定
    const disc = calculateDiscType(q7, q8, q9);

    participants.push({
      id: participants.length + 1,
      name: name,
      chapter: chapter,
      category: category,
      phone: normalizedPhone,
      phone_last4: normalizedPhone.slice(-4),
      industry: industry,
      industry_group: industryGroup,
      target_customers: targetCustomers,
      disc_main: disc.disc_main,
      disc_sub: disc.disc_sub,
      disc_label: disc.disc_label,
      disc_scores: disc.disc_scores
    });
  }

  Logger.log(`参加者データ読み込み完了: ${participants.length}名`);
  return { participants: participants };
}

/**
 * チェックボックス形式の回答をパースする
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
 * DISC判定結果をスプレッドシートに書き出す
 */
function writeDiscResults(participants) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_DISC);
  if (!sheet) sheet = ss.insertSheet(CONFIG.SHEET_DISC);
  sheet.clearContents();

  const headers = ['ID', '氏名', 'チャプター', 'カテゴリー', '業種', 'メインタイプ', 'サブタイプ', 'ラベル', 'D(炎)', 'I(風)', 'S(大地)', 'C(水)'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.getRange(1, 1, 1, headers.length).setBackground('#CF2030');
  sheet.getRange(1, 1, 1, headers.length).setFontColor('#FFFFFF');

  const rows = participants.map(p => [
    p.id, p.name, p.chapter, p.category, p.industry,
    p.disc_main, p.disc_sub, p.disc_label,
    p.disc_scores.D, p.disc_scores.I, p.disc_scores.S, p.disc_scores.C
  ]);

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sheet.autoResizeColumns(1, headers.length);
}

/**
 * DISC判定のユニットテスト
 */
function testDiscScoring() {
  const tests = [
    { q7:'A', q8:'A', q9:'A', expect_main:'D', expect_label:'炎', desc:'純粋D（全てA）' },
    { q7:'A', q8:'A', q9:'B', expect_main:'D', expect_label:'炎風', desc:'複合Di（A,A,B）' },
    { q7:'B', q8:'A', q9:'B', expect_main:'I', expect_label:'風炎', desc:'複合iD（B,A,B）' },
    { q7:'C', q8:'C', q9:'C', expect_main:'S', expect_label:'大地', desc:'純粋S（全てC）' },
    { q7:'D', q8:'D', q9:'D', expect_main:'C', expect_label:'水', desc:'純粋C（全てD）' },
    { q7:'A', q8:'B', q9:'C', expect_main:'D', expect_label:'炎風', desc:'同点タイブレーク（A,B,C→Q7優先でD）' },
    { q7:'B', q8:'C', q9:'D', expect_main:'I', expect_label:'風大地', desc:'同点タイブレーク（B,C,D→Q7優先でI）' },
  ];

  let passed = 0;
  let failed = 0;
  const results = [];

  tests.forEach(t => {
    const disc = calculateDiscType(t.q7, t.q8, t.q9);
    const mainOk = disc.disc_main === t.expect_main;
    const labelOk = disc.disc_label === t.expect_label;
    const ok = mainOk && labelOk;
    if (ok) passed++; else failed++;
    results.push(`${ok?'✅':'❌'} ${t.desc}: main=${disc.disc_main}(${t.expect_main}) label=${disc.disc_label}(${t.expect_label})`);
  });

  const msg = `DISC判定テスト結果: ${passed}/${tests.length} 合格\n\n${results.join('\n')}`;
  Logger.log(msg);
  SpreadsheetApp.getUi().alert('DISC判定テスト', msg, SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * 参加者データのサマリーをログ出力（デバッグ用）
 */
function debugParticipants() {
  const data = loadParticipants();
  Logger.log(`総参加者数: ${data.participants.length}`);

  // DISC分布
  const discCount = { D: 0, I: 0, S: 0, C: 0 };
  data.participants.forEach(p => { discCount[p.disc_main]++; });
  Logger.log(`DISC分布: D(炎)=${discCount.D} I(風)=${discCount.I} S(大地)=${discCount.S} C(水)=${discCount.C}`);

  // 業種グループ別
  const groupCount = {};
  data.participants.forEach(p => {
    groupCount[p.industry_group] = (groupCount[p.industry_group] || 0) + 1;
  });
  Logger.log('業種グループ別人数:');
  Object.entries(groupCount).sort((a, b) => b[1] - a[1]).forEach(([group, count]) => {
    Logger.log(`  ${group}: ${count}名`);
  });
}
