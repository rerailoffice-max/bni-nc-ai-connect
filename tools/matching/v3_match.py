#!/usr/bin/env python3
"""
v3マッチング: 未マッチ17名除外 + 電話番号下4桁追加 + パワーチーム名具体化
"""
import sys, json, re, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from data import RESPONDENTS, INDUSTRY_GROUPS, ANSWER_MAP
from unanswered import UNANSWERED

# 電話番号下4桁マップ (master_row → last4)
PHONE_LAST4 = {
    88: '8834',  # 大城芳樹
    6: '5644',   # 荻原宏子
    122: '7655', # 高田廣太朗
    113: '6429', # 鳥居良介
    16: '2727',  # 江夏伊織
    20: '7295',  # 前田弘樹
    138: '7376', # YOO BRANDEN
    15: '5603',  # 高島徹
    98: '8880',  # 上岡(MASAKAZU KAMIOKA)
    222: '5231', # Chris Heng
    139: '2474', # Taehyun Kim
    14: '0323',  # 川島あいか
    66: '1099',  # 矢倉孝二
    141: '5113', # KIM KWANGHO
    52: '2874',  # 吉田淳一
    30: '3838',  # 狩野善友
    142: '0309', # PARK WHUI JUNG
    223: '8666', # Danny Ng
    43: '1931',  # 金子城治
    2: '5151',   # 鮎川泰之
    23: '6967',  # 高山実由紀
    68: '2911',  # 藤本浩明
    186: '5301', # Mun Dagyeong
    4: '6192',   # 金澤嘉宏
    62: '7764',  # 金陽信
    59: '2401',  # 鍋島祥郎
    164: '3413', # Alex Liu
    194: '2096', # Choijaehyuk
    12: '0171',  # 忍足幸三
    108: '0808', # 大畠英樹
    54: '5318',  # 藤本英子
    152: '4691', # Kit Chan
    90: '6076',  # 栗崎由子
    85: '7433',  # 田上睦深
    28: '6304',  # 横山寛
    217: '3030', # Chae won Yoon
    155: '8362', # Fannie Lo
    120: '6168', # 北出明日香
    13: '7001',  # 宮崎豊久
    103: '3109', # 松本大成
    102: '9845', # 安紗弥香
    24: '0853',  # 兵頭克典
    38: '0501',  # 兼城哲也
    75: '7507',  # 岡健一
    117: '1425', # 笠原麻紀
    128: '1219', # 加藤千映子
    78: '0709',  # 石川望美
    127: '5758', # 新郷和典
    56: '9837',  # 新坂和彦
    10: '8040',  # タケダ梨花
    95: '6482',  # 大久保賢治
    112: '9353', # ハンフリィス陽子
    91: '7751',  # 勝野高儀
    159: '1067', # Haydn Lau
    84: '7849',  # 武藤貴宏
    9: '9535',   # 横山禎
    221: '5758', # Oyuntsetseg
    220: '5538', # Sosnowicz
    27: '2041',  # Shigeru Toyomasa
    173: '5155', # Hyodock Lee
    34: '2234',  # 中村光輝
    107: '4033', # 吉元大
    3: '5819',   # 木皿真人
    193: '5130', # Phyllis Lee
    39: '9489',  # 岡村弥生
    180: '3527', # Kimchunhwa
    53: '7703',  # 加藤博子
    143: '0109', # Tammy Sun
    70: '4988',  # 田下翔太
    148: '3391', # Benny Li
    153: '4766', # Ringo Lee
    160: '2866', # Yvonne Choi
    73: '6206',  # 菅原達郎
    208: '5145', # Gallant Chan
    105: '9966', # 深野裕之
    168: '4688', # Jack Lam
    47: '7559',  # 長阪健久
    187: '9390', # Madlax Ho
    147: '8106', # Felix Poon
    206: '5374', # Nicky Wai
    163: '7752', # Fanny Chan
    207: '5120', # Jason Chan
    31: '0005',  # toshiyuki terao
    55: '1606',  # 冨永恵一郎
    101: '5779', # 木村誠之
    51: '5044',  # 小瀬勇太
    35: '1941',  # 岡優治
    89: '9022',  # 鴇田英将
    111: '0720', # John Zendano
    79: '4935',  # 大西弘恵
    116: '3814', # 伊藤梢
    114: '8676', # 中島雅美
    118: '9080', # 多久島逸平
    21: '0959',  # 内田真次
    60: '9452',  # 桔梗
    224: '2252', # Hsu Yilunh
    209: '8908', # 伏原健一郎
    129: '0274', # 栗原愛
    228: '5323', # Robin Chong
    229: '8099', # Tyra Tan
    166: '3630', # Jan din (master row 166)
    161: '8872', # Fanny Chung
    165: '8800', # Derek Lai
    156: '9110', # Eric Wan
    203: '9431', # Jess Cheng
    232: '2768', # Jennifer Yeung
}

