/**
 * AI Connect — テーブル最適化・バリデーション
 * Gemini出力を検証し、ルール違反があれば自動修正する
 */

/**
 * テーブル配置のバリデーション
 * @param {Object} result - Geminiからのテーブル配置結果
 * @param {Object[]} participants - 参加者配列
 * @return {Object} {isValid: boolean, errors: string[], warnings: string[]}
 */
function validateTables(result, participants) {
  const errors = [];
  const warnings = [];

  if (!result || !result.tables || !Array.isArray(result.tables)) {
    return { isValid: false, errors: ['テーブルデータが不正です'], warnings: [] };
  }

  // 全参加者がいずれかのテーブルに割り当てられているかチェック
  const assignedIds = new Set();
  result.tables.forEach(table => {
    table.members.forEach(m => assignedIds.add(m.id));
  });

  const missingIds = participants.filter(p => !assignedIds.has(p.id)).map(p => `${p.name}(ID:${p.id})`);
  if (missingIds.length > 0) {
    errors.push(`未割り当ての参加者: ${missingIds.join(', ')}`);
  }

  // 重複割り当てチェック
  const allIds = [];
  result.tables.forEach(table => {
    table.members.forEach(m => allIds.push(m.id));
  });
  const duplicateIds = allIds.filter((id, idx) => allIds.indexOf(id) !== idx);
  if (duplicateIds.length > 0) {
    errors.push(`重複割り当て: ID ${[...new Set(duplicateIds)].join(', ')}`);
  }

  // 参加者IDでルックアップ用マップ
  const pMap = {};
  participants.forEach(p => { pMap[p.id] = p; });

  result.tables.forEach(table => {
    const tn = table.table_number;

    // テーブルサイズチェック
    if (table.members.length < CONFIG.TABLE_SIZE_MIN) {
      errors.push(`テーブル${tn}: ${table.members.length}名（最小${CONFIG.TABLE_SIZE_MIN}名未満）`);
    }
    if (table.members.length > CONFIG.TABLE_SIZE_MAX) {
      errors.push(`テーブル${tn}: ${table.members.length}名（最大${CONFIG.TABLE_SIZE_MAX}名超過）`);
    }

    // 同業種グループチェック
    const groupCount = {};
    table.members.forEach(m => {
      const p = pMap[m.id];
      if (p) {
        groupCount[p.industry_group] = (groupCount[p.industry_group] || 0) + 1;
      }
    });
    Object.entries(groupCount).forEach(([group, count]) => {
      if (count > 2) {
        errors.push(`テーブル${tn}: 「${group}」が${count}名（2名以下にすべき）`);
      } else if (count === 2) {
        warnings.push(`テーブル${tn}: 「${group}」が2名（許容範囲だが理想は1名）`);
      }
    });

    // 同チャプターチェック
    const chapterCount = {};
    table.members.forEach(m => {
      const p = pMap[m.id];
      if (p && p.chapter) {
        chapterCount[p.chapter] = (chapterCount[p.chapter] || 0) + 1;
      }
    });
    Object.entries(chapterCount).forEach(([chapter, count]) => {
      if (count > 2) {
        errors.push(`テーブル${tn}: チャプター「${chapter}」が${count}名（2名以下にすべき）`);
      } else if (count === 2) {
        warnings.push(`テーブル${tn}: チャプター「${chapter}」が2名（許容範囲）`);
      }
    });
  });

  // 結果判定（warningのみならvalidとする）
  const isValid = errors.length === 0;

  if (warnings.length > 0) {
    Logger.log(`バリデーション警告: ${warnings.join(' / ')}`);
  }

  return { isValid, errors, warnings };
}

/**
 * テーブル配置のルール違反を自動修正する
 * 隣接テーブル間でメンバーをスワップして修正を試みる
 * @param {Object} result - テーブル配置結果
 * @param {Object[]} participants - 参加者配列
 * @return {Object} 修正済みのテーブル配置結果
 */
