/**
 * AI Connect v2 — グループ最適化・バリデーション・セレンディピティ
 * Gemini出力を検証し、ルール違反があれば自動修正する
 */

/**
 * グループ配置のバリデーション（v2: 10グループ × 2テーブル）
 * @param {Object} result - Geminiからのグループ配置結果
 * @param {Object[]} participants - 参加者配列
 * @return {Object} {isValid, errors, warnings}
 */
function validateGroups(result, participants) {
  const errors = [];
  const warnings = [];

  if (!result || !result.groups || !Array.isArray(result.groups)) {
    return { isValid: false, errors: ['グループデータが不正です'], warnings: [] };
  }

  const pMap = {};
  participants.forEach(p => { pMap[p.id] = p; });

  // 1. 全参加者がいずれかのグループに割り当てられているか
  const assignedIds = new Set();
  result.groups.forEach(g => {
    g.tables.forEach(t => {
      t.members.forEach(m => assignedIds.add(m.id));
    });
  });
  const missingIds = participants.filter(p => !assignedIds.has(p.id)).map(p => `${p.name}(ID:${p.id})`);
  if (missingIds.length > 0) {
    errors.push(`未割り当て: ${missingIds.length}名 — ${missingIds.slice(0, 5).join(', ')}${missingIds.length > 5 ? '...' : ''}`);
  }

  // 2. 重複割り当てチェック
  const allIds = [];
  result.groups.forEach(g => g.tables.forEach(t => t.members.forEach(m => allIds.push(m.id))));
  const duplicateIds = allIds.filter((id, idx) => allIds.indexOf(id) !== idx);
  if (duplicateIds.length > 0) {
    errors.push(`重複割り当て: ID ${[...new Set(duplicateIds)].join(', ')}`);
  }

  result.groups.forEach(group => {
    const gn = group.group_number;
    const allMembers = group.tables.flatMap(t => t.members);
    const groupSize = allMembers.length;

    // 3. グループサイズチェック（17-23名）
    if (groupSize < CONFIG.GROUP_SIZE_MIN) {
      errors.push(`グループ${gn}: ${groupSize}名（最小${CONFIG.GROUP_SIZE_MIN}名未満）`);
    }
    if (groupSize > CONFIG.GROUP_SIZE_MAX) {
      errors.push(`グループ${gn}: ${groupSize}名（最大${CONFIG.GROUP_SIZE_MAX}名超過）`);
    }

    // 4. テーブルバランスチェック（2テーブル間の差 ±1）
    if (group.tables.length === 2) {
      const diff = Math.abs(group.tables[0].members.length - group.tables[1].members.length);
      if (diff > 1) {
        warnings.push(`グループ${gn}: テーブル間差${diff}名（理想は±1）`);
      }
    }

    // 5. DISC全4タイプ含有チェック
    const discCount = { D: 0, I: 0, S: 0, C: 0 };
    allMembers.forEach(m => {
      const p = pMap[m.id];
      if (p && p.disc_main) discCount[p.disc_main]++;
    });
    const missingTypes = Object.entries(discCount).filter(([, v]) => v === 0).map(([k]) => k);
    if (missingTypes.length > 0) {
      errors.push(`グループ${gn}: DISCタイプ不足 — ${missingTypes.join(',')}が0名`);
    }

    // 6. S/C型最低人数チェック
    if (discCount.S < CONFIG.DISC.SC_MIN_PER_GROUP) {
      warnings.push(`グループ${gn}: S(大地)型 ${discCount.S}名（推奨${CONFIG.DISC.SC_MIN_PER_GROUP}名以上）`);
    }
    if (discCount.C < CONFIG.DISC.SC_MIN_PER_GROUP) {
      warnings.push(`グループ${gn}: C(水)型 ${discCount.C}名（推奨${CONFIG.DISC.SC_MIN_PER_GROUP}名以上）`);
    }

    // 7. 同業種グループチェック（4名以下）
    const industryGroupCount = {};
    allMembers.forEach(m => {
      const p = pMap[m.id];
      if (p) industryGroupCount[p.industry_group] = (industryGroupCount[p.industry_group] || 0) + 1;
    });
    Object.entries(industryGroupCount).forEach(([ig, count]) => {
      if (count > 4) {
        errors.push(`グループ${gn}: 「${ig}」が${count}名（4名以下にすべき）`);
      }
    });

    // 8. 同チャプターチェック（3名以下）
    const chapterCount = {};
    allMembers.forEach(m => {
      const p = pMap[m.id];
      if (p && p.chapter) chapterCount[p.chapter] = (chapterCount[p.chapter] || 0) + 1;
    });
    Object.entries(chapterCount).forEach(([ch, count]) => {
      if (count > 3) {
        errors.push(`グループ${gn}: チャプター「${ch}」が${count}名（3名以下にすべき）`);
      }
    });
  });

  const isValid = errors.length === 0;
  if (warnings.length > 0) {
    Logger.log(`バリデーション警告: ${warnings.join(' / ')}`);
  }
  return { isValid, errors, warnings };
}

