/**
 * AI Connect — 設定値一元管理
 * スクリプトプロパティにGEMINI_API_KEYを設定してから使用すること
 */

const CONFIG = {
  // Gemini API
  GEMINI_API_KEY: PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY'),
  GEMINI_MODEL: 'gemini-2.0-flash',
  GEMINI_ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/models/',
  GEMINI_TEMPERATURE: 0.2,
  GEMINI_MAX_OUTPUT_TOKENS: 8192,
  GEMINI_MAX_RETRIES: 3,

  // テーブル設定
  TABLE_SIZE_MIN: 5,
  TABLE_SIZE_MAX: 7,

  // シート名
  SHEET_RESPONSES: '参加者回答',
  SHEET_RESULTS: 'マッチング結果',
  SHEET_TABLES: 'テーブル一覧',
  SHEET_CONFIG: '設定',

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
  }
};

/**
 * メニューを追加（スプレッドシートを開いた時に実行）
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🤖 AI Connect')
    .addItem('▶ マッチング実行', 'runMatching')
    .addItem('🔄 再マッチング', 'runMatching')
    .addItem('📊 ダミーデータ生成（30名）', 'generateDummyData')
    .addItem('📊 ダミーデータ生成（150名）', 'generateDummyData150')
    .addItem('🗑️ 結果クリア', 'clearResults')
    .addItem('📄 スクリーンHTML出力', 'exportScreenHTML')
    .addToUi();
}

/**
 * 結果シートをクリア
 */
function clearResults() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resultSheet = ss.getSheetByName(CONFIG.SHEET_RESULTS);
  const tableSheet = ss.getSheetByName(CONFIG.SHEET_TABLES);
  if (resultSheet) resultSheet.clearContents();
  if (tableSheet) tableSheet.clearContents();
  SpreadsheetApp.getUi().alert('結果をクリアしました');
}