function fixTableViolations(result, participants) {
  const pMap = {};
  participants.forEach(p => { pMap[p.id] = p; });

  let improved = true;
  let iterations = 0;
  const maxIterations = 100; // 無限ループ防止

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    for (let i = 0; i < result.tables.length; i++) {
      const table = result.tables[i];

      // 同業種グループの違反を検出
      const groupMembers = {};
      table.members.forEach(m => {
        const p = pMap[m.id];
        if (p) {
          if (!groupMembers[p.industry_group]) groupMembers[p.industry_group] = [];
          groupMembers[p.industry_group].push(m);
        }
      });

      // 3名以上の同業種グループがある場合、余剰メンバーを別テーブルに移動
      Object.entries(groupMembers).forEach(([group, members]) => {
        if (members.length > 2) {
          const excess = members.slice(2); // 3人目以降
          excess.forEach(excessMember => {
            // 受け入れ可能なテーブルを探す
            const targetTable = findSwapTarget(result.tables, i, excessMember, pMap);
            if (targetTable !== null) {
              performSwap(result.tables, i, targetTable, excessMember, pMap);
              improved = true;
            }
          });
        }
      });

      // テーブルサイズの調整
      if (table.members.length > CONFIG.TABLE_SIZE_MAX) {
        // 人数超過 → 最も移動しやすいメンバーを隣のテーブルへ
        const smallestTable = result.tables
          .filter((t, idx) => idx !== i && t.members.length < CONFIG.TABLE_SIZE_MAX)
          .sort((a, b) => a.members.length - b.members.length)[0];

        if (smallestTable) {
          const memberToMove = table.members[table.members.length - 1];
          table.members = table.members.filter(m => m.id !== memberToMove.id);
          smallestTable.members.push(memberToMove);
          improved = true;
        }
      }
    }
  }

  // 未割り当ての参加者を空きテーブルに追加
  const assignedIds = new Set();
  result.tables.forEach(t => t.members.forEach(m => assignedIds.add(m.id)));

  const unassigned = participants.filter(p => !assignedIds.has(p.id));
  unassigned.forEach(p => {
    // 最も少ない人数のテーブルに追加
    const targetTable = result.tables
      .filter(t => t.members.length < CONFIG.TABLE_SIZE_MAX)
      .sort((a, b) => a.members.length - b.members.length)[0];

    if (targetTable) {
      targetTable.members.push({
        id: p.id,
        name: p.name,
        industry: p.industry,
        chapter: p.chapter
      });
    }
  });

  Logger.log(`自動修正完了: ${iterations}回のイテレーション`);
  return result;
}

/**
 * スワップ先のテーブルを探す
 * @param {Object[]} tables - テーブル配列
 * @param {number} sourceIdx - 元テーブルのインデックス
 * @param {Object} member - 移動するメンバー
 * @param {Object} pMap - 参加者マップ
 * @return {number|null} スワップ先テーブルのインデックス、なければnull
 */
function findSwapTarget(tables, sourceIdx, member, pMap) {
  const memberData = pMap[member.id];
  if (!memberData) return null;

  for (let j = 0; j < tables.length; j++) {
    if (j === sourceIdx) continue;

    const targetTable = tables[j];

    // テーブルサイズチェック
    if (targetTable.members.length >= CONFIG.TABLE_SIZE_MAX) continue;

    // 同業種グループチェック
    const hasConflict = targetTable.members.some(m => {
      const p = pMap[m.id];
      return p && p.industry_group === memberData.industry_group;
    });

    if (!hasConflict) return j;
  }

  return null; // 移動先が見つからない
}

/**
 * テーブル間でメンバーを移動する
 * @param {Object[]} tables - テーブル配列
 * @param {number} fromIdx - 移動元テーブルのインデックス
 * @param {number} toIdx - 移動先テーブルのインデックス
 * @param {Object} member - 移動するメンバー
 * @param {Object} pMap - 参加者マップ
 */
function performSwap(tables, fromIdx, toIdx, member, pMap) {
  // 元テーブルからメンバーを削除
  tables[fromIdx].members = tables[fromIdx].members.filter(m => m.id !== member.id);

  // 移動先テーブルにメンバーを追加
  tables[toIdx].members.push(member);

  Logger.log(`移動: ${member.name} → テーブル${tables[fromIdx].table_number} → テーブル${tables[toIdx].table_number}`);
}

/**
 * ダミーデータ生成（30名）
 */
function generateDummyData() {
  _generateDummy(30);
}

/**
 * ダミーデータ生成（150名）
 */
function generateDummyData150() {
  _generateDummy(150);
}

/**
 * ダミーデータを生成してスプレッドシートに書き込む
 * @param {number} count - 生成する人数
 */