/**
 * グループ配置のルール違反を自動修正する
 */
function fixGroupViolations(result, participants) {
  const pMap = {};
  participants.forEach(p => { pMap[p.id] = p; });

  let improved = true;
  let iterations = 0;
  const maxIterations = 200;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    for (let i = 0; i < result.groups.length; i++) {
      const group = result.groups[i];
      const allMembers = group.tables.flatMap(t => t.members);

      // 同業種グループの違反を修正
      const igCount = {};
      allMembers.forEach(m => {
        const p = pMap[m.id];
        if (p) {
          if (!igCount[p.industry_group]) igCount[p.industry_group] = [];
          igCount[p.industry_group].push(m);
        }
      });

      Object.entries(igCount).forEach(([ig, members]) => {
        if (members.length > 4) {
          const excess = members.slice(4);
          excess.forEach(excessMember => {
            const target = findGroupSwapTarget_(result.groups, i, excessMember, pMap, 'industry');
            if (target !== null) {
              performGroupSwap_(result.groups, i, target, excessMember, pMap);
              improved = true;
            }
          });
        }
      });

      // 同チャプター違反を修正
      const chCount = {};
      allMembers.forEach(m => {
        const p = pMap[m.id];
        if (p && p.chapter) {
          if (!chCount[p.chapter]) chCount[p.chapter] = [];
          chCount[p.chapter].push(m);
        }
      });

      Object.entries(chCount).forEach(([ch, members]) => {
        if (members.length > 3) {
          const excess = members.slice(3);
          excess.forEach(excessMember => {
            const target = findGroupSwapTarget_(result.groups, i, excessMember, pMap, 'chapter');
            if (target !== null) {
              performGroupSwap_(result.groups, i, target, excessMember, pMap);
              improved = true;
            }
          });
        }
      });
    }
  }

  // 未割り当ての参加者を最小グループに追加
  const assignedIds = new Set();
  result.groups.forEach(g => g.tables.forEach(t => t.members.forEach(m => assignedIds.add(m.id))));
  const unassigned = participants.filter(p => !assignedIds.has(p.id));
  unassigned.forEach(p => {
    const smallest = result.groups
      .filter(g => g.tables.flatMap(t => t.members).length < CONFIG.GROUP_SIZE_MAX)
      .sort((a, b) => a.tables.flatMap(t => t.members).length - b.tables.flatMap(t => t.members).length)[0];
    if (smallest) {
      // 小さい方のテーブルに追加
      const targetTable = smallest.tables.sort((a, b) => a.members.length - b.members.length)[0];
      targetTable.members.push({
        id: p.id, name: p.name, industry: p.industry,
        chapter: p.chapter, category: p.category, disc_label: p.disc_label
      });
    }
  });

  // グループ内テーブルバランス調整
  result.groups.forEach(group => {
    if (group.tables.length === 2) {
      while (Math.abs(group.tables[0].members.length - group.tables[1].members.length) > 1) {
        const bigger = group.tables[0].members.length > group.tables[1].members.length ? 0 : 1;
        const smaller = bigger === 0 ? 1 : 0;
        const member = group.tables[bigger].members.pop();
        group.tables[smaller].members.push(member);
      }
    }
  });

  Logger.log(`自動修正完了: ${iterations}回のイテレーション`);
  return result;
}

