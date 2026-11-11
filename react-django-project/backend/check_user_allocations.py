import os
import django
import json
from django.db import connection

# Setup Django environment
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

def query_db():
    user_id = 'MLV1212'
    report = {"user_id": user_id, "projects": []}
    with connection.cursor() as cursor:
        cursor.execute("SELECT DISTINCT project, subproject FROM project_pdfs")
        for p, s in cursor.fetchall():
            cursor.execute("SELECT COUNT(*) FROM project_pdfs WHERE project = %s AND subproject = %s", (p, s))
            tot = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(DISTINCT pdf_path) FROM codings WHERE project = %s AND subproject = %s AND user_id = %s", (p, s, user_id))
            usr = cursor.fetchone()[0]
            report["projects"].append({
                "project": p,
                "subproject": s,
                "total": tot,
                "user_allocated": usr,
                "full": tot == usr and tot > 0
            })

        cursor.execute("SELECT chart_id, project, subproject, chart_status FROM codings WHERE user_id = %s AND (chart_status = 'Allocated' OR chart_status IS NULL)", (user_id,))
        report["active_allocations"] = [
            {"chart_id": r[0], "project": r[1], "subproject": r[2], "status": r[3]}
            for r in cursor.fetchall()
        ]
    
    with open("report_mlv1212.json", "w") as f:
        json.dump(report, f, indent=4)
    print("Report saved to report_mlv1212.json")

if __name__ == "__main__":
    query_db()