function _generateDummy(count) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_RESPONSES);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_RESPONSES);
  }
  sheet.clearContents();

  // ヘッダー
  const headers = ['氏名', 'チャプター名', 'メールアドレス', '業種', 'カテゴリー（専門分野詳細）', 'ターゲット顧客層', '紹介してほしい業種'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

  // ダミーデータ
  const industries = Object.keys(CONFIG.INDUSTRY_GROUPS);
  const chapters = [
    'アンカー', 'ジャンヌ', 'ライジング', '風神', 'UKA', 'フェニックス', 'ドリーム',
    'サクセス', 'パイオニア', 'ビクトリー', 'フォルテ', 'レガシー', 'インフィニティ',
    'ブリリアント', 'エクセレンス', 'プレミアム', 'トリニティ', 'アドバンス', 'グローリー', 'ネクサス'
  ];
  const targetOptions = [
    '個人（一般消費者）', '個人事業主・フリーランス', '中小企業（従業員30名以下）',
    '中堅企業（従業員31-300名）', '大企業（従業員301名以上）', '飲食・小売店舗',
    '医療・福祉施設', '不動産オーナー', '富裕層・高所得者', '海外企業・外国人'
  ];
  const referralOptions = [
    '建設・不動産', 'IT・デジタル', '士業・コンサルティング', '金融・保険',
    '美容・健康', '飲食・食品', '教育・研修', 'クリエイティブ', '生活サービス', 'その他'
  ];

  const lastNames = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤',
    '吉田', '山田', '佐々木', '松本', '井上', '木村', '林', '斎藤', '清水', '山崎',
    '森', '池田', '橋本', '阿部', '石川', '前田', '藤田', '小川', '岡田', '後藤'];
  const firstNames = ['太郎', '花子', '一郎', '美咲', '健太', '由美', '大輔', '陽子', '翔太', '麻衣',
    '拓也', '真由美', '直樹', '裕子', '達也', '恵子', '雄一', '智子', '和也', '理恵',
    '俊介', '綾子', '修', '明美', '誠', '久美子', '浩二', '幸子', '正義', '敦子'];

  const categoryDetails = {
    '建築設計・施工': ['注文住宅専門', '商業施設設計', 'RC造マンション設計'],
    'リフォーム・リノベーション': ['中古マンションリノベ', '耐震補強リフォーム', '水回り専門'],
    '不動産売買': ['投資用物件専門', '新築戸建て仲介', '事業用不動産'],
    '不動産賃貸・管理': ['賃貸管理100棟以上', 'サブリース専門', 'シェアハウス運営'],
    'Web制作・デザイン': ['EC構築専門', 'WordPress特化', 'BtoBサイト制作'],
    'システム開発': ['業務システム開発', 'アプリ開発', 'クラウド移行支援'],
    'AI・DX支援': ['AI導入コンサル', 'RPA導入支援', 'データ分析基盤構築'],
    '弁護士': ['企業法務専門', '離婚・相続', '知的財産権'],
    '税理士・会計士': ['相続税対策', '創業支援', '医業経営支援'],
    '社会保険労務士': ['助成金申請代行', '就業規則作成', '労務トラブル対応'],
    '生命保険': ['法人保険設計', '相続対策保険', '富裕層向け資産保全'],
    '損害保険': ['事業用総合保険', '賠償責任保険', '火災保険・地震保険'],
    'ファイナンシャルプランナー': ['資産形成コンサル', '保険見直し', 'ライフプラン設計'],
    '美容室・ヘアサロン': ['オーガニックサロン', 'メンズ特化', 'ヘアカラー専門店'],
    'エステ・リラクゼーション': ['痩身エステ', 'フェイシャル専門', 'メンズエステ'],
    '整体・鍼灸・接骨': ['スポーツ障害専門', '産後骨盤矯正', '自律神経調整'],
    '飲食店経営': ['イタリアン', '居酒屋チェーン', 'カフェ経営'],
    '経営コンサルティング': ['事業承継コンサル', '補助金支援', 'M&Aアドバイザー'],
    '研修・セミナー': ['管理職研修', 'コミュニケーション研修', 'DX人材育成'],
    '写真・映像': ['ブライダル撮影', '企業PR動画', 'ドローン空撮'],
    'グラフィックデザイン': ['ロゴ・CI設計', 'パッケージデザイン', '広告デザイン'],
    '清掃・ハウスクリーニング': ['オフィス清掃', 'エアコンクリーニング', '退去時清掃'],
    '広告・PR': ['SNS運用代行', 'プレスリリース配信', 'イベントPR'],
    '人材紹介・派遣': ['IT人材特化', '介護人材紹介', 'ハイクラス転職'],
    'コーチング': ['エグゼクティブコーチ', 'キャリアコーチ', 'ビジネスコーチ'],
    '融資・資金調達': ['日本政策金融公庫連携', '補助金・助成金', 'ベンチャー投資'],
    'SNSマーケティング': ['Instagram運用', 'TikTokマーケ', 'LINE公式活用'],
    '動画制作・映像': ['YouTube運用', '採用動画', 'アニメーション制作']
  };

  const rows = [];
  for (let i = 0; i < count; i++) {
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const name = `${lastName} ${firstName}`;
    const chapter = chapters[Math.floor(Math.random() * chapters.length)];
    const email = `${lastName.toLowerCase()}${firstName.toLowerCase()}${i}@example.com`;
    const industry = industries[Math.floor(Math.random() * industries.length)];

    // カテゴリー詳細
    const details = categoryDetails[industry];
    const detail = details ? details[Math.floor(Math.random() * details.length)] : industry + '専門';

    // ターゲット顧客（1-3個ランダム選択）
    const targetCount = Math.floor(Math.random() * 3) + 1;
    const shuffledTargets = [...targetOptions].sort(() => Math.random() - 0.5);
    const targets = shuffledTargets.slice(0, targetCount).join(', ');

    // 紹介してほしい業種（1-3個ランダム選択）
    const refCount = Math.floor(Math.random() * 3) + 1;
    const shuffledRefs = [...referralOptions].sort(() => Math.random() - 0.5);
    const refs = shuffledRefs.slice(0, refCount).join(', ');

    rows.push([name, chapter, email, industry, detail, targets, refs]);
  }

  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.autoResizeColumns(1, headers.length);

  SpreadsheetApp.getUi().alert(`ダミーデータ ${count}名分を生成しました`);
  Logger.log(`ダミーデータ生成完了: ${count}名`);
}