# 6パワーチーム再定義（具体化）
POWER_TEAMS = [
    {
        'name': '住まい・暮らしまるごと相談チーム',
        'name_en': 'Home & Life Total Support',
        'industries': ['不動産売買', '不動産賃貸・管理', 'リフォーム・リノベーション', 'インテリア・内装',
                       '外構・エクステリア', '建築設計・施工', '電気・設備工事', '生命保険',
                       'ファイナンシャルプランナー', '行政書士', '司法書士', '融資・資金調達'],
        'synergy': '住宅購入・リフォーム・保険・税務・施工までを「暮らし丸ごと」で支える専門家集団。家を起点に紹介の連鎖が生まれる',
    },
    {
        'name': '中小企業の経営参謀チーム',
        'name_en': 'SME Strategic Advisor',
        'industries': ['経営コンサルティング', '人材・組織コンサルティング', '人材紹介・派遣',
                       '税理士・会計士', '社会保険労務士', '中小企業診断士', '弁護士',
                       'AI・DX支援', '研修・セミナー', 'コーチング'],
        'synergy': '経営者の悩みに横断的に応える士業×コンサル×AI/DXの参謀チーム。資金・人事・法務・DXを一気通貫で提案',
    },
    {
        'name': '食×文化×グローバル発信チーム',
        'name_en': 'Food, Culture & Global',
        'industries': ['食品製造・販売', '飲食店経営', 'ケータリング・仕出し', '語学・翻訳'],
        'synergy': '日本の食・文化・伝統工芸を世界へ届けるグローバルチーム。インバウンド×アウトバウンド両軸で互いの顧客を共有',
    },
    {
        'name': 'ブランド戦略エキスパート集団',
        'name_en': 'Brand Strategy Experts',
        'industries': ['Web制作・デザイン', 'システム開発', 'IT機器・サポート',
                       'グラフィックデザイン', '写真・映像', 'ライティング・編集', '印刷・出版',
                       '広告・PR'],
        'synergy': '企業のブランドを多角的に魅せるクリエイティブ連合。Web・デザイン・PR・映像・印刷で一貫した世界観を構築',
    },
    {
        'name': '美と健康のラグジュアリーチーム',
        'name_en': 'Beauty & Wellness Luxury',
        'industries': ['美容室・ヘアサロン', 'エステ・リラクゼーション', '整体・鍼灸・接骨',
                       '医療・クリニック', '歯科', 'パーソナルトレーニング'],
        'synergy': '富裕層・女性顧客の「美と健康」を総合提案。美容・医療・ウェルネスの相互紹介で顧客の生涯価値を最大化',
    },
    {
        'name': '人生に寄り添うライフパートナー',
        'name_en': 'Lifestyle Partners',
        'industries': ['投資・資産運用', 'ペット関連', '自動車販売・整備', '冠婚葬祭',
                       '学習塾・スクール', 'その他'],
        'synergy': '結婚・教育・ペット・資産形成・冠婚葬祭——人生の節目に必要な専門家がそろう生涯パートナー連合',
    },
]

