#!/usr/bin/env python3
"""v3_result.json → screen.html用 REAL_DATA + スプシ用配列"""
import json, sys, os
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(SCRIPT_DIR, 'v3_result.json')) as f:
    data = json.load(f)

# === REAL_DATA (HTML用) ===
real_data = {
    'groups': [],
    'serendipity_group': None,
    'stats': data['stats'],
    'generated_at': data['generated_at'],
}

mid = 1
for g in data['groups']:
    grp = {
        'group_number': g['group_number'],
        'group_name': g['group_name'],
        'group_name_en': g.get('group_name_en', ''),
        'disc_balance': g['disc_balance'],
        'synergy_reason': g['synergy_reason'],
        'tables': [],
    }
    for t in g['tables']:
        tbl = {'table_number': t['table_number'], 'members': []}
        for m in t['members']:
            tbl['members'].append({
                'id': mid,
                'name': m['name'],
                'chapter': m['chapter'],
                'industry': m.get('industry', ''),
                'category': m.get('category', ''),
                'disc_main': m.get('disc_main', ''),
                'disc_sub': m.get('disc_sub', ''),
                'disc_label': m.get('disc_label', '未診断'),
                'disc_emoji': m.get('disc_emoji', '❓'),
                'disc_css': m.get('disc_css', ''),
                'phone': m.get('phone', ''),
            })
            mid += 1
        grp['tables'].append(tbl)
    real_data['groups'].append(grp)

os.makedirs(os.path.join(SCRIPT_DIR, 'v3'), exist_ok=True)
with open(os.path.join(SCRIPT_DIR, 'v3/real_data.json'), 'w') as f:
    json.dump(real_data, f, ensure_ascii=False)

# === スプシ用 ===
matching = [['グループ番号', 'グループ名', 'テーブル番号', 'ID', '氏名',
             'チャプター', '業種', '業種グループ', 'カテゴリー',
             '電話番号(下4桁)', 'DISCメイン', 'DISCサブ', 'DISCラベル', 'シナジー理由']]
mid2 = 1
for g in data['groups']:
    for t in g['tables']:
        for m in t['members']:
            matching.append([
                str(g['group_number']), g['group_name'], str(t['table_number']), str(mid2),
                m['name'], m['chapter'], m.get('industry', '') or '',
                m.get('industry_group', '') or '', m.get('category', '') or '',
                m.get('phone', '') or '',
                m.get('disc_main', '') or '', m.get('disc_sub', '') or '',
                m.get('disc_label', '') or '未診断', '',
            ])
            mid2 += 1

with open(os.path.join(SCRIPT_DIR, 'v3/matching.json'), 'w') as f:
    json.dump(matching, f, ensure_ascii=False)

# グループ一覧
groups_sheet = [['グループ番号', 'グループ名', '総人数', 'テーブルA人数', 'テーブルB人数',
                 'D(炎)', 'I(風)', 'S(大地)', 'C(水)', 'シナジー理由']]
for g in data['groups']:
    bal = g['disc_balance']
    t_a = len(g['tables'][0]['members']) if len(g['tables']) > 0 else 0
    t_b = len(g['tables'][1]['members']) if len(g['tables']) > 1 else 0
    groups_sheet.append([
        str(g['group_number']), g['group_name'], str(t_a + t_b), str(t_a), str(t_b),
        str(bal['D']), str(bal['I']), str(bal['S']), str(bal['C']),
        g['synergy_reason'],
    ])
with open(os.path.join(SCRIPT_DIR, 'v3/groups.json'), 'w') as f:
    json.dump(groups_sheet, f, ensure_ascii=False)

print(f'matching: {len(matching)} rows / groups: {len(groups_sheet)} rows / REAL_DATA: {len(real_data["groups"])} groups')
print(f'total members: {sum(len(t["members"]) for g in real_data["groups"] for t in g["tables"])}')