/**
 * スワップ先グループを探す
 */
function findGroupSwapTarget_(groups, sourceIdx, member, pMap, violationType) {
  const memberData = pMap[member.id];
  if (!memberData) return null;

  for (let j = 0; j < groups.length; j++) {
    if (j === sourceIdx) continue;
    const targetGroup = groups[j];
    const targetMembers = targetGroup.tables.flatMap(t => t.members);

    if (targetMembers.length >= CONFIG.GROUP_SIZE_MAX) continue;

    if (violationType === 'industry') {
      const sameIG = targetMembers.filter(m => {
        const p = pMap[m.id];
        return p && p.industry_group === memberData.industry_group;
      }).length;
      if (sameIG < 4) return j;
    } else if (violationType === 'chapter') {
      const sameCh = targetMembers.filter(m => {
        const p = pMap[m.id];
        return p && p.chapter === memberData.chapter;
      }).length;
      if (sameCh < 3) return j;
    }
  }
  return null;
}

/**
 * グループ間でメンバーを移動する
 */
function performGroupSwap_(groups, fromIdx, toIdx, member, pMap) {
  // 元グループから削除
  for (const table of groups[fromIdx].tables) {
    const idx = table.members.findIndex(m => m.id === member.id);
    if (idx >= 0) {
      table.members.splice(idx, 1);
      break;
    }
  }
  // 移動先グループの小さいテーブルに追加
  const targetTable = groups[toIdx].tables.sort((a, b) => a.members.length - b.members.length)[0];
  targetTable.members.push(member);
}

/**
 * セレンディピティグループを割り当てる（未回答者用）
 * 現在はフォーム回答者のみなので、外部参加者リストとの差分で未回答者を特定する想定
 * @return {Object|null} セレンディピティグループ、または不要ならnull
 */
function assignSerendipityGroup(result, participants) {
  // 現状: 全員がフォーム回答者なのでセレンディピティグループは空
  // 本番では別途参加者名簿シートとの差分を計算
  // ここではプレースホルダとして空のセレンディピティを返す
  return null;
}

// ===== ダミーデータ生成 =====

/**
 * ダミーデータ生成（30名 — スモークテスト用）
 */
function generateDummyData() {
  _generateDummy(30);
}

/**
 * ダミーデータ生成（200名 — 本番想定テスト用）
 */
function generateDummyData200() {
  _generateDummy(200);
}

/**
 * ダミーデータを生成してスプレッドシートに書き込む（v2形式）
 * @param {number} count - 生成する人数
 */