def calculate_disc(q7, q8, q9):
    scores = {'D': 0, 'I': 0, 'S': 0, 'C': 0}
    answers = [(q7, 'Q7'), (q8, 'Q8'), (q9, 'Q9')]
    for ans, _ in answers:
        t = ANSWER_MAP.get(ans.upper())
        if t:
            scores[t] += 1
    def first_appearance(t):
        for i, (a, _) in enumerate(answers):
            if ANSWER_MAP.get(a.upper()) == t:
                return i
        return 99
    sorted_types = sorted(scores.items(), key=lambda x: (-x[1], first_appearance(x[0])))
    main = sorted_types[0][0]
    sub = sorted_types[1][0]
    is_pure = (sorted_types[0][1] - sorted_types[1][1]) >= 2
    sub_final = main if is_pure else sub
    LABELS = {
        'DD':'炎','DI':'炎風','ID':'風炎','II':'風',
        'IS':'風大地','SI':'大地風','SS':'大地','SC':'大地水',
        'CS':'水大地','CC':'水','CD':'水炎','DC':'炎水',
    }
    NAMES = {'D':'炎','I':'風','S':'大地','C':'水'}
    EMOJI = {'D':'🔥','I':'🌀','S':'🌿','C':'💧'}
    CSS = {'D':'fire','I':'wind','S':'earth','C':'water'}
    label = LABELS.get(main + sub_final, NAMES[main])
    return {'main': main, 'sub': sub_final, 'label': label,
            'emoji': EMOJI[main], 'css': CSS[main], 'scores': scores}

def find_power_team(industry):
    for i, pt in enumerate(POWER_TEAMS):
        if industry in pt['industries']:
            return i
    return 5

# 回答者処理（master_row=Noneは除外）
respondents = []
for r in RESPONDENTS:
    name, chap, cat, ind, q7, q8, q9, master_row = r
    if master_row is None:
        continue  # 未マッチ除外
    disc = calculate_disc(q7, q8, q9)
    pt_idx = find_power_team(ind)
    phone = PHONE_LAST4.get(master_row, '')
    respondents.append({
        'name': name, 'chapter': chap, 'category': cat,
        'industry': ind, 'industry_group': INDUSTRY_GROUPS.get(ind, 'その他'),
        'q7': q7, 'q8': q8, 'q9': q9,
        'disc_main': disc['main'], 'disc_sub': disc['sub'],
        'disc_label': disc['label'], 'disc_emoji': disc['emoji'],
        'disc_css': disc['css'],
        'master_row': master_row,
        'powerteam_idx': pt_idx,
        'phone': phone,
        'is_responded': True,
    })

# 未回答処理
unanswered_list = []
for u in UNANSWERED:
    region, surname, given, country, ticket, master_row = u
    full_name = f"{surname} {given}".strip() if given else surname
    unanswered_list.append({
        'name': full_name, 'chapter': region, 'category': '',
        'industry': '', 'industry_group': '',
        'q7': '', 'q8': '', 'q9': '',
        'disc_main': '', 'disc_sub': '', 'disc_label': '未診断',
        'disc_emoji': '❓', 'disc_css': '',
        'master_row': master_row,
        'country': country, 'ticket': ticket,
        'phone': '',
        'is_responded': False,
    })

print(f"回答者(マッチ済): {len(respondents)} / 未回答: {len(unanswered_list)}", file=sys.stderr)

# 6パワーチームに振り分け
pt_groups = [[] for _ in range(6)]
for p in respondents:
    pt_groups[p['powerteam_idx']].append(p)

print(f"初期パワーチーム配分: {[len(g) for g in pt_groups]}", file=sys.stderr)

# サイズ調整
def rebalance(groups, target_max=20, target_min=15):
    for _ in range(50):
        sizes = [len(g) for g in groups]
        max_idx = sizes.index(max(sizes))
        min_idx = sizes.index(min(sizes))
        if sizes[max_idx] <= target_max and sizes[min_idx] >= target_min:
            break
        if not groups[max_idx]:
            break
        groups[min_idx].append(groups[max_idx].pop())
    return groups

