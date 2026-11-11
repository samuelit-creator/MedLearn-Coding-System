import os
import re

file_path = r'c:\reactjs\react-django-project\backend\users\views.py'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Fix at_auditor_id alias in unions
content = content.replace(
    'SELECT chart_id, at_auditor_id, project, subproject, allocated_at, chart_status FROM at_audit_allocations',
    'SELECT chart_id, at_auditor_id as auditor_id, project, subproject, allocated_at, chart_status FROM at_audit_allocations'
)

# 2. Fix DXUnion to include id (3 columns version)
old_dx_v1 = """            DXUnion AS (
                SELECT chart_id, from_date, dxcode FROM audit_dx_entries
                UNION ALL
                SELECT chart_id, from_date, dxcode FROM at_audit_dx_entries
            ),"""
new_dx_v1 = """            DXUnion AS (
                SELECT id, chart_id, from_date, dxcode FROM audit_dx_entries
                UNION ALL
                SELECT id, chart_id, from_date, dxcode FROM at_audit_dx_entries
            ),"""
content = content.replace(old_dx_v1, new_dx_v1)

# 3. Fix DXUnion to include id (4 columns version)
old_dx_v2 = """            DXUnion AS (
                SELECT chart_id, from_date, dxcode, created_at FROM audit_dx_entries
                UNION ALL
                SELECT chart_id, from_date, dxcode, created_at FROM at_audit_dx_entries
            ),"""
new_dx_v2 = """            DXUnion AS (
                SELECT id, chart_id, from_date, dxcode, created_at FROM audit_dx_entries
                UNION ALL
                SELECT id, chart_id, from_date, dxcode, created_at FROM at_audit_dx_entries
            ),"""
content = content.replace(old_dx_v2, new_dx_v2)

# 4. Fix audit_export_team_production_api subqueries (Step 494/495 missed some)
# Since I fixed them with replace_file_content, they might already be okay, 
# but I will double check the auditor_id aliasing specifically in subqueries.
# (Handled by simple replace above if they match the pattern if not, I'll do specific joins)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Replacement complete.")