function _generateDummy(count) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_RESPONSES);
  if (!sheet) sheet = ss.insertSheet(CONFIG.SHEET_RESPONSES);
  sheet.clearContents();

  // v2ヘッダー（タイムスタンプなし）
  const headers = ['氏名', 'チャプター名', 'カテゴリー名', '電話番号', '業種', 'ターゲット顧客層', 'Q7', 'Q8', 'Q9'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

  const industries = Object.keys(CONFIG.INDUSTRY_GROUPS);
  const chapters = [
    'アンカー', 'ジャンヌ', 'ライジング', '風神', 'UKA', 'フェニックス', 'ドリーム',
    'サクセス', 'パイオニア', 'ビクトリー', 'フォルテ', 'レガシー', 'インフィニティ',
    'ブリリアント', 'エクセレンス', 'プレミアム', 'トリニティ', 'アドバンス', 'グローリー', 'ネクサス',
    'ホライズン', 'クレスト', 'サミット', 'ステラ', 'グランツ'
  ];
  const targetOptions = CONFIG.TARGET_OPTIONS;

  const lastNames = ['佐藤','鈴木','高橋','田中','伊藤','渡辺','山本','中村','小林','加藤',
    '吉田','山田','佐々木','松本','井上','木村','林','斎藤','清水','山崎',
    '森','池田','橋本','阿部','石川','前田','藤田','小川','岡田','後藤',
    '長谷川','石井','村上','近藤','坂本','遠藤','青木','藤井','西村','福田'];
  const firstNames = ['太郎','花子','健太','由美','大輔','美咲','陽子','翔太','麻衣','拓也',
    '真由美','直樹','裕子','達也','恵子','雄一','智子','和也','理恵','俊介',
    '綾子','修','明美','誠','久美子','浩二','幸子','正義','敦子','啓介'];

  const categoryDetails = {
    '建築設計・施工': ['注文住宅専門の建築士','商業施設設計のプロ','RC造マンション設計'],
    'リフォーム・リノベーション': ['中古マンションリノベ','耐震補強リフォーム','水回り専門リフォーム'],
    '不動産売買': ['投資用物件専門の不動産','新築戸建て仲介','事業用不動産アドバイザー'],
    'Web制作・デザイン': ['EC構築専門のWeb制作','WordPress特化デザイナー','BtoBサイト制作'],
    'システム開発': ['業務システム開発','アプリ開発エンジニア','クラウド移行支援'],
    'AI・DX支援': ['業務自動化のAI顧問','RPA導入支援','データ分析基盤構築'],
    '弁護士': ['企業法務専門弁護士','離婚・相続の弁護士','知的財産権弁護士'],
    '税理士・会計士': ['相続税対策の税理士','創業支援の税理士','医業経営支援の会計士'],
    '生命保険': ['法人保険設計の専門家','相続対策保険アドバイザー','富裕層向け資産保全'],
    '損害保険': ['事業用総合保険','賠償責任保険の専門家','火災保険・地震保険'],
    '美容室・ヘアサロン': ['オーガニックサロン経営','メンズ特化ヘアサロン','ヘアカラー専門店'],
    '経営コンサルティング': ['事業承継コンサルタント','補助金支援の専門家','M&Aアドバイザー'],
    '飲食店経営': ['イタリアンレストラン経営','居酒屋チェーン経営者','カフェオーナー'],
    '写真・映像': ['ブライダル撮影のカメラマン','企業PR動画制作','ドローン空撮カメラマン'],
    'SNSマーケティング': ['Instagram運用のプロ','TikTokマーケター','LINE公式活用支援'],
    '研修・セミナー': ['管理職研修の講師','コミュニケーション研修','DX人材育成講師']
  };

  // BNI集団のDISC分布（I/D型に偏り）
  // 各質問で A(D)=25%, B(I)=35%, C(S)=25%, D(C)=15%
  function randomAnswer() {
    const r = Math.random();
    if (r < 0.25) return 'A';      // D(炎)
    if (r < 0.60) return 'B';      // I(風)
    if (r < 0.85) return 'C';      // S(大地)
    return 'D';                     // C(水)
  }

  const usedPhones = new Set();
  const rows = [];

  for (let i = 0; i < count; i++) {
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const name = `${lastName} ${firstName}`;
    const chapter = chapters[Math.floor(Math.random() * chapters.length)];

    // ユニークな電話番号
    let phone;
    do {
      phone = '090-' + String(1000 + Math.floor(Math.random() * 9000)) + '-' + String(1000 + Math.floor(Math.random() * 9000));
    } while (usedPhones.has(phone));
    usedPhones.add(phone);

    const industry = industries[Math.floor(Math.random() * industries.length)];

    // カテゴリー詳細
    const details = categoryDetails[industry];
    const category = details ? details[Math.floor(Math.random() * details.length)] : industry + '専門';

    // ターゲット顧客（1-3個ランダム）
    const targetCount = Math.floor(Math.random() * 3) + 1;
    const shuffled = [...targetOptions].sort(() => Math.random() - 0.5);
    const targets = shuffled.slice(0, targetCount).join(', ');

    // 行動スタイル診断（BNI偏り分布）
    const q7 = randomAnswer();
    const q8 = randomAnswer();
    const q9 = randomAnswer();

    rows.push([name, chapter, category, phone, industry, targets, q7, q8, q9]);
  }

  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.autoResizeColumns(1, headers.length);

  SpreadsheetApp.getUi().alert(`ダミーデータ ${count}名分を生成しました`);
  Logger.log(`ダミーデータ生成完了: ${count}名`);
}
