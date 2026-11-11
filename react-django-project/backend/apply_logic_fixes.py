import os
import re

file_path = r'c:\reactjs\react-django-project\backend\users\views.py'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Refactor CodingsUnion (Remove auditor entries) - Standardize to only codings table
# Pattern for CodingsUnion that has project_pdf_id, user_id, etc.
# Note: Some versions have project_pdf_id, others have from_date, created_at too.

# Case 1: Simple CodingsUnion (team_quality_api and export summary)
content = content.replace(
    """            CodingsUnion AS (
                SELECT chart_id, user_id, project, subproject, project_pdf_id FROM codings
                UNION ALL
                SELECT aa.chart_id, aa.auditor_id as user_id, aa.project, aa.subproject, c.project_pdf_id FROM audit_allocations aa LEFT JOIN codings c ON c.chart_id = aa.chart_id
            ),""",
    """            CodingsUnion AS (
                SELECT chart_id, user_id, project, subproject, project_pdf_id FROM codings
            ),"""
)

# Case 2: CodingsUnion with dates (export audit/error log sheets)
content = content.replace(
    """            CodingsUnion AS (
                SELECT chart_id, user_id, project, subproject, project_pdf_id, from_date, created_at FROM codings
                UNION ALL
                SELECT aa.chart_id, aa.auditor_id as user_id, aa.project, aa.subproject, c.project_pdf_id, aa.from_date, aa.created_at FROM audit_allocations aa LEFT JOIN codings c ON c.chart_id = aa.chart_id
            ),""",
    """            CodingsUnion AS (
                SELECT chart_id, user_id, project, subproject, project_pdf_id, from_date, created_at FROM codings
            ),"""
)

# Also handle potential variance in whitespaces/line breaks for Step 308/309 (user edits)
content = content.replace(
    """            CodingsUnion AS (
                SELECT chart_id, user_id, project, subproject, project_pdf_id, from_date, created_at FROM codings
                UNION ALL
                SELECT aa.chart_id, aa.auditor_id as user_id,  aa.project, aa.subproject, c.project_pdf_id, aa.from_date, aa.created_at FROM audit_allocations aa LEFT JOIN codings c ON c.chart_id = aa.chart_id
            ),""",
    """            CodingsUnion AS (
                SELECT chart_id, user_id, project, subproject, project_pdf_id, from_date, created_at FROM codings
            ),"""
)

# 2. Refactor ICDStats in export_team_quality_api
# Summary sheet ICDStats
old_icd_summary = """            ICDStats AS (
                SELECT b.user_employee_id, b.project, b.subproject, b.activity_date_val,
                    COUNT(dx.id) as total_icd
                FROM BaseAudit b
                JOIN DXUnion dx ON dx.chart_id = b.chart_id
                WHERE dx.dxcode IS NOT NULL AND dx.dxcode != ''
                GROUP BY b.user_employee_id, b.project, b.subproject, b.activity_date_val
            ),"""
new_icd_summary = """            ICDStats AS (
                SELECT b.user_employee_id, b.project, b.subproject, b.activity_date_val,
                    COUNT(co.id) as total_icd
                FROM BaseAudit b
                JOIN codings co ON co.chart_id = b.chart_id
                WHERE co.dxcode IS NOT NULL AND co.dxcode != ''
                GROUP BY b.user_employee_id, b.project, b.subproject, b.activity_date_val
            ),"""
content = content.replace(old_icd_summary, new_icd_summary)

# 3. Refactor DXUnion column names in export_team_quality_api (if id missing)
# Handled by previous apply_sql_fixes.py mostly, but good to ensure consistency.

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Logic fixes applied.")
