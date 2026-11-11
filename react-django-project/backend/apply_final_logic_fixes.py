import os

file_path = r'c:\reactjs\react-django-project\backend\users\views.py'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Fix ICDStats in team_quality_api
# From:
# JOIN codings co ON co.chart_id = b.chart_id
# WHERE co.dxcode IS NOT NULL 
# AND co.dxcode != ''
# To:
# JOIN dx_entries dx ON dx.chart_id = b.chart_id
# WHERE dx.dxcode IS NOT NULL AND dx.dxcode != ''

old_icd_dashboard = """                    COUNT(co.id) as total_icd
                FROM BaseAudit b
                JOIN codings co ON co.chart_id = b.chart_id
                WHERE co.dxcode IS NOT NULL 
                AND co.dxcode != ''"""

new_icd_dashboard = """                    COUNT(dx.id) as total_icd
                FROM BaseAudit b
                JOIN dx_entries dx ON dx.chart_id = b.chart_id
                WHERE dx.dxcode IS NOT NULL 
                AND dx.dxcode != ''"""

content = content.replace(old_icd_dashboard, new_icd_dashboard)

# 2. Fix ICDStats in export_team_quality_api summary query
old_icd_export = """                    COUNT(co.id) as total_icd
                FROM BaseAudit b
                JOIN codings co ON co.chart_id = b.chart_id
                WHERE co.dxcode IS NOT NULL AND co.dxcode != ''"""

new_icd_export = """                    COUNT(dx.id) as total_icd
                FROM BaseAudit b
                JOIN dx_entries dx ON dx.chart_id = b.chart_id
                WHERE dx.dxcode IS NOT NULL AND dx.dxcode != ''"""

content = content.replace(old_icd_export, new_icd_export)

# 3. Escape % in Quality column alias
content = content.replace("as [Quality %]", "as [Quality %%]")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Logic and escaping fixes applied.")