pt_groups = rebalance(pt_groups, 20, 15)
print(f"調整後配分: {[len(g) for g in pt_groups]}", file=sys.stderr)

# 各グループを2テーブルに分割（DI/SCバランス）
def split_table_by_disc(group):
    di_members = [m for m in group if m['disc_main'] in ('D', 'I')]
    sc_members = [m for m in group if m['disc_main'] in ('S', 'C')]
    table_a, table_b = [], []
    for i, m in enumerate(di_members):
        (table_a if i % 2 == 0 else table_b).append(m)
    for i, m in enumerate(sc_members):
        (table_a if i % 2 == 0 else table_b).append(m)
    return table_a, table_b

groups = []
for i, pt_grp in enumerate(pt_groups):
    table_a, table_b = split_table_by_disc(pt_grp)
    pt = POWER_TEAMS[i]
    bal = {'D': 0, 'I': 0, 'S': 0, 'C': 0}
    for m in pt_grp:
        bal[m['disc_main']] += 1
    groups.append({
        'group_number': i + 1,
        'group_name': pt['name'],
        'group_name_en': pt['name_en'],
        'synergy_reason': pt['synergy'],
        'disc_balance': bal,
        'tables': [
            {'table_number': i*2+1, 'members': table_a},
            {'table_number': i*2+2, 'members': table_b},
        ],
    })

# 未回答者を5グループ × 2テーブルに分散
unanswered_sorted = sorted(unanswered_list, key=lambda p: (p['chapter'], p['name']))
NUM_UNANS_TABLES = 10
unans_tables = [[] for _ in range(NUM_UNANS_TABLES)]
direction = 1
idx = 0
for m in unanswered_sorted:
    unans_tables[idx].append(m)
    idx += direction
    if idx >= NUM_UNANS_TABLES: idx = NUM_UNANS_TABLES - 1; direction = -1
    elif idx < 0: idx = 0; direction = 1

UNANS_NAMES = [
    ('交流テーブル ① 出会いの扉', 'Connection 1'),
    ('交流テーブル ② 国境を越えて', 'Connection 2'),
    ('交流テーブル ③ 日本の宝', 'Connection 3'),
    ('交流テーブル ④ アジアブリッジ', 'Connection 4'),
    ('交流テーブル ⑤ ビジネスチャンス発掘', 'Connection 5'),
]
for i in range(5):
    a, b = unans_tables[i*2], unans_tables[i*2+1]
    bal = {'D': 0, 'I': 0, 'S': 0, 'C': 0}
    groups.append({
        'group_number': 6 + i + 1,
        'group_name': UNANS_NAMES[i][0],
        'group_name_en': UNANS_NAMES[i][1],
        'synergy_reason': 'まだアンケート未回答の方々のテーブル。当日の自然な交流から新しいビジネスチャンスを発見してください',
        'disc_balance': bal,
        'tables': [
            {'table_number': 12 + i*2 + 1, 'members': a},
            {'table_number': 12 + i*2 + 2, 'members': b},
        ],
    })

# 検証ログ
print("\n=== 22テーブル最終配分 ===", file=sys.stderr)
for g in groups:
    total = sum(len(t['members']) for t in g['tables'])
    bal = g['disc_balance']
    bal_str = f"D{bal['D']} I{bal['I']} S{bal['S']} C{bal['C']}" if any(bal.values()) else '未診断'
    sizes = '+'.join(str(len(t['members'])) for t in g['tables'])
    print(f"G{g['group_number']:2d} {g['group_name'][:25]:25} 計{total:2d}名 ({sizes}) {bal_str}", file=sys.stderr)

# JSON出力
print(json.dumps({
    'groups': groups,
    'stats': {
        'total_participants': sum(len(t['members']) for g in groups for t in g['tables']),
        'total_groups': len(groups),
        'responded': len(respondents),
        'unanswered': len(unanswered_list),
    },
    'generated_at': '2026-04-27T22:00:00Z',
}, ensure_ascii=False))
