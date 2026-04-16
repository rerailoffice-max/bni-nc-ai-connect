/**
 * AI Connect v2 — 設定値一元管理
 * スクリプトプロパティにGEMINI_API_KEYを設定してから使用すること
 */

const CONFIG = {
  // スプレッドシートID（Web App用 — getActiveSpreadsheet()はWeb Appで動かないため）
  SPREADSHEET_ID: '1V8g2N3hYP4PT9_uTy8bzOkvJlcE1GX9kjnUzFB9fANQ',

  // Gemini API
  GEMINI_API_KEY: PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY'),
  GEMINI_MODEL: 'gemini-3-flash-preview',
  GEMINI_ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/models/',
  GEMINI_TEMPERATURE: 0.2,
  GEMINI_MAX_OUTPUT_TOKENS: 65536,
  GEMINI_MAX_RETRIES: 3,

  // グループ設定（v2: 10グループ × 2テーブル × 約10名）
  GROUP_COUNT: 10,
  GROUP_SIZE_MIN: 17,
  GROUP_SIZE_MAX: 23,
  TABLES_PER_GROUP: 2,

  // シート名
  SHEET_RESPONSES: '参加者回答',
  SHEET_DISC: 'DISC判定結果',
  SHEET_RESULTS: 'マッチング結果',
  SHEET_GROUPS: 'グループ一覧',
  SHEET_REASONING: 'マッチング根拠',
  SHEET_CONFIG: '設定',

  // DISC行動スタイル診断
  DISC: {
    // フォーム選択肢 → DISCタイプ
    ANSWER_MAP: { 'A': 'D', 'B': 'I', 'C': 'S', 'D': 'C' },

    // タイプ情報
    TYPE_NAMES: {
      D: { ja: '炎', en: 'Fire', emoji: '🔥', css: 'fire', color: '#CF2030' },
      I: { ja: '風', en: 'Wind', emoji: '🌀', css: 'wind', color: '#2196F3' },
      S: { ja: '大地', en: 'Earth', emoji: '🌿', css: 'earth', color: '#FFC107' },
      C: { ja: '水', en: 'Water', emoji: '💧', css: 'water', color: '#4CAF50' }
    },

    // サブタイプラベル（メインタイプ+サブタイプ → 和名）
    COMPOUND_LABELS: {
      DD: '炎', DI: '炎風', ID: '風炎', II: '風',
      IS: '風大地', SI: '大地風', SS: '大地', SC: '大地水',
      CS: '水大地', CC: '水', CD: '水炎', DC: '炎水'
    },

    // 同点時の優先度（Q7の回答を最優先）
    PRIORITY: ['Q7', 'Q8', 'Q9'],

    // 各グループにS型・C型を最低この人数保証
    SC_MIN_PER_GROUP: 2
  },

  // 業種大分類
  INDUSTRY_GROUPS: {
    '建築設計・施工': '建設・不動産',
    'リフォーム・リノベーション': '建設・不動産',
    '不動産売買': '建設・不動産',
    '不動産賃貸・管理': '建設・不動産',
    'インテリア・内装': '建設・不動産',
    '外構・エクステリア': '建設・不動産',
    '電気・設備工事': '建設・不動産',
    'Web制作・デザイン': 'IT・デジタル',
    'システム開発': 'IT・デジタル',
    'AI・DX支援': 'IT・デジタル',
    'SNSマーケティング': 'IT・デジタル',
    '動画制作・映像': 'IT・デジタル',
    'IT機器・サポート': 'IT・デジタル',
    '弁護士': '士業・コンサルティング',
    '税理士・会計士': '士業・コンサルティング',
    '社会保険労務士': '士業・コンサルティング',
    '行政書士': '士業・コンサルティング',
    '司法書士': '士業・コンサルティング',
    '中小企業診断士': '士業・コンサルティング',
    '経営コンサルティング': '士業・コンサルティング',
    '人材・組織コンサルティング': '士業・コンサルティング',
    '生命保険': '金融・保険',
    '損害保険': '金融・保険',
    'ファイナンシャルプランナー': '金融・保険',
    '融資・資金調達': '金融・保険',
    '投資・資産運用': '金融・保険',
    '美容室・ヘアサロン': '美容・健康',
    'エステ・リラクゼーション': '美容・健康',
    '整体・鍼灸・接骨': '美容・健康',
    'パーソナルトレーニング': '美容・健康',
    '歯科': '美容・健康',
    '医療・クリニック': '美容・健康',
    '飲食店経営': '飲食・食品',
    'ケータリング・仕出し': '飲食・食品',
    '食品製造・販売': '飲食・食品',
    '語学・翻訳': '教育・研修',
    '研修・セミナー': '教育・研修',
    'コーチング': '教育・研修',
    '学習塾・スクール': '教育・研修',
    'グラフィックデザイン': 'クリエイティブ',
    '写真・映像': 'クリエイティブ',
    'ライティング・編集': 'クリエイティブ',
    '印刷・出版': 'クリエイティブ',
    '清掃・ハウスクリーニング': '生活サービス',
    '引越し・物流': '生活サービス',
    '冠婚葬祭': '生活サービス',
    'ペット関連': '生活サービス',
    '自動車販売・整備': '生活サービス',
    '人材紹介・派遣': 'その他',
    '広告・PR': 'その他',
    '通信・インフラ': 'その他',
    'その他': 'その他'
  },

  // ターゲット顧客層の選択肢
  TARGET_OPTIONS: [
    '個人（一般消費者）',
    '個人事業主・フリーランス',
    '中小企業（従業員30名以下）',
    '中堅企業（従業員31-300名）',
    '大企業（従業員301名以上）',
    '飲食・小売店舗',
    '医療・福祉施設',
    '不動産オーナー',
    '富裕層・高所得者',
    '海外企業・外国人'
  ]
};

/**
 * メニューを追加（スプレッドシートを開いた時に実行）
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🤖 AI Connect v2')
    .addItem('▶ マッチング実行', 'runMatching')
    .addItem('🔄 再マッチング', 'runMatching')
    .addSeparator()
    .addItem('📊 ダミーデータ生成（30名）', 'generateDummyData')
    .addItem('📊 ダミーデータ生成（200名）', 'generateDummyData200')
    .addSeparator()
    .addItem('🧪 DISC判定テスト', 'testDiscScoring')
    .addItem('📄 スクリーンHTML出力', 'exportScreenHTML')
    .addItem('🗑️ 結果クリア', 'clearResults')
    .addToUi();
}

/**
 * 結果シートをクリア
 */
function clearResults() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = [CONFIG.SHEET_RESULTS, CONFIG.SHEET_GROUPS, CONFIG.SHEET_REASONING, CONFIG.SHEET_DISC];
  sheets.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (sheet) sheet.clearContents();
  });
  try { SpreadsheetApp.getUi().alert('結果をクリアしました'); } catch(e) {}
}
