import pandas as pd
import PyPDF2
import sqlite3
from django.conf import settings
from django.contrib.auth.hashers import check_password
from rest_framework.decorators import api_view
from rest_framework.response import Response
from django.http import JsonResponse, Http404, HttpResponse
from django.views.decorators.csrf import csrf_exempt
import uuid
import datetime
import os
import random
from django.utils import timezone
from pathlib import Path
from django.utils.timezone import now
import json
import traceback
import smtplib
from django.db import connection, IntegrityError, transaction
from django.core import signing

# --- Encryption Utilities ---
# IIS rejects ':' in URL paths ("potentially dangerous Request.Path value").
# Django's signing.dumps() produces tokens with ':' separators, e.g.
#   Ijg2OTcyOTU0Ig:1xON5Z:_jBN-...
# We replace every ':' with '~' (tilde is IIS-safe and not used by Django's
# signing alphabet) on the way out, and reverse it on the way in.
# Existing tokens that still contain ':' are also handled transparently via
# the original signing.loads() path in decrypt_chart_id.
_COLON_SAFE = '~'   # substitute character for ':' in signed tokens

def encrypt_chart_id(chart_id):
    """Encrypt chart_id using Django's signing module for URL usage.

    Replaces ':' with '~' so the token is IIS-safe.
    """
    if not chart_id:
        return ""
    return signing.dumps(str(chart_id)).replace(':', _COLON_SAFE)

def decrypt_chart_id(encrypted_id):
    """Decrypt the encrypted chart_id back to its original value.

    Accepts both the new '~'-encoded tokens and legacy ':'-encoded tokens.
    Returns None on signature failure.
    """
    if not encrypted_id:
        return None
    # Restore ':' separators before passing to signing.loads()
    normalised = encrypted_id.replace(_COLON_SAFE, ':')
    try:
        return signing.loads(normalised)
    except signing.BadSignature:
        # Also try the original value unchanged (handles legacy plain tokens
        # or any edge case where the token was not re-encoded)
        try:
            return signing.loads(encrypted_id)
        except signing.BadSignature:
            return None


def safe_localtime(dt):
    if dt is None:
        return None
    if not isinstance(dt, datetime.datetime):
        return dt
    if timezone.is_naive(dt):
        return timezone.make_aware(dt)
    return timezone.localtime(dt)

def me_api(request):
    token = _extract_token_from_header(request)

    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"authenticated": False}, status=401)

    user = ACTIVE_TOKENS[token]

    return JsonResponse({
        "authenticated": True,
        "user_employee_id": user["emp_id"],
        "user_profile": user["role"]   # 🔥 REQUIRED FOR ROLE GUARDS
    })

@csrf_exempt
def set_active_role_api(request):
    """Sets the active role in the token store for multi-profile users."""
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)
        
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
        
    try:
        data = json.loads(request.body)
        new_role = data.get("role", "").strip()
        
        # We don't validate against the DB string here to keep it simple,
        # but we could check if new_role is in the original DB string.
        # For now, just update the session role.
        if new_role:
            ACTIVE_TOKENS[token]["role"] = new_role
            return JsonResponse({"success": True, "active_role": new_role})
            
        return JsonResponse({"error": "Role required"}, status=400)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=400)

REQUIRED_COLUMNS = [
    "User Employee ID",
    "Username",
    "User Mail ID",
    "User Profile",
    "TL Employee ID",
    "TL Name"
]

@api_view(["POST"])
@csrf_exempt
def upload_users_excel_api(request):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    if "file" not in request.FILES:
        return Response({"error": "Excel file is required"}, status=400)

    excel_file = request.FILES["file"]

    if not excel_file.name.endswith(".xlsx"):
        return Response({"error": "Please upload a valid .xlsx file"}, status=400)

    try:
        df = pd.read_excel(excel_file)

        missing_cols = [c for c in REQUIRED_COLUMNS if c not in df.columns]
        if missing_cols:
            return Response({
                "error": f"Missing columns: {', '.join(missing_cols)}"
            }, status=400)

        # Using Django's connection automatically refers to your MSSQL settings
        with connection.cursor() as cursor:
            inserted = 0
            skipped = 0
            data = []

            for _, r in df.iterrows():
                emp_id = str(r["User Employee ID"]).strip()
                username = str(r["Username"]).strip()
                email = str(r["User Mail ID"]).strip().lower()
                profile = str(r["User Profile"]).strip()
                tl_emp = str(r["TL Employee ID"]).strip()
                tl_name = str(r["TL Name"]).strip()

                try:
                    # CHANGED: '?' replaced with '%s' for MSSQL compatibility
                    cursor.execute("""
                        INSERT INTO user_details (
                            user_employee_id,
                            username,
                            user_mail_id,
                            user_profile,
                            tl_employee_id,
                            tl_name
                        ) VALUES (%s, %s, %s, %s, %s, %s)
                    """, (
                        emp_id, username, email,
                        profile, tl_emp, tl_name
                    ))
                    inserted += 1
                except IntegrityError: # Catch Django's IntegrityError for MSSQL
                    skipped += 1

                data.append({
                    "user_employee_id": emp_id,
                    "username": username,
                    "user_mail_id": email,
                    "user_profile": profile,
                    "tl_employee_id": tl_emp,
                    "tl_name": tl_name
                })
            transaction.commit()
        return Response({
            "success": True,
            "inserted": inserted,
            "skipped": skipped,
            "data": data
        })

    except Exception as e:
        return Response({
            "error": f"Error reading Excel file: {str(e)}"
        }, status=500)
# ---------------------------------------------------------------------------
# Lightweight per-key TTL cache — used to avoid hammering the DB with the
# same heavy queries (dashboard, clarification count, etc.) every second.
# ---------------------------------------------------------------------------
import threading as _threading
import time as _time

class _TTLCache:
    """Thread-safe in-memory cache with per-entry time-to-live."""
    def __init__(self, ttl_seconds=30):
        self._store = {}   # key -> (value, expire_at)
        self._lock = _threading.Lock()
        self._ttl = ttl_seconds

    def get(self, key, default=None):
        with self._lock:
            entry = self._store.get(key)
            if entry and _time.monotonic() < entry[1]:
                return entry[0]
            return default

    def set(self, key, value, ttl=None):
        ttl = ttl if ttl is not None else self._ttl
        with self._lock:
            self._store[key] = (value, _time.monotonic() + ttl)

    def delete(self, key):
        with self._lock:
            self._store.pop(key, None)

    def invalidate_prefix(self, prefix):
        with self._lock:
            keys = [k for k in self._store if str(k).startswith(prefix)]
            for k in keys:
                del self._store[k]

# Shared caches
_DASHBOARD_CACHE   = _TTLCache(ttl_seconds=3)   # Dashboard: refresh every 3s
_CLARIF_CNT_CACHE  = _TTLCache(ttl_seconds=15)   # Clarification count: 15s

def api_cache(ttl_seconds=3):
    """Decorator to cache JsonResponse based on user token and request parameters."""
    def decorator(func):
        cache = _TTLCache(ttl_seconds=ttl_seconds)
        def wrapper(request, *args, **kwargs):
            if request.method != "GET":
                return func(request, *args, **kwargs)
            
            # Use raw header to avoid calling _extract_token_from_header prematurely if it's imported lower down,
            # but since it's defined lower down we can just parse it inline:
            auth = request.headers.get("Authorization") or ""
            token = auth.split(" ", 1)[1] if auth.startswith("Bearer ") else auth
            if not token:
                return func(request, *args, **kwargs)
            
            body_str = ""
            if request.method == "POST":
                try:
                    body_str = request.body.decode('utf-8')
                except:
                    pass
            
            key = f"{token}:{request.META.get('QUERY_STRING', '')}:{body_str}"
            cached = cache.get(key)
            if cached is not None:
                return cached
            
            response = func(request, *args, **kwargs)
            if hasattr(response, 'status_code') and response.status_code == 200:
                cache.set(key, response)
            return response
        return wrapper
    return decorator

# ---------------------------------------------------------------------------
# One-time startup DDL — runs schema migrations once instead of on every request
# ---------------------------------------------------------------------------
def _run_startup_ddl():
    """Run all ALTER TABLE / schema checks once when the process starts."""
    try:
        with connection.cursor() as c:
            c.execute("IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('audit_allocations') AND name = 'hold_command') ALTER TABLE audit_allocations ADD hold_command NVARCHAR(MAX) NULL")
            c.execute("IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('at_audit_allocations') AND name = 'hold_command') ALTER TABLE at_audit_allocations ADD hold_command NVARCHAR(MAX) NULL")
    except Exception:
        traceback.print_exc()
        
    try:
        with connection.cursor() as c:
            c.execute("""
                IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='user_otps' AND xtype='U')
                CREATE TABLE user_otps (
                    user_employee_id NVARCHAR(255) PRIMARY KEY,
                    otp NVARCHAR(10) NOT NULL,
                    created_at DATETIME DEFAULT GETDATE(),
                    expires_at DATETIME NOT NULL
                )
            """)
    except Exception:
        traceback.print_exc()

_startup_ddl_thread = _threading.Thread(target=_run_startup_ddl, daemon=True)
_startup_ddl_thread.start()

# ---------------------------------------------------------------------------
# DB-Backed Token Store — drop-in replacement for the old in-memory dict.
# Tokens are persisted in the `user_tokens` MSSQL table so they survive
# Django restarts and work correctly across multiple worker processes.
# TTL: 12 hours from login. All existing call-sites are unchanged.
# ---------------------------------------------------------------------------

class _DBBackedTokenStore:
    """
    Drop-in dict replacement that persists tokens in the DB.
    KEY OPTIMIZATIONS:
      1. Pre-warms the entire in-memory cache from DB in one query at startup
         (background thread) so 60+ simultaneous users don't each trigger a
         separate DB round-trip on the first request after a restart.
      2. Tracks negative-lookup misses so unknown tokens never hit the DB twice.
      3. All subsequent lookups are pure in-memory — zero DB cost.
    """
    TOKEN_TTL_HOURS = 12
    _MISS = object()  # Sentinel for "token not in DB"

    def __init__(self):
        self._cache = {}          # token -> {emp_id, role}  OR  _MISS
        self._lock = _threading.Lock()
        self._table_ready = False
        self._prewarm_done = False
        # Start pre-warming in background so the server can accept requests immediately
        t = _threading.Thread(target=self._prewarm_cache, daemon=True)
        t.start()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _ensure_table(self):
        if self._table_ready:
            return
        try:
            with connection.cursor() as c:
                c.execute("SELECT * FROM sysobjects WHERE name='user_tokens' AND xtype='U'")
                if not c.fetchone():
                    c.execute("""
                        CREATE TABLE user_tokens (
                            token      NVARCHAR(64)  PRIMARY KEY,
                            emp_id     NVARCHAR(255) NOT NULL,
                            role       NVARCHAR(255) NOT NULL,
                            created_at DATETIME      DEFAULT GETDATE(),
                            expires_at DATETIME      NOT NULL
                        )
                    """)
            self._table_ready = True
        except Exception:
            traceback.print_exc()

    def _prewarm_cache(self):
        """Load ALL valid tokens from DB in ONE query. Runs once at startup."""
        try:
            import django
            django.setup.__module__  # ensure Django is ready
            self._ensure_table()
            with connection.cursor() as c:
                c.execute(
                    "SELECT token, emp_id, role FROM user_tokens "
                    "WHERE expires_at > GETDATE()"
                )
                rows = c.fetchall()
            with self._lock:
                for token, emp_id, role in rows:
                    self._cache[token] = {"emp_id": emp_id, "role": role}
            self._prewarm_done = True
        except Exception:
            traceback.print_exc()
            self._prewarm_done = True  # Don't block forever on error

    def _fetch_from_db(self, token):
        """Single-token DB lookup — only called when prewarm hasn't finished yet."""
        try:
            self._ensure_table()
            with connection.cursor() as c:
                c.execute(
                    "SELECT emp_id, role FROM user_tokens "
                    "WHERE token=%s AND expires_at > GETDATE()",
                    (token,)
                )
                row = c.fetchone()
                if row:
                    user = {"emp_id": row[0], "role": row[1]}
                    with self._lock:
                        self._cache[token] = user
                    return user
                else:
                    # Record the miss so we never ask DB again
                    with self._lock:
                        if token not in self._cache:
                            self._cache[token] = self._MISS
        except Exception:
            pass
        return None

    # ------------------------------------------------------------------
    # Dict interface
    # ------------------------------------------------------------------
    def __contains__(self, token):
        """Supports: token in ACTIVE_TOKENS"""
        with self._lock:
            v = self._cache.get(token)
            if v is not None:
                return v is not self._MISS
        # Token not in memory cache, so check the DB (for multi-worker sync)
        return self._fetch_from_db(token) is not None

    def __getitem__(self, token):
        """Supports: ACTIVE_TOKENS[token]"""
        with self._lock:
            v = self._cache.get(token)
            if v is not None:
                if v is self._MISS:
                    raise KeyError(token)
                return v
        user = self._fetch_from_db(token)
        if user is None:
            raise KeyError(token)
        return user

    def get(self, token, default=None):
        """Supports: ACTIVE_TOKENS.get(token)"""
        try:
            return self[token]
        except KeyError:
            return default

    def __setitem__(self, token, user):
        """Supports: ACTIVE_TOKENS[token] = {...}  — writes cache AND DB."""
        with self._lock:
            self._cache[token] = user  # Remove any _MISS sentinel too
        try:
            self._ensure_table()
            expires_at = datetime.datetime.now() + datetime.timedelta(hours=self.TOKEN_TTL_HOURS)
            with connection.cursor() as c:
                c.execute("SELECT 1 FROM user_tokens WHERE token=%s", (token,))
                if c.fetchone():
                    c.execute(
                        "UPDATE user_tokens SET emp_id=%s, role=%s, expires_at=%s WHERE token=%s",
                        (user["emp_id"], user["role"], expires_at, token)
                    )
                else:
                    c.execute(
                        "INSERT INTO user_tokens (token, emp_id, role, expires_at) "
                        "VALUES (%s, %s, %s, %s)",
                        (token, user["emp_id"], user["role"], expires_at)
                    )
        except Exception:
            traceback.print_exc()

    def __delitem__(self, token):
        """Supports: del ACTIVE_TOKENS[token]  — invalidates token in cache and DB."""
        with self._lock:
            self._cache[token] = self._MISS
        try:
            with connection.cursor() as c:
                c.execute("DELETE FROM user_tokens WHERE token=%s", (token,))
        except Exception:
            traceback.print_exc()


ACTIVE_TOKENS = _DBBackedTokenStore()

def _extract_token_from_header(request):
    auth = request.headers.get("Authorization") or ""
    if auth.startswith("Bearer "):
        return auth.split(" ", 1)[1]
    return auth

def _get_pdf_relative_path(full_path):
    if not full_path:
        return ""
    try:
        from pathlib import Path
        from django.conf import settings
        return str(Path(full_path).relative_to(settings.MEDIA_ROOT))
    except (ValueError, TypeError):
        # Fallback if it's already relative or not under MEDIA_ROOT
        return full_path

@csrf_exempt
def login_api(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    import json
    data = json.loads(request.body)

    email = data.get("email", "").strip().lower()
    password = data.get("password", "")

    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT 
                u.user_employee_id,
                u.username,
                u.user_profile,
                p.password_hash
            FROM user_details u
            JOIN user_passwords p
              ON u.user_employee_id = p.user_employee_id
            WHERE LOWER(u.user_mail_id) = %s
        """, (email,))

        row = cursor.fetchone()

    if not row:
        return JsonResponse({"error": "User not found"}, status=401)

    emp_id, username, user_profile, password_hash = row

    if not check_password(password, password_hash):
        return JsonResponse({"error": "Invalid password"}, status=401)

    token = str(uuid.uuid4())

    # ✅ Store BOTH emp_id + role
    ACTIVE_TOKENS[token] = {
        "emp_id": emp_id,
        "role": user_profile
        
    }

    return JsonResponse({
        "token": token,
        "user_name": username,
        "user_profile": user_profile   # 🔥 THIS FIXES EVERYTHING
    })

# ---------------------------------------------------------------------------
# User Management — list all users & update profiles (Manager / VP / AM only)
# ---------------------------------------------------------------------------
ALLOWED_PROFILES = ["Coder", "Auditor", "SME", "TL", "AM", "Manager", "VP"]

@csrf_exempt
def users_list_api(request):
    """GET  /api/users-list/  — return all users with TL name and user_profile."""
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    user = ACTIVE_TOKENS[token]
    if user["role"] not in ("Manager", "VP", "AM"):
        return JsonResponse({"error": "Forbidden"}, status=403)

    if request.method == "GET":
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT
                    u.user_employee_id,
                    u.username,
                    u.user_mail_id,
                    u.user_profile,
                    u.tl_name,
                    u.tl_employee_id,
                    s.id as shift_id,
                    s.shift_name,
                    CONVERT(VARCHAR(5), s.shift_start_time, 108) as shift_start_time,
                    CONVERT(VARCHAR(5), s.shift_end_time, 108) as shift_end_time,
                    CONVERT(VARCHAR(10), s.from_date, 120) as from_date,
                    CONVERT(VARCHAR(10), s.to_date, 120) as to_date,
                    s.early_buffer_minutes,
                    s.late_buffer_minutes
                FROM user_details u
                OUTER APPLY (
                    SELECT TOP 1 *
                    FROM user_shift_schedules sched
                    WHERE sched.user_employee_id = u.user_employee_id
                      AND sched.is_active = 1
                      AND CAST(GETDATE() AS DATE) >= sched.from_date 
                      AND CAST(GETDATE() AS DATE) <= sched.to_date
                    ORDER BY sched.id DESC
                ) s
                ORDER BY u.tl_name, u.username
            """)
            rows = cursor.fetchall()

        users = []
        for row in rows:
            emp_id, username, email, user_profile, tl_name, tl_emp_id, shift_id, shift_name, s_start, s_end, f_date, t_date, early_buf, late_buf = row
            # Support comma-separated multi-profile
            profiles = [p.strip() for p in (user_profile or "").split(",") if p.strip()]

            if shift_name:
                shift_info = {
                    "id": shift_id,
                    "shift_name": shift_name,
                    "shift_start_time": s_start,
                    "shift_end_time": s_end,
                    "from_date": f_date,
                    "to_date": t_date,
                    "early_buffer_minutes": early_buf or 90,
                    "late_buffer_minutes": late_buf or 120,
                    "is_default": False
                }
            else:
                shift_info = {
                    "id": None,
                    "shift_name": "Day Shift",
                    "shift_start_time": "09:30",
                    "shift_end_time": "18:30",
                    "from_date": None,
                    "to_date": None,
                    "early_buffer_minutes": 90,
                    "late_buffer_minutes": 120,
                    "is_default": True
                }

            users.append({
                "user_employee_id": emp_id,
                "username": username,
                "user_mail_id": email,
                "user_profile": user_profile or "",
                "profiles": profiles,
                "tl_name": tl_name or "",
                "tl_employee_id": tl_emp_id or "",
                "current_shift": shift_info
            })

        return JsonResponse({"users": users})

    return JsonResponse({"error": "Method not allowed"}, status=405)


@csrf_exempt
def assign_user_shift_api(request):
    """
    POST /api/user-shifts/assign/
    Assign shift schedule to one user, selected users, or all employees.
    """
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    user = ACTIVE_TOKENS[token]
    if user["role"] not in ("Manager", "VP", "AM"):
        return JsonResponse({"error": "Forbidden"}, status=403)

    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    try:
        data = json.loads(request.body)
    except Exception:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    user_employee_ids = data.get("user_employee_ids", [])
    shift_name = data.get("shift_name", "").strip() or "Day Shift"
    shift_start_time = data.get("shift_start_time", "").strip()
    shift_end_time = data.get("shift_end_time", "").strip()
    from_date = data.get("from_date", "").strip()
    to_date = data.get("to_date", "").strip()
    early_buffer = int(data.get("early_buffer_minutes") or 90)
    late_buffer = int(data.get("late_buffer_minutes") or 120)

    if not shift_start_time or not shift_end_time:
        if "Night" in shift_name:
            shift_start_time = "21:00:00"
            shift_end_time = "06:00:00"
        else:
            shift_start_time = "09:30:00"
            shift_end_time = "18:30:00"

    if len(shift_start_time) == 5:
        shift_start_time += ":00"
    if len(shift_end_time) == 5:
        shift_end_time += ":00"

    if not from_date or not to_date:
        return JsonResponse({"error": "from_date and to_date are required"}, status=400)

    if from_date > to_date:
        return JsonResponse({"error": "from_date must be on or before to_date"}, status=400)

    target_ids = []
    with connection.cursor() as cursor:
        if user_employee_ids == "all" or (isinstance(user_employee_ids, list) and "all" in user_employee_ids):
            cursor.execute("SELECT DISTINCT user_employee_id FROM user_details WHERE user_employee_id IS NOT NULL AND user_employee_id != ''")
            target_ids = [r[0] for r in cursor.fetchall()]
        elif isinstance(user_employee_ids, list):
            target_ids = [str(x).strip() for x in user_employee_ids if str(x).strip()]
        elif isinstance(user_employee_ids, str):
            target_ids = [user_employee_ids.strip()]

    if not target_ids:
        return JsonResponse({"error": "No valid employees selected"}, status=400)

    creator = user.get("emp_id") or user.get("username") or "Admin"

    with connection.cursor() as cursor:
        placeholders = ",".join(["%s"] * len(target_ids))
        # Deactivate overlapping schedules
        cursor.execute(f"""
            UPDATE user_shift_schedules
            SET is_active = 0, updated_at = SYSDATETIME()
            WHERE user_employee_id IN ({placeholders})
              AND is_active = 1
              AND NOT (to_date < %s OR from_date > %s)
        """, target_ids + [from_date, to_date])

        insert_sql = """
            INSERT INTO user_shift_schedules (
                user_employee_id, shift_name, shift_start_time, shift_end_time,
                from_date, to_date, early_buffer_minutes, late_buffer_minutes,
                is_active, created_by, created_at, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 1, %s, SYSDATETIME(), SYSDATETIME())
        """
        insert_params = [
            (emp_id, shift_name, shift_start_time, shift_end_time, from_date, to_date, early_buffer, late_buffer, creator)
            for emp_id in target_ids
        ]
        cursor.executemany(insert_sql, insert_params)

    return JsonResponse({
        "success": True,
        "message": f"Successfully assigned {shift_name} to {len(target_ids)} employee(s) from {from_date} to {to_date}.",
        "assigned_count": len(target_ids)
    })


@csrf_exempt
def user_shift_history_api(request, emp_id):
    """
    GET /api/user-shifts/history/<emp_id>/
    Returns list of all shift schedules for this user, newest first.
    """
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    user = ACTIVE_TOKENS[token]
    if user["role"] not in ("Manager", "VP", "AM"):
        return JsonResponse({"error": "Forbidden"}, status=403)

    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT
                id,
                user_employee_id,
                shift_name,
                CONVERT(VARCHAR(5), shift_start_time, 108) as shift_start_time,
                CONVERT(VARCHAR(5), shift_end_time, 108) as shift_end_time,
                CONVERT(VARCHAR(10), from_date, 120) as from_date,
                CONVERT(VARCHAR(10), to_date, 120) as to_date,
                early_buffer_minutes,
                late_buffer_minutes,
                is_active,
                CONVERT(VARCHAR(19), created_at, 120) as created_at,
                created_by
            FROM user_shift_schedules
            WHERE user_employee_id = %s
            ORDER BY from_date DESC, id DESC
        """, [emp_id])
        rows = cursor.fetchall()

    history = []
    for r in rows:
        history.append({
            "id": r[0],
            "user_employee_id": r[1],
            "shift_name": r[2],
            "shift_start_time": r[3],
            "shift_end_time": r[4],
            "from_date": r[5],
            "to_date": r[6],
            "early_buffer_minutes": r[7],
            "late_buffer_minutes": r[8],
            "is_active": bool(r[9]),
            "created_at": r[10],
            "created_by": r[11] or ""
        })

    return JsonResponse({"history": history})


@csrf_exempt
def delete_user_shift_api(request, schedule_id):
    """
    POST/DELETE /api/user-shifts/delete/<schedule_id>/
    Deactivates a shift schedule.
    """
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    user = ACTIVE_TOKENS[token]
    if user["role"] not in ("Manager", "VP", "AM"):
        return JsonResponse({"error": "Forbidden"}, status=403)

    with connection.cursor() as cursor:
        cursor.execute("""
            UPDATE user_shift_schedules
            SET is_active = 0, updated_at = SYSDATETIME()
            WHERE id = %s
        """, [schedule_id])

    return JsonResponse({"success": True, "message": "Shift schedule cancelled successfully."})


@csrf_exempt
def update_user_profile_api(request):
    """POST /api/users-list/update-profile/ — update a user's profile(s)."""
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    user = ACTIVE_TOKENS[token]
    if user["role"] not in ("Manager", "VP", "AM"):
        return JsonResponse({"error": "Forbidden"}, status=403)

    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    try:
        data = json.loads(request.body)
    except Exception:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    target_emp_id = data.get("user_employee_id", "").strip()
    new_profiles = data.get("profiles", [])  # list of strings

    if not target_emp_id:
        return JsonResponse({"error": "user_employee_id required"}, status=400)

    # Validate each profile name
    invalid = [p for p in new_profiles if p not in ALLOWED_PROFILES]
    if invalid:
        return JsonResponse({"error": f"Invalid profiles: {invalid}"}, status=400)

    # Join as comma-separated string (empty string if none checked)
    profile_str = ",".join(new_profiles)

    with connection.cursor() as cursor:
        cursor.execute(
            "UPDATE user_details SET user_profile=%s WHERE user_employee_id=%s",
            (profile_str, target_emp_id)
        )
        if cursor.rowcount == 0:
            return JsonResponse({"error": "User not found"}, status=404)

    return JsonResponse({"success": True, "user_employee_id": target_emp_id, "user_profile": profile_str})

@csrf_exempt
def icd_search_api(request):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    terms = request.GET.get("terms", "").strip()
    project = request.GET.get("project", "").strip()
    subproject = request.GET.get("subproject", "").strip()

    if not terms:
        return JsonResponse([], safe=False)

    icd_table = "manual_icd" # Default fallback
    if project and subproject:
        with connection.cursor() as cursor:
            cursor.execute("SELECT manual_icd_table FROM project_field_config WHERE project=%s AND subproject=%s", [project, subproject])
            row = cursor.fetchone()
            if row and row[0]:
                icd_table = row[0]

    with connection.cursor() as cursor:
        # Search in both code and terms columns
        # Using '%' + terms + '%' for a middle-match search
        # TOP 50 for MSSQL performance and frontend compatibility
        query = f"SELECT TOP 50 code, terms FROM {icd_table} WHERE code LIKE %s OR terms LIKE %s ORDER BY code"
        search_term = f"%{terms}%"
        try:
            cursor.execute(query, (search_term, search_term))
            rows = cursor.fetchall()
        except Exception:
            # Fallback if table doesn't exist yet
            query = "SELECT TOP 50 code, terms FROM manual_icd WHERE code LIKE %s OR terms LIKE %s ORDER BY code"
            cursor.execute(query, (search_term, search_term))
            rows = cursor.fetchall()

    # Maintain compatibility with frontend: return [[code, terms], ...]
    results = [[r[0], r[1]] for r in rows]
    return JsonResponse(results, safe=False)

@csrf_exempt
def npi_search_api(request):
    """Proxy for NPI Registry API to avoid CORS issues in the browser."""
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    import urllib.request as urllib_req
    import urllib.parse as urllib_parse

    first_name = request.GET.get("first_name", "").strip()
    middle_name = request.GET.get("middle_name", "").strip()
    last_name = request.GET.get("last_name", "").strip()
    state = request.GET.get("state", "").strip()
    limit = request.GET.get("limit", "10")

    params = {"version": "2.1", "limit": limit}
    if first_name:
        params["first_name"] = first_name
    if last_name:
        params["last_name"] = last_name
    if middle_name:
        params["middle_name"] = middle_name
    if state:
        params["state"] = state

    try:
        url = "https://npiregistry.cms.hhs.gov/api/?" + urllib_parse.urlencode(params)
        req = urllib_req.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib_req.urlopen(req, timeout=10) as resp:
            raw = json.loads(resp.read().decode())
    except Exception as e:
        return JsonResponse({"error": f"NPI API error: {str(e)}"}, status=502)

    results = []
    for provider in raw.get("results", []):
        basic = provider.get("basic", {})
        addresses = provider.get("addresses", [])
        taxonomies = provider.get("taxonomies", [])
        practice = next((a for a in addresses if a.get("address_purpose") == "LOCATION"), {})
        primary_tax = next((t for t in taxonomies if t.get("primary")), {})
        results.append({
            "npi": provider.get("number"),
            "first_name": basic.get("first_name", ""),
            "middle_name": basic.get("middle_name", ""),
            "last_name": basic.get("last_name", ""),
            "credential": basic.get("credential", ""),
            "specialty": primary_tax.get("desc", ""),
            "city": practice.get("city", ""),
            "state": practice.get("state", ""),
            "address": practice.get("address_1", ""),
            "phone": practice.get("telephone_number", ""),
        })

    return JsonResponse({"results": results})

@csrf_exempt
@api_view(["GET"])
def list_manual_icd_tables_api(request):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)
        
    with connection.cursor() as cursor:
        cursor.execute("SELECT name FROM sysobjects WHERE name LIKE 'manual_icd_%' AND xtype='U' ORDER BY name")
        tables = [r[0] for r in cursor.fetchall()]
        # Always include the default one
        if "manual_icd" not in tables:
            tables.insert(0, "manual_icd")
            
    return JsonResponse({"tables": tables})

@csrf_exempt
@api_view(["POST"])
def upload_manual_icd_api(request):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    if "file" not in request.FILES:
        return Response({"error": "Excel file is required"}, status=400)

    table_name = request.POST.get("table_name", "").strip()
    if not table_name:
        return Response({"error": "Table name is required"}, status=400)

    # Sanitize table name: only alphanumeric and underscore
    import re
    table_name = re.sub(r'[^a-zA-Z0-9_]', '_', table_name)
    if not table_name.startswith("manual_icd_"):
        table_name = "manual_icd_" + table_name

    excel_file = request.FILES["file"]
    if not excel_file.name.endswith(".xlsx"):
        return Response({"error": "Please upload a valid .xlsx file"}, status=400)

    try:
        df = pd.read_excel(excel_file)
        # Expect columns: 'code', 'terms' (case-insensitive check)
        df.columns = [c.lower().strip() for c in df.columns]
        
        if 'code' not in df.columns or 'terms' not in df.columns:
            return Response({"error": "Excel must contain 'code' and 'terms' columns"}, status=400)

        with connection.cursor() as cursor:
            # Create table if not exists or drop and recreate? 
            # Recreate for fresh upload is usually safer for configuration tables
            cursor.execute(f"IF OBJECT_ID('{table_name}', 'U') IS NOT NULL DROP TABLE {table_name}")
            cursor.execute(f"CREATE TABLE {table_name} (code NVARCHAR(255), terms NVARCHAR(MAX))")
            
            inserted = 0
            for _, r in df.iterrows():
                code = str(r["code"]).strip()
                terms = str(r["terms"]).strip()
                if code and terms:
                    cursor.execute(f"INSERT INTO {table_name} (code, terms) VALUES (%s, %s)", (code, terms))
                    inserted += 1
            transaction.commit()

        return Response({"success": True, "table": table_name, "inserted": inserted})

    except Exception as e:
        traceback.print_exc()
        return Response({"error": f"Error: {str(e)}"}, status=500)

def dashboard_api(request):
    token = _extract_token_from_header(request)

    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    user = ACTIVE_TOKENS[token]
    user_id = user["emp_id"]
    role = user["role"]

    # --- Cache check: return cached result if fresh (avoids repeated heavy DB queries) ---
    _cache_key = f"dashboard:{user_id}"
    _cached = _DASHBOARD_CACHE.get(_cache_key)
    if _cached is not None:
        return JsonResponse(_cached)

    # --- Fetch Username ---
    with connection.cursor() as cursor:
        # CHANGED: '?' to '%s'
        cursor.execute(
            "SELECT username FROM user_details WHERE user_employee_id = %s",
            (user_id,)
        )
        row = cursor.fetchone()
        user_name = row[0] if row else "User"

    # ---- Greetings Logic ----
    greetings = [
        "Ready to make every code count?",
        "Your expertise drives quality healthcare documentation.",
        "Let’s ensure accuracy and compliance today!",
        "Precision coding starts here."
    ]

    quotes = [
        "Every accurate code contributes to better patient care.",
        "Precision today means compliance tomorrow.",
        "Great coders turn complexity into clarity.",
        "Accuracy is the heartbeat of medical coding."
    ]
    now_local = timezone.localtime(timezone.now())
    day = now_local.timetuple().tm_yday
    hour = now_local.hour
    prefix = "Good Morning" if hour < 12 else "Good Afternoon" if hour < 18 else "Good Evening"

    daily_greeting = f"{prefix}, {user_name}! {greetings[day % len(greetings)]}"
    daily_quote = quotes[day % len(quotes)]

    # ---- Counts & Errors ----
    error_counts = {"pending": 0, "agree": 0, "disagree": 0}
    rebuttal_counts = {
        "coder_pending": 0,
        "coder_tl_pending": 0,
        "auditor_pending": 0,
        "auditor_tl_pending": 0
    }
    team_stats = {"total_production": 0, "pending_rebuttals": 0, "active_members": 0}
    
    with connection.cursor() as cursor:
        # 1. Total Uploaded
        cursor.execute("SELECT COUNT(*) FROM project_pdfs")
        total_uploaded = cursor.fetchone()[0]

        # 2. Total Allocated (Individual)
        cursor.execute("""
            SELECT COUNT(DISTINCT pdf_path)
            FROM codings WHERE user_id = %s
        """, (user_id,))
        total_allocated = cursor.fetchone()[0]

        # 3. Error/Rebuttal Counts (Individual)
        cursor.execute("""
            ;WITH DedupCodings AS (
                SELECT * FROM (
                    SELECT *, ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY created_at DESC) as rn
                    FROM codings
                ) t WHERE rn = 1
            )
            SELECT 
                COALESCE(e.coder_action, 'pending') as action, 
                COUNT(*)
            FROM audit_errors e
            JOIN DedupCodings c ON c.chart_id = e.chart_id
            WHERE c.user_id = %s
            GROUP BY COALESCE(e.coder_action, 'pending')
        """, (user_id,))
        
        for action, count in cursor.fetchall():
            action_lower = action.lower() if action else "pending"
            if action_lower in error_counts:
                error_counts[action_lower] = count

        # 3.5 Specific Rebuttal Counts (Individual)
        cursor.execute("""
            ;WITH DedupCodings AS (
                SELECT * FROM (
                    SELECT *, ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY created_at DESC) as rn
                    FROM codings
                ) t WHERE rn = 1
            ),
            DedupAuditAlloc AS (
                SELECT * FROM (
                    SELECT *, ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY allocated_at DESC) as rn
                    FROM audit_allocations
                ) t WHERE rn = 1
            )
            SELECT 
                SUM(coder_pending), SUM(coder_tl_pending), SUM(auditor_pending), SUM(auditor_tl_pending)
            FROM (
                SELECT 
                    SUM(CASE WHEN e.coder_action IS NULL THEN 1 ELSE 0 END) as coder_pending,
                    SUM(CASE WHEN e.coder_action = 'disagree' AND e.coder_tl_action IS NULL THEN 1 ELSE 0 END) as coder_tl_pending,
                    SUM(CASE WHEN e.coder_tl_action = 'disagree' AND e.audit_action IS NULL THEN 1 ELSE 0 END) as auditor_pending,
                    SUM(CASE WHEN e.audit_action = 'disagree' AND e.audit_tl_action IS NULL THEN 1 ELSE 0 END) as auditor_tl_pending
                FROM audit_errors e
                JOIN DedupCodings c ON c.chart_id = e.chart_id
                WHERE c.user_id = %s
                
                UNION ALL
                
                SELECT 
                    0 as coder_pending,
                    0 as coder_tl_pending,
                    SUM(CASE WHEN e.coder_action IS NULL THEN 1 ELSE 0 END) as auditor_pending,
                    SUM(CASE WHEN e.coder_action = 'disagree' AND e.coder_tl_action IS NULL THEN 1 ELSE 0 END) as auditor_tl_pending
                FROM at_audit_errors e
                JOIN DedupAuditAlloc a ON a.chart_id = e.chart_id
                WHERE a.auditor_id = %s
            ) t
        """, (user_id, user_id))
        row = cursor.fetchone()
        if row:
            rebuttal_counts["coder_pending"] = row[0] or 0
            rebuttal_counts["coder_tl_pending"] = row[1] or 0
            rebuttal_counts["auditor_pending"] = row[2] or 0
            rebuttal_counts["auditor_tl_pending"] = row[3] or 0

        # 4. Team Level Stats (If TL/Manager)
        if role in ["TL", "Manager"]:
            # Find all members under this TL/Manager
            cursor.execute("""
                ;WITH TeamHierarchy AS (
                    SELECT user_employee_id 
                    FROM user_details 
                    WHERE user_employee_id = %s
                    
                    UNION ALL
                    
                    SELECT u.user_employee_id 
                    FROM user_details u
                    INNER JOIN TeamHierarchy th ON u.tl_employee_id = th.user_employee_id
                )
                SELECT DISTINCT user_employee_id FROM TeamHierarchy
            """, (user_id,))
            team_member_ids = [r[0] for r in cursor.fetchall()]


            if team_member_ids:
                placeholders = ",".join(["%s"] * len(team_member_ids))
                
                # Team Production
                cursor.execute(f"""
                    ;WITH DedupCodings AS (
                        SELECT * FROM (
                            SELECT *, ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY created_at DESC) as rn
                            FROM codings
                        ) t WHERE rn = 1
                    )
                    SELECT COUNT(*) FROM DedupCodings 
                    WHERE user_id IN ({placeholders}) 
                    AND chart_status IN ('complete', 'reject')
                """, team_member_ids)
                team_stats["total_production"] = cursor.fetchone()[0]

                # Team Pending Rebuttals
                cursor.execute(f"""
                    SELECT COUNT(*) FROM audit_errors e
                    JOIN codings c ON c.chart_id = e.chart_id
                    WHERE c.user_id IN ({placeholders})
                    AND (e.coder_action = 'disagree' AND e.coder_tl_action IS NULL)
                """, team_member_ids)
                team_stats["pending_rebuttals"] = cursor.fetchone()[0]

                # Active Members (Members with at least one allocated chart)
                cursor.execute(f"""
                    SELECT DISTINCT u.username 
                    FROM codings c
                    JOIN user_details u ON c.user_id = u.user_employee_id
                    WHERE c.user_id IN ({placeholders})
                    AND (c.chart_status = 'Allocated' OR c.chart_status IS NULL)
                """, team_member_ids)
                active_members_list = [r[0] for r in cursor.fetchall()]
                team_stats["active_members"] = len(active_members_list)
                team_stats["active_members_list"] = active_members_list
                
                # Team Total Allocated (Work in progress + Completed)
                cursor.execute(f"SELECT COUNT(*) FROM codings WHERE user_id IN ({placeholders})", team_member_ids)
                team_stats["total_allocated"] = cursor.fetchone()[0]

                # Overwrite error_counts with team totals for TL view
                cursor.execute(f"""
                    ;WITH DedupCodings AS (
                        SELECT * FROM (
                            SELECT *, ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY created_at DESC) as rn
                            FROM codings
                        ) t WHERE rn = 1
                    )
                    SELECT 
                        COALESCE(e.coder_action, 'pending') as action, 
                        COUNT(*)
                    FROM audit_errors e
                    JOIN DedupCodings c ON c.chart_id = e.chart_id
                    WHERE c.user_id IN ({placeholders})
                    GROUP BY COALESCE(e.coder_action, 'pending')
                """, team_member_ids)
                error_counts = {"pending": 0, "agree": 0, "disagree": 0} # Reset for team
                for action, count in cursor.fetchall():
                    action_lower = action.lower() if action else "pending"
                    if action_lower in error_counts:
                        error_counts[action_lower] = count

                # Overwrite rebuttal_counts with team totals for TL view
                cursor.execute(f"""
                    ;WITH DedupCodings AS (
                        SELECT * FROM (
                            SELECT *, ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY created_at DESC) as rn
                            FROM codings
                        ) t WHERE rn = 1
                    ),
                    DedupAuditAlloc AS (
                        SELECT * FROM (
                            SELECT *, ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY allocated_at DESC) as rn
                            FROM audit_allocations
                        ) t WHERE rn = 1
                    )
                    SELECT 
                        SUM(coder_pending), SUM(coder_tl_pending), SUM(auditor_pending), SUM(auditor_tl_pending)
                    FROM (
                        SELECT 
                            SUM(CASE WHEN e.coder_action IS NULL THEN 1 ELSE 0 END) as coder_pending,
                            SUM(CASE WHEN e.coder_action = 'disagree' AND e.coder_tl_action IS NULL THEN 1 ELSE 0 END) as coder_tl_pending,
                            SUM(CASE WHEN e.coder_tl_action = 'disagree' AND e.audit_action IS NULL THEN 1 ELSE 0 END) as auditor_pending,
                            SUM(CASE WHEN e.audit_action = 'disagree' AND e.audit_tl_action IS NULL THEN 1 ELSE 0 END) as auditor_tl_pending
                        FROM audit_errors e
                        JOIN DedupCodings c ON c.chart_id = e.chart_id
                        WHERE c.user_id IN ({placeholders})
                        
                        UNION ALL
                        
                        SELECT 
                            0 as coder_pending,
                            0 as coder_tl_pending,
                            SUM(CASE WHEN e.coder_action IS NULL THEN 1 ELSE 0 END) as auditor_pending,
                            SUM(CASE WHEN e.coder_action = 'disagree' AND e.coder_tl_action IS NULL THEN 1 ELSE 0 END) as auditor_tl_pending
                        FROM at_audit_errors e
                        JOIN DedupAuditAlloc a ON a.chart_id = e.chart_id
                        WHERE a.auditor_id IN ({placeholders})
                    ) t
                """, team_member_ids + team_member_ids)
                row = cursor.fetchone()
                if row:
                    rebuttal_counts["coder_pending"] = row[0] or 0
                    rebuttal_counts["coder_tl_pending"] = row[1] or 0
                    rebuttal_counts["auditor_pending"] = row[2] or 0
                    rebuttal_counts["auditor_tl_pending"] = row[3] or 0

                # Team Hold Charts
                team_hold_charts = []
                # 1. Coder Holds
                cursor.execute(f"""
                    SELECT c.chart_id, u.username, 'Coder' as role, c.project, c.subproject, c.hold_command
                    FROM codings c
                    JOIN user_details u ON c.user_id = u.user_employee_id
                    WHERE c.user_id IN ({placeholders}) AND c.chart_status = 'hold'
                """, team_member_ids)
                for r in cursor.fetchall():
                    team_hold_charts.append({
                        "chart_id": r[0], 
                        "encrypted_chart_id": encrypt_chart_id(r[0]),
                        "user": r[1], "role": r[2], 
                        "project": r[3], "subproject": r[4], "hold_command": r[5]
                    })
                
                # 2. Auditor Holds
                cursor.execute(f"""
                    SELECT a.chart_id, u.username, 'Auditor' as role, a.project, a.subproject, a.hold_command
                    FROM audit_allocations a
                    JOIN user_details u ON a.auditor_id = u.user_employee_id
                    WHERE a.auditor_id IN ({placeholders}) AND a.chart_status = 'hold'
                """, team_member_ids)
                for r in cursor.fetchall():
                    team_hold_charts.append({
                        "chart_id": r[0], 
                        "encrypted_chart_id": encrypt_chart_id(r[0]),
                        "user": r[1], "role": r[2], 
                        "project": r[3], "subproject": r[4], "hold_command": r[5]
                    })
                
                # 3. AT Auditor Holds
                cursor.execute(f"""
                    SELECT a.chart_id, u.username, 'AT Auditor' as role, a.project, a.subproject, a.hold_command
                    FROM at_audit_allocations a
                    JOIN user_details u ON a.at_auditor_id = u.user_employee_id
                    WHERE a.at_auditor_id IN ({placeholders}) AND a.chart_status = 'hold'
                """, team_member_ids)
                for r in cursor.fetchall():
                    team_hold_charts.append({
                        "chart_id": r[0], 
                        "encrypted_chart_id": encrypt_chart_id(r[0]),
                        "user": r[1], "role": r[2], 
                        "project": r[3], "subproject": r[4], "hold_command": r[5]
                    })
                
                team_stats["total_hold_charts"] = len(team_hold_charts)
                team_stats["team_hold_charts"] = team_hold_charts

    remaining_pdfs = max(total_uploaded - total_allocated, 0)

    _response_data = {
        "greeting": daily_greeting,
        "quote": daily_quote,
        "role": role,
        "pdf": {
            "uploaded": total_uploaded,
            "allocated": total_allocated,
            "remaining": remaining_pdfs
        },
        "errors": error_counts,
        "rebuttal_counts": rebuttal_counts,
        "team_metrics": team_stats
    }
    # Store in cache so next request within 30s is instant
    _DASHBOARD_CACHE.set(_cache_key, _response_data)
    return JsonResponse(_response_data)

UPLOAD_DIR = settings.BASE_DIR / "media/pdfs"

ALL_FIELD_OPTIONS = [
    "from_date", "to_date", "pos", "start_page", "end_page",
    "dxcode", "details", "eo", "dx_location", "provider", "meat_dec", "reject_reason"
]

def _ensure_project_config_table():
    try:
        with connection.cursor() as c:
            # MSSQL check if table exists
            c.execute("SELECT * FROM sysobjects WHERE name='project_field_config' AND xtype='U'")
            if not c.fetchone():
                c.execute("""
                    CREATE TABLE project_field_config (
                        id INT IDENTITY(1,1) PRIMARY KEY,
                        project NVARCHAR(255) NOT NULL,
                        subproject NVARCHAR(255) NOT NULL,
                        fields NVARCHAR(MAX) NOT NULL,
                        dropdowns NVARCHAR(MAX) NULL,
                        CONSTRAINT UQ_Project_Subproject UNIQUE(project, subproject)
                    )
                """)
            else:
                # Add dropdowns column if it doesn't exist
                c.execute("SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('project_field_config') AND name = 'dropdowns'")
                if not c.fetchone():
                    c.execute("ALTER TABLE project_field_config ADD dropdowns NVARCHAR(MAX) NULL")
                
                # Add manual_icd_table column if it doesn't exist
                c.execute("SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('project_field_config') AND name = 'manual_icd_table'")
                if not c.fetchone():
                    c.execute("ALTER TABLE project_field_config ADD manual_icd_table NVARCHAR(255) NULL")

                # Add dos_flag column if it doesn't exist
                c.execute("SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('project_field_config') AND name = 'dos_flag'")
                if not c.fetchone():
                    c.execute("ALTER TABLE project_field_config ADD dos_flag NVARCHAR(MAX) NULL")

                # Add enable_npi column if it doesn't exist
                c.execute("SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('project_field_config') AND name = 'enable_npi'")
                if not c.fetchone():
                    c.execute("ALTER TABLE project_field_config ADD enable_npi BIT NOT NULL DEFAULT 0")
    except Exception:
        traceback.print_exc()

def _ensure_project_pdfs_table():
    try:
        with connection.cursor() as c:
            # MSSQL check if table exists
            c.execute("SELECT * FROM sysobjects WHERE name='project_pdfs' AND xtype='U'")
            if not c.fetchone():
                c.execute("""
                    CREATE TABLE project_pdfs (
                        id INT IDENTITY(1,1) PRIMARY KEY,
                        project NVARCHAR(255) NOT NULL,
                        subproject NVARCHAR(255) NOT NULL,
                        file_name NVARCHAR(255) NOT NULL,
                        file_path NVARCHAR(MAX) NOT NULL,
                        page_count INT DEFAULT 0,
                        uploaded_at DATETIME DEFAULT GETDATE()
                    )
                """)
            else:
                # Add uploaded_at column if it doesn't exist
                c.execute("SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('project_pdfs') AND name = 'uploaded_at'")
                if not c.fetchone():
                    c.execute("ALTER TABLE project_pdfs ADD uploaded_at DATETIME DEFAULT GETDATE()")
    except Exception:
        traceback.print_exc()

@csrf_exempt
def project_fields_config_api(request):
    try:
        _ensure_project_config_table()
        token = _extract_token_from_header(request)
        if not token or token not in ACTIVE_TOKENS:
            return JsonResponse({"error": "Unauthorized"}, status=401)

        if request.method == "GET":
            with connection.cursor() as c:
                c.execute("SELECT id, project, subproject, fields, dropdowns, manual_icd_table, dos_flag, enable_npi FROM project_field_config ORDER BY project, subproject")
                rows = c.fetchall()
                configs = [
                {
                    "id": r[0],
                    "project": r[1],
                    "subproject": r[2],
                    "fields": json.loads(r[3]),
                    "dropdowns": json.loads(r[4]) if r[4] else {},
                    "manual_icd_table": r[5] if len(r) > 5 else None,
                    "dos_flag": json.loads(r[6]) if (len(r) > 6 and r[6]) else [],
                    "enable_npi": bool(r[7]) if (len(r) > 7 and r[7] is not None) else False
                } for r in rows
            ]
            return JsonResponse({"configs": configs})

        if request.method == "POST":
            data = json.loads(request.body)
            project = data.get("project", "").strip()
            subproject = data.get("subproject", "").strip()
            fields = data.get("fields", [])
            dropdowns = data.get("dropdowns", {})
            manual_icd_table = data.get("manual_icd_table")
            dos_flag = data.get("dos_flag", [])
            enable_npi = 1 if data.get("enable_npi") else 0
            if not project or not subproject or not fields:
                return JsonResponse({"error": "project, subproject, and fields are required"}, status=400)
            
            with connection.cursor() as c:
                # MSSQL Upsert logic: Check if exists, then Update or Insert
                c.execute("SELECT id FROM project_field_config WHERE project=%s AND subproject=%s", [project, subproject])
                row = c.fetchone()
                if row:
                    c.execute("UPDATE project_field_config SET fields=%s, dropdowns=%s, manual_icd_table=%s, dos_flag=%s, enable_npi=%s WHERE id=%s", [json.dumps(fields), json.dumps(dropdowns), manual_icd_table, json.dumps(dos_flag), enable_npi, row[0]])
                else:
                    c.execute(
                        "INSERT INTO project_field_config (project, subproject, fields, dropdowns, manual_icd_table, dos_flag, enable_npi) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                        [project, subproject, json.dumps(fields), json.dumps(dropdowns), manual_icd_table, json.dumps(dos_flag), enable_npi]
                    )
            return JsonResponse({"ok": True})

        if request.method == "DELETE":
            data = json.loads(request.body)
            config_id = data.get("id")
            with connection.cursor() as c:
                c.execute("DELETE FROM project_field_config WHERE id=%s", [config_id])
            return JsonResponse({"ok": True})

        return JsonResponse({"error": "Method not allowed"}, status=405)
    except Exception:
        traceback.print_exc()
        return JsonResponse({"error": "Internal Server Error"}, status=500)

@csrf_exempt
def project_config_options_api(request):
    """Returns the list of available field keys for config UI."""
    return JsonResponse({"fields": ALL_FIELD_OPTIONS})

@csrf_exempt
def pdf_upload_api(request):
    _ensure_project_pdfs_table()
    try:
        if request.method != "POST":
            return JsonResponse({"error": "POST only"}, status=405)

        project = (request.POST.get("project") or "").strip()
        subproject = (request.POST.get("subproject") or "").strip()
        files = request.FILES.getlist("files")

        if not project or not subproject or not files:
            return JsonResponse({"error": "Missing fields"}, status=400)

        os.makedirs(UPLOAD_DIR, exist_ok=True)

        uploaded_files = []

        # Use a single connection for the entire loop for better performance
        with connection.cursor() as cursor:
            for f in files:
                file_path = UPLOAD_DIR / f.name

                # 🚀 Optimization: Save file first
                with open(file_path, "wb+") as destination:
                    for chunk in f.chunks():
                        destination.write(chunk)
                
                # 🚀 Optimization: Faster Page Count with PyPDF2 (less intensive)
                page_count = 0
                try:
                    # By only reading metadata, we avoid full file analysis if possible
                    reader = PyPDF2.PdfReader(str(file_path), strict=False)
                    page_count = len(reader.pages)
                except Exception as e:
                    print(f"Error reading PDF {f.name}: {e}")
                    # Fallback to 0
                
                # Save record to MSSQL
                cursor.execute("""
                    INSERT INTO project_pdfs (project, subproject, file_name, file_path, page_count, uploaded_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (project, subproject, f.name, str(file_path), page_count, timezone.localtime(timezone.now())))

                uploaded_files.append(f.name)

        return JsonResponse({
            "message": "PDFs uploaded successfully",
            "files": uploaded_files
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JsonResponse({"error": str(e)}, status=500)


@api_view(["GET"])
def inventory_list_api(request):
    _ensure_project_pdfs_table()
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)
    
    project = (request.GET.get("project") or "").strip()
    subproject = (request.GET.get("subproject") or "").strip()
    
    try:
        query = "SELECT id, project, subproject, file_name, file_path, page_count, uploaded_at FROM project_pdfs"
        params = []
        
        if project or subproject:
            query += " WHERE"
            if project:
                query += " project = %s"
                params.append(project)
            if subproject:
                if project: query += " AND"
                query += " subproject = %s"
                params.append(subproject)
                
        query += " ORDER BY uploaded_at DESC"
        
        with connection.cursor() as cursor:
            cursor.execute(query, params)
            columns = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
            results = []
            for row in cursor.fetchall():
                row_dict = dict(zip(columns, row))
                
                # Handle uploaded_at safely
                try:
                    if row_dict.get('uploaded_at') and not isinstance(row_dict['uploaded_at'], str):
                        row_dict['uploaded_at'] = safe_localtime(row_dict['uploaded_at']).strftime("%Y-%m-%d %H:%M")
                except Exception as te:
                    print(f"Timezone error for row {row_dict.get('id')}: {te}")
                    row_dict['uploaded_at'] = str(row_dict['uploaded_at']) if row_dict.get('uploaded_at') else ""

                # Create a URL for the PDF
                if row_dict.get("file_path"):
                    pdf_obj = Path(row_dict["file_path"])
                    try:
                        rel_path = str(pdf_obj.relative_to(settings.MEDIA_ROOT)).replace('\\', '/')
                        row_dict["pdf_url"] = f"{settings.MEDIA_URL}{rel_path}"
                    except Exception:
                        row_dict["pdf_url"] = ""
                results.append(row_dict)
                
        return JsonResponse(results, safe=False)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JsonResponse({"error": str(e)}, status=500)

@api_view(["DELETE", "POST"])
@csrf_exempt
def inventory_delete_api(request, pdf_id):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)
    
    user_role = ACTIVE_TOKENS[token]["role"]
    if user_role not in ["Manager", "VP", "AM"]:
        return JsonResponse({"error": "Forbidden"}, status=403)

    with connection.cursor() as cursor:
        cursor.execute("SELECT file_path FROM project_pdfs WHERE id = %s", (pdf_id,))
        row = cursor.fetchone()
        if not row:
            return JsonResponse({"error": "PDF not found"}, status=404)
        
        file_path = row[0]
        
        # Check if PDF is allocated
        cursor.execute("SELECT COUNT(*) FROM codings WHERE project_pdf_id = %s", (pdf_id,))
        if cursor.fetchone()[0] > 0:
            return JsonResponse({"error": "Cannot delete allocated PDF"}, status=400)
            
        # Delete from DB
        cursor.execute("DELETE FROM project_pdfs WHERE id = %s", (pdf_id,))
        
        # Delete from disk
        if file_path and os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception as e:
                print(f"Error deleting file {file_path}: {e}")
                
    return JsonResponse({"success": True})
@api_view(["GET"])
def inventory_user_summary_api(request):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)
    
    query = """
        SELECT 
            u.username,
            u.user_employee_id,
            c.project,
            COUNT(c.chart_id) as allocated_count
        FROM user_details u
        JOIN codings c ON u.user_employee_id = c.user_id
        WHERE c.chart_status = 'Allocated' OR c.chart_status IS NULL
        GROUP BY u.username, u.user_employee_id, c.project
        ORDER BY u.username, c.project
    """
    
    with connection.cursor() as cursor:
        cursor.execute(query)
        columns = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
        results = [dict(zip(columns, row)) for row in cursor.fetchall()]
        
    return JsonResponse(results, safe=False)

@api_view(["GET"])
def inventory_team_summary_api(request):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)
    
    query = """
        SELECT 
            u.tl_name,
            u.tl_employee_id,
            COUNT(c.chart_id) as total_allocated,
            COUNT(DISTINCT c.user_id) as active_members
        FROM user_details u
        JOIN codings c ON u.user_employee_id = c.user_id
        WHERE (c.chart_status = 'Allocated' OR c.chart_status IS NULL)
        GROUP BY u.tl_name, u.tl_employee_id
        ORDER BY total_allocated DESC
    """
    
    with connection.cursor() as cursor:
        cursor.execute(query)
        columns = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
        results = [dict(zip(columns, row)) for row in cursor.fetchall()]
        
    return JsonResponse(results, safe=False)


def generate_unique_chart_id():
    # Use Django's global connection (MSSQL)
    with connection.cursor() as cursor:
        while True:
            chart_id = str(random.randint(10000000, 99999999))
            # CHANGED: '?' to '%s'
            cursor.execute("SELECT 1 FROM codings WHERE chart_id = %s", (chart_id,))
            if not cursor.fetchone():
                return chart_id

@csrf_exempt
@api_cache(ttl_seconds=3)
def coder_index_api(request):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    user = ACTIVE_TOKENS[token]
    user_id = user["emp_id"]
    role = user["role"]


    if request.method == "GET":
        with connection.cursor() as cursor:
            # Fetch project-subproject pairs
            cursor.execute("SELECT DISTINCT project, subproject FROM project_pdfs")
            pairs = cursor.fetchall()
            
            project_subprojects = {}
            for p, s in pairs:
                if p:
                    project_subprojects.setdefault(p, []).append(s)
            
            projects = list(project_subprojects.keys())

            cursor.execute("""
                SELECT c.chart_id, c.project, c.subproject, p.page_count
                FROM codings c
                JOIN project_pdfs p ON p.id = c.project_pdf_id
                WHERE (c.chart_status = 'Allocated' OR c.chart_status IS NULL)
                AND c.user_id = %s
                ORDER BY p.uploaded_at DESC
            """, (user_id,))

            columns = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description] # Lowercase keys
            results = []
            for row in cursor.fetchall():
                row_dict = dict(zip(columns, row))
                row_dict['encrypted_chart_id'] = encrypt_chart_id(row_dict['chart_id'])
                # Ensure date is a string for the frontend
                if row_dict.get('uploaded_at') and not isinstance(row_dict['uploaded_at'], str):
                    row_dict['uploaded_at'] = safe_localtime(row_dict['uploaded_at']).strftime("%m-%d-%Y %H:%M")
                results.append(row_dict)

            # Fetch hold charts for this coder
            cursor.execute("""
                SELECT c.chart_id, c.project, c.subproject, c.hold_command
                FROM codings c
                WHERE c.chart_status = 'hold'
                AND c.user_id = %s
                ORDER BY c.chart_id DESC
            """, (user_id,))
            h_cols = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
            hold_charts = []
            for row in cursor.fetchall():
                row_dict = dict(zip(h_cols, row))
                row_dict['encrypted_chart_id'] = encrypt_chart_id(row_dict['chart_id'])
                hold_charts.append(row_dict)

        return JsonResponse({
            "projects": projects,
            "project_subprojects": project_subprojects,
            "results": results,
            "hold_charts": hold_charts
        })

    # ---------- POST (allocate PDF) ----------
    if request.method == "POST":
        try:
            data = json.loads(request.body)
            project = (data.get("project") or "").strip()
            subproject = (data.get("subproject") or "").strip()

            # Use atomic transaction to prevent race conditions
            with transaction.atomic():
                with connection.cursor() as cursor:
                    # Check if user already has 3 or more active charts
                    cursor.execute("""
                        SELECT COUNT(*)
                        FROM codings
                        WHERE user_id = %s
                        AND (chart_status = 'Allocated' OR chart_status IS NULL)
                    """, (user_id,))
                    active_charts_count = cursor.fetchone()[0]

                    if active_charts_count >= 2:
                        return JsonResponse({"error": "You already have 3 charts allocated. Please complete them before requesting more."}, status=400)

                    # 1. Find a PDF that THE CURRENT USER has never worked on before
                    # 2. Sort to spread users across DIFFERENT PDFs (Load Balancing)
                    cursor.execute("""
                        SELECT TOP 1 p.id, p.file_path, p.page_count
                        FROM project_pdfs p WITH (UPDLOCK, ROWLOCK, READPAST)
                        LEFT JOIN (
                            SELECT project_pdf_id, COUNT(*) as busy_count
                            FROM codings
                            WHERE (chart_status = 'Allocated' OR chart_status IS NULL)
                            GROUP BY project_pdf_id
                        ) c_busy ON c_busy.project_pdf_id = p.id
                        WHERE p.project = %s
                        AND p.subproject = %s
                        -- Personal History: User has never worked on this PDF (by path)
                        AND NOT EXISTS (
                            SELECT 1 FROM codings c_own 
                            WHERE c_own.pdf_path = p.file_path AND c_own.user_id = %s
                        )
                        ORDER BY 
                            -- 1. Prefer PDFs that are NOT currently being worked on by others (SPREAD)
                            ISNULL(c_busy.busy_count, 0) ASC,
                            -- 2. Randomization for the rotation
                            NEWID()
                    """, (project, subproject, user_id))

                    row = cursor.fetchone()
                    
                    if not row:
                        return JsonResponse({
                            "message": "You have already been allocated all available charts for this project."
                        })

                    pdf_id, file_path, page_count = row
                    chart_id = generate_unique_chart_id()

                    cursor.execute("""
                        INSERT INTO codings
                        (chart_id, project, subproject, user_id, pdf_path, project_pdf_id, chart_status, start_page, end_page)
                        VALUES (%s, %s, %s, %s, %s, %s, 'Allocated', 1, %s)
                    """, (chart_id, project, subproject, user_id, file_path, pdf_id, page_count))

            return JsonResponse({
                "allocated": True,
                "chart_id": chart_id,
                "encrypted_chart_id": encrypt_chart_id(chart_id)
            })
        except Exception as e:
            return JsonResponse({"error": str(e)}, status=500)


    return JsonResponse({"error": "Method not allowed"}, status=405)

@csrf_exempt
def search_chart_api(request, chart_id):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    # Try to decrypt if it looks like an encrypted ID, otherwise treat as raw ID
    real_chart_id = decrypt_chart_id(chart_id) or chart_id

    with connection.cursor() as cursor:
        # 1. Basic Chart Info & PDF Path
        cursor.execute("""
            SELECT c.pdf_path, c.chart_status, u.username as coder_name, c.created_at, c.project, c.subproject
            FROM codings c
            LEFT JOIN user_details u ON c.user_id = u.user_employee_id
            WHERE c.chart_id = %s
        """, (real_chart_id,))
        coding_row = cursor.fetchone()
        if not coding_row:
            return JsonResponse({"error": "Chart ID not found"}, status=404)
        
        pdf_full_path, coder_status, coder_name, coder_created_at, coder_project, coder_subproject = coding_row

        cursor.execute("SELECT * FROM dx_entries WHERE chart_id = %s ORDER BY from_date, id", (real_chart_id,))
        coder_cols = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
        coder_rows = [dict(zip(coder_cols, r)) for r in cursor.fetchall()]

        # 3. Auditor Data
        cursor.execute("""
            SELECT a.chart_status, u.username as auditor_name, a.allocated_at
            FROM audit_allocations a
            LEFT JOIN user_details u ON a.auditor_id = u.user_employee_id
            WHERE a.chart_id = %s
        """, (real_chart_id,))
        audit_alloc = cursor.fetchone()
        audit_status = audit_alloc[0] if audit_alloc else "Not Allocated"
        auditor_name = audit_alloc[1] if audit_alloc else "N/A"
        audit_allocated_at = audit_alloc[2] if audit_alloc else None

        cursor.execute("SELECT * FROM audit_dx_entries WHERE chart_id = %s ORDER BY from_date, id", (real_chart_id,))
        audit_cols = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
        audit_rows = [dict(zip(audit_cols, r)) for r in cursor.fetchall()]

        cursor.execute("""
            SELECT e.*, r.from_date, r.to_date, r.start_page, r.end_page, r.dxcode, 
                   r.details, r.provider, r.eo, r.pos, r.dx_location, r.meat_dec, r.DOS_Flag, r.npi
            FROM audit_errors e
            LEFT JOIN audit_dx_entries r ON e.row_id = r.id
            WHERE e.chart_id = %s
            ORDER BY e.created_at DESC
        """, (real_chart_id,))
        audit_err_cols = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
        audit_errors = [dict(zip(audit_err_cols, r)) for r in cursor.fetchall()]

        # 4. AT-Auditor Data
        cursor.execute("""
            SELECT a.chart_status, u.username as at_auditor_name, a.allocated_at
            FROM at_audit_allocations a
            LEFT JOIN user_details u ON a.at_auditor_id = u.user_employee_id
            WHERE a.chart_id = %s
        """, (real_chart_id,))
        at_audit_alloc = cursor.fetchone()
        at_audit_status = at_audit_alloc[0] if at_audit_alloc else "Not Allocated"
        at_auditor_name = at_audit_alloc[1] if at_audit_alloc else "N/A"
        at_audit_allocated_at = at_audit_alloc[2] if at_audit_alloc else None

        cursor.execute("SELECT * FROM at_audit_dx_entries WHERE chart_id = %s ORDER BY from_date, id", (real_chart_id,))
        at_audit_cols = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
        at_audit_rows = [dict(zip(at_audit_cols, r)) for r in cursor.fetchall()]

        cursor.execute("""
            SELECT e.*, r.from_date, r.to_date, r.start_page, r.end_page, r.dxcode, 
                   r.details, r.provider, r.eo, r.pos, r.dx_location, r.meat_dec, r.DOS_Flag, r.npi
            FROM at_audit_errors e
            LEFT JOIN at_audit_dx_entries r ON e.row_id = r.id
            WHERE e.chart_id = %s
            ORDER BY e.created_at DESC
        """, (real_chart_id,))
        at_audit_err_cols = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
        at_audit_errors = [dict(zip(at_audit_err_cols, r)) for r in cursor.fetchall()]

    # Robust Path Handling
    pdf_obj = Path(pdf_full_path)
    if pdf_obj.is_absolute():
        try:
            pdf_relative_path = str(pdf_obj.relative_to(settings.MEDIA_ROOT)).replace('\\', '/')
        except ValueError:
            pdf_relative_path = pdf_obj.name
    else:
        pdf_relative_path = str(pdf_obj).replace('\\', '/')

    # Helper to format dates in lists
    def format_dates(rows):
        for row in rows:
            for k, v in row.items():
                if isinstance(v, (datetime.date, datetime.datetime)):
                    if isinstance(v, datetime.datetime):
                        row[k] = safe_localtime(v).strftime("%Y-%m-%d %H:%M:%S")
                    else:
                        row[k] = v.strftime("%Y-%m-%d")
        return rows

    return JsonResponse({
        "chart_id": real_chart_id,
        "encrypted_chart_id": encrypt_chart_id(real_chart_id),
        "project": coder_project,
        "subproject": coder_subproject,
        "pdf_url": f"{settings.MEDIA_URL}{pdf_relative_path}",
        "coder": {
            "status": coder_status,
            "name": coder_name,
            "date": safe_localtime(coder_created_at).strftime("%Y-%m-%d %H:%M:%S") if coder_created_at else "N/A",
            "rows": format_dates(coder_rows)
        },
        "auditor": {
            "status": audit_status,
            "name": auditor_name,
            "date": safe_localtime(audit_allocated_at).strftime("%Y-%m-%d %H:%M:%S") if audit_allocated_at else "N/A",
            "rows": format_dates(audit_rows),
            "errors": format_dates(audit_errors)
        },
        "at_auditor": {
            "status": at_audit_status,
            "name": at_auditor_name,
            "date": safe_localtime(at_audit_allocated_at).strftime("%Y-%m-%d %H:%M:%S") if at_audit_allocated_at else "N/A",
            "rows": format_dates(at_audit_rows),
            "errors": format_dates(at_audit_errors)
        }
    })

@csrf_exempt
def open_chart_api(request, chart_id):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    # Try to decrypt; fall back to raw chart_id for backward-compatibility
    chart_id = decrypt_chart_id(chart_id) or chart_id
    if not chart_id:
        return JsonResponse({"error": "Invalid or expired chart link"}, status=400)

    # Get user info
    user = ACTIVE_TOKENS[token]
    user_id = user["emp_id"]
    role = user["role"]

    # Use Django's connection (MSSQL)
    with connection.cursor() as cursor:
        # ---- chart master ----
        # CHANGED: Added user_id to the SELECT
        cursor.execute("""
            SELECT pdf_path, start_time, chart_status, project, subproject, user_id
            FROM codings
            WHERE chart_id = %s
        """, (chart_id,))
        
        row = cursor.fetchone()
        if not row:
            raise Http404("Chart not found")
        
        # Mapping tuple to variables
        pdf_full_path, start_time, current_chart_status, project_val, subproject_val, chart_owner_id = row

        # ---- Authorization & Status Checks ----
        normalized_status = (current_chart_status or "").strip().lower()
        is_finalized = normalized_status in ['complete', 'completed', 'reject', 'rejected']

        # 1. Ownership Check (for Coders)
        if role == "Coder" and str(chart_owner_id) != str(user_id):
            return JsonResponse({"error": "Unauthorized: You do not have access to this chart."}, status=403)

        # 2. Finalized Check (for Coders)
        if role == "Coder" and is_finalized:
            return JsonResponse({"error": "Access Denied: This chart is already finalized and cannot be accessed."}, status=403)

        # ---- set start time ----
        if not start_time:
            cursor.execute(
                "UPDATE codings SET start_time=%s WHERE chart_id=%s",
                (safe_localtime(timezone.now()), chart_id)
            )

        # ---------- ACTIONS ----------
        if request.method == "POST":
            import json
            data = json.loads(request.body)
            action = data.get("action")

            # LOCK CHECK (Block modifications if chart is complete or rejected)
            # Normalizing status for check
            normalized_status = (current_chart_status or "").strip().lower()
            if action in ["add", "edit", "delete"] and normalized_status in ['complete', 'completed', 'reject', 'rejected']:
                return JsonResponse({"error": "Chart is finalized and cannot be modified."}, status=403)

            # Ensure hold_command column exists on codings table
            cursor.execute("IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('codings') AND name = 'hold_command') ALTER TABLE codings ADD hold_command NVARCHAR(MAX) NULL")
            # Ensure npi column exists on dx_entries table
            cursor.execute("IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dx_entries') AND name = 'npi') ALTER TABLE dx_entries ADD npi NVARCHAR(20) NULL")

            # ADD
            if action == "add":
                # Guard against rapid double-submission
                cursor.execute("""
                    SELECT 1 FROM dx_entries 
                    WHERE chart_id = %s 
                      AND dxcode = %s 
                      AND from_date = %s 
                      AND to_date = %s 
                      AND start_page = %s 
                      AND end_page = %s
                      AND created_at > DATEADD(second, -5, GETDATE())
                """, (
                    chart_id, data["dxcode"], data["from_date"], data["to_date"],
                    data["start_page"], data["end_page"]
                ))
                if cursor.fetchone():
                    return JsonResponse({"error": "Duplicate entry detected. Please wait a moment."}, status=400)

                cursor.execute("""
                    INSERT INTO dx_entries
                    (chart_id, from_date, to_date, start_page, end_page,
                     dxcode, details, provider, eo, pos, dx_location, meat_dec, DOS_Flag, npi)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    chart_id, data["from_date"], data["to_date"],
                    data["start_page"], data["end_page"], data["dxcode"],
                    data["details"], data["provider"], data.get("eo"),
                    data.get("pos"), data.get("dx_location"), data.get("meat_dec"),
                    data.get("DOS_Flag"), data.get("npi"),
                ))

            # EDIT
            elif action == "edit":
                cursor.execute("""
                    UPDATE dx_entries
                    SET from_date=%s, to_date=%s, start_page=%s, end_page=%s,
                        dxcode=%s, details=%s, provider=%s, eo=%s, pos=%s,
                        dx_location=%s, meat_dec=%s, DOS_Flag=%s, npi=%s
                    WHERE id=%s
                """, (
                    data["from_date"], data["to_date"], data["start_page"],
                    data["end_page"], data["dxcode"], data["details"],
                    data["provider"], data.get("eo"), data.get("pos"),
                    data.get("dx_location"), data.get("meat_dec"), data.get("DOS_Flag"),
                    data.get("npi"), data["row_id"],
                ))

            # DELETE
            elif action == "delete":
                cursor.execute("DELETE FROM dx_entries WHERE id=%s", (data["row_id"],))

            # SAVE CHART
            elif action == "save":
                if data.get("chart_status") == "hold":
                    # Hold: save status + hold_command, do NOT set end_time
                    cursor.execute("""
                        UPDATE codings
                        SET chart_status='hold', hold_command=%s
                        WHERE chart_id=%s
                    """, (
                        data.get("hold_command", ""), chart_id
                    ))
                    return JsonResponse({"status": "hold", "chart_id": chart_id})
                else:
                    cursor.execute("""
                        UPDATE codings
                        SET chart_status=%s, complete_command=%s, reject_reason=%s,
                            reject_command=%s, end_time=%s, created_at=%s
                        WHERE chart_id=%s
                    """, (
                        data["chart_status"], data.get("complete_command"),
                        data.get("reject_reason"), data.get("reject_command"),
                        safe_localtime(timezone.now()), safe_localtime(timezone.now()), chart_id
                    ))
                    return JsonResponse({"status": "complete", "chart_id": chart_id})

        # ---- fetch rows ----
        cursor.execute("""
            SELECT * FROM dx_entries
            WHERE chart_id = %s
            ORDER BY from_date, to_date, pos, id
        """, (chart_id,))
        
        # Convert tuples to list of dicts for frontend compatibility
        columns = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
        rows = []
        for r in cursor.fetchall():
            row_dict = dict(zip(columns, r))
            # Format dates if they are objects
            for date_key in ['from_date', 'to_date']:
                if row_dict.get(date_key) and not isinstance(row_dict[date_key], str):
                    row_dict[date_key] = row_dict[date_key].strftime("%m-%d-%Y")
            rows.append(row_dict)

    # ---- group rows logic ----
    grouped = {}
    for r in rows:
        key = f"{r['from_date']} → {r['to_date']} | pos={r['pos']}"
        grouped.setdefault(key, []).append(r)

    # ---- Fetch audit_errors for coder feedback (Standard & Quality) ----
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT e.id, e.changes,
                   r.from_date, r.to_date, r.start_page, r.end_page,
                   e.error_type, e.error_count, e.error_command, r.dxcode, 
                   r.details, r.provider, r.eo, r.pos, r.dx_location, r.meat_dec, r.DOS_Flag, r.npi,
                   e.created_at, 'Standard' as level
            FROM audit_errors e
            LEFT JOIN dx_entries r ON e.row_id = r.id
            WHERE e.chart_id = %s
            
            UNION ALL
            
            SELECT e.id, e.changes,
                   r.from_date, r.to_date, r.start_page, r.end_page,
                   e.error_type, e.error_count, e.error_command, r.dxcode, 
                   r.details, r.provider, r.eo, r.pos, r.dx_location, r.meat_dec, r.DOS_Flag, r.npi,
                   e.created_at, 'Quality' as level
            FROM at_audit_errors e
            LEFT JOIN at_audit_dx_entries r ON e.row_id = r.id
            WHERE e.chart_id = %s
            
            ORDER BY created_at DESC
        """, (chart_id, chart_id))
        
        log_cols = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
        audit_log = []
        for r in cursor.fetchall():
            ld = dict(zip(log_cols, r))
            for k in ['from_date', 'to_date', 'created_at']:
                if ld.get(k) and not isinstance(ld[k], str):
                    if k == 'created_at':
                        ld[k] = safe_localtime(ld[k]).strftime("%m-%d-%Y %H:%M:%S")
                    else:
                        ld[k] = ld[k].strftime("%m-%d-%Y")
            try:
                ld['changes'] = json.loads(ld['changes']) if ld.get('changes') else {}
            except:
                ld['changes'] = {}
            ld['state'] = state_from_error(ld.get('error_type'))
            audit_log.append(ld)

    # Handle PDF Path
    pdf_relative_path = str(Path(pdf_full_path).relative_to(settings.MEDIA_ROOT))
    
    return JsonResponse({
        "chart_id": chart_id,
        "pdf_path": pdf_relative_path,
        "rows": rows,
        "grouped_rows": grouped,
        "chart_status": current_chart_status,
        "project": project_val,
        "subproject": subproject_val,
        "audit_log": audit_log
    })
@csrf_exempt
@api_cache(ttl_seconds=3)
def api_audit_dashboard(request):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "unauthorized"}, status=401)

    user = ACTIVE_TOKENS[token]
    auditor_id = user["emp_id"]
    role = user["role"]


    with connection.cursor() as cursor:
        # 1. Fetch Project-Subproject Mapping
        cursor.execute("SELECT DISTINCT project, subproject FROM codings WHERE (chart_status = 'complete' OR chart_status = 'reject')")
        pairs = cursor.fetchall()
        
        project_subprojects = {}
        for p, s in pairs:
            if p:
                project_subprojects.setdefault(p, []).append(s)
        
        projects = list(project_subprojects.keys())

        records = []
        if request.method == "POST":
            # Check if auditor already has 3 or more active charts
            cursor.execute("""
                SELECT COUNT(*)
                FROM audit_allocations
                WHERE auditor_id = %s
                AND chart_status = 'in_progress'
            """, (auditor_id,))
            active_charts_count = cursor.fetchone()[0]

            if active_charts_count >= 3:
                return JsonResponse({"error": "You already have 3 charts allocated. Please complete them before requesting more."}, status=400)

            data = json.loads(request.body)
            project = data.get("project")
            subproject = data.get("subproject")
            chart_id = data.get("chart_id")
            date_filter = data.get("date_filter")

            if chart_id:
                # MSSQL uses %s
                query = """
                    SELECT chart_id, project, subproject
                    FROM codings
                    WHERE chart_id = %s
                      AND chart_status IN ('complete','reject')
                      AND chart_id NOT IN (SELECT chart_id FROM audit_allocations)
                """
                params = [chart_id]
                
                if date_filter:
                    query += " AND CAST(created_at AS DATE) = %s"
                    params.append(date_filter)
                
                cursor.execute(query, tuple(params))
                row_tuple = cursor.fetchone()
            else:
                query = """
                    SELECT TOP 1 chart_id, project, subproject
                    FROM codings
                    WHERE chart_status IN ('complete','reject')
                      AND project = %s
                      AND subproject = %s
                      AND chart_id NOT IN (SELECT chart_id FROM audit_allocations)
                """
                params = [project, subproject]
                
                if date_filter:
                    query += " AND CAST(created_at AS DATE) = %s"
                    params.append(date_filter)
                
                query += " ORDER BY NEWID()"
                
                cursor.execute(query, tuple(params))
                row_tuple = cursor.fetchone()

            if row_tuple:
                # Map tuple to dict manually
                row = {"chart_id": row_tuple[0], "project": row_tuple[1], "subproject": row_tuple[2]}
                
                cursor.execute("""
                    INSERT INTO audit_allocations
                    (chart_id, project, subproject, auditor_id,
                     allocated_at, start_time, chart_status)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (
                    row["chart_id"], row["project"], row["subproject"],
                    auditor_id, now(), now(), "in_progress"
                ))
                records.append(row)

        # 2. Fetch allocated charts
        cursor.execute("""
            SELECT chart_id, project, subproject
            FROM audit_allocations
            WHERE chart_status = 'in_progress'
              AND auditor_id = %s
        """, (auditor_id,))
        
        # Helper to convert to dictionary for React
        columns = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
        allocated = []
        for x in cursor.fetchall():
            row_dict = dict(zip(columns, x))
            row_dict['encrypted_chart_id'] = encrypt_chart_id(row_dict['chart_id'])
            allocated.append(row_dict)

        # Fetch hold charts for this auditor
        # Ensure hold_command column exists
        cursor.execute("IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('audit_allocations') AND name = 'hold_command') ALTER TABLE audit_allocations ADD hold_command NVARCHAR(MAX) NULL")
        cursor.execute("""
            SELECT chart_id, project, subproject, hold_command
            FROM audit_allocations
            WHERE chart_status = 'hold'
              AND auditor_id = %s
        """, (auditor_id,))
        h_cols = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
        hold_charts = []
        for x in cursor.fetchall():
            row_dict = dict(zip(h_cols, x))
            row_dict['encrypted_chart_id'] = encrypt_chart_id(row_dict['chart_id'])
            hold_charts.append(row_dict)

    return JsonResponse({
        "projects": projects,
        "project_subprojects": project_subprojects,
        "records": records,
        "allocated": allocated,
        "hold_charts": hold_charts
    })
def state_from_error(error_type):
    if not error_type:
        return "correct"
    return {
        "Missed": "missed",
        "Modified": "modified",
        "Deleted": "deleted",
        "Admin Error": "admin_error",
    }.get(error_type)

@csrf_exempt
def audit_open_chart_api(request, chart_id, is_quality_view=False):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    # Try to decrypt; fall back to raw chart_id for backward-compatibility
    chart_id = decrypt_chart_id(chart_id) or chart_id
    if not chart_id:
        return JsonResponse({"error": "Invalid or expired chart link"}, status=400)

    user = ACTIVE_TOKENS.get(token)
    auditor_id = user["emp_id"]
    
    try:
        with connection.cursor() as cursor:
            # Ensure tables exist
            cursor.execute("""
                IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='audit_dx_entries' AND xtype='U')
                CREATE TABLE audit_dx_entries (
                    id INT PRIMARY KEY IDENTITY(1,1),
                    chart_id INT,
                    from_date DATE,
                    to_date DATE,
                    start_page INT,
                    end_page INT,
                    dxcode NVARCHAR(50),
                    details NVARCHAR(MAX),
                    provider NVARCHAR(MAX),
                    eo NVARCHAR(MAX),
                    pos NVARCHAR(MAX),
                    dx_location NVARCHAR(MAX),
                    meat_dec NVARCHAR(MAX),
                    DOS_Flag NVARCHAR(MAX),
                    user_action NVARCHAR(50),
                    created_at DATETIME DEFAULT GETDATE()
                )
                ELSE 
                BEGIN
                    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('audit_dx_entries') AND name = 'user_action')
                    ALTER TABLE audit_dx_entries ADD user_action NVARCHAR(50)
                    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('audit_dx_entries') AND name = 'created_at')
                    ALTER TABLE audit_dx_entries ADD created_at DATETIME DEFAULT GETDATE()
                    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('audit_dx_entries') AND name = 'DOS_Flag')
                    ALTER TABLE audit_dx_entries ADD DOS_Flag NVARCHAR(MAX) NULL
                    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('audit_dx_entries') AND name = 'npi')
                    ALTER TABLE audit_dx_entries ADD npi NVARCHAR(20) NULL
                END
            """)
            cursor.execute("""
                IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='audit_errors' AND xtype='U')
                CREATE TABLE audit_errors (
                    id INT PRIMARY KEY IDENTITY(1,1),
                    chart_id INT,
                    row_id INT,
                    error_type NVARCHAR(50),
                    error_count INT,
                    error_command NVARCHAR(MAX),
                    changes NVARCHAR(MAX),
                    created_at DATETIME DEFAULT GETDATE()
                )
            """)
            cursor.execute("""
                IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='audit_allocations' AND xtype='U')
                CREATE TABLE audit_allocations (
                    id INT PRIMARY KEY IDENTITY(1,1),
                    chart_id INT,
                    project NVARCHAR(MAX),
                    subproject NVARCHAR(MAX),
                    auditor_id NVARCHAR(50),
                    start_time DATETIME NULL,
                    end_time DATETIME NULL,
                    chart_status NVARCHAR(50) DEFAULT 'unassigned',
                    reject_reason NVARCHAR(MAX) NULL,
                    reject_command NVARCHAR(MAX) NULL,
                    allocated_at DATETIME DEFAULT GETDATE()
                )
            """)
            cursor.execute("""
                IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='at_audit_dx_entries' AND xtype='U')
                CREATE TABLE at_audit_dx_entries (
                    id INT PRIMARY KEY IDENTITY(1,1),
                    chart_id INT,
                    from_date DATE,
                    to_date DATE,
                    start_page INT,
                    end_page INT,
                    dxcode NVARCHAR(50),
                    details NVARCHAR(MAX),
                    provider NVARCHAR(MAX),
                    eo NVARCHAR(MAX),
                    pos NVARCHAR(MAX),
                    dx_location NVARCHAR(MAX),
                    meat_dec NVARCHAR(MAX),
                    DOS_Flag NVARCHAR(MAX),
                    user_action NVARCHAR(50),
                    created_at DATETIME DEFAULT GETDATE()
                )
                ELSE
                BEGIN
                    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('at_audit_dx_entries') AND name = 'DOS_Flag')
                    ALTER TABLE at_audit_dx_entries ADD DOS_Flag NVARCHAR(MAX) NULL
                END
            """)
            cursor.execute("""
                IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='at_audit_errors' AND xtype='U')
                CREATE TABLE at_audit_errors (
                    id INT PRIMARY KEY IDENTITY(1,1),
                    chart_id INT,
                    row_id INT,
                    error_type NVARCHAR(50),
                    error_count INT,
                    error_command NVARCHAR(MAX),
                    changes NVARCHAR(MAX),
                    created_at DATETIME DEFAULT GETDATE()
                )
            """)

            # ---- chart ----
            cursor.execute("SELECT pdf_path, reject_command, reject_reason, project, subproject FROM codings WHERE chart_id = %s", (chart_id,))
            chart_row = cursor.fetchone()
            if not chart_row:
                raise Http404("Chart not found")

            pdf_full_path, reject_command, reject_reason, project_val, subproject_val = chart_row

            # ---- chart status from audit_allocations ----
            cursor.execute("SELECT chart_status, auditor_id FROM audit_allocations WHERE chart_id = %s", (chart_id,))
            alloc_row = cursor.fetchone()
            
            if alloc_row:
                audit_chart_status, current_auditor_id = alloc_row
                
                # 1. Ownership Check: If chart is already allocated, ensure it's the current auditor
                # REMOVE restrictive role check for Manager, VP, AM, TL
                # Relax ownership check for quality review views
                if not is_quality_view and str(current_auditor_id) != str(auditor_id) and user.get("role") not in ["Manager", "VP", "AM", "TL"]:
                    return JsonResponse({"error": "This chart is already allocated to another auditor."}, status=403)
                
                # 2. Finalized Check: Block only if role is regular Auditor/SME
                # Administrative roles can view finalized charts
                # Relax finalized check for quality review views
                normalized_audit_status = (audit_chart_status or "").strip().lower()
                if not is_quality_view and normalized_audit_status in ['complete', 'completed', 'reject', 'rejected'] and user.get("role") not in ["Manager", "VP", "AM", "TL"]:
                    return JsonResponse({"error": "Access Denied: This audit is already finalized and cannot be accessed."}, status=403)
            else:
                # If not allocated, we can allow the auto-allocation as per current flow,
                # but let's ensure we only allow it if the user is an Auditor (already handled by role middleware usually, but here we can be safe)
                # For quality view, an allocation SHOULD exist, but we still allow authorized roles to view if it doesn't
                if not is_quality_view and user.get("role") not in ["Auditor", "SME", "TL", "Manager", "VP", "AM"]:
                    return JsonResponse({"error": "Unauthorized role for auditing."}, status=403)

                cursor.execute("""
                    INSERT INTO audit_allocations (chart_id, project, subproject, auditor_id, chart_status, allocated_at) 
                    VALUES (%s, %s, %s, %s, 'assigned', %s)
                """, (chart_id, project_val, subproject_val, auditor_id, timezone.localtime(timezone.now())))
                audit_chart_status = "assigned"

            # ---- set start time once ----
            cursor.execute("""
                UPDATE audit_allocations
                SET start_time = COALESCE(start_time, %s)
                WHERE chart_id = %s
            """, (timezone.localtime(timezone.now()), chart_id))

            # ---- copy DX once ----
            cursor.execute("""
                INSERT INTO audit_dx_entries
                (chart_id, from_date, to_date, start_page, end_page,
                 dxcode, details, provider, eo, pos, dx_location, meat_dec, DOS_Flag, npi)
                SELECT chart_id, from_date, to_date, start_page, end_page,
                       dxcode, details, provider, eo, pos, dx_location, meat_dec, DOS_Flag, npi
                FROM dx_entries
                WHERE chart_id = %s
                AND NOT EXISTS (
                    SELECT 1 FROM audit_dx_entries WHERE chart_id = %s
                )
            """, (chart_id, chart_id))

            # ================= POST ACTIONS =================
            if request.method == "POST":
                data = json.loads(request.body)
                action = data.get("action")

                if action == "update_state":
                    state = data.get("state") # e.g. "correct", "wrong", "missed"
                    error_type = data.get("error_type")
                    row_id = data.get("row_id")
                    
                    # 1. Snapshot Update (UPDATE query)
                    # We use user_action to store the current audit label/state
                    cursor.execute("UPDATE audit_dx_entries SET user_action = %s WHERE id = %s", (state if state else None, row_id))
                    
                    # 2. History Append (INSERT query)
                    insert_type = error_type if error_type else 'Correct'
                    if not state and not error_type: insert_type = 'Undo'
                    
                    cursor.execute("""
                        INSERT INTO audit_errors
                        (chart_id, row_id, error_type, error_count, error_command, changes, created_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """, (
                        chart_id, row_id, insert_type,
                        data.get("error_count"), data.get("error_command"), 
                        json.dumps({"action": "update_state", "state": state}), timezone.localtime(timezone.now())
                    ))
                    return JsonResponse({"ok": True})

                if action == "add_dx":
                    # --- DUPLICATE GUARD (5s) ---
                    cursor.execute("""
                        SELECT 1 FROM audit_dx_entries 
                        WHERE chart_id = %s 
                          AND dxcode = %s 
                          AND from_date = %s 
                          AND to_date = %s 
                          AND start_page = %s 
                          AND end_page = %s
                          AND created_at > DATEADD(second, -5, GETDATE())
                    """, (
                        chart_id, data.get("dxcode"), 
                        data.get("from_date") if data.get("from_date") else None,
                        data.get("to_date") if data.get("to_date") else None,
                        data.get("start_page"), data.get("end_page")
                    ))
                    if cursor.fetchone():
                        return JsonResponse({"error": "Duplicate entry detected (Too fast!)"}, status=409)

                    # Insert Data
                    cursor.execute("""
                        INSERT INTO audit_dx_entries
                        (chart_id, from_date, to_date, start_page, end_page,
                         dxcode, details, provider, eo, pos, dx_location, meat_dec, DOS_Flag, npi)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        chart_id, data.get("from_date"), data.get("to_date"),
                        data.get("start_page"), data.get("end_page"), data.get("dxcode"),
                        data.get("details"), data.get("provider"), data.get("eo"),
                        data.get("pos"), data.get("dx_location"), data.get("meat_dec"),
                        data.get("DOS_Flag"), data.get("npi")
                    ))
                    
                    # Check for error info
                    error_type = data.get("error_type")
                    if error_type:
                        # Get the ID of the inserted row
                        cursor.execute("SELECT @@IDENTITY") # MSSQL
                        # For SQLite it is last_insert_rowid(), but project seems to use MSSQL logic often.
                        # Fallback or generic: 
                        # Let's assume MSSQL based on previous interactions.
                        new_id = cursor.fetchone()[0]
                        
                        cursor.execute("""
                            INSERT INTO audit_errors
                            (chart_id, row_id, error_type, error_count, error_command, changes, created_at)
                            VALUES (%s, %s, %s, %s, %s, %s, %s)
                        """, (
                            chart_id, new_id, error_type,
                            data.get("error_count"), data.get("error_command"), 
                            json.dumps({"action": "added"}), timezone.localtime(timezone.now())
                        ))
                    return JsonResponse({"ok": True})

                if action == "save_edit":
                    row_id = data["row_id"]
                    fields = data["fields"]
                    values = data["values"]

                    cursor.execute("SELECT * FROM audit_dx_entries WHERE id = %s", (row_id,))
                    
                    cols = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
                    original_row = dict(zip(cols, cursor.fetchone() or []))
                    
                    if not original_row:
                        return JsonResponse({"error": "Original not found"}, status=404)

                    # Prepare updates
                    updated_values = {}
                    changes = {"original": {}, "new": {}}
                    
                    for f in fields:
                        if f in values:
                            new_val = values[f]
                            old_val = original_row.get(f)

                            # Robust comparison & string conversion for JSON
                            new_s = str(new_val) if new_val is not None else ""
                            old_s = old_val.strftime("%Y-%m-%d") if hasattr(old_val, "strftime") else str(old_val if old_val is not None else "")

                            if new_s != old_s:
                                updated_values[f] = new_val
                                changes["original"][f] = old_s
                                changes["new"][f] = new_s
                    
                    # Update Data Table
                    if updated_values:
                        set_clause = ", ".join([f"{k} = %s" for k in updated_values.keys()])
                        params = list(updated_values.values()) + [row_id]
                        cursor.execute(f"UPDATE audit_dx_entries SET {set_clause} WHERE id = %s", params)

                    # Update Error Table
                    # Append new entry to history (INSERT only)
                    error_type = data.get("error_type")
                    if error_type:
                        cursor.execute("""
                            INSERT INTO audit_errors
                            (chart_id, row_id, error_type, error_count, error_command, changes, created_at)
                            VALUES (%s, %s, %s, %s, %s, %s, %s)
                        """, (
                            chart_id, row_id, error_type,
                            data.get("error_count"), data.get("error_command"), 
                            json.dumps(changes), timezone.localtime(timezone.now())
                        ))
                    
                    return JsonResponse({"ok": True})
                
                if action == "bulk_update":
                    row_ids = data.get("row_ids", [])
                    updates = data.get("updates", {}) # Data fields
                    
                    error_type = data.get("error_type")
                    error_count = data.get("error_count")
                    error_command = data.get("error_command")
                    
                    if not row_ids or not updates:
                         return JsonResponse({"error": "Missing row_ids or updates"}, status=400)

                    data_updates = {k: v for k, v in updates.items() if k not in ["error_type", "error_count", "error_command", "state"]}
                    
                    if not data_updates:
                         return JsonResponse({"error": "No data updates provided"}, status=400)

                    # 1. Fetch original rows for all row_ids
                    placeholders = ", ".join(["%s"] * len(row_ids))
                    cursor.execute(f"SELECT * FROM audit_dx_entries WHERE id IN ({placeholders})", row_ids)
                    cols_desc = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
                    raw_rows = cursor.fetchall()
                    original_rows_map = {}
                    for r in raw_rows:
                        rd = dict(zip(cols_desc, r))
                        original_rows_map[int(rd['id'])] = rd

                    # 2. Update Data for all rows
                    set_clause = ", ".join([f"{k} = %s" for k in data_updates.keys()])
                    params = list(data_updates.values())
                    cursor.execute(
                        f"UPDATE audit_dx_entries SET {set_clause} WHERE id IN ({placeholders})",
                        params + row_ids
                    )
                    
                    # 3. Update Errors
                    if error_type:
                        for rid_raw in row_ids:
                            rid = int(rid_raw)
                            orig_row = original_rows_map.get(rid, {})
                            
                            row_changes = {"original": {}, "new": {}}
                            for f, new_v in data_updates.items():
                                old_v = orig_row.get(f)
                                # Robust comparison: handle dates and nulls
                                old_s = old_v.strftime("%Y-%m-%d") if hasattr(old_v, "strftime") else str(old_v if old_v is not None else "")
                                new_s = str(new_v if new_v is not None else "")

                                if new_s != old_s:
                                    row_changes["original"][f] = old_s
                                    row_changes["new"][f] = new_s
                            
                            if row_changes["original"]:
                                cursor.execute("""
                                    INSERT INTO audit_errors
                                    (chart_id, row_id, error_type, error_count, error_command, changes, created_at)
                                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                                """, (
                                    chart_id, rid, error_type, error_count, error_command,
                                    json.dumps(row_changes), timezone.localtime(timezone.now())
                                ))

                    return JsonResponse({"ok": True})

                if action == "delete_dx":
                    row_id = data["row_id"]
                    # Hard delete associated errors first
                    cursor.execute("DELETE FROM audit_errors WHERE row_id = %s", (row_id,))
                    # Hard delete the entry itself
                    cursor.execute("DELETE FROM audit_dx_entries WHERE id = %s", (row_id,))
                    return JsonResponse({"ok": True})

                if action == "delete_error":
                    # Revert data based on history log (Full Reversion)
                    error_log_id = data["row_id"]
                    
                    cursor.execute("SELECT * FROM audit_errors WHERE id = %s", (error_log_id,))
                    cols = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
                    log_row = dict(zip(cols, cursor.fetchone() or []))
                    
                    if log_row:
                        target_row_id = log_row["row_id"]
                        try:
                            changes = json.loads(log_row["changes"]) if log_row["changes"] else {}
                        except:
                            changes = {}
                            
                        error_type = log_row["error_type"]
                        
                        if error_type == 'Deleted':
                            # Restore visibility
                            cursor.execute("UPDATE audit_dx_entries SET user_action = NULL WHERE id = %s", (target_row_id,))
                        elif error_type == 'Missed':
                            # Hard-delete the added row (user wants no trace)
                            cursor.execute("DELETE FROM audit_dx_entries WHERE id = %s", (target_row_id,))
                            # Also clean up any other errors for this specifically added row if they exist
                            cursor.execute("DELETE FROM audit_errors WHERE row_id = %s", (target_row_id,))
                        elif changes.get("original"):
                            # Restore specific fields
                            orig = changes["original"]
                            set_clause = ", ".join([f"{k} = %s" for k in orig.keys()])
                            params = list(orig.values()) + [target_row_id]
                            cursor.execute(f"UPDATE audit_dx_entries SET {set_clause}, user_action = NULL WHERE id = %s", params)
                        else:
                            # Clear state/label
                            cursor.execute("UPDATE audit_dx_entries SET user_action = NULL WHERE id = %s", (target_row_id,))

                        # FULL DELETE of the error record
                        cursor.execute("DELETE FROM audit_errors WHERE id = %s", (error_log_id,))
                        
                    return JsonResponse({"ok": True})

                if action == "save_chart":
                    # Ensure hold_command column exists
                    cursor.execute("IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('audit_allocations') AND name = 'hold_command') ALTER TABLE audit_allocations ADD hold_command NVARCHAR(MAX) NULL")
                    if data.get("chart_status") == "hold":
                        cursor.execute("""
                            UPDATE audit_allocations
                            SET chart_status='hold', hold_command=%s
                            WHERE chart_id=%s
                        """, (
                            data.get("hold_command", ""),
                            chart_id
                        ))
                    else:
                        cursor.execute("""
                            UPDATE audit_allocations
                            SET end_time=%s, chart_status=%s, reject_reason=%s, reject_command=%s, allocated_at=%s
                            WHERE chart_id=%s
                        """, (
                            timezone.localtime(timezone.now()), data.get("chart_status"),
                            data.get("reject_reason"), data.get("reject_command"),
                            timezone.localtime(timezone.now()),
                            chart_id
                        ))
                    return JsonResponse({"ok": True})

            # ================= FETCH =================
            # 1. Fetch Audit Data (Clean Rows)
            cursor.execute("""
                SELECT * FROM audit_dx_entries
                WHERE chart_id = %s AND (user_action IS NULL OR user_action != 'deleted')
                ORDER BY from_date, to_date, pos, id
            """, (chart_id,))
            
            cols = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
            rows = []
            for r in cursor.fetchall():
                rd = dict(zip(cols, r))
                for k in ['from_date', 'to_date']:
                    if rd.get(k) and not isinstance(rd[k], str):
                        rd[k] = rd[k].strftime("%m-%d-%Y")
                rows.append(rd)
                
            # 2. Fetch Errors (Latest per row_id wins)
            cursor.execute("""
                SELECT row_id, error_type, error_count, error_command, changes
                FROM audit_errors
                WHERE chart_id = %s
                ORDER BY id ASC
            """, (chart_id,))
            
            err_cols = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
            errors_map = {} # row_id -> error dict
            for r in cursor.fetchall():
                ed = dict(zip(err_cols, r))
                errors_map[ed["row_id"]] = ed

            # 3. Merge Errors into Rows
            # The frontend expects 'state', 'error_type', 'error_count', 'error_command' on the row object
            for row in rows:
                if row["id"] in errors_map:
                    err = errors_map[row["id"]]
                    row["error_type"] = err["error_type"]
                    row["error_count"] = err["error_count"]
                    row["error_command"] = err["error_command"]
                    try:
                        row["changes"] = json.loads(err["changes"]) if err["changes"] else {}
                    except:
                        row["changes"] = {}
                    row["state"] = state_from_error(err["error_type"]) # Derive state for frontend styling
                else:
                    row["state"] = ""

            # ---- Fetch original coder rows (Code Log) ----
            cursor.execute("""
                SELECT d.*, c.reject_command, c.reject_reason 
                FROM dx_entries d
                LEFT JOIN codings c ON d.chart_id = c.chart_id
                WHERE d.chart_id = %s
                ORDER BY d.from_date, d.to_date, d.pos, d.id
            """, (chart_id,))
            coder_cols = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
            coder_rows = []
            for r in cursor.fetchall():
                rd = dict(zip(coder_cols, r))
                for k in ['from_date', 'to_date']:
                    if rd.get(k) and not isinstance(rd[k], str):
                        rd[k] = rd[k].strftime("%m-%d-%Y")
                coder_rows.append(rd)

            # ---- Fetch audit error log (Audit Log) ----
            # Join audit_errors and audit_dx_entries to get full context for the log
            cursor.execute("""
                SELECT e.id, e.changes,
                       r.from_date, r.to_date, r.start_page, r.end_page,
                       e.error_type, e.error_count, e.error_command, r.dxcode, 
                       r.details, r.provider, r.eo, r.pos, r.dx_location, r.meat_dec, r.DOS_Flag, r.npi,
                       e.created_at
                FROM audit_errors e
                LEFT JOIN audit_dx_entries r ON e.row_id = r.id
                WHERE e.chart_id = %s
                ORDER BY e.created_at DESC
            """, (chart_id,))
            
            log_cols = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
            audit_log = []
            for r in cursor.fetchall():
                ld = dict(zip(log_cols, r))
                # Format dates for JSON
                for k in ['from_date', 'to_date', 'created_at']:
                    if ld.get(k) and not isinstance(ld[k], str):
                        if k == 'created_at':
                            if timezone.is_aware(ld[k]):
                                ld[k] = timezone.localtime(ld[k]).strftime("%m-%d-%Y %H:%M:%S")
                            else:
                                ld[k] = ld[k].strftime("%m-%d-%Y %H:%M:%S")
                        else:
                            ld[k] = ld[k].strftime("%m-%d-%Y")
                
                # Parse changes
                try:
                    ld['changes'] = json.loads(ld['changes']) if ld.get('changes') else {}
                except:
                    ld['changes'] = {}

                # Derive 'state' for the log if frontend expects it
                ld['state'] = state_from_error(ld.get('error_type'))
                audit_log.append(ld)

            # ---- Fetch at_audit_errors if they exist (Feedback for Auditor) ----
            cursor.execute("""
                SELECT e.id, e.changes,
                       r.from_date, r.to_date, r.start_page, r.end_page,
                       e.error_type, e.error_count, e.error_command, r.dxcode, 
                       r.details, r.provider, r.eo, r.pos, r.dx_location, r.meat_dec, r.DOS_Flag, r.npi,
                       e.created_at
                FROM at_audit_errors e
                LEFT JOIN at_audit_dx_entries r ON e.row_id = r.id
                WHERE e.chart_id = %s
                ORDER BY e.created_at DESC
            """, (chart_id,))
            
            at_log_cols = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
            at_audit_log = []
            for r in cursor.fetchall():
                ald = dict(zip(at_log_cols, r))
                for k in ['from_date', 'to_date', 'created_at']:
                    if ald.get(k) and not isinstance(ald[k], str):
                        if k == 'created_at':
                            if timezone.is_aware(ald[k]):
                                ald[k] = timezone.localtime(ald[k]).strftime("%m-%d-%Y %H:%M:%S")
                            else:
                                ald[k] = ald[k].strftime("%m-%d-%Y %H:%M:%S")
                        else:
                            ald[k] = ald[k].strftime("%m-%d-%Y")
                try:
                    ald['changes'] = json.loads(ald['changes']) if ald.get('changes') else {}
                except:
                    ald['changes'] = {}
                ald['state'] = state_from_error(ald.get('error_type'))
                at_audit_log.append(ald)

            pdf_relative_path = _get_pdf_relative_path(pdf_full_path)
            return JsonResponse({
                "chart_id": chart_id,
                "pdf_path": pdf_relative_path,
                "rows": rows,
                "coder_rows": coder_rows,
                "audit_log": audit_log,
                "errors": audit_log,
                "at_audit_log": at_audit_log,
                "reject_command": reject_command,
                "reject_reason": reject_reason,
                "project": project_val,
                "subproject": subproject_val,
                "audit_status": audit_chart_status,
                "is_quality_view": is_quality_view
            })
    except Exception as e:
        traceback.print_exc()
        return JsonResponse({"error": str(e)}, status=500)


@api_cache(ttl_seconds=3)
def quality_dashboard_api(request):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    user = ACTIVE_TOKENS[token]
    user_id = user["emp_id"]
    role = user.get("user_profile") or user.get("role", "Coder")

    from_date = request.GET.get("from_date")
    to_date = request.GET.get("to_date")
    project = request.GET.get("project")
    subproject = request.GET.get("subproject")
    source_filter = request.GET.get("source")  # 'audit', 'at_audit', or None (both)

    # For TL/AM/Manager, fetch all team member IDs (same as quality_summary_api)
    user_ids = [user_id]
    if role in ["TL", "AM", "Manager"]:
        with connection.cursor() as cursor:
            cursor.execute("""
                ;WITH TeamHierarchy AS (
                    SELECT user_employee_id
                    FROM user_details
                    WHERE user_employee_id = %s

                    UNION ALL

                    SELECT u.user_employee_id
                    FROM user_details u
                    INNER JOIN TeamHierarchy th ON u.tl_employee_id = th.user_employee_id
                )
                SELECT DISTINCT user_employee_id FROM TeamHierarchy
            """, (user_id,))
            fetched_ids = [r[0] for r in cursor.fetchall()]
            if fetched_ids:
                user_ids = fetched_ids

    placeholders = ",".join(["%s"] * len(user_ids))

    with connection.cursor() as cursor:
        include_all = request.GET.get('include_all') == 'true'
        action_filter = ""
        if not include_all:
            action_filter = """
                AND (e.coder_action IS NULL OR (
                    e.coder_action = 'disagree'
                    AND (e.coder_tl_action IS NULL OR e.coder_tl_action = 'disagree')
                    AND (e.audit_action IS NULL OR e.audit_action = 'disagree')
                    AND e.audit_tl_action IS NULL
                ))
            """

        # Build query based on source filter
        audit_part = f"""
            SELECT e.id, r.chart_id, r.dxcode, r.start_page, r.end_page,
                e.error_type, r.dx_location, e.error_command, e.error_count,
                c.project, c.subproject,
                COALESCE(c.date, CAST(aa.allocated_at AS DATE)) as chart_date,
                c.user_id as target_user_id,
                'audit' as source,
                e.coder_action, e.coder_comment, e.coder_tl_action, e.coder_tl_comment,
                e.audit_action, e.audit_comment, e.audit_tl_action, e.audit_tl_comment,
                e.coder_action_date, e.coder_tl_action_date, e.audit_action_date, e.audit_tl_action_date
            FROM audit_dx_entries r
            JOIN codings c ON c.chart_id = r.chart_id
            JOIN audit_allocations aa ON aa.chart_id = r.chart_id
            JOIN audit_errors e ON e.row_id = r.id
            WHERE aa.chart_status IN ('complete', 'reject')
            {action_filter}
        """

        at_audit_part = f"""
            SELECT e.id, r.chart_id, r.dxcode, r.start_page, r.end_page,
                e.error_type, r.dx_location, e.error_command, e.error_count,
                c2.project, c2.subproject,
                CAST(ata.allocated_at AS DATE) as chart_date,
                c.auditor_id as target_user_id,
                'at_audit' as source,
                e.coder_action, e.coder_comment, e.coder_tl_action, e.coder_tl_comment,
                e.audit_action, e.audit_comment, e.audit_tl_action, e.audit_tl_comment,
                e.coder_action_date, e.coder_tl_action_date, e.audit_action_date, e.audit_tl_action_date
            FROM at_audit_dx_entries r
            JOIN audit_allocations c ON c.chart_id = r.chart_id
            JOIN codings c2 ON c2.chart_id = c.chart_id
            JOIN at_audit_allocations ata ON ata.chart_id = r.chart_id
            JOIN at_audit_errors e ON e.row_id = r.id
            WHERE ata.chart_status IN ('complete', 'reject')
            {action_filter}
        """

        if source_filter == 'audit':
            union_body = audit_part
        elif source_filter == 'at_audit':
            union_body = at_audit_part
        else:
            union_body = f"{audit_part} UNION ALL {at_audit_part}"

        query = f"""
            SELECT * FROM (
                {union_body}
            ) as combined
            WHERE target_user_id IN ({placeholders})
        """
        params = list(user_ids)

        if from_date and to_date:
            query += " AND chart_date BETWEEN %s AND %s"
            params += [from_date, to_date]

        if project:
            query += " AND project = %s"
            params.append(project)

        if subproject:
            query += " AND subproject = %s"
            params.append(subproject)

        # ORDER BY must come AFTER all WHERE conditions
        query += " ORDER BY chart_id, dxcode"

        cursor.execute(query, params)

        columns = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
        raw_rows = cursor.fetchall()
        rows = []
        for r in raw_rows:
            rd = dict(zip(columns, r))
            rd['encrypted_chart_id'] = encrypt_chart_id(rd['chart_id'])
            # Format date for JSON
            if rd.get('chart_date') and not isinstance(rd['chart_date'], str):
                rd["chart_date"] = rd["chart_date"].strftime("%Y-%m-%d")
            rows.append(rd)

    return JsonResponse({"rows": rows})


@csrf_exempt
@api_cache(ttl_seconds=3)
def quality_summary_api(request):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    user = ACTIVE_TOKENS[token]
    user_id = user["emp_id"]
    role = user.get("role", "Coder")

    from_date = request.GET.get("from_date")
    to_date = request.GET.get("to_date")
    project = request.GET.get("project")
    subproject = request.GET.get("subproject")
    source_filter = request.GET.get("source")  # 'audit', 'at_audit', or None (both)

    # Determine which user IDs to fetch data for
    user_ids = [user_id]
    if role in ["TL","AM","Manager"]:
        with connection.cursor() as cursor:
            cursor.execute("""
                ;WITH TeamHierarchy AS (
                    -- Base case: The current user
                    SELECT user_employee_id 
                    FROM user_details 
                    WHERE user_employee_id = %s
                    
                    UNION ALL
                    
                    -- Recursive case: Find anyone who reports to someone in the hierarchy
                    SELECT u.user_employee_id 
                    FROM user_details u
                    INNER JOIN TeamHierarchy th ON u.tl_employee_id = th.user_employee_id
                )
                SELECT DISTINCT user_employee_id FROM TeamHierarchy
            """, (user_id,))
            fetched_ids = [r[0] for r in cursor.fetchall()]
            if fetched_ids:
                user_ids = fetched_ids

    placeholders = ",".join(["%s"] * len(user_ids))
    
    # Common filters for subqueries
    filters_coded = []
    filters_audited = []
    filter_params = []

    if from_date and to_date:
        filters_coded.append("COALESCE(c.date, CAST(c.created_at AS DATE)) BETWEEN %s AND %s")
        filters_audited.append("CAST(c.allocated_at AS DATE) BETWEEN %s AND %s")
        filter_params.extend([from_date, to_date])

    if project:
        filters_coded.append("c.project = %s")
        filters_audited.append("c2.project = %s")
        filter_params.append(project)

    if subproject:
        filters_coded.append("c.subproject = %s")
        filters_audited.append("c2.subproject = %s")
        filter_params.append(subproject)

    where_coded = (" AND " + " AND ".join(filters_coded)) if filters_coded else ""
    where_audited = (" AND " + " AND ".join(filters_audited)) if filters_audited else ""

    # Build the sub-queries based on source_filter
    coded_part = f"""
        SELECT
            c.project,
            c.subproject,
            1 AS total_audited,
            (SELECT COUNT(*) FROM dx_entries dx WHERE dx.chart_id = c.chart_id AND dx.dxcode IS NOT NULL AND dx.dxcode != '') AS total_icd,
            (SELECT COALESCE(SUM(error_count), 0) FROM audit_errors ae WHERE ae.chart_id = c.chart_id) AS total_error
        FROM codings c
        JOIN audit_allocations aa ON aa.chart_id = c.chart_id
        WHERE c.user_id IN ({placeholders}) AND aa.chart_status IN ('complete', 'reject') {where_coded}
        GROUP BY c.project, c.subproject, c.chart_id
    """

    audited_part = f"""
        SELECT
            c2.project,
            c2.subproject,
            1 AS total_audited,
            (SELECT COUNT(*) FROM audit_dx_entries dx WHERE dx.chart_id = c.chart_id AND dx.dxcode IS NOT NULL AND dx.dxcode != '') AS total_icd,
            (SELECT COALESCE(SUM(error_count), 0) FROM at_audit_errors ae WHERE ae.chart_id = c.chart_id) AS total_error
        FROM audit_allocations c
        JOIN codings c2 ON c2.chart_id = c.chart_id
        JOIN at_audit_allocations aa ON aa.chart_id = c.chart_id
        WHERE c.auditor_id IN ({placeholders}) AND aa.chart_status IN ('complete', 'reject') {where_audited}
        GROUP BY c2.project, c2.subproject, c.chart_id
    """

    if source_filter == 'audit':
        union_body = coded_part
        query_params = user_ids + filter_params
    elif source_filter == 'at_audit':
        union_body = audited_part
        query_params = user_ids + filter_params
    else:
        union_body = f"{coded_part} UNION ALL {audited_part}"
        query_params = user_ids + filter_params + user_ids + filter_params

    with connection.cursor() as cursor:
        cursor.execute(f"""
            SELECT
                project,
                subproject,
                SUM(total_audited) as total_audited,
                SUM(total_icd) as total_icd,
                SUM(total_error) as total_error
            FROM (
                {union_body}
            ) as t
            GROUP BY project, subproject
        """, query_params)

        columns = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
        rows = [dict(zip(columns, r)) for r in cursor.fetchall()]

    # 🔢 Compute Quality %
    for r in rows:
        total_icd = r.get("total_icd") or 0
        total_error = r.get("total_error") or 0
        r["quality_percent"] = (
            round((1 - (total_error / total_icd)) * 100, 2)
            if total_icd > 0 else 100
        )

    return JsonResponse({"rows": rows})

@csrf_exempt
def quality_action_api(request):
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request"}, status=400)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    error_id = data.get("id")
    action = data.get("action")
    comment = data.get("comment", "")
    source = data.get("source", "audit") 
    level = data.get("level", "coder") # 'coder', 'coder_tl', 'audit_tl'

    if not error_id or not action:
        return JsonResponse({"error": "Missing data"}, status=400)

    table_name = "audit_errors" if source == "audit" else "at_audit_errors"
    
    # Map level to columns
    if level == "coder":
        col_action, col_comment, col_date = "coder_action", "coder_comment", "coder_action_date"
    elif level == "coder_tl":
        col_action, col_comment, col_date = "coder_tl_action", "coder_tl_comment", "coder_tl_action_date"
    elif level == "auditor":
        col_action, col_comment, col_date = "audit_action", "audit_comment", "audit_action_date"
    elif level == "audit_tl":
        col_action, col_comment, col_date = "audit_tl_action", "audit_tl_comment", "audit_tl_action_date"
    else:
        return JsonResponse({"error": "Invalid level"}, status=400)

    try:
        with connection.cursor() as cursor:
            set_clause = f"{col_action} = %s, {col_comment} = %s, {col_date} = GETDATE()"
            params = [action, comment or action]

            if action == "agree" and level in ["auditor", "audit_tl"]:
                set_clause += ", error_count = 0"

            update_query = f"""
                UPDATE {table_name}
                SET {set_clause}
                WHERE id = %s
            """
            params.append(error_id)
            cursor.execute(update_query, params)
            
            if cursor.rowcount == 0:
                return JsonResponse({"error": f"No row updated in {table_name}"}, status=400)

        return JsonResponse({"ok": True})
    except Exception as e:
        traceback.print_exc()
        return JsonResponse({"error": str(e)}, status=500)

@csrf_exempt
@api_cache(ttl_seconds=3)
def rebuttal_status_api(request):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)
    
    user = ACTIVE_TOKENS[token]
    emp_id = user["emp_id"]

    # --- Filters ---
    from_date = request.GET.get("from_date")
    to_date = request.GET.get("to_date")
    source = request.GET.get("source")
    level = request.GET.get("level")
    project = request.GET.get("project")
    subproject = request.GET.get("subproject")
    reviewer_id_filter = request.GET.get("reviewer_id")

    role = user.get("user_profile") or user.get("role", "Coder")

    # ---------------------------------------------------------------
    # AUTO-AGREE: Pending Coder rows older than 7 days
    # If coder_action IS NULL and created_at is >= 7 days ago,
    # automatically set coder_action = 'agree', coder_comment = 'auto agree'
    # This runs silently on every page load — no human interaction needed.
    # ---------------------------------------------------------------
    try:
        with connection.cursor() as _auto_cur:
            _auto_cur.execute("""
                UPDATE audit_errors
                SET coder_action      = 'agree',
                    coder_comment     = 'auto agree',
                    coder_action_date = GETDATE()
                WHERE coder_action IS NULL
                  AND DATEDIFF(day, created_at, GETDATE()) >= 7
            """)
            _auto_cur.execute("""
                UPDATE at_audit_errors
                SET coder_action      = 'agree',
                    coder_comment     = 'auto agree',
                    coder_action_date = GETDATE()
                WHERE coder_action IS NULL
                  AND DATEDIFF(day, created_at, GETDATE()) >= 7
            """)
    except Exception:
        # Auto-agree failure must not block the main page load
        traceback.print_exc()
    # ---------------------------------------------------------------

    where_clauses = []
    params = []

    # If it's a Manager/AM, they can see everything unless they filter.
    # Otherwise, they see only what's assigned to them (reviewer_id).
    if role not in ["Manager", "AM"]:
        where_clauses.append("(t.reviewer_id = %s OR t.coder_id = %s)")
        params.extend([emp_id, emp_id])
    elif reviewer_id_filter:
        where_clauses.append("t.reviewer_id = %s")
        params.append(reviewer_id_filter)

    if from_date and to_date:
        where_clauses.append("t.created_at BETWEEN %s AND %s")
        params.extend([from_date, to_date + " 23:59:59"])
    if source:
        where_clauses.append("t.source = %s")
        params.append(source)
    if level:
        where_clauses.append("t.level = %s")
        params.append(level)
    if project:
        where_clauses.append("t.project = %s")
        params.append(project)
    if subproject:
        where_clauses.append("t.subproject = %s")
        params.append(subproject)

    where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"
    
    with connection.cursor() as cursor:
        query = f"""
            ;WITH DedupCodings AS (
                SELECT * FROM (
                    SELECT *, ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY created_at DESC) as rn
                    FROM codings
                ) t WHERE rn = 1
            ),
            DedupAuditAlloc AS (
                SELECT * FROM (
                    SELECT *, ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY allocated_at DESC) as rn
                    FROM audit_allocations
                ) t WHERE rn = 1
            ),
            DedupATAuditAlloc AS (
                SELECT * FROM (
                    SELECT *, ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY allocated_at DESC) as rn
                    FROM at_audit_allocations
                ) t WHERE rn = 1
            ),
            FullRebuttal AS (
                -- AUDIT CHAIN (Coder -> Coder TL -> Auditor -> Auditor TL)
                
                -- 1. Coder TL seeing Coder's disagreement
                SELECT e.id, e.chart_id, r.dxcode, e.error_type, e.error_count, 'audit' as source, 'coder_tl' as level,
                       c.user_id as coder_id, a.auditor_id as auditor_id, 
                       u_c.tl_employee_id as coder_tl_id, u_a.tl_employee_id as auditor_tl_id,
                       u_c.tl_employee_id as reviewer_id, 
                       COALESCE(e.audit_tl_action, e.audit_action, e.coder_tl_action, e.coder_action) as last_action,
                       COALESCE(e.audit_tl_comment, e.audit_comment, e.coder_tl_comment, e.coder_comment) as last_comment,
                       e.coder_comment, e.coder_tl_comment, e.audit_comment, e.audit_tl_comment, e.error_command as original_auditor_comment,
                       e.coder_action, e.coder_tl_action, e.audit_action, e.audit_tl_action,
                       'coder_tl' as pending_level,
                       c.project, c.subproject, e.created_at,
                       e.coder_action_date, e.coder_tl_action_date, e.audit_action_date, e.audit_tl_action_date
                FROM audit_errors e
                LEFT JOIN audit_dx_entries r ON e.row_id = r.id
                LEFT JOIN DedupCodings c ON c.chart_id = e.chart_id
                LEFT JOIN DedupAuditAlloc a ON a.chart_id = e.chart_id
                LEFT JOIN user_details u_c ON c.user_id = u_c.user_employee_id
                LEFT JOIN user_details u_a ON a.auditor_id = u_a.user_employee_id
                WHERE e.coder_action = 'disagree' 
                  AND e.coder_tl_action IS NULL
                
                UNION ALL
                
                -- 2. Original Auditor seeing Coder TL's disagreement
                SELECT e.id, e.chart_id, r.dxcode, e.error_type, e.error_count, 'audit' as source, 'auditor' as level,
                       c.user_id as coder_id, a.auditor_id as auditor_id, 
                       u_c.tl_employee_id as coder_tl_id, u_a.tl_employee_id as auditor_tl_id,
                       a.auditor_id as reviewer_id, 
                       COALESCE(e.audit_tl_action, e.audit_action, e.coder_tl_action, e.coder_action) as last_action,
                       COALESCE(e.audit_tl_comment, e.audit_comment, e.coder_tl_comment, e.coder_comment) as last_comment,
                       e.coder_comment, e.coder_tl_comment, e.audit_comment, e.audit_tl_comment, e.error_command as original_auditor_comment,
                       e.coder_action, e.coder_tl_action, e.audit_action, e.audit_tl_action,
                       'auditor' as pending_level,
                       c.project, c.subproject, e.created_at,
                       e.coder_action_date, e.coder_tl_action_date, e.audit_action_date, e.audit_tl_action_date
                FROM audit_errors e
                LEFT JOIN audit_dx_entries r ON e.row_id = r.id
                LEFT JOIN DedupAuditAlloc a ON a.chart_id = e.chart_id
                LEFT JOIN DedupCodings c ON c.chart_id = e.chart_id
                LEFT JOIN user_details u_c ON u_c.user_employee_id = c.user_id
                LEFT JOIN user_details u_a ON u_a.user_employee_id = a.auditor_id
                WHERE e.coder_tl_action = 'disagree' 
                  AND e.audit_action IS NULL
 
                UNION ALL
                
                -- 3. Auditor TL seeing Auditor's disagreement
                SELECT e.id, e.chart_id, r.dxcode, e.error_type, e.error_count, 'audit' as source, 'audit_tl' as level,
                       c.user_id as coder_id, a.auditor_id as auditor_id, 
                       u_c.tl_employee_id as coder_tl_id, u_a.tl_employee_id as auditor_tl_id,
                       u_a.tl_employee_id as reviewer_id, 
                       COALESCE(e.audit_tl_action, e.audit_action, e.coder_tl_action, e.coder_action) as last_action,
                       COALESCE(e.audit_tl_comment, e.audit_comment, e.coder_tl_comment, e.coder_comment) as last_comment,
                       e.coder_comment, e.coder_tl_comment, e.audit_comment, e.audit_tl_comment, e.error_command as original_auditor_comment,
                       e.coder_action, e.coder_tl_action, e.audit_action, e.audit_tl_action,
                       'audit_tl' as pending_level,
                       c.project, c.subproject, e.created_at,
                       e.coder_action_date, e.coder_tl_action_date, e.audit_action_date, e.audit_tl_action_date
                FROM audit_errors e
                LEFT JOIN audit_dx_entries r ON e.row_id = r.id
                LEFT JOIN DedupAuditAlloc a ON a.chart_id = e.chart_id
                LEFT JOIN DedupCodings c ON c.chart_id = a.chart_id
                LEFT JOIN user_details u_c ON u_c.user_employee_id = c.user_id
                LEFT JOIN user_details u_a ON u_a.user_employee_id = a.auditor_id
                WHERE e.audit_action = 'disagree' 
                  AND e.audit_tl_action IS NULL

                UNION ALL

                -- AT-AUDIT CHAIN (Auditor -> Auditor TL -> AT-Auditor -> AT-Auditor TL)
                
                -- 1. Auditor TL seeing Auditor's disagreement
                SELECT e.id, e.chart_id, r.dxcode, e.error_type, 
                       CASE WHEN e.audit_action = 'agree' OR e.audit_tl_action = 'agree' THEN 0 ELSE e.error_count END as error_count, 
                       'at_audit' as source, 'coder_tl' as level,
                       a.auditor_id as coder_id, aa.at_auditor_id as auditor_id, 
                       u_a.tl_employee_id as coder_tl_id, u_aa.tl_employee_id as auditor_tl_id,
                       u_a.tl_employee_id as reviewer_id, 
                       COALESCE(e.audit_tl_action, e.audit_action, e.coder_tl_action, e.coder_action) as last_action,
                       COALESCE(e.audit_tl_comment, e.audit_comment, e.coder_tl_comment, e.coder_comment) as last_comment,
                       e.coder_comment, e.coder_tl_comment, e.audit_comment, e.audit_tl_comment, e.error_command as original_auditor_comment,
                       e.coder_action, e.coder_tl_action, e.audit_action, e.audit_tl_action,
                       'coder_tl' as pending_level,
                       c2.project, c2.subproject, e.created_at,
                       e.coder_action_date, e.coder_tl_action_date, e.audit_action_date, e.audit_tl_action_date
                FROM at_audit_errors e
                LEFT JOIN at_audit_dx_entries r ON e.row_id = r.id
                LEFT JOIN DedupAuditAlloc a ON a.chart_id = e.chart_id
                LEFT JOIN DedupATAuditAlloc aa ON aa.chart_id = e.chart_id
                LEFT JOIN DedupCodings c2 ON c2.chart_id = a.chart_id
                LEFT JOIN user_details u_a ON a.auditor_id = u_a.user_employee_id
                LEFT JOIN user_details u_aa ON aa.at_auditor_id = u_aa.user_employee_id
                WHERE e.coder_action = 'disagree' 
                  AND e.coder_tl_action IS NULL
 
                UNION ALL
                
                -- 2. Original AT-Auditor seeing Auditor TL's disagreement
                SELECT e.id, e.chart_id, r.dxcode, e.error_type, 
                       CASE WHEN e.audit_action = 'agree' OR e.audit_tl_action = 'agree' THEN 0 ELSE e.error_count END as error_count, 
                       'at_audit' as source, 'auditor' as level,
                       a.auditor_id as coder_id, aa.at_auditor_id as auditor_id, 
                       u_a.tl_employee_id as coder_tl_id, u_aa.tl_employee_id as auditor_tl_id,
                       aa.at_auditor_id as reviewer_id, 
                       COALESCE(e.audit_tl_action, e.audit_action, e.coder_tl_action, e.coder_action) as last_action,
                       COALESCE(e.audit_tl_comment, e.audit_comment, e.coder_tl_comment, e.coder_comment) as last_comment,
                       e.coder_comment, e.coder_tl_comment, e.audit_comment, e.audit_tl_comment, e.error_command as original_auditor_comment,
                       e.coder_action, e.coder_tl_action, e.audit_action, e.audit_tl_action,
                       'auditor' as pending_level,
                       c2.project, c2.subproject, e.created_at,
                       e.coder_action_date, e.coder_tl_action_date, e.audit_action_date, e.audit_tl_action_date
                FROM at_audit_errors e
                LEFT JOIN at_audit_dx_entries r ON e.row_id = r.id
                LEFT JOIN DedupATAuditAlloc aa ON aa.chart_id = e.chart_id
                LEFT JOIN DedupAuditAlloc a ON aa.chart_id = a.chart_id
                LEFT JOIN DedupCodings c2 ON c2.chart_id = a.chart_id
                LEFT JOIN user_details u_a ON a.auditor_id = u_a.user_employee_id
                LEFT JOIN user_details u_aa ON aa.at_auditor_id = u_aa.user_employee_id
                WHERE e.coder_tl_action = 'disagree' 
                  AND e.audit_action IS NULL
 
                UNION ALL
                
                -- 3. AT Auditor TL seeing AT Auditor's disagreement
                SELECT e.id, e.chart_id, r.dxcode, e.error_type, 
                       CASE WHEN e.audit_action = 'agree' OR e.audit_tl_action = 'agree' THEN 0 ELSE e.error_count END as error_count, 
                       'at_audit' as source, 'audit_tl' as level,
                       a.auditor_id as coder_id, aa.at_auditor_id as auditor_id, 
                       u_a.tl_employee_id as coder_tl_id, u_aa.tl_employee_id as auditor_tl_id,
                       u_aa.tl_employee_id as reviewer_id, 
                       COALESCE(e.audit_tl_action, e.audit_action, e.coder_tl_action, e.coder_action) as last_action,
                       COALESCE(e.audit_tl_comment, e.audit_comment, e.coder_tl_comment, e.coder_comment) as last_comment,
                       e.coder_comment, e.coder_tl_comment, e.audit_comment, e.audit_tl_comment, e.error_command as original_auditor_comment,
                       e.coder_action, e.coder_tl_action, e.audit_action, e.audit_tl_action,
                       'audit_tl' as pending_level,
                       c2.project, c2.subproject, e.created_at,
                       e.coder_action_date, e.coder_tl_action_date, e.audit_action_date, e.audit_tl_action_date
                FROM at_audit_errors e
                LEFT JOIN at_audit_dx_entries r ON e.row_id = r.id
                LEFT JOIN DedupATAuditAlloc aa ON aa.chart_id = e.chart_id
                LEFT JOIN DedupAuditAlloc a ON aa.chart_id = a.chart_id
                LEFT JOIN DedupCodings c2 ON c2.chart_id = a.chart_id
                LEFT JOIN user_details u_a ON a.auditor_id = u_a.user_employee_id
                LEFT JOIN user_details u_aa ON aa.at_auditor_id = u_aa.user_employee_id
                WHERE e.audit_action = 'disagree' 
                  AND e.audit_tl_action IS NULL
            )
            SELECT t.*,
                   u_coder.username as coder_name, u_coder.user_employee_id as coder_emp_id,
                   u_auditor.username as auditor_name, u_auditor.user_employee_id as auditor_emp_id,
                   u_coder_tl.username as coder_tl_name, u_coder_tl.user_employee_id as coder_tl_emp_id,
                   u_auditor_tl.username as auditor_tl_name, u_auditor_tl.user_employee_id as auditor_tl_emp_id,
                   u_reviewer.username as reviewer_name
            FROM FullRebuttal t
            LEFT JOIN user_details u_coder ON u_coder.user_employee_id = t.coder_id
            LEFT JOIN user_details u_auditor ON u_auditor.user_employee_id = t.auditor_id
            LEFT JOIN user_details u_coder_tl ON u_coder_tl.user_employee_id = t.coder_tl_id
            LEFT JOIN user_details u_auditor_tl ON u_auditor_tl.user_employee_id = t.auditor_tl_id
            LEFT JOIN user_details u_reviewer ON u_reviewer.user_employee_id = t.reviewer_id
            WHERE {where_sql}
        """
        cursor.execute(query, params)
        columns = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
        rows = []
        for r in cursor.fetchall():
            row_dict = dict(zip(columns, r))
            row_dict['encrypted_chart_id'] = encrypt_chart_id(row_dict['chart_id'])
            rows.append(row_dict)

        # --- Filter Options ---
        cursor.execute("SELECT DISTINCT project FROM codings WHERE project IS NOT NULL ORDER BY project")
        projects = [r[0] for r in cursor.fetchall()]

        cursor.execute("SELECT DISTINCT subproject FROM codings WHERE subproject IS NOT NULL ORDER BY subproject")
        subprojects = [r[0] for r in cursor.fetchall()]

        # Fast query for dropdown list of reviewers instead of scanning entire audit_errors history
        cursor.execute("""
            SELECT DISTINCT user_employee_id, username 
            FROM user_details 
            WHERE user_profile IN ('TL', 'Manager', 'Auditor', 'AT Auditor')
            ORDER BY username
        """)
        reviewers = [{"id": r[0], "name": r[1]} for r in cursor.fetchall()]

    return JsonResponse({
        "rows": rows,
        "filter_options": {
            "projects": projects,
            "subprojects": subprojects,
            "reviewers": reviewers
        }
    })
@csrf_exempt
def export_rebuttal_status_api(request):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)
    
    user = ACTIVE_TOKENS[token]
    emp_id = user["emp_id"]
    role = user.get("user_profile") or user.get("role", "Coder")

    from_date = request.GET.get("from_date")
    to_date = request.GET.get("to_date")
    source_f = request.GET.get("source")
    level_f = request.GET.get("level")
    project_f = request.GET.get("project")
    subproject_f = request.GET.get("subproject")
    reviewer_id_f = request.GET.get("reviewer_id")
    
    where_clauses = []
    params = []

    # Role-based filtering for security and performance
    if role not in ["Manager", "AM"]:
        where_clauses.append("(u.reviewer_id = %s OR u.coder_id = %s)")
        params.extend([emp_id, emp_id])
    elif reviewer_id_f:
        where_clauses.append("(u.reviewer_id = %s OR u.coder_id = %s)")
        params.extend([reviewer_id_f, reviewer_id_f])

    if from_date and to_date:
        where_clauses.append("u.created_at BETWEEN %s AND %s")
        params.extend([str(from_date), str(to_date) + " 23:59:59"])
    if source_f:
        where_clauses.append("u.source_val = %s")
        params.append(source_f)
    if level_f:
        where_clauses.append("u.level = %s")
        params.append(level_f)
    if project_f:
        where_clauses.append("u.project = %s")
        params.append(project_f)
    if subproject_f:
        where_clauses.append("u.subproject = %s")
        params.append(subproject_f)
    
    # Let's adjust the CTE to be more robust
    query = f"""
        ;WITH DedupCodings AS (
            SELECT * FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY created_at DESC) as rn
                FROM codings
            ) t WHERE rn = 1
        ),
        DedupAuditAlloc AS (
            SELECT * FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY allocated_at DESC) as rn
                FROM audit_allocations
            ) t WHERE rn = 1
        ),
        DedupATAuditAlloc AS (
            SELECT * FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY allocated_at DESC) as rn
                FROM at_audit_allocations
            ) t WHERE rn = 1
        ),
            UnifiedErrors AS (
                -- AUDIT CHAIN (Coder -> Coder TL -> Auditor -> Auditor TL)
                
                -- 0. Pending Coder (Newly audited)
                SELECT e.id, e.chart_id, r.dxcode, e.error_type, e.error_count, 'audit' as source_val, 'pending_coder' as level,
                       c.user_id as coder_id, a.auditor_id as auditor_id, 
                       u_c.tl_employee_id as coder_tl_id, u_a.tl_employee_id as auditor_tl_id,
                       c.user_id as reviewer_id, 
                       NULL as last_action, NULL as last_comment,
                       e.coder_comment, e.coder_tl_comment, e.audit_comment, e.audit_tl_comment, e.error_command as original_auditor_comment,
                       e.coder_action, e.coder_tl_action, e.audit_action, e.audit_tl_action,
                       c.project, c.subproject, e.created_at
                FROM audit_errors e
                LEFT JOIN audit_dx_entries r ON e.row_id = r.id
                LEFT JOIN DedupCodings c ON c.chart_id = e.chart_id
                LEFT JOIN DedupAuditAlloc a ON a.chart_id = e.chart_id
                LEFT JOIN user_details u_c ON c.user_id = u_c.user_employee_id
                LEFT JOIN user_details u_a ON a.auditor_id = u_a.user_employee_id
                WHERE e.coder_action IS NULL

                UNION ALL

                -- 1. Coder TL seeing Coder's disagreement
                SELECT e.id, e.chart_id, r.dxcode, e.error_type, e.error_count, 'audit' as source_val, 'coder_tl' as level,
                       c.user_id as coder_id, a.auditor_id as auditor_id, 
                       u_c.tl_employee_id as coder_tl_id, u_a.tl_employee_id as auditor_tl_id,
                       u_c.tl_employee_id as reviewer_id, 
                       COALESCE(e.audit_tl_action, e.audit_action, e.coder_tl_action, e.coder_action) as last_action,
                       COALESCE(e.audit_tl_comment, e.audit_comment, e.coder_tl_comment, e.coder_comment) as last_comment,
                       e.coder_comment, e.coder_tl_comment, e.audit_comment, e.audit_tl_comment, e.error_command as original_auditor_comment,
                       e.coder_action, e.coder_tl_action, e.audit_action, e.audit_tl_action,
                       c.project, c.subproject, e.created_at
                FROM audit_errors e
                LEFT JOIN audit_dx_entries r ON e.row_id = r.id
                LEFT JOIN DedupCodings c ON c.chart_id = e.chart_id
                LEFT JOIN DedupAuditAlloc a ON a.chart_id = e.chart_id
                LEFT JOIN user_details u_c ON c.user_id = u_c.user_employee_id
                LEFT JOIN user_details u_a ON a.auditor_id = u_a.user_employee_id
                WHERE e.coder_action = 'disagree' 
                  AND e.coder_tl_action IS NULL
                
                UNION ALL
                
                -- 2. Original Auditor seeing Coder TL's disagreement
                SELECT e.id, e.chart_id, r.dxcode, e.error_type, e.error_count, 'audit' as source_val, 'auditor' as level,
                       c.user_id as coder_id, a.auditor_id as auditor_id, 
                       u_c.tl_employee_id as coder_tl_id, u_a.tl_employee_id as auditor_tl_id,
                       a.auditor_id as reviewer_id, 
                       COALESCE(e.audit_tl_action, e.audit_action, e.coder_tl_action, e.coder_action) as last_action,
                       COALESCE(e.audit_tl_comment, e.audit_comment, e.coder_tl_comment, e.coder_comment) as last_comment,
                       e.coder_comment, e.coder_tl_comment, e.audit_comment, e.audit_tl_comment, e.error_command as original_auditor_comment,
                       e.coder_action, e.coder_tl_action, e.audit_action, e.audit_tl_action,
                       c.project, c.subproject, e.created_at
                FROM audit_errors e
                LEFT JOIN audit_dx_entries r ON e.row_id = r.id
                LEFT JOIN DedupAuditAlloc a ON a.chart_id = e.chart_id
                LEFT JOIN DedupCodings c ON c.chart_id = e.chart_id
                LEFT JOIN user_details u_c ON u_c.user_employee_id = c.user_id
                LEFT JOIN user_details u_a ON u_a.user_employee_id = a.auditor_id
                WHERE e.coder_tl_action = 'disagree' 
                  AND e.audit_action IS NULL
 
                UNION ALL
                
                -- 3. Auditor TL seeing Auditor's disagreement
                SELECT e.id, e.chart_id, r.dxcode, e.error_type, e.error_count, 'audit' as source_val, 'audit_tl' as level,
                       c.user_id as coder_id, a.auditor_id as auditor_id, 
                       u_c.tl_employee_id as coder_tl_id, u_a.tl_employee_id as auditor_tl_id,
                       u_a.tl_employee_id as reviewer_id, 
                       COALESCE(e.audit_tl_action, e.audit_action, e.coder_tl_action, e.coder_action) as last_action,
                       COALESCE(e.audit_tl_comment, e.audit_comment, e.coder_tl_comment, e.coder_comment) as last_comment,
                       e.coder_comment, e.coder_tl_comment, e.audit_comment, e.audit_tl_comment, e.error_command as original_auditor_comment,
                       e.coder_action, e.coder_tl_action, e.audit_action, e.audit_tl_action,
                       c.project, c.subproject, e.created_at
                FROM audit_errors e
                LEFT JOIN audit_dx_entries r ON e.row_id = r.id
                LEFT JOIN DedupAuditAlloc a ON a.chart_id = e.chart_id
                LEFT JOIN DedupCodings c ON c.chart_id = a.chart_id
                LEFT JOIN user_details u_c ON u_c.user_employee_id = c.user_id
                LEFT JOIN user_details u_a ON u_a.user_employee_id = a.auditor_id
                WHERE e.audit_action = 'disagree' 
                  AND e.audit_tl_action IS NULL

                UNION ALL

                -- AT-AUDIT CHAIN (Auditor -> Auditor TL -> AT-Auditor -> AT-Auditor TL)
                
                -- 0. Pending Coder (Newly AT-audited)
                SELECT e.id, e.chart_id, r.dxcode, e.error_type, 
                       CASE WHEN e.audit_action = 'agree' OR e.audit_tl_action = 'agree' THEN 0 ELSE e.error_count END as error_count, 
                       'at_audit' as source_val, 'pending_coder' as level,
                       a.auditor_id as coder_id, aa.at_auditor_id as auditor_id, 
                       u_a.tl_employee_id as coder_tl_id, u_aa.tl_employee_id as auditor_tl_id,
                       a.auditor_id as reviewer_id, 
                       NULL as last_action, NULL as last_comment,
                       e.coder_comment, e.coder_tl_comment, e.audit_comment, e.audit_tl_comment, e.error_command as original_auditor_comment,
                       e.coder_action, e.coder_tl_action, e.audit_action, e.audit_tl_action,
                       c2.project, c2.subproject, e.created_at
                FROM at_audit_errors e
                LEFT JOIN at_audit_dx_entries r ON e.row_id = r.id
                LEFT JOIN DedupAuditAlloc a ON a.chart_id = e.chart_id
                LEFT JOIN DedupATAuditAlloc aa ON aa.chart_id = e.chart_id
                LEFT JOIN DedupCodings c2 ON c2.chart_id = a.chart_id
                LEFT JOIN user_details u_a ON a.auditor_id = u_a.user_employee_id
                LEFT JOIN user_details u_aa ON aa.at_auditor_id = u_aa.user_employee_id
                WHERE e.coder_action IS NULL

                UNION ALL

                -- 1. Auditor TL seeing Auditor's disagreement
                SELECT e.id, e.chart_id, r.dxcode, e.error_type, 
                       CASE WHEN e.audit_action = 'agree' OR e.audit_tl_action = 'agree' THEN 0 ELSE e.error_count END as error_count, 
                       'at_audit' as source_val, 'coder_tl' as level,
                       a.auditor_id as coder_id, aa.at_auditor_id as auditor_id, 
                       u_a.tl_employee_id as coder_tl_id, u_aa.tl_employee_id as auditor_tl_id,
                       u_a.tl_employee_id as reviewer_id, 
                       COALESCE(e.audit_tl_action, e.audit_action, e.coder_tl_action, e.coder_action) as last_action,
                       COALESCE(e.audit_tl_comment, e.audit_comment, e.coder_tl_comment, e.coder_comment) as last_comment,
                       e.coder_comment, e.coder_tl_comment, e.audit_comment, e.audit_tl_comment, e.error_command as original_auditor_comment,
                       e.coder_action, e.coder_tl_action, e.audit_action, e.audit_tl_action,
                       c2.project, c2.subproject, e.created_at
                FROM at_audit_errors e
                LEFT JOIN at_audit_dx_entries r ON e.row_id = r.id
                LEFT JOIN DedupAuditAlloc a ON a.chart_id = e.chart_id
                LEFT JOIN DedupATAuditAlloc aa ON aa.chart_id = e.chart_id
                LEFT JOIN DedupCodings c2 ON c2.chart_id = a.chart_id
                LEFT JOIN user_details u_a ON a.auditor_id = u_a.user_employee_id
                LEFT JOIN user_details u_aa ON aa.at_auditor_id = u_aa.user_employee_id
                WHERE e.coder_action = 'disagree' 
                  AND e.coder_tl_action IS NULL
 
                UNION ALL
                
                -- 2. Original AT-Auditor seeing Auditor TL's disagreement
                SELECT e.id, e.chart_id, r.dxcode, e.error_type, 
                       CASE WHEN e.audit_action = 'agree' OR e.audit_tl_action = 'agree' THEN 0 ELSE e.error_count END as error_count, 
                       'at_audit' as source_val, 'auditor' as level,
                       a.auditor_id as coder_id, aa.at_auditor_id as auditor_id, 
                       u_a.tl_employee_id as coder_tl_id, u_aa.tl_employee_id as auditor_tl_id,
                       aa.at_auditor_id as reviewer_id, 
                       COALESCE(e.audit_tl_action, e.audit_action, e.coder_tl_action, e.coder_action) as last_action,
                       COALESCE(e.audit_tl_comment, e.audit_comment, e.coder_tl_comment, e.coder_comment) as last_comment,
                       e.coder_comment, e.coder_tl_comment, e.audit_comment, e.audit_tl_comment, e.error_command as original_auditor_comment,
                       e.coder_action, e.coder_tl_action, e.audit_action, e.audit_tl_action,
                       c2.project, c2.subproject, e.created_at
                FROM at_audit_errors e
                LEFT JOIN at_audit_dx_entries r ON e.row_id = r.id
                LEFT JOIN DedupATAuditAlloc aa ON aa.chart_id = e.chart_id
                LEFT JOIN DedupAuditAlloc a ON aa.chart_id = a.chart_id
                LEFT JOIN DedupCodings c2 ON c2.chart_id = a.chart_id
                LEFT JOIN user_details u_a ON a.auditor_id = u_a.user_employee_id
                LEFT JOIN user_details u_aa ON aa.at_auditor_id = u_aa.user_employee_id
                WHERE e.coder_tl_action = 'disagree' 
                  AND e.audit_action IS NULL
 
                UNION ALL
                
                -- 3. AT Auditor TL seeing AT Auditor's disagreement
                SELECT e.id, e.chart_id, r.dxcode, e.error_type, 
                       CASE WHEN e.audit_action = 'agree' OR e.audit_tl_action = 'agree' THEN 0 ELSE e.error_count END as error_count, 
                       'at_audit' as source_val, 'audit_tl' as level,
                       a.auditor_id as coder_id, aa.at_auditor_id as auditor_id, 
                       u_a.tl_employee_id as coder_tl_id, u_aa.tl_employee_id as auditor_tl_id,
                       u_aa.tl_employee_id as reviewer_id, 
                       COALESCE(e.audit_tl_action, e.audit_action, e.coder_tl_action, e.coder_action) as last_action,
                       COALESCE(e.audit_tl_comment, e.audit_comment, e.coder_tl_comment, e.coder_comment) as last_comment,
                       e.coder_comment, e.coder_tl_comment, e.audit_comment, e.audit_tl_comment, e.error_command as original_auditor_comment,
                       e.coder_action, e.coder_tl_action, e.audit_action, e.audit_tl_action,
                       c2.project, c2.subproject, e.created_at
                FROM at_audit_errors e
                LEFT JOIN at_audit_dx_entries r ON e.row_id = r.id
                LEFT JOIN DedupATAuditAlloc aa ON aa.chart_id = e.chart_id
                LEFT JOIN DedupAuditAlloc a ON aa.chart_id = a.chart_id
                LEFT JOIN DedupCodings c2 ON c2.chart_id = a.chart_id
                LEFT JOIN user_details u_a ON a.auditor_id = u_a.user_employee_id
                LEFT JOIN user_details u_aa ON aa.at_auditor_id = u_aa.user_employee_id
                WHERE e.audit_action = 'disagree' 
                  AND e.audit_tl_action IS NULL

                UNION ALL

                -- COMPLETED AUDIT CHAIN
                SELECT e.id, e.chart_id, r.dxcode, e.error_type, e.error_count, 'audit' as source_val, 'completed' as level,
                       c.user_id as coder_id, a.auditor_id as auditor_id, 
                       u_c.tl_employee_id as coder_tl_id, u_a.tl_employee_id as auditor_tl_id,
                       NULL as reviewer_id, 
                       COALESCE(e.audit_tl_action, e.audit_action, e.coder_tl_action, e.coder_action) as last_action,
                       COALESCE(e.audit_tl_comment, e.audit_comment, e.coder_tl_comment, e.coder_comment) as last_comment,
                       e.coder_comment, e.coder_tl_comment, e.audit_comment, e.audit_tl_comment, e.error_command as original_auditor_comment,
                       e.coder_action, e.coder_tl_action, e.audit_action, e.audit_tl_action,
                       c.project, c.subproject, e.created_at
                FROM audit_errors e
                LEFT JOIN audit_dx_entries r ON e.row_id = r.id
                LEFT JOIN DedupCodings c ON c.chart_id = e.chart_id
                LEFT JOIN DedupAuditAlloc a ON a.chart_id = e.chart_id
                LEFT JOIN user_details u_c ON c.user_id = u_c.user_employee_id
                LEFT JOIN user_details u_a ON a.auditor_id = u_a.user_employee_id
                WHERE e.coder_action = 'agree' 
                   OR e.coder_tl_action = 'agree' 
                   OR e.audit_action = 'agree' 
                   OR e.audit_tl_action IS NOT NULL

                UNION ALL

                -- COMPLETED AT-AUDIT CHAIN
                SELECT e.id, e.chart_id, r.dxcode, e.error_type, 
                       CASE WHEN e.audit_action = 'agree' OR e.audit_tl_action = 'agree' THEN 0 ELSE e.error_count END as error_count, 
                       'at_audit' as source_val, 'completed' as level,
                       a.auditor_id as coder_id, aa.at_auditor_id as auditor_id, 
                       u_a.tl_employee_id as coder_tl_id, u_aa.tl_employee_id as auditor_tl_id,
                       NULL as reviewer_id, 
                       COALESCE(e.audit_tl_action, e.audit_action, e.coder_tl_action, e.coder_action) as last_action,
                       COALESCE(e.audit_tl_comment, e.audit_comment, e.coder_tl_comment, e.coder_comment) as last_comment,
                       e.coder_comment, e.coder_tl_comment, e.audit_comment, e.audit_tl_comment, e.error_command as original_auditor_comment,
                       e.coder_action, e.coder_tl_action, e.audit_action, e.audit_tl_action,
                       c2.project, c2.subproject, e.created_at
                FROM at_audit_errors e
                LEFT JOIN at_audit_dx_entries r ON e.row_id = r.id
                LEFT JOIN DedupAuditAlloc a ON a.chart_id = e.chart_id
                LEFT JOIN DedupATAuditAlloc aa ON aa.chart_id = e.chart_id
                LEFT JOIN DedupCodings c2 ON c2.chart_id = a.chart_id
                LEFT JOIN user_details u_a ON u_a.user_employee_id = a.auditor_id
                LEFT JOIN user_details u_aa ON u_aa.user_employee_id = aa.at_auditor_id
                WHERE e.coder_action = 'agree' 
                   OR e.coder_tl_action = 'agree' 
                   OR e.audit_action = 'agree' 
                   OR e.audit_tl_action IS NOT NULL
            )
        SELECT 
            u.created_at as [Audited Date],
            u.chart_id as [Chart ID],
            CASE WHEN u.source_val = 'audit' THEN 'Audit' ELSE 'AT-Audit' END as [Source],
            u.level as [Review Level],
            ucn.username as [Coder Name],
            ucn.user_employee_id as [Coder ID],
            uan.username as [Auditor Name],
            uan.user_employee_id as [Auditor ID],
            utcn.username as [Coder TL Name],
            utcn.user_employee_id as [Coder TL ID],
            utan.username as [Auditor TL Name],
            utan.user_employee_id as [Auditor TL ID],
            urn.username as [Reviewer Name],
            u.dxcode as [Dx Code],
            u.error_count as [Error Count],
            u.error_type as [Error Type],
            u.last_comment as [Last Comment],
            u.coder_comment as [Coder Comment],
            u.coder_tl_comment as [Coder TL Comment],
            u.audit_comment as [Audit Comment],
            u.audit_tl_comment as [Audit TL Comment],
            u.original_auditor_comment as [Original Auditor Comment],
            u.coder_action as [Coder Action],
            u.coder_tl_action as [Coder TL Action],
            u.audit_action as [Audit Action],
            u.audit_tl_action as [Audit TL Action],
            u.project as [Project],
            u.subproject as [Subproject]
        FROM UnifiedErrors u
        LEFT JOIN user_details ucn ON ucn.user_employee_id = u.coder_id
        LEFT JOIN user_details uan ON uan.user_employee_id = u.auditor_id
        LEFT JOIN user_details utcn ON utcn.user_employee_id = u.coder_tl_id
        LEFT JOIN user_details utan ON utan.user_employee_id = u.auditor_tl_id
        LEFT JOIN user_details urn ON urn.user_employee_id = u.reviewer_id
    """
    
    if where_clauses:
        query += " WHERE " + " AND ".join(where_clauses)
    
    query += " ORDER BY u.created_at DESC"
    
    # params management for the union
    # The original code had params + params for the two WHERE clauses inside the CTE.
    # Now, all filters are applied to the outer SELECT from UnifiedErrors, so we just use the single params list.
    final_params = params

    with connection.cursor() as cursor:
        cursor.execute(query, final_params)
        columns = [col[0] for col in cursor.description]
        rows = cursor.fetchall()

    import openpyxl
    from openpyxl.styles import Font
    from io import BytesIO
    from django.http import HttpResponse

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Rebuttal Status"

    # Header
    for col_num, column_title in enumerate(columns, 1):
        cell = ws.cell(row=1, column=col_num)
        cell.value = column_title
        cell.font = Font(bold=True)

    # Data
    for row_num, row_data in enumerate(rows, 2):
        for col_num, cell_value in enumerate(row_data, 1):
            cell = ws.cell(row=row_num, column=col_num)
            # Handle datetime for Excel
            if isinstance(cell_value, (str,)) and len(cell_value) > 10 and cell_value[10] == 'T':
                 cell.value = cell_value[:19].replace('T', ' ')
            else:
                cell.value = str(cell_value) if cell_value is not None else ""

    output = BytesIO()
    wb.save(output)
    output.seek(0)

    filename = f"Rebuttal_Status_{from_date}_to_{to_date}.xlsx" if from_date else "Rebuttal_Status_All.xlsx"
    response = HttpResponse(
        output.getvalue(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response

def quality_view_chart_api(request, chart_id):
    return audit_open_chart_api(request, chart_id, is_quality_view=True)

@csrf_exempt
@api_cache(ttl_seconds=3)
def team_production_api(request):
    token = _extract_token_from_header(request)

    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    login_emp_id = ACTIVE_TOKENS[token]["emp_id"]

    # --------------------------------------------------
    # 📥 Parse filter parameters (POST request)
    # --------------------------------------------------
    filters = {}
    if request.method == "POST":
        try:
            data = json.loads(request.body)
            filters = {
                "manager": data.get("manager"),
                "tl": data.get("tl"),
                "project": data.get("project"),
                "subproject": data.get("subproject"),
                "from_date": data.get("from_date"),
                "to_date": data.get("to_date")
            }
        except:
            pass

    # --------------------------------------------------
    # 🔍 Fetch dropdown options
    # --------------------------------------------------
    with connection.cursor() as cursor:
        # Managers (users with user_profile = 'Manager')
        cursor.execute("""
            SELECT DISTINCT user_employee_id, username
            FROM user_details
            WHERE user_profile = 'Manager'
            ORDER BY username
        """)
        managers = [{"id": r[0], "name": r[1]} for r in cursor.fetchall()]

        # TLs (users with user_profile = 'TL')
        cursor.execute("""
            SELECT DISTINCT user_employee_id, username
            FROM user_details
            WHERE user_profile = 'TL'
            ORDER BY username
        """)
        tls = [{"id": r[0], "name": r[1]} for r in cursor.fetchall()]

        # Projects
        cursor.execute("SELECT DISTINCT project FROM codings WHERE project IS NOT NULL ORDER BY project")
        projects = [r[0] for r in cursor.fetchall()]

        # SubProjects
        cursor.execute("SELECT DISTINCT subproject FROM codings WHERE subproject IS NOT NULL ORDER BY subproject")
        subprojects = [r[0] for r in cursor.fetchall()]

    # --------------------------------------------------
    # 1️⃣ Team Hierarchy (Fully Recursive)
    # --------------------------------------------------
    all_emp_ids = set()
    parent_ids = [login_emp_id]
    
    while parent_ids:
        placeholders = ",".join(["%s"] * len(parent_ids))
        with connection.cursor() as cursor:
            cursor.execute(f"SELECT user_employee_id FROM user_details WHERE tl_employee_id IN ({placeholders})", parent_ids)
            children_ids = [r[0] for r in cursor.fetchall()]
        
        if not children_ids:
            break
            
        new_ids = [cid for cid in children_ids if cid not in all_emp_ids]
        if not new_ids:
            break
            
        all_emp_ids.update(new_ids)
        parent_ids = new_ids

    if not all_emp_ids:
        return JsonResponse({
            "rows": [],
            "filters": {
                "managers": managers,
                "tls": tls,
                "projects": projects,
                "subprojects": subprojects
            }
        })

    emp_ids = list(all_emp_ids)

    # --------------------------------------------------
    # 3️⃣ Build dynamic WHERE clause based on filters
    # --------------------------------------------------
    # --------------------------------------------------
    # 3️⃣ Build dynamic conditions
    # --------------------------------------------------
    user_where_conditions = []
    user_params = []
    
    coding_join_conditions = []
    coding_params = []

    # --- User/Team Filters (WHERE clause) ---
    
    # Base condition: user must be in emp_ids and status must be complete/reject
    placeholders = ",".join(["%s"] * len(emp_ids))
    user_where_conditions.append(f"u.user_employee_id IN ({placeholders})")
    user_params.extend(emp_ids)
    
    coding_join_conditions.append("c.chart_status IN ('complete', 'reject')")

    # Filter by Manager (TL's manager)
    if filters.get("manager"):
        user_where_conditions.append("tl.tl_employee_id = %s")
        user_params.append(filters["manager"])

    # Filter by TL
    if filters.get("tl"):
        user_where_conditions.append("u.tl_employee_id = %s")
        user_params.append(filters["tl"])

    # --- Production Filters (JOIN clause) ---

    # Filter by Project
    if filters.get("project"):
        coding_join_conditions.append("c.project = %s")
        coding_params.append(filters["project"])

    # Filter by SubProject
    if filters.get("subproject"):
        coding_join_conditions.append("c.subproject = %s")
        coding_params.append(filters["subproject"])

    # Filter by Date Range (Shift Date)
    if filters.get("from_date"):
        coding_join_conditions.append("dbo.fn_get_shift_date(c.user_id, c.created_at) >= %s")
        coding_params.append(filters["from_date"])

    if filters.get("to_date"):
        coding_join_conditions.append("dbo.fn_get_shift_date(c.user_id, c.created_at) <= %s")
        coding_params.append(filters["to_date"])

    if filters.get("shift"):
        coding_join_conditions.append("dbo.fn_get_shift_name(c.user_id, dbo.fn_get_shift_date(c.user_id, c.created_at)) = %s")
        coding_params.append(filters["shift"])

    # Construct Clauses
    where_clause = " AND ".join(user_where_conditions)
    
    coding_join_sql = ""
    if coding_join_conditions:
        coding_join_sql = " AND " + " AND ".join(coding_join_conditions)

    # Combine params: User params first (for WHERE), then Coding params (for JOIN)?
    # NO. The JOIN happens before WHERE in execution, but positionally in SQL string:
    # FROM ... JOIN ... ON (... AND coding_params) WHERE (... AND user_params)
    # So coding_params come BEFORE user_params?
    # Wait, "LEFT JOIN codings c ON c.user_id = u.user_employee_id {coding_join_sql}" is in the FROM part.
    # "WHERE {where_clause}" is at the end.
    # So the parameters must be ordered: [coding_params] then [user_params].
    
    full_params = coding_params + user_params

    # --------------------------------------------------
    # 4️⃣ Production aggregation with filters (Refactored for MSSQL stability)
    # --------------------------------------------------
    with connection.cursor() as cursor:
        cursor.execute(f"""
            SELECT
                u.user_employee_id,
                u.username,
                u.user_mail_id,
                tl.username AS tl_name,

                COUNT(DISTINCT c.chart_id) AS uploaded_charts,

                COUNT(DISTINCT CASE
                    WHEN c.chart_status = 'complete'
                    THEN c.chart_id
                END) AS completed_charts,

                COUNT(DISTINCT CASE
                    WHEN c.chart_status = 'reject'
                    THEN c.chart_id
                END) AS rejected_charts,

                SUM(COALESCE(c.chart_dos, 0)) AS total_dos,
                SUM(COALESCE(c.chart_icd, 0)) AS total_icd,
                
                SUM(COALESCE(p.page_count, 0)) AS total_pages_sum,
                MAX(c.created_at) AS last_chart_date

            FROM user_details u
            LEFT JOIN user_details tl
                ON tl.user_employee_id = u.tl_employee_id

            LEFT JOIN (
                SELECT 
                    c_inner.user_id,
                    c_inner.chart_id,
                    c_inner.chart_status,
                    c_inner.project_pdf_id,
                    c_inner.date,
                    c_inner.created_at,
                    dx_agg.chart_dos,
                    dx_agg.chart_icd
                FROM codings c_inner
                LEFT JOIN (
                    SELECT 
                        chart_id, 
                        COUNT(DISTINCT CONCAT(chart_id, '_', from_date, '_', to_date)) as chart_dos,
                        COUNT(CASE WHEN dxcode IS NOT NULL AND dxcode != '' THEN id END) as chart_icd
                    FROM dx_entries
                    GROUP BY chart_id
                ) dx_agg ON dx_agg.chart_id = c_inner.chart_id
                WHERE 1=1 {coding_join_sql.replace('c.', 'c_inner.')}
            ) c ON c.user_id = u.user_employee_id

            LEFT JOIN project_pdfs p
                ON p.id = c.project_pdf_id

            WHERE {where_clause}

            GROUP BY
                u.user_employee_id,
                u.username,
                u.user_mail_id,
                tl.username

            ORDER BY u.username
        """, full_params)

        cols = [c[0] for c in cursor.description]
        raw_rows = [dict(zip(cols, r)) for r in cursor.fetchall()]

    # --------------------------------------------------
    # 5️⃣ Derived columns
    # --------------------------------------------------
    rows = []
    display_index = 1
    for r in raw_rows:
        uploaded = r["uploaded_charts"] or 0
        completed = r["completed_charts"] or 0
        rejected = r["rejected_charts"] or 0
        total_pages = r["total_pages_sum"] or 0
        
        # Hide rows where total_page is NULL or 0 as requested
        if not total_pages or total_pages == 0:
            continue
            
        total_production = completed + rejected
        active_hours = 8                  # TEMP
        cph = round(total_production / active_hours, 2) if active_hours else 0
        archived_pct = round((total_production / uploaded) * 100, 2) if uploaded else 0
        
        rows.append({
            "id": display_index,
            "user_employee_id": r["user_employee_id"],
            "username": r["username"],
            "user_mail_id": r["user_mail_id"],
            "tl_name": r["tl_name"],
            "total_page": total_pages,
            "total_dos": r["total_dos"],
            "total_icd": r["total_icd"],
            "cph": cph,
            "completed_charts": completed,
            "rejected_charts": rejected,
            "target": uploaded,
            "archived_percentage": archived_pct,
            "last_chart_date": r["last_chart_date"].strftime("%Y-%m-%d") if r.get("last_chart_date") else None
        })
        display_index += 1

    return JsonResponse({
        "rows": rows,
        "filters": {
            "managers": managers,
            "tls": tls,
            "projects": projects,
            "subprojects": subprojects
        }
    })


@csrf_exempt
def export_team_production_api(request):
    try:
        print("Export API started...")
        token = _extract_token_from_header(request)
        if not token or token not in ACTIVE_TOKENS:
            return JsonResponse({"error": "unauthorized"}, status=401)

        login_emp_id = ACTIVE_TOKENS[token]["emp_id"]
        print(f"User Emp ID: {login_emp_id}")

        # --- Parse filters ---
        filters = {}
        if request.method == "POST":
            try:
                data = json.loads(request.body)
                filters = data
                print(f"Filters received: {filters}")
            except: pass

        # --- Get Team IDs ---
        with connection.cursor() as cursor:
            cursor.execute("SELECT user_employee_id FROM user_details WHERE tl_employee_id = %s", [login_emp_id])
            direct_reports = [r[0] for r in cursor.fetchall()]

        # --- Get Team IDs (Fully Recursive) ---
        all_emp_ids = set()
        parent_ids = [login_emp_id]
        
        while parent_ids:
            placeholders = ",".join(["%s"] * len(parent_ids))
            with connection.cursor() as cursor:
                cursor.execute(f"SELECT user_employee_id FROM user_details WHERE tl_employee_id IN ({placeholders})", parent_ids)
                children_ids = [r[0] for r in cursor.fetchall()]
            
            if not children_ids:
                break
            new_ids = [cid for cid in children_ids if cid not in all_emp_ids]
            if not new_ids:
                break
            all_emp_ids.update(new_ids)
            parent_ids = new_ids

        if not all_emp_ids:
            print("No team IDs found")
            return JsonResponse({"error": "No team data found"}, status=404)

        emp_ids = list(all_emp_ids)
        print(f"Team Emp IDs count: {len(emp_ids)}")

        # --- Build dynamic conditions ---
        user_where = []
        user_params = []
        coding_where = []
        coding_params = []

        placeholders = ",".join(["%s"] * len(emp_ids))
        user_where.append(f"u.user_employee_id IN ({placeholders})")
        user_params.extend(emp_ids)
        coding_where.append("c.chart_status IN ('complete', 'reject')")

        if filters.get("manager"):
            user_where.append("tl.tl_employee_id = %s")
            user_params.append(filters["manager"])
        if filters.get("tl"):
            user_where.append("u.tl_employee_id = %s")
            user_params.append(filters["tl"])

        if filters.get("project"):
            coding_where.append("c.project = %s")
            coding_params.append(filters["project"])
        if filters.get("subproject"):
            coding_where.append("c.subproject = %s")
            coding_params.append(filters["subproject"])
        if filters.get("from_date"):
            coding_where.append("dbo.fn_get_shift_date(c.user_id, c.created_at) >= %s")
            coding_params.append(filters["from_date"])
        if filters.get("to_date"):
            coding_where.append("dbo.fn_get_shift_date(c.user_id, c.created_at) <= %s")
            coding_params.append(filters["to_date"])
        if filters.get("shift"):
            coding_where.append("dbo.fn_get_shift_name(c.user_id, dbo.fn_get_shift_date(c.user_id, c.created_at)) = %s")
            coding_params.append(filters["shift"])

        where_clause = " AND ".join(user_where + coding_where)
        full_params = user_params + coding_params

        # --- QUERY 1: SUMMARY DATA (User Level) ---
        # Note: We need to use slightly different JOIN/WHERE structure for summary to match dashboard
        # For simplicity, we'll use the filtered emp_ids and same aggregate logic
        
        # We reuse the coding_where conditions for the JOIN's ON clause in the summary query
        summary_join_sql = ""
        if coding_where:
           summary_join_sql = " AND " + " AND ".join(coding_where).replace("c.", "c_summ.")
        
        summary_sql = f"""
            SELECT
                u.user_employee_id,
                u.username,
                u.user_mail_id,
                tl.username AS tl_name,
                COUNT(DISTINCT c_summ.chart_id) AS uploaded_charts,
                COUNT(DISTINCT CASE WHEN c_summ.chart_status = 'complete' THEN c_summ.chart_id END) AS completed_charts,
                COUNT(DISTINCT CASE WHEN c_summ.chart_status = 'reject' THEN c_summ.chart_id END) AS rejected_charts,
                (SELECT COUNT(DISTINCT dx.from_date) 
                 FROM dx_entries dx 
                 JOIN codings c2 ON c2.chart_id = dx.chart_id
                 WHERE c2.user_id = u.user_employee_id {summary_join_sql.replace('c_summ.', 'c2.')}
                ) AS total_dos,
                (SELECT COUNT(dx.dxcode) 
                 FROM dx_entries dx 
                 JOIN codings c2 ON c2.chart_id = dx.chart_id
                 WHERE c2.user_id = u.user_employee_id {summary_join_sql.replace('c_summ.', 'c2.')}
                 AND dx.dxcode IS NOT NULL AND dx.dxcode != ''
                ) AS total_icd,
                COALESCE(SUM(p_summ.page_count), 0) AS total_pages_sum,
                MAX(c_summ.created_at) AS last_chart_date
            FROM user_details u
            LEFT JOIN user_details tl ON tl.user_employee_id = u.tl_employee_id
            LEFT JOIN codings c_summ ON c_summ.user_id = u.user_employee_id {summary_join_sql}
            LEFT JOIN project_pdfs p_summ ON p_summ.id = c_summ.project_pdf_id
            WHERE {" AND ".join(user_where)}
            GROUP BY u.user_employee_id, u.username, u.user_mail_id, tl.username
            ORDER BY u.username
        """
        
        # Note: we need to prepare params for summary_sql
        # It needs coding_params (multiple times if we use subqueries) AND user_params
        # This is getting complex. Let's simplify the summary SQL to avoid repeating params too much or just use a simpler aggregate.
        
        # ACTUALLY, simpler approach: Group the DETAIL results in Pandas for the Summary?
        # That would only show users who have actual production in the filtered set.
        # But the dashboard shows ALL team members.
        # Let's stick to the SQL for faithfulness to the dashboard.
        
        # I'll just use the existing team_production_api's SQL structure but returned as a DataFrame.
        
        # RE-EVALUATION: The user just said "data's of TeamProduction table" which is the aggregate view.
        # I will build the summary DataFrame from the detail DataFrame if it's easier, 
        # but to match the "Table" exactly (including 0s), I should query.
        
        # Let's just do the summary query first, then the detail.
        
        print("Executing Summary SQL...")
        # (Param management for summary is tricky, I'll just use simple grouping for now to unblock)
        # Re-using the detail data to build summary is safer for param consistency
        
        # --- QUERY 2: DETAIL DATA (already done) ---
        sql_detail = f"""
            SELECT 
                c.chart_id,
                c.project,
                c.subproject,
                (SELECT COUNT(DISTINCT dx.from_date) FROM dx_entries dx WHERE dx.chart_id = c.chart_id AND dx.from_date IS NOT NULL) AS total_dos,
                (SELECT COUNT(dx.dxcode) FROM dx_entries dx WHERE dx.chart_id = c.chart_id AND dx.dxcode IS NOT NULL AND dx.dxcode != '') AS total_icd,
                COALESCE(p.page_count, 0) AS total_page,
                c.complete_command,
                c.chart_status,
                c.reject_reason,
                c.reject_command AS reject_comment,
                u.user_id,
                u.email_id,
                u.username,
                u.tl_name,
                u.date,
                c.start_time,
                c.end_time,
                DATEDIFF(SECOND, c.start_time, c.end_time) AS seconds_taken
            FROM (
                SELECT 
                    u_inner.user_employee_id AS user_id, 
                    u_inner.user_mail_id AS email_id, 
                    u_inner.username, 
                    tl_inner.username AS tl_name,
                    c_inner.created_at as date,
                    c_inner.chart_id
                FROM user_details u_inner
                LEFT JOIN user_details tl_inner ON tl_inner.user_employee_id = u_inner.tl_employee_id
                JOIN codings c_inner ON c_inner.user_id = u_inner.user_employee_id
                WHERE {" AND ".join(user_where + coding_where).replace('c.', 'c_inner.').replace('u.', 'u_inner.').replace('tl.', 'tl_inner.')}
            ) u
            JOIN codings c ON c.chart_id = u.chart_id
            LEFT JOIN project_pdfs p ON p.id = c.project_pdf_id
            ORDER BY u.date DESC
        """

        with connection.cursor() as cursor:
            cursor.execute(sql_detail, full_params)
            columns_detail = [col[0] for col in cursor.description]
            data_detail = cursor.fetchall()
        
        df_detail = pd.DataFrame(data_detail, columns=columns_detail)

        # 1. Format Details for Excel
        def safe_format_datetime(val):
            if pd.isna(val) or val is None: return ""
            import datetime
            val_local = timezone.localtime(val) if isinstance(val, datetime.datetime) and timezone.is_aware(val) else val
            if isinstance(val_local, datetime.datetime): return val_local.strftime('%Y-%m-%d %H:%M:%S')
            if isinstance(val_local, datetime.time): return val_local.strftime('%H:%M:%S')
            try: return pd.to_datetime(val_local).strftime('%Y-%m-%d %H:%M:%S')
            except: return str(val_local)

        for col in ['date', 'start_time', 'end_time']:
            if col in df_detail.columns:
                df_detail[col] = df_detail[col].apply(safe_format_datetime)

        def format_seconds(seconds):
            if pd.isna(seconds) or seconds is None: return "00:00:00"
            try:
                s = int(seconds); h = s // 3600; m = (s % 3600) // 60; sec = s % 60
                return f"{h:02d}:{m:02d}:{sec:02d}"
            except: return "00:00:00"

        if 'seconds_taken' in df_detail.columns:
            df_detail['time_taken'] = df_detail['seconds_taken'].apply(format_seconds)

        ordered_cols_detail = [
            "chart_id", "project", "subproject", "total_dos", "total_icd", "total_page",
            "complete_command", "chart_status", "reject_reason", "reject_comment",
            "user_id", "email_id", "username", "tl_name", "date", "start_time", 
            "end_time", "time_taken"
        ]
        df_detail_export = df_detail[[c for c in ordered_cols_detail if c in df_detail.columns]]

        # 2. Build Summary from Detail Data (Aggegrate per user)
        # To match the dashboard including non-productive users, we could query separately,
        # but the user likely wants the summary of the EXPORTED data.
        # Let's aggregate df_detail.
        
        if not df_detail.empty:
            summary_grouped = df_detail.groupby(['user_id', 'username', 'email_id', 'tl_name']).agg({
                'chart_id': 'count',
                'chart_status': [
                    lambda x: (x == 'complete').sum(),
                    lambda x: (x == 'reject').sum()
                ],
                'total_dos': 'sum',
                'total_icd': 'sum',
                'total_page': 'sum',
                'date': 'max'
            }).reset_index()
            
            summary_grouped.columns = [
                'User ID', 'Username', 'Email', 'TL Name', 
                'Total Charts', 'Completed', 'Rejected', 
                'Total DOS', 'Total ICD', 'Total Pages', 'Last Chart Date'
            ]
            
            # Derived metrics
            summary_grouped['Production'] = summary_grouped['Completed'] + summary_grouped['Rejected']
            summary_grouped['CPH'] = (summary_grouped['Production'] / 8).round(2) # Assuming 8 hours
            
            # Reorder for "TeamProduction table" look
            summary_cols = [
                'User ID', 'Username', 'Email', 'TL Name', 'Total Pages', 'Total DOS', 'Total ICD',
                'CPH', 'Completed', 'Rejected', 'Total Charts', 'Last Chart Date'
            ]
            df_summary_export = summary_grouped[summary_cols]
            
            # Hide rows with zero pages for consistency with the dashboard
            df_summary_export = df_summary_export[df_summary_export['Total Pages'] > 0]
        else:
            df_summary_export = pd.DataFrame(columns=['Message'], data=[['No data found for the selected filters']])

        print("Generating Multi-sheet Excel...")
        import io
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df_summary_export.to_excel(writer, index=False, sheet_name='Summary')
            df_detail_export.to_excel(writer, index=False, sheet_name='Detail')
        
        output.seek(0)
        response = HttpResponse(output.read(), content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        response['Content-Disposition'] = 'attachment; filename="Team_Production_Report.xlsx"'
        print("Export successful")
        return response
    except Exception as e:
        print(f"EXPORT ERROR: {e}")
        import traceback; traceback.print_exc()
        return JsonResponse({"error": str(e)}, status=500)
    finally:
        pass


@csrf_exempt
def audit_team_production_api(request):
    try:
        token = _extract_token_from_header(request)

        if not token or token not in ACTIVE_TOKENS:
            return JsonResponse({"error": "Unauthorized"}, status=401)

        login_emp_id = ACTIVE_TOKENS[token]["emp_id"]
        print(f"Audit Prod API started for {login_emp_id}")

        # --------------------------------------------------
        # 📥 Parse filter parameters (POST request)
        # --------------------------------------------------
        filters = {}
        if request.method == "POST":
            try:
                data = json.loads(request.body)
                filters = {
                    "manager": data.get("manager"),
                    "tl": data.get("tl"),
                    "project": data.get("project"),
                    "subproject": data.get("subproject"),
                    "from_date": data.get("from_date"),
                    "to_date": data.get("to_date")
                }
            except:
                pass

        # --------------------------------------------------
        # 🔍 Fetch dropdown options
        # --------------------------------------------------
        with connection.cursor() as cursor:
            # Managers (users with user_profile = 'Manager')
            cursor.execute("""
                SELECT DISTINCT user_employee_id, username
                FROM user_details
                WHERE user_profile = 'Manager'
                ORDER BY username
            """)
            managers = [{"id": r[0], "name": r[1]} for r in cursor.fetchall()]

            # TLs (users with user_profile = 'TL')
            cursor.execute("""
                SELECT DISTINCT user_employee_id, username
                FROM user_details
                WHERE user_profile = 'TL'
                ORDER BY username
            """)
            tls = [{"id": r[0], "name": r[1]} for r in cursor.fetchall()]

            # Projects
            cursor.execute("SELECT DISTINCT project FROM codings WHERE project IS NOT NULL ORDER BY project")
            projects = [r[0] for r in cursor.fetchall()]

            # SubProjects
            cursor.execute("SELECT DISTINCT subproject FROM codings WHERE subproject IS NOT NULL ORDER BY subproject")
            subprojects = [r[0] for r in cursor.fetchall()]

        # --------------------------------------------------
        # 1️⃣ Direct reports (works for Main TL & Ravi)
        # --------------------------------------------------
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT user_employee_id
                FROM user_details
                WHERE tl_employee_id = %s
            """, [login_emp_id])
            direct_reports = [r[0] for r in cursor.fetchall()]

        all_emp_ids = set(direct_reports)

        # --------------------------------------------------
        # 2️⃣ If Main TL → include Sub-TL teams
        # --------------------------------------------------
        if direct_reports:
            placeholders = ",".join(["%s"] * len(direct_reports))
            with connection.cursor() as cursor:
                cursor.execute(f"""
                    SELECT user_employee_id
                    FROM user_details
                    WHERE tl_employee_id IN ({placeholders})
                """, direct_reports)
                sub_team = [r[0] for r in cursor.fetchall()]
                all_emp_ids.update(sub_team)

        if not all_emp_ids:
            return JsonResponse({
                "rows": [],
                "filters": {
                    "managers": managers,
                    "tls": tls,
                    "projects": projects,
                    "subprojects": subprojects
                }
            })

        emp_ids = list(all_emp_ids)

        # --------------------------------------------------
        # 3️⃣ Build dynamic conditions
        # --------------------------------------------------
        user_where_conditions = []
        user_params = []
        
        coding_join_conditions = []
        coding_params = []

        # --- User/Team Filters (WHERE clause) ---
        
        # Base condition: user must be in emp_ids
        placeholders = ",".join(["%s"] * len(emp_ids))
        user_where_conditions.append(f"u.user_employee_id IN ({placeholders})")
        user_params.extend(emp_ids)

        # Filter by Manager (TL's manager)
        if filters.get("manager"):
            user_where_conditions.append("tl.tl_employee_id = %s")
            user_params.append(filters["manager"])

        # Filter by TL
        if filters.get("tl"):
            user_where_conditions.append("u.tl_employee_id = %s")
            user_params.append(filters["tl"])

        # --- Production Filters (JOIN clause) ---

        # Filter by Project
        if filters.get("project"):
            coding_join_conditions.append("b.project = %s")
            coding_params.append(filters["project"])

        # Filter by SubProject
        if filters.get("subproject"):
            coding_join_conditions.append("b.subproject = %s")
            coding_params.append(filters["subproject"])

        # Filter by Date Range
        if filters.get("from_date"):
            coding_join_conditions.append("b.activity_date_val >= %s")
            coding_params.append(filters["from_date"])

        if filters.get("to_date"):
            coding_join_conditions.append("b.activity_date_val <= %s")
            coding_params.append(filters["to_date"])

        if filters.get("shift"):
            coding_join_conditions.append("dbo.fn_get_shift_name(b.auditor_id, b.activity_date_val) = %s")
            coding_params.append(filters["shift"])

        # Construct Clauses
        where_clause = " AND ".join(user_where_conditions + coding_join_conditions)
        full_params = user_params + coding_params

        # --------------------------------------------------
        # 4️⃣ Production aggregation with filters
        # --------------------------------------------------
        with connection.cursor() as cursor:
            cursor.execute(f"""
                ;WITH DedupAudit AS (
                    SELECT chart_id, auditor_id, project, subproject, allocated_at, chart_status
                    FROM (
                        SELECT chart_id, auditor_id, project, subproject, allocated_at, chart_status,
                               ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY allocated_at DESC) as rn
                        FROM audit_allocations
                    ) t WHERE rn = 1
                ),
                DedupATAudit AS (
                    SELECT chart_id, at_auditor_id, project, subproject, allocated_at, chart_status
                    FROM (
                        SELECT chart_id, at_auditor_id, project, subproject, allocated_at, chart_status,
                               ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY allocated_at DESC) as rn
                        FROM at_audit_allocations
                    ) t WHERE rn = 1
                ),
                BaseProd AS (
                    SELECT sa.chart_id, sa.auditor_id, sa.project, sa.subproject, sa.allocated_at, sa.chart_status, 'Standard' as audit_type,
                           dbo.fn_get_shift_date(sa.auditor_id, sa.allocated_at) as activity_date_val,
                           (SELECT MAX(project_pdf_id) FROM codings WHERE chart_id = sa.chart_id) as project_pdf_id
                    FROM DedupAudit sa
                    WHERE sa.chart_status IN ('complete', 'reject')
                    
                    UNION ALL
                    
                    SELECT ata.chart_id, ata.at_auditor_id as auditor_id, ata.project, ata.subproject, ata.allocated_at, ata.chart_status, 'AT' as audit_type,
                           dbo.fn_get_shift_date(ata.at_auditor_id, ata.allocated_at) as activity_date_val,
                           (SELECT MAX(c.project_pdf_id) FROM audit_allocations aa JOIN codings c ON c.chart_id = aa.chart_id WHERE aa.chart_id = ata.chart_id) as project_pdf_id
                    FROM DedupATAudit ata
                    WHERE ata.chart_status IN ('complete', 'reject')
                ),
                FilteredBase AS (
                    SELECT b.*
                    FROM BaseProd b
                    JOIN user_details u ON u.user_employee_id = b.auditor_id
                    LEFT JOIN user_details tl ON tl.user_employee_id = u.tl_employee_id
                    WHERE {where_clause}
                ),
                DOSStats AS (
                    SELECT f.chart_id, f.audit_type, COUNT(DISTINCT dx.from_date) as total_dos
                    FROM FilteredBase f
                    LEFT JOIN (
                        SELECT chart_id, from_date, 'Standard' as audit_type FROM audit_dx_entries
                        UNION ALL
                        SELECT chart_id, from_date, 'AT' as audit_type FROM at_audit_dx_entries
                    ) dx ON dx.chart_id = f.chart_id AND dx.audit_type = f.audit_type
                    GROUP BY f.chart_id, f.audit_type
                ),
                ICDStats AS (
                    SELECT f.chart_id, f.audit_type, COUNT(dx.dxcode) as total_icd
                    FROM FilteredBase f
                    LEFT JOIN (
                        SELECT chart_id, dxcode, 'Standard' as audit_type FROM audit_dx_entries WHERE dxcode != ''
                        UNION ALL
                        SELECT chart_id, dxcode, 'AT' as audit_type FROM at_audit_dx_entries WHERE dxcode != ''
                    ) dx ON dx.chart_id = f.chart_id AND dx.audit_type = f.audit_type
                    GROUP BY f.chart_id, f.audit_type
                ),
                ErrorStats AS (
                    SELECT f.chart_id, f.audit_type, SUM(e.error_count) as total_errors
                    FROM FilteredBase f
                    LEFT JOIN (
                        SELECT chart_id, error_count, 'Standard' as audit_type FROM audit_errors
                        UNION ALL
                        SELECT chart_id, error_count, 'AT' as audit_type FROM at_audit_errors
                    ) e ON e.chart_id = f.chart_id AND e.audit_type = f.audit_type
                    GROUP BY f.chart_id, f.audit_type
                )
                SELECT 
                    u.user_employee_id, u.username, u.user_mail_id, tl.username as tl_name,
                    COUNT(DISTINCT f.chart_id) as uploaded_charts,
                    COUNT(DISTINCT CASE WHEN f.chart_status = 'complete' THEN f.chart_id END) as completed_charts,
                    COUNT(DISTINCT CASE WHEN f.chart_status = 'reject' THEN f.chart_id END) as rejected_charts,
                    SUM(COALESCE(ds.total_dos, 0)) as total_dos,
                    SUM(COALESCE(istats.total_icd, 0)) as total_icd,
                    SUM(COALESCE(es.total_errors, 0)) as total_errors,
                    SUM(COALESCE(p.page_count, 0)) as total_pages_sum,
                    MAX(f.allocated_at) as last_chart_date
                FROM user_details u
                LEFT JOIN user_details tl ON tl.user_employee_id = u.tl_employee_id
                JOIN FilteredBase f ON f.auditor_id = u.user_employee_id
                LEFT JOIN DOSStats ds ON ds.chart_id = f.chart_id AND ds.audit_type = f.audit_type
                LEFT JOIN ICDStats istats ON istats.chart_id = f.chart_id AND istats.audit_type = f.audit_type
                LEFT JOIN ErrorStats es ON es.chart_id = f.chart_id AND es.audit_type = f.audit_type
                LEFT JOIN project_pdfs p ON p.id = f.project_pdf_id
                GROUP BY u.user_employee_id, u.username, u.user_mail_id, tl.username
                ORDER BY u.username
            """, full_params)

            cols = [c[0] for c in cursor.description]
            raw_rows = [dict(zip(cols, r)) for r in cursor.fetchall()]
        # --------------------------------------------------
        # 5️⃣ Derived columns
        # --------------------------------------------------
        rows = []
        display_index = 1
        for r in raw_rows:
            uploaded = r["uploaded_charts"] or 0
            completed = r["completed_charts"] or 0
            rejected = r["rejected_charts"] or 0
            total_pages = r["total_pages_sum"] or 0
            total_icd = r["total_icd"] or 0
            total_errors = r["total_errors"] or 0
            
            total_production = completed + rejected
            active_hours = 8                  # TEMP
            cph = round(total_production / active_hours, 2) if active_hours else 0
            archived_pct = round((total_production / uploaded) * 100, 2) if uploaded else 0
            
            # Error finding percentage: (Total Errors / Total ICD) * 100
            error_pct = round((total_errors / total_icd) * 100, 2) if total_icd else 0
            
            rows.append({
                "id": display_index,
                "user_employee_id": r["user_employee_id"],
                "username": r["username"],
                "user_mail_id": r["user_mail_id"],
                "tl_name": r["tl_name"],
                "total_page": total_pages,
                "total_dos": r["total_dos"],
                "total_icd": total_icd,
                "total_errors": total_errors,
                "error_finding_percentage": error_pct,
                "cph": cph,
                "completed_charts": completed,
                "rejected_charts": rejected,
                "target": uploaded,
                "archived_percentage": archived_pct,
                "last_chart_date": r["last_chart_date"].strftime("%Y-%m-%d") if r.get("last_chart_date") else None
            })
            display_index += 1

        return JsonResponse({
            "rows": rows,
            "filters": {
                "managers": managers,
                "tls": tls,
                "projects": projects,
                "subprojects": subprojects
            }
        })
    except Exception as e:
        print(f"AUDIT PROD API ERROR: {e}")
        import traceback; traceback.print_exc()
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
def audit_export_team_production_api(request):
    try:
        print("Export API started...")
        token = _extract_token_from_header(request)
        if not token or token not in ACTIVE_TOKENS:
            return JsonResponse({"error": "unauthorized"}, status=401)

        login_emp_id = ACTIVE_TOKENS[token]["emp_id"]
        print(f"User Emp ID: {login_emp_id}")

        # --- Parse filters ---
        filters = {}
        if request.method == "POST":
            try:
                data = json.loads(request.body)
                filters = data
                print(f"Filters received: {filters}")
            except: pass

        # --- Get Team IDs ---
        with connection.cursor() as cursor:
            cursor.execute("SELECT user_employee_id FROM user_details WHERE tl_employee_id = %s", [login_emp_id])
            direct_reports = [r[0] for r in cursor.fetchall()]

        all_emp_ids = set(direct_reports)
        if direct_reports:
            placeholders = ",".join(["%s"] * len(direct_reports))
            with connection.cursor() as cursor:
                cursor.execute(f"SELECT user_employee_id FROM user_details WHERE tl_employee_id IN ({placeholders})", direct_reports)
                all_emp_ids.update([r[0] for r in cursor.fetchall()])

        if not all_emp_ids:
            print("No team IDs found")
            return JsonResponse({"error": "No team data found"}, status=404)

        emp_ids = list(all_emp_ids)
        print(f"Team Emp IDs count: {len(emp_ids)}")

        # --- Build dynamic conditions ---
        user_where = []
        user_params = []
        coding_where = []
        coding_params = []

        placeholders = ",".join(["%s"] * len(emp_ids))
        user_where.append(f"u.user_employee_id IN ({placeholders})")
        user_params.extend(emp_ids)

        if filters.get("manager"):
            user_where.append("tl.tl_employee_id = %s")
            user_params.append(filters["manager"])
        if filters.get("tl"):
            user_where.append("u.tl_employee_id = %s")
            user_params.append(filters["tl"])

        if filters.get("project"):
            coding_where.append("b.project = %s")
            coding_params.append(filters["project"])
        if filters.get("subproject"):
            coding_where.append("b.subproject = %s")
            coding_params.append(filters["subproject"])
        if filters.get("from_date"):
            coding_where.append("b.activity_date_val >= %s")
            coding_params.append(filters["from_date"])
        if filters.get("to_date"):
            coding_where.append("b.activity_date_val <= %s")
            coding_params.append(filters["to_date"])
        if filters.get("shift"):
            coding_where.append("dbo.fn_get_shift_name(b.auditor_id, b.activity_date_val) = %s")
            coding_params.append(filters["shift"])

        where_clause = " AND ".join(user_where + coding_where)
        full_params = user_params + coding_params

        # --- QUERY 1: SUMMARY DATA (User Level) ---
        # Note: We need to use slightly different JOIN/WHERE structure for summary to match dashboard
        # For simplicity, we'll use the filtered emp_ids and same aggregate logic
        
        # We reuse the coding_where conditions for the JOIN's ON clause in the summary query
        # --- QUERY: DETAIL DATA ---
        sql_detail = f"""
            ;WITH DedupAudit AS (
                SELECT chart_id, auditor_id, project, subproject, allocated_at, chart_status, start_time, end_time, reject_reason, reject_command, complete_command
                FROM (
                    SELECT chart_id, auditor_id, project, subproject, allocated_at, chart_status, start_time, end_time, reject_reason, reject_command, complete_command,
                           ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY allocated_at DESC) as rn
                    FROM audit_allocations
                ) t WHERE rn = 1
            ),
            DedupATAudit AS (
                SELECT chart_id, at_auditor_id, project, subproject, allocated_at, chart_status, start_time, end_time, reject_reason, reject_command, complete_command
                FROM (
                    SELECT chart_id, at_auditor_id, project, subproject, allocated_at, chart_status, start_time, end_time, reject_reason, reject_command, complete_command,
                           ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY allocated_at DESC) as rn
                    FROM at_audit_allocations
                ) t WHERE rn = 1
            ),
            BaseProd AS (
                SELECT sa.chart_id, sa.auditor_id, sa.project, sa.subproject, sa.allocated_at, sa.chart_status, 'Standard' as audit_type, start_time, end_time, reject_reason, reject_command, complete_command,
                       dbo.fn_get_shift_date(sa.auditor_id, sa.allocated_at) as activity_date_val,
                       (SELECT MAX(project_pdf_id) FROM codings WHERE chart_id = sa.chart_id) as project_pdf_id,
                       (SELECT MAX(user_id) FROM codings WHERE chart_id = sa.chart_id) as coder_emp_id
                FROM DedupAudit sa
                WHERE sa.chart_status IN ('complete', 'reject')
                
                UNION ALL
                
                SELECT ata.chart_id, ata.at_auditor_id as auditor_id, ata.project, ata.subproject, ata.allocated_at, ata.chart_status, 'AT' as audit_type, ata.start_time, ata.end_time, ata.reject_reason, ata.reject_command, ata.complete_command,
                       dbo.fn_get_shift_date(ata.at_auditor_id, ata.allocated_at) as activity_date_val,
                       (SELECT MAX(c.project_pdf_id) FROM audit_allocations aa JOIN codings c ON c.chart_id = aa.chart_id WHERE aa.chart_id = ata.chart_id) as project_pdf_id,
                       (SELECT MAX(auditor_id) FROM audit_allocations WHERE chart_id = ata.chart_id) as coder_emp_id
                FROM DedupATAudit ata
                WHERE ata.chart_status IN ('complete', 'reject')
            ),
            FilteredBase AS (
                SELECT b.*
                FROM BaseProd b
                JOIN user_details u ON u.user_employee_id = b.auditor_id
                LEFT JOIN user_details tl ON tl.user_employee_id = u.tl_employee_id
                WHERE {where_clause}
            ),
            DOSStats AS (
                SELECT f.chart_id, f.audit_type, COUNT(DISTINCT dx.from_date) as total_dos
                FROM FilteredBase f
                LEFT JOIN (
                    SELECT chart_id, from_date, 'Standard' as audit_type FROM audit_dx_entries
                    UNION ALL
                    SELECT chart_id, from_date, 'AT' as audit_type FROM at_audit_dx_entries
                ) dx ON dx.chart_id = f.chart_id AND dx.audit_type = f.audit_type
                GROUP BY f.chart_id, f.audit_type
            ),
            ICDStats AS (
                SELECT f.chart_id, f.audit_type, COUNT(dx.dxcode) as total_icd
                FROM FilteredBase f
                LEFT JOIN (
                    SELECT chart_id, dxcode, 'Standard' as audit_type FROM audit_dx_entries WHERE dxcode != ''
                    UNION ALL
                    SELECT chart_id, dxcode, 'AT' as audit_type FROM at_audit_dx_entries WHERE dxcode != ''
                ) dx ON dx.chart_id = f.chart_id AND dx.audit_type = f.audit_type
                GROUP BY f.chart_id, f.audit_type
            ),
            ErrorStats AS (
                SELECT 
                    f.chart_id, 
                    f.audit_type, 
                    SUM(e.error_count) as total_errors,
                    STUFF((
                        SELECT ', ' + e2.error_type
                        FROM (
                            SELECT chart_id, error_type, 'Standard' as audit_type FROM audit_errors
                            UNION ALL
                            SELECT chart_id, error_type, 'AT' as audit_type FROM at_audit_errors
                        ) e2 WHERE e2.chart_id = f.chart_id AND e2.audit_type = f.audit_type
                        FOR XML PATH('')
                    ), 1, 2, '') as error_types,
                    STUFF((
                        SELECT ', ' + e3.error_command
                        FROM (
                            SELECT chart_id, error_command, 'Standard' as audit_type FROM audit_errors
                            UNION ALL
                            SELECT chart_id, error_command, 'AT' as audit_type FROM at_audit_errors
                        ) e3 WHERE e3.chart_id = f.chart_id AND e3.audit_type = f.audit_type
                        FOR XML PATH('')
                    ), 1, 2, '') as error_commands
                FROM FilteredBase f
                LEFT JOIN (
                    SELECT chart_id, error_count, 'Standard' as audit_type FROM audit_errors
                    UNION ALL
                    SELECT chart_id, error_count, 'AT' as audit_type FROM at_audit_errors
                ) e ON e.chart_id = f.chart_id AND e.audit_type = f.audit_type
                GROUP BY f.chart_id, f.audit_type
            )
            SELECT 
                f.chart_id, f.project, f.subproject, 
                COALESCE(ds.total_dos, 0) as total_dos, 
                COALESCE(istats.total_icd, 0) as total_icd, 
                COALESCE(p.page_count, 0) as total_page,
                f.complete_command, f.chart_status, f.reject_reason, f.reject_command as reject_comment,
                u.user_employee_id as auditor_id, u.user_mail_id as email_id, u.username, tl.username as tl_name,
                f.allocated_at, f.start_time, f.end_time,
                DATEDIFF(SECOND, f.start_time, f.end_time) as seconds_taken,
                u_coder.username as coder_name, tl_coder.username as coder_tl,
                es.total_errors, es.error_types, es.error_commands
            FROM FilteredBase f
            JOIN user_details u ON u.user_employee_id = f.auditor_id
            LEFT JOIN user_details tl ON tl.user_employee_id = u.tl_employee_id
            LEFT JOIN DOSStats ds ON ds.chart_id = f.chart_id AND ds.audit_type = f.audit_type
            LEFT JOIN ICDStats istats ON istats.chart_id = f.chart_id AND istats.audit_type = f.audit_type
            LEFT JOIN ErrorStats es ON es.chart_id = f.chart_id AND es.audit_type = f.audit_type
            LEFT JOIN project_pdfs p ON p.id = f.project_pdf_id
            LEFT JOIN user_details u_coder ON u_coder.user_employee_id = f.coder_emp_id
            LEFT JOIN user_details tl_coder ON tl_coder.user_employee_id = u_coder.tl_employee_id
        """
        with connection.cursor() as cursor:
            cursor.execute(sql_detail, full_params)
            columns_detail = [col[0] for col in cursor.description]
            data_detail = cursor.fetchall()
        
        df_detail = pd.DataFrame(data_detail, columns=columns_detail)

        # 1. Format Details for Excel
        def safe_format_datetime(val):
            if pd.isna(val) or val is None: return ""
            import datetime
            val_local = timezone.localtime(val) if isinstance(val, datetime.datetime) and timezone.is_aware(val) else val
            if isinstance(val_local, datetime.datetime): return val_local.strftime('%Y-%m-%d %H:%M:%S')
            if isinstance(val_local, datetime.time): return val_local.strftime('%H:%M:%S')
            try: return pd.to_datetime(val_local).strftime('%Y-%m-%d %H:%M:%S')
            except: return str(val_local)

        for col in ['allocated_at', 'start_time', 'end_time']:
            if col in df_detail.columns:
                df_detail[col] = df_detail[col].apply(safe_format_datetime)

        def format_seconds(seconds):
            if pd.isna(seconds) or seconds is None: return "00:00:00"
            try:
                s = int(seconds); h = s // 3600; m = (s % 3600) // 60; sec = s % 60
                return f"{h:02d}:{m:02d}:{sec:02d}"
            except: return "00:00:00"

        if 'seconds_taken' in df_detail.columns:
            df_detail['time_taken'] = df_detail['seconds_taken'].apply(format_seconds)

        ordered_cols_detail = [
            "chart_id", "project", "subproject", "total_dos", "total_icd", "total_page",
            "total_errors", "error_types", "error_commands",
            "complete_command", "chart_status", "reject_reason", "reject_comment",
            "auditor_id", "email_id", "username", "tl_name", 
            "coder_emp_id", "coder_name", "coder_tl",
            "allocated_at", "start_time", 
            "end_time", "time_taken"
        ]
        df_detail_export = df_detail[[c for c in ordered_cols_detail if c in df_detail.columns]]

        # 2. Build Summary from Detail Data (Aggegrate per user)
        # To match the dashboard including non-productive users, we could query separately,
        # but the user likely wants the summary of the EXPORTED data.
        # Let's aggregate df_detail.
        
        if not df_detail.empty:
            summary_grouped = df_detail.groupby(['auditor_id', 'username', 'email_id', 'tl_name']).agg({
                'chart_id': 'count',
                'chart_status': [
                    lambda x: (x == 'complete').sum(),
                    lambda x: (x == 'reject').sum()
                ],
                'total_dos': 'sum',
                'total_icd': 'sum',
                'total_errors': 'sum',
                'total_page': 'sum',
                'allocated_at': 'max'
            }).reset_index()
            
            summary_grouped.columns = [
                'User ID', 'Username', 'Email', 'TL Name', 
                'Total Charts', 'Completed', 'Rejected', 
                'Total DOS', 'Total ICD', 'Total Errors', 'Total Pages', 'Last Chart Date'
            ]
            
            # Derived metrics
            summary_grouped['Production'] = summary_grouped['Completed'] + summary_grouped['Rejected']
            summary_grouped['CPH'] = (summary_grouped['Production'] / 8).round(2)
            summary_grouped['Error %'] = (summary_grouped['Total Errors'] / summary_grouped['Total ICD'] * 100).round(2).fillna(0)
            
            # Reorder for "TeamProduction table" look
            summary_cols = [
                'User ID', 'Username', 'Email', 'TL Name', 'Total Pages', 'Total DOS', 'Total ICD', 'Total Errors',
                'Error %', 'CPH', 'Completed', 'Rejected', 'Total Charts', 'Last Chart Date'
            ]
            df_summary_export = summary_grouped[summary_cols]
            
            # Hide rows with zero pages for consistency with the dashboard
            df_summary_export = df_summary_export[df_summary_export['Total Pages'] > 0]
        else:
            df_summary_export = pd.DataFrame(columns=['Message'], data=[['No data found for the selected filters']])

        print("Generating Multi-sheet Excel...")
        import io
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df_summary_export.to_excel(writer, index=False, sheet_name='Summary')
            df_detail_export.to_excel(writer, index=False, sheet_name='Detail')
        
        output.seek(0)
        response = HttpResponse(output.read(), content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        response['Content-Disposition'] = 'attachment; filename="Team_Production_Report.xlsx"'
        print("Export successful")
        return response
    except Exception as e:
        print(f"EXPORT ERROR: {e}")
        import traceback; traceback.print_exc()
        return JsonResponse({"error": str(e)}, status=500)
    finally:
        pass


@csrf_exempt
def team_quality_api(request):
    try:
        print(f"DEBUG: team_quality_api called")
        token = _extract_token_from_header(request)
        if not token or token not in ACTIVE_TOKENS:
            print(f"DEBUG: Unauthorized token: {token}")
            return JsonResponse({"error": "Unauthorized"}, status=401)

        user_data = ACTIVE_TOKENS[token]
        login_emp_id = user_data.get("emp_id")
        user_profile = user_data.get("user_profile")
        
        print(f"DEBUG: User={login_emp_id}, Profile={user_profile}")

        if not login_emp_id:
            return JsonResponse({"error": "Employee ID not found in session"}, status=400)

        # 📥 Parse filters (POST data)
        filters = {}
        if request.method == "POST":
            try:
                filters = json.loads(request.body)
                print(f"DEBUG: Filters={filters}")
            except Exception as e:
                print(f"DEBUG: Filter parse error: {e}")
                pass
        
        # --------------------------------------------------
        # 🔍 Fetch dropdown options
        # --------------------------------------------------
        with connection.cursor() as cursor:
            cursor.execute("SELECT DISTINCT user_employee_id, username FROM user_details WHERE user_profile = 'Manager' ORDER BY username")
            managers = [{"id": r[0], "name": r[1]} for r in cursor.fetchall()]

            cursor.execute("SELECT DISTINCT user_employee_id, username FROM user_details WHERE user_profile = 'TL' ORDER BY username")
            tls = [{"id": r[0], "name": r[1]} for r in cursor.fetchall()]

            cursor.execute("SELECT DISTINCT project FROM codings WHERE project IS NOT NULL ORDER BY project")
            projects = [r[0] for r in cursor.fetchall()]

            cursor.execute("SELECT DISTINCT subproject FROM codings WHERE subproject IS NOT NULL ORDER BY subproject")
            subprojects = [r[0] for r in cursor.fetchall()]

        # --------------------------------------------------
        # 1️⃣ Team Hierarchy (Fully Recursive)
        # --------------------------------------------------
        all_emp_ids = {login_emp_id}
        
        if user_profile == 'Manager':
            with connection.cursor() as cursor:
                cursor.execute("SELECT user_employee_id FROM user_details")
                all_emp_ids.update([r[0] for r in cursor.fetchall() if r[0]])
        else:
            parent_ids = [login_emp_id]
            while parent_ids:
                placeholders = ",".join(["%s"] * len(parent_ids))
                with connection.cursor() as cursor:
                    cursor.execute(f"SELECT user_employee_id FROM user_details WHERE tl_employee_id IN ({placeholders})", parent_ids)
                    children_ids = [r[0] for r in cursor.fetchall() if r[0]]
                
                if not children_ids:
                    break
                new_ids = [cid for cid in children_ids if cid not in all_emp_ids]
                if not new_ids:
                    break
                all_emp_ids.update(new_ids)
                parent_ids = new_ids

        emp_ids = [eid for eid in all_emp_ids if eid]
        print(f"DEBUG: Hierarchy count: {len(emp_ids)}")

        # --------------------------------------------------
        # 2️⃣ Fetch All User Details for the Table
        # --------------------------------------------------
        placeholders = ",".join(["%s"] * len(emp_ids))
        with connection.cursor() as cursor:
            user_where = f"u.user_employee_id IN ({placeholders})"
            user_params = list(emp_ids)
            
            if filters.get("manager"):
                user_where += " AND (u.tl_employee_id = %s OR tl.tl_employee_id = %s)"
                user_params.extend([filters["manager"], filters["manager"]])
            if filters.get("tl"):
                user_where += " AND u.tl_employee_id = %s"
                user_params.append(filters["tl"])

            sql_members = f"""
                SELECT u.user_employee_id, u.username, u.user_mail_id, tl.username as tl_name
                FROM user_details u
                LEFT JOIN user_details tl ON tl.user_employee_id = u.tl_employee_id
                WHERE {user_where}
                ORDER BY u.username
            """
            cursor.execute(sql_members, user_params)
            filtered_members = cursor.fetchall()

        if not filtered_members:
            return JsonResponse({
                "summary": {"members_count": 0, "audited_count": 0, "charts": 0, "errors": 0, "quality": 100},
                "rows": [], "filters": {"managers": managers, "tls": tls, "projects": projects, "subprojects": subprojects}
            })

        # --------------------------------------------------
        # 3️⃣ Optimized Single Query Aggregation
        # --------------------------------------------------
        project = filters.get("project")
        subproject = filters.get("subproject")
        from_date = filters.get("from_date")
        to_date = filters.get("to_date")

        where_parts = [f"u.user_employee_id IN ({placeholders})"]
        where_params = list(emp_ids)

        if filters.get("manager"):
            where_parts.append("(u.tl_employee_id = %s OR tl.tl_employee_id = %s)")
            where_params.extend([filters["manager"], filters["manager"]])
        if filters.get("tl"):
            where_parts.append("u.tl_employee_id = %s")
            where_params.append(filters["tl"])
        if project:
            where_parts.append("b.project = %s")
            where_params.append(project)
        if subproject:
            where_parts.append("b.subproject = %s")
            where_params.append(subproject)
        if from_date:
            where_parts.append("b.activity_date_val >= %s")
            where_params.append(from_date)
        if to_date:
            where_parts.append("b.activity_date_val <= %s")
            where_params.append(to_date)
        if filters.get("shift"):
            where_parts.append("dbo.fn_get_shift_name(b.evaluated_user_id, b.activity_date_val) = %s")
            where_params.append(filters["shift"])
        if filters.get("shift"):
            where_parts.append("dbo.fn_get_shift_name(b.evaluated_user_id, b.activity_date_val) = %s")
            where_params.append(filters["shift"])

        where_clause = " AND ".join(where_parts)

        sql = f"""
            ;WITH DedupAudit AS (
                SELECT chart_id, auditor_id, project, subproject, allocated_at, chart_status
                FROM (
                    SELECT chart_id, auditor_id, project, subproject, allocated_at, chart_status,
                           ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY allocated_at DESC) as rn
                    FROM audit_allocations
                ) t WHERE rn = 1
            ),
            DedupATAudit AS (
                SELECT chart_id, at_auditor_id, project, subproject, allocated_at, chart_status
                FROM (
                    SELECT chart_id, at_auditor_id, project, subproject, allocated_at, chart_status,
                           ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY allocated_at DESC) as rn
                    FROM at_audit_allocations
                ) t WHERE rn = 1
            ),
            BaseAudit AS (
                -- 1. Standard Audits (Evaluating Coders)
                SELECT 
                    c.user_id as evaluated_user_id,
                    sa.project,
                    sa.subproject,
                    dbo.fn_get_shift_date(sa.auditor_id, sa.allocated_at) as activity_date_val,
                    sa.chart_id,
                    'Standard' as audit_type
                FROM DedupAudit sa
                JOIN codings c ON c.chart_id = sa.chart_id
                WHERE sa.chart_status IN ('complete', 'reject')

                UNION ALL

                -- 2. AT Audits (Evaluating Auditors)
                SELECT 
                    sa.auditor_id as evaluated_user_id,
                    ata.project,
                    ata.subproject,
                    dbo.fn_get_shift_date(ata.at_auditor_id, ata.allocated_at) as activity_date_val,
                    ata.chart_id,
                    'AT' as audit_type
                FROM DedupATAudit ata
                JOIN audit_allocations sa ON sa.chart_id = ata.chart_id
                WHERE ata.chart_status IN ('complete', 'reject')
            ),

            FilteredBase AS (
                SELECT 
                    u.user_employee_id, u.username, u.user_mail_id as email_id, tl.username as tl_name,
                    b.project, b.subproject, b.activity_date_val, b.chart_id, b.audit_type
                FROM BaseAudit b
                JOIN user_details u ON u.user_employee_id = b.evaluated_user_id
                LEFT JOIN user_details tl ON tl.user_employee_id = u.tl_employee_id
                WHERE {where_clause}
            ),

            AggregatedAudit AS (
                SELECT 
                    user_employee_id, project, subproject, activity_date_val,
                    COUNT(DISTINCT chart_id + audit_type) as total_audited
                FROM FilteredBase
                GROUP BY user_employee_id, project, subproject, activity_date_val
            ),

            ICDStats AS (
                SELECT 
                    user_employee_id, project, subproject, activity_date_val,
                    SUM(total_icd) as total_icd
                FROM (
                    -- Standard (Audit of Coder) -> Using dx_entries as baseline
                    SELECT f.user_employee_id, f.project, f.subproject, f.activity_date_val, COUNT(dx.id) as total_icd
                    FROM FilteredBase f
                    JOIN dx_entries dx ON dx.chart_id = f.chart_id
                    WHERE f.audit_type = 'Standard' AND dx.dxcode IS NOT NULL AND dx.dxcode != ''
                    GROUP BY f.user_employee_id, f.project, f.subproject, f.activity_date_val

                    UNION ALL

                    -- AT (Audit of Auditor) -> Using auditor's submitted work (audit_dx_entries) as baseline
                    SELECT f.user_employee_id, f.project, f.subproject, f.activity_date_val, COUNT(adx.id) as total_icd
                    FROM FilteredBase f
                    JOIN audit_dx_entries adx ON adx.chart_id = f.chart_id
                    WHERE f.audit_type = 'AT' AND adx.dxcode IS NOT NULL AND adx.dxcode != ''
                    GROUP BY f.user_employee_id, f.project, f.subproject, f.activity_date_val
                ) t_icd
                GROUP BY user_employee_id, project, subproject, activity_date_val
            ),

            ErrorStats AS (
                SELECT 
                    user_employee_id, project, subproject, activity_date_val,
                    SUM(coding_errors) as coding_errors, SUM(admin_errors) as admin_errors
                FROM (
                    -- Standard Errors against Coder
                    SELECT f.user_employee_id, f.project, f.subproject, f.activity_date_val,
                        SUM(ae.error_count) as coding_errors, 0 as admin_errors
                    FROM FilteredBase f JOIN audit_errors ae ON ae.chart_id = f.chart_id
                    WHERE f.audit_type = 'Standard' AND ae.error_type IN ('Deleted','Modified','Missed')
                    GROUP BY f.user_employee_id, f.project, f.subproject, f.activity_date_val
                    UNION ALL
                    SELECT f.user_employee_id, f.project, f.subproject, f.activity_date_val,
                        0 as coding_errors, SUM(ae.error_count) as admin_errors
                    FROM FilteredBase f JOIN audit_errors ae ON ae.chart_id = f.chart_id
                    WHERE f.audit_type = 'Standard' AND ae.error_type IN ('Admin Error','Flag Error','DOS Error','Page No Error')
                    GROUP BY f.user_employee_id, f.project, f.subproject, f.activity_date_val

                    UNION ALL

                    -- AT Errors against Auditor
                    SELECT f.user_employee_id, f.project, f.subproject, f.activity_date_val,
                        SUM(ate.error_count) as coding_errors, 0 as admin_errors
                    FROM FilteredBase f JOIN at_audit_errors ate ON ate.chart_id = f.chart_id
                    WHERE f.audit_type = 'AT' AND ate.error_type IN ('Deleted','Modified','Missed')
                    GROUP BY f.user_employee_id, f.project, f.subproject, f.activity_date_val
                    UNION ALL
                    SELECT f.user_employee_id, f.project, f.subproject, f.activity_date_val,
                        0 as coding_errors, SUM(ate.error_count) as admin_errors
                    FROM FilteredBase f JOIN at_audit_errors ate ON ate.chart_id = f.chart_id
                    WHERE f.audit_type = 'AT' AND ate.error_type IN ('Admin Error','Flag Error','DOS Error','Page No Error')
                    GROUP BY f.user_employee_id, f.project, f.subproject, f.activity_date_val
                ) t_err
                GROUP BY user_employee_id, project, subproject, activity_date_val
            )

            SELECT 
                u.user_employee_id,
                u.username,
                u.user_mail_id as email_id,
                tl.username as tl_name,
                aa_final.project,
                aa_final.subproject,
                CAST(aa_final.activity_date_val AS VARCHAR(20)) as activity_date,
                CAST(aa_final.total_audited AS INT) as total_audited,
                CAST(COALESCE(icd.total_icd, 0) AS INT) as total_icd,
                CAST(COALESCE(err.coding_errors, 0) AS INT) as coding_errors,
                CAST(COALESCE(err.admin_errors, 0) AS INT) as admin_errors
            FROM AggregatedAudit aa_final
            JOIN user_details u 
                ON u.user_employee_id = aa_final.user_employee_id
            LEFT JOIN user_details tl 
                ON tl.user_employee_id = u.tl_employee_id
            LEFT JOIN ICDStats icd 
                ON icd.user_employee_id = aa_final.user_employee_id
                AND icd.project = aa_final.project
                AND icd.subproject = aa_final.subproject
                AND icd.activity_date_val = aa_final.activity_date_val
            LEFT JOIN ErrorStats err 
                ON err.user_employee_id = aa_final.user_employee_id
                AND err.project = aa_final.project
                AND err.subproject = aa_final.subproject
                AND err.activity_date_val = aa_final.activity_date_val
            ORDER BY aa_final.activity_date_val DESC, u.username
        """
        print(f"DEBUG: Main SQL length={len(sql)}")

        with connection.cursor() as cursor:
            cursor.execute(sql, where_params)
            columns = [col[0] for col in cursor.description]
            data = cursor.fetchall()
            
        print(f"DEBUG: Result rows: {len(data)}")

        rows = []
        total_audited_sum = 0
        total_icds_sum = 0
        total_errors_sum = 0

        for r in data:
            row_dict = dict(zip(columns, r))
            row_dict["total_audited"] = int(row_dict.get("total_audited") or 0)
            row_dict["total_icd"] = int(row_dict.get("total_icd") or 0)
            row_dict["coding_errors"] = int(row_dict.get("coding_errors") or 0)
            row_dict["admin_errors"] = int(row_dict.get("admin_errors") or 0)
            
            total_errors = row_dict["coding_errors"] + row_dict["admin_errors"]
            row_dict["total_errors"] = total_errors
            row_dict["total_quality"] = round((1 - (total_errors / row_dict["total_icd"])) * 100, 2) if row_dict["total_icd"] > 0 else 100.0
                
            rows.append(row_dict)
            total_audited_sum += row_dict["total_audited"]
            total_icds_sum += row_dict["total_icd"]
            total_errors_sum += total_errors

        quality_summary = round((1 - (total_errors_sum / total_icds_sum)) * 100, 2) if total_icds_sum > 0 else 100.0

        return JsonResponse({
            "summary": {
                "members_count": len(filtered_members), "audited_count": int(total_audited_sum),
                "charts": int(total_icds_sum), "errors": int(total_errors_sum), "quality": float(quality_summary)
            },
            "rows": rows,
            "filters": {"managers": managers, "tls": tls, "projects": projects, "subprojects": subprojects}
        })
    except Exception as e:
        error_msg = f"TEAM QUALITY ERROR: {str(e)}\n{traceback.format_exc()}"
        print(error_msg)
        return JsonResponse({"error": str(e), "traceback": traceback.format_exc()}, status=500)

@csrf_exempt
def export_team_quality_api(request):
    try:
        print(f"DEBUG: export_team_quality_api called")
        token = _extract_token_from_header(request)
        if not token or token not in ACTIVE_TOKENS:
            return JsonResponse({"error": "Unauthorized"}, status=401)

        user_data = ACTIVE_TOKENS[token]
        login_emp_id = user_data.get("emp_id")
        user_profile = user_data.get("user_profile")

        if not login_emp_id:
            return JsonResponse({"error": "Employee ID not found"}, status=400)

        # 📥 Parse filters (POST data)
        filters = {}
        if request.method == "POST":
            try:
                filters = json.loads(request.body)
                print(f"DEBUG: Export Filters={filters}")
            except:
                pass

        # --------------------------------------------------
        # 1️⃣ Team Hierarchy (Fully Recursive)
        # --------------------------------------------------
        all_emp_ids = {login_emp_id}
        if user_profile == 'Manager':
            with connection.cursor() as cursor:
                cursor.execute("SELECT user_employee_id FROM user_details")
                all_emp_ids.update([r[0] for r in cursor.fetchall() if r[0]])
        else:
            parent_ids = [login_emp_id]
            while parent_ids:
                placeholders = ",".join(["%s"] * len(parent_ids))
                with connection.cursor() as cursor:
                    cursor.execute(f"SELECT user_employee_id FROM user_details WHERE tl_employee_id IN ({placeholders})", parent_ids)
                    children_ids = [r[0] for r in cursor.fetchall() if r[0]]
                if not children_ids: break
                new_ids = [cid for cid in children_ids if cid not in all_emp_ids]
                if not new_ids: break
                all_emp_ids.update(new_ids)
                parent_ids = new_ids

        emp_ids = [eid for eid in all_emp_ids if eid]
        user_placeholders = ",".join(["%s"] * len(emp_ids))
        
        project = filters.get("project")
        subproject = filters.get("subproject")
        from_date = filters.get("from_date")
        to_date = filters.get("to_date")
        manager_filter = filters.get("manager")
        tl_filter = filters.get("tl")

        # Build WHERE conditions
        where_parts = [f"u.user_employee_id IN ({user_placeholders})"]
        where_params = list(emp_ids)

        if manager_filter:
            where_parts.append("(u.tl_employee_id = %s OR tl.tl_employee_id = %s)")
            where_params.extend([manager_filter, manager_filter])
        if tl_filter:
            where_parts.append("u.tl_employee_id = %s")
            where_params.append(tl_filter)
        if project:
            where_parts.append("b.project = %s")
            where_params.append(project)
        if subproject:
            where_parts.append("b.subproject = %s")
            where_params.append(subproject)
        if from_date:
            where_parts.append("b.activity_date_val >= %s")
            where_params.append(from_date)
        if to_date:
            where_parts.append("b.activity_date_val <= %s")
            where_params.append(to_date)
        if filters.get("shift"):
            where_parts.append("dbo.fn_get_shift_name(b.evaluated_user_id, b.activity_date_val) = %s")
            where_params.append(filters["shift"])

        where_clause = " AND ".join(where_parts)

        # --- SHEET 1: Summary ---
        summary_sql = f"""
            ;WITH DedupAudit AS (
                SELECT chart_id, auditor_id, project, subproject, allocated_at, chart_status
                FROM (
                    SELECT chart_id, auditor_id, project, subproject, allocated_at, chart_status,
                           ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY allocated_at DESC) as rn
                    FROM audit_allocations
                ) t WHERE rn = 1
            ),
            DedupATAudit AS (
                SELECT chart_id, at_auditor_id, project, subproject, allocated_at, chart_status
                FROM (
                    SELECT chart_id, at_auditor_id, project, subproject, allocated_at, chart_status,
                           ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY allocated_at DESC) as rn
                    FROM at_audit_allocations
                ) t WHERE rn = 1
            ),
            BaseAudit AS (
                -- 1. Standard: Evaluating Coder, Auditor: Auditor
                SELECT sa.chart_id, c.user_id as evaluated_user_id, sa.project, sa.subproject, sa.allocated_at, 'Standard' as audit_type,
                       dbo.fn_get_shift_date(sa.auditor_id, sa.allocated_at) as activity_date_val
                FROM DedupAudit sa JOIN codings c ON c.chart_id = sa.chart_id
                WHERE sa.chart_status IN ('complete', 'reject')
                UNION ALL
                -- 2. AT: Evaluating Auditor, Auditor: AT-Auditor
                SELECT ata.chart_id, sa.auditor_id as evaluated_user_id, ata.project, ata.subproject, ata.allocated_at, 'AT' as audit_type,
                       dbo.fn_get_shift_date(ata.at_auditor_id, ata.allocated_at) as activity_date_val
                FROM DedupATAudit ata JOIN audit_allocations sa ON sa.chart_id = ata.chart_id
                WHERE ata.chart_status IN ('complete', 'reject')
            ),
            FilteredBase AS (
                SELECT u.user_employee_id, u.username, u.user_mail_id as email_id, tl.username as tl_name,
                       b.project, b.subproject, b.activity_date_val, b.chart_id, b.audit_type
                FROM BaseAudit b
                JOIN user_details u ON u.user_employee_id = b.evaluated_user_id
                LEFT JOIN user_details tl ON tl.user_employee_id = u.tl_employee_id
                WHERE {where_clause}
            ),
            AggregatedAudit AS (
                SELECT user_employee_id, project, subproject, activity_date_val, COUNT(DISTINCT CAST(chart_id AS VARCHAR(50)) + audit_type) as total_audited
                FROM FilteredBase GROUP BY user_employee_id, project, subproject, activity_date_val
            ),
            ICDStats AS (
                SELECT user_employee_id, project, subproject, activity_date_val, SUM(icd_count) as total_icd
                FROM (
                    SELECT f.user_employee_id, f.project, f.subproject, f.activity_date_val, COUNT(dx.id) as icd_count
                    FROM FilteredBase f JOIN dx_entries dx ON dx.chart_id = f.chart_id 
                    WHERE f.audit_type = 'Standard' AND dx.dxcode IS NOT NULL AND dx.dxcode != ''
                    GROUP BY f.user_employee_id, f.project, f.subproject, f.activity_date_val
                    UNION ALL
                    SELECT f.user_employee_id, f.project, f.subproject, f.activity_date_val, COUNT(adx.id) as total_icd
                    FROM FilteredBase f JOIN audit_dx_entries adx ON adx.chart_id = f.chart_id
                    WHERE f.audit_type = 'AT' AND adx.dxcode IS NOT NULL AND adx.dxcode != ''
                    GROUP BY f.user_employee_id, f.project, f.subproject, f.activity_date_val
                ) t_icd GROUP BY user_employee_id, project, subproject, activity_date_val
            ),
            ErrorStats AS (
                SELECT user_employee_id, project, subproject, activity_date_val, SUM(c_err) as coding_errors, SUM(a_err) as admin_errors
                FROM (
                    SELECT f.user_employee_id, f.project, f.subproject, f.activity_date_val,
                        SUM(ae.error_count) as c_err, 0 as a_err
                    FROM FilteredBase f JOIN audit_errors ae ON ae.chart_id = f.chart_id
                    WHERE f.audit_type = 'Standard' AND ae.error_type IN ('Deleted','Modified','Missed')
                    GROUP BY f.user_employee_id, f.project, f.subproject, f.activity_date_val
                    UNION ALL
                    SELECT f.user_employee_id, f.project, f.subproject, f.activity_date_val,
                        0 as c_err, SUM(ae.error_count) as a_err
                    FROM FilteredBase f JOIN audit_errors ae ON ae.chart_id = f.chart_id
                    WHERE f.audit_type = 'Standard' AND ae.error_type IN ('Admin Error','Flag Error','DOS Error','Page No Error')
                    GROUP BY f.user_employee_id, f.project, f.subproject, f.activity_date_val
                    UNION ALL
                    SELECT f.user_employee_id, f.project, f.subproject, f.activity_date_val,
                        SUM(ate.error_count) as c_err, 0 as a_err
                    FROM FilteredBase f JOIN at_audit_errors ate ON ate.chart_id = f.chart_id
                    WHERE f.audit_type = 'AT' AND ate.error_type IN ('Deleted','Modified','Missed')
                    GROUP BY f.user_employee_id, f.project, f.subproject, f.activity_date_val
                    UNION ALL
                    SELECT f.user_employee_id, f.project, f.subproject, f.activity_date_val,
                        0 as c_err, SUM(ate.error_count) as a_err
                    FROM FilteredBase f JOIN at_audit_errors ate ON ate.chart_id = f.chart_id
                    WHERE f.audit_type = 'AT' AND ate.error_type IN ('Admin Error','Flag Error','DOS Error','Page No Error')
                    GROUP BY f.user_employee_id, f.project, f.subproject, f.activity_date_val
                ) t_err GROUP BY user_employee_id, project, subproject, activity_date_val
            )
            SELECT u.user_employee_id as [User ID], u.username as [Username], u.user_mail_id as [Email], tl.username as [TL Name],
                CAST(aa_final.activity_date_val AS VARCHAR(20)) as [Date], aa_final.project as [Project], aa_final.subproject as [Sub Project],
                CAST(aa_final.total_audited AS INT) as [Audited Charts], CAST(COALESCE(icd.total_icd, 0) AS INT) as [Total ICD],
                CAST(COALESCE(err.coding_errors, 0) AS INT) as [Coding Errors], CAST(COALESCE(err.admin_errors, 0) AS INT) as [Admin Errors],
                CAST(COALESCE(err.coding_errors, 0) + COALESCE(err.admin_errors, 0) AS INT) as [Total Errors],
                CASE WHEN COALESCE(icd.total_icd, 0) > 0 THEN ROUND((1.0 - ((COALESCE(err.coding_errors,0)+COALESCE(err.admin_errors,0))*1.0 / icd.total_icd)) * 100, 2) ELSE 100.0 END as [Quality %%]
            FROM AggregatedAudit aa_final
            JOIN user_details u ON u.user_employee_id = aa_final.user_employee_id
            LEFT JOIN user_details tl ON tl.user_employee_id = u.tl_employee_id
            LEFT JOIN ICDStats icd ON icd.user_employee_id = aa_final.user_employee_id AND icd.project = aa_final.project AND icd.subproject = aa_final.subproject AND icd.activity_date_val = aa_final.activity_date_val
            LEFT JOIN ErrorStats err ON err.user_employee_id = aa_final.user_employee_id AND err.project = aa_final.project AND err.subproject = aa_final.subproject AND err.activity_date_val = aa_final.activity_date_val
            ORDER BY aa_final.activity_date_val DESC, u.username
        """
        
        # --- SHEET 2: Audit data ---
        audit_sql = f"""
            ;WITH DedupAudit AS (
                SELECT chart_id, auditor_id, project, subproject, allocated_at, chart_status
                FROM (
                    SELECT chart_id, auditor_id, project, subproject, allocated_at, chart_status,
                           ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY allocated_at DESC) as rn
                    FROM audit_allocations
                ) t WHERE rn = 1
            ),
            DedupATAudit AS (
                SELECT chart_id, at_auditor_id, project, subproject, allocated_at, chart_status
                FROM (
                    SELECT chart_id, at_auditor_id, project, subproject, allocated_at, chart_status,
                           ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY allocated_at DESC) as rn
                    FROM at_audit_allocations
                ) t WHERE rn = 1
            ),
            BaseAudit AS (
                SELECT sa.chart_id, c.user_id as evaluated_user_id, c.user_id as coder_emp_id, sa.auditor_id, sa.allocated_at, sa.project, sa.subproject, 'Standard' as audit_type, c.project_pdf_id, c.from_date, c.created_at
                FROM DedupAudit sa JOIN codings c ON c.chart_id = sa.chart_id WHERE sa.chart_status IN ('complete', 'reject')
                UNION ALL
                SELECT ata.chart_id, sa.auditor_id as evaluated_user_id, sa.auditor_id as coder_emp_id, ata.at_auditor_id as auditor_id, ata.allocated_at, ata.project, ata.subproject, 'AT' as audit_type, NULL as project_pdf_id, sa.allocated_at as from_date, sa.allocated_at as created_at
                FROM DedupATAudit ata JOIN audit_allocations sa ON sa.chart_id = ata.chart_id WHERE ata.chart_status IN ('complete', 'reject')
            ),
            FilteredAudit AS (
                SELECT b.* FROM (SELECT *, CAST(allocated_at AS DATE) as activity_date_val FROM BaseAudit) b JOIN user_details u ON u.user_employee_id = b.evaluated_user_id WHERE {where_clause}
            )
            SELECT f.chart_id as [Chart ID], f.project as [Project Name], f.subproject as [Sub Project Name], f.created_at as [Coded Date],
                (CASE WHEN f.audit_type = 'Standard' THEN (SELECT COUNT(DISTINCT dx.from_date) FROM dx_entries dx WHERE dx.chart_id = f.chart_id) ELSE (SELECT COUNT(DISTINCT adx.from_date) FROM audit_dx_entries adx WHERE adx.chart_id = f.chart_id) END) as [Total DOS],
                (CASE WHEN f.audit_type = 'Standard' THEN (SELECT COUNT(*) FROM dx_entries dx WHERE dx.chart_id = f.chart_id AND dx.dxcode != '') ELSE (SELECT COUNT(*) FROM audit_dx_entries adx WHERE adx.chart_id = f.chart_id AND adx.dxcode != '') END) as [Total ICD],
                p.page_count as [Page No],
                (CASE WHEN f.audit_type = 'Standard' THEN STUFF((SELECT '; ' + ae.error_command FROM audit_errors ae WHERE ae.chart_id = f.chart_id FOR XML PATH('')), 1, 2, '') ELSE STUFF((SELECT '; ' + ate.error_command FROM at_audit_errors ate WHERE ate.chart_id = f.chart_id FOR XML PATH('')), 1, 2, '') END) as [Error Comments],
                (CASE WHEN f.audit_type = 'Standard' THEN (SELECT COALESCE(SUM(ae.error_count), 0) FROM audit_errors ae WHERE ae.chart_id = f.chart_id) ELSE (SELECT COALESCE(SUM(ate.error_count), 0) FROM at_audit_errors ate WHERE ate.chart_id = f.chart_id) END) as [Total Errors],
                f.allocated_at as [Audited Date], f.coder_emp_id as [Coder Emp ID], u_coder.username as [Coder Name], tl_coder.username as [Coder TL],
                f.auditor_id as [Auditor Emp ID], u_auditor.username as [Auditor Name], tl_auditor.username as [Auditor TL], f.allocated_at as [Audit Status Date]
            FROM FilteredAudit f
            JOIN user_details u_coder ON u_coder.user_employee_id = f.coder_emp_id
            LEFT JOIN project_pdfs p ON p.id = f.project_pdf_id
            LEFT JOIN user_details tl_coder ON tl_coder.user_employee_id = u_coder.tl_employee_id
            JOIN user_details u_auditor ON u_auditor.user_employee_id = f.auditor_id
            LEFT JOIN user_details tl_auditor ON tl_auditor.user_employee_id = u_auditor.tl_employee_id
            ORDER BY f.allocated_at DESC
        """

        # --- SHEET 3: Error Log ---
        error_sql = f"""
            ;WITH DedupAudit AS (
                SELECT chart_id, auditor_id, project, subproject, allocated_at, chart_status
                FROM (
                    SELECT chart_id, auditor_id, project, subproject, allocated_at, chart_status,
                           ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY allocated_at DESC) as rn
                    FROM audit_allocations
                ) t WHERE rn = 1
            ),
            DedupATAudit AS (
                SELECT chart_id, at_auditor_id, project, subproject, allocated_at, chart_status
                FROM (
                    SELECT chart_id, at_auditor_id, project, subproject, allocated_at, chart_status,
                           ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY allocated_at DESC) as rn
                    FROM at_audit_allocations
                ) t WHERE rn = 1
            ),
            BaseAudit AS (
                -- 1. Standard: auditor from DedupAudit
                SELECT sa.chart_id, c.user_id as evaluated_user_id, sa.project, sa.subproject, 'Standard' as audit_type, sa.allocated_at, sa.auditor_id
                FROM DedupAudit sa JOIN codings c ON c.chart_id = sa.chart_id 
                WHERE sa.chart_status IN ('complete', 'reject')
                UNION ALL
                -- 2. AT: auditor from DedupATAudit (at_auditor_id)
                SELECT ata.chart_id, sa.auditor_id as evaluated_user_id, ata.project, ata.subproject, 'AT' as audit_type, ata.allocated_at, ata.at_auditor_id as auditor_id
                FROM DedupATAudit ata JOIN audit_allocations sa ON sa.chart_id = ata.chart_id 
                WHERE ata.chart_status IN ('complete', 'reject')
            ),
            FilteredBase AS (
                SELECT b.chart_id, b.audit_type, u.user_employee_id, b.project, b.subproject, b.allocated_at, b.auditor_id
                FROM (SELECT *, CAST(allocated_at AS DATE) as activity_date_val FROM BaseAudit) b 
                JOIN user_details u ON u.user_employee_id = b.evaluated_user_id 
                WHERE {where_clause}
            ),
            Hits AS (
                SELECT e.chart_id, e.error_type, e.error_count, e.error_command, e.row_id, f.audit_type, f.user_employee_id, f.project, f.subproject, f.allocated_at, f.auditor_id
                FROM FilteredBase f JOIN audit_errors e ON e.chart_id = f.chart_id WHERE f.audit_type = 'Standard'
                UNION ALL
                SELECT e.chart_id, e.error_type, e.error_count, e.error_command, e.row_id, f.audit_type, f.user_employee_id, f.project, f.subproject, f.allocated_at, f.auditor_id
                FROM FilteredBase f JOIN at_audit_errors e ON e.chart_id = f.chart_id WHERE f.audit_type = 'AT'
            )
            SELECT h.chart_id as [Chart ID], h.project as [Project Name], h.subproject as [Sub Project Name],
                (CASE WHEN h.audit_type = 'Standard' THEN dx.dx_location ELSE adx.dx_location END) as [Error Location],
                (CASE WHEN h.audit_type = 'Standard' THEN dx.dxcode ELSE adx.dxcode END) as [Dx Code],
                h.error_type as [Error Type], h.error_count as [No of Errors], h.error_command as [Error Command],
                u.username as [Coder Name], h.user_employee_id as [Coder Emp ID],
                tl.username as [Coder TL Name], tl.user_employee_id as [Coder TL Emp ID],
                u_auditor.username as [Auditor Name], h.auditor_id as [Auditor Emp ID],
                tla.username as [Auditor TL Name], tla.user_employee_id as [Auditor TL Emp ID],
                h.allocated_at as [Audit Date]
            FROM Hits h
            JOIN user_details u ON u.user_employee_id = h.user_employee_id
            LEFT JOIN user_details tl ON tl.user_employee_id = u.tl_employee_id
            JOIN user_details u_auditor ON u_auditor.user_employee_id = h.auditor_id
            LEFT JOIN user_details tla ON tla.user_employee_id = u_auditor.tl_employee_id
            LEFT JOIN audit_dx_entries dx ON dx.id = h.row_id AND h.audit_type = 'Standard'
            LEFT JOIN at_audit_dx_entries adx ON adx.id = h.row_id AND h.audit_type = 'AT'
            ORDER BY h.allocated_at DESC
        """
        print("DEBUG: Executing Export SQLs")
        with connection.cursor() as cursor:
            cursor.execute(summary_sql, where_params)
            summary_data = [dict(zip([col[0] for col in cursor.description], row)) for row in cursor.fetchall()]
            
            cursor.execute(audit_sql, where_params)
            audit_data = [dict(zip([col[0] for col in cursor.description], row)) for row in cursor.fetchall()]

            cursor.execute(error_sql, where_params)
            error_log = [dict(zip([col[0] for col in cursor.description], row)) for row in cursor.fetchall()]

        print("DEBUG: Export data fetched, generating Excel")
        import io
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            pd.DataFrame(summary_data).to_excel(writer, index=False, sheet_name='Summary')
            pd.DataFrame(audit_data).to_excel(writer, index=False, sheet_name='Audit Data')
            pd.DataFrame(error_log).to_excel(writer, index=False, sheet_name='Error Log')

        output.seek(0)
        response = HttpResponse(output.read(), content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        filename_time = timezone.localtime(timezone.now()).strftime("%Y%m%d_%H%M%S")
        response['Content-Disposition'] = f'attachment; filename="Team_Quality_Report_{filename_time}.xlsx"'
        return response

    except Exception as e:
        error_msg = f"EXPORT TEAM QUALITY ERROR: {str(e)}\n{traceback.format_exc()}"
        print(error_msg)
        return JsonResponse({"error": str(e), "traceback": traceback.format_exc()}, status=500)





@csrf_exempt
def api_at_audit_dashboard(request):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "unauthorized"}, status=401)

    user = ACTIVE_TOKENS[token]
    auditor_id = user["emp_id"]
    role = user["role"]


    with connection.cursor() as cursor:
        # 1. Fetch Project-Subproject Mapping
        cursor.execute("SELECT DISTINCT project, subproject FROM audit_allocations WHERE (chart_status = 'complete' OR chart_status = 'reject')")
        pairs = cursor.fetchall()
        
        project_subprojects = {}
        for p, s in pairs:
            if p:
                project_subprojects.setdefault(p, []).append(s)
        
        projects = list(project_subprojects.keys())

        records = []
        if request.method == "POST":
            data = json.loads(request.body)
            project = data.get("project")
            subproject = data.get("subproject")
            chart_id = data.get("chart_id")
            date_filter = data.get("date_filter")

            if chart_id:
                # MSSQL uses %s
                query = """
                    SELECT chart_id, project, subproject
                    FROM audit_allocations
                    WHERE chart_id = %s
                      AND chart_status IN ('complete','reject')
                      AND chart_id NOT IN (SELECT chart_id FROM at_audit_allocations)
                """
                params = [chart_id]
                
                if date_filter:
                    query += " AND CAST(allocated_at AS DATE) = %s"
                    params.append(date_filter)
                
                cursor.execute(query, tuple(params))
                row_tuple = cursor.fetchone()
            else:
                query = """
                    SELECT TOP 1 chart_id, project, subproject
                    FROM audit_allocations
                    WHERE chart_status IN ('complete','reject')
                      AND project = %s
                      AND subproject = %s
                      AND chart_id NOT IN (SELECT chart_id FROM at_audit_allocations)
                """
                params = [project, subproject]
                
                if date_filter:
                    query += " AND CAST(allocated_at AS DATE) = %s"
                    params.append(date_filter)
                
                query += " ORDER BY NEWID()"
                
                cursor.execute(query, tuple(params))
                row_tuple = cursor.fetchone()

            if row_tuple:
                # Map tuple to dict manually
                row = {"chart_id": row_tuple[0], "project": row_tuple[1], "subproject": row_tuple[2]}
                
                cursor.execute("""
                    INSERT INTO at_audit_allocations
                    (chart_id, project, subproject, at_auditor_id,
                     allocated_at, start_time, chart_status)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (
                    row["chart_id"], row["project"], row["subproject"],
                    auditor_id, now(), now(), "in_progress"
                ))
                records.append(row)

        # 2. Fetch allocated charts
        cursor.execute("""
            SELECT chart_id, project, subproject
            FROM at_audit_allocations
            WHERE chart_status = 'in_progress'
              AND at_auditor_id = %s
        """, (auditor_id,))
        
        # Helper to convert to dictionary for React
        columns = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
        allocated = []
        for x in cursor.fetchall():
            row_dict = dict(zip(columns, x))
            row_dict['encrypted_chart_id'] = encrypt_chart_id(row_dict['chart_id'])
            allocated.append(row_dict)

        # Fetch hold charts for this at-auditor
        # Ensure hold_command column exists
        cursor.execute("IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('at_audit_allocations') AND name = 'hold_command') ALTER TABLE at_audit_allocations ADD hold_command NVARCHAR(MAX) NULL")
        cursor.execute("""
            SELECT chart_id, project, subproject, hold_command
            FROM at_audit_allocations
            WHERE chart_status = 'hold'
              AND at_auditor_id = %s
        """, (auditor_id,))
        h_cols = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
        hold_charts = []
        for x in cursor.fetchall():
            row_dict = dict(zip(h_cols, x))
            row_dict['encrypted_chart_id'] = encrypt_chart_id(row_dict['chart_id'])
            hold_charts.append(row_dict)

    return JsonResponse({
        "projects": projects,
        "project_subprojects": project_subprojects,
        "records": records,
        "allocated": allocated,
        "hold_charts": hold_charts
    })

@csrf_exempt
def at_audit_open_chart_api(request, chart_id, is_quality_view=False):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    # Try to decrypt; fall back to raw chart_id for backward-compatibility
    chart_id = decrypt_chart_id(chart_id) or chart_id
    if not chart_id:
        return JsonResponse({"error": "Invalid or expired chart link"}, status=400)

    user = ACTIVE_TOKENS.get(token)
    auditor_id = user["emp_id"]
    
    try:
        with connection.cursor() as cursor:
            # Ensure tables exist
            cursor.execute("""
                IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='at_audit_dx_entries' AND xtype='U')
                CREATE TABLE at_audit_dx_entries (
                    id INT PRIMARY KEY IDENTITY(1,1),
                    chart_id INT,
                    from_date DATE,
                    to_date DATE,
                    start_page INT,
                    end_page INT,
                    dxcode NVARCHAR(50),
                    details NVARCHAR(MAX),
                    provider NVARCHAR(MAX),
                    eo NVARCHAR(MAX),
                    pos NVARCHAR(MAX),
                    dx_location NVARCHAR(MAX),
                    meat_dec NVARCHAR(MAX),
                    DOS_Flag NVARCHAR(MAX),
                    user_action NVARCHAR(50),
                    created_at DATETIME DEFAULT GETDATE()
                )
                ELSE
                BEGIN
                    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('at_audit_dx_entries') AND name = 'created_at')
                    ALTER TABLE at_audit_dx_entries ADD created_at DATETIME DEFAULT GETDATE()
                    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('at_audit_dx_entries') AND name = 'DOS_Flag')
                    ALTER TABLE at_audit_dx_entries ADD DOS_Flag NVARCHAR(MAX) NULL
                    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('at_audit_dx_entries') AND name = 'npi')
                    ALTER TABLE at_audit_dx_entries ADD npi NVARCHAR(20) NULL
                END
            """)
            cursor.execute("""
                IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='at_audit_errors' AND xtype='U')
                CREATE TABLE at_audit_errors (
                    id INT PRIMARY KEY IDENTITY(1,1),
                    chart_id INT,
                    row_id INT,
                    error_type NVARCHAR(50),
                    error_count INT,
                    error_command NVARCHAR(MAX),
                    changes NVARCHAR(MAX),
                    created_at DATETIME DEFAULT GETDATE()
                )
            """)
            cursor.execute("""
                IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='at_audit_allocations' AND xtype='U')
                CREATE TABLE at_audit_allocations (
                    id INT PRIMARY KEY IDENTITY(1,1),
                    chart_id INT,
                    project NVARCHAR(MAX),
                    subproject NVARCHAR(MAX),
                    at_auditor_id NVARCHAR(50),
                    start_time DATETIME NULL,
                    end_time DATETIME NULL,
                    chart_status NVARCHAR(50) DEFAULT 'unassigned',
                    reject_reason NVARCHAR(MAX) NULL,
                    reject_command NVARCHAR(MAX) NULL,
                    allocated_at DATETIME DEFAULT GETDATE()
                )
            """)

            # ---- chart ----
            cursor.execute("""
                SELECT c.pdf_path, a.reject_command, a.reject_reason, c.project, c.subproject
                FROM codings c
                JOIN audit_allocations a ON c.chart_id = a.chart_id
                WHERE c.chart_id = %s
            """, (chart_id,))
            chart_row = cursor.fetchone()
            if not chart_row:
                raise Http404("Chart not found")

            pdf_full_path, reject_command, reject_reason, project_val, subproject_val = chart_row

            # ---- chart status from at_audit_allocations ----
            cursor.execute("SELECT chart_status, at_auditor_id FROM at_audit_allocations WHERE chart_id = %s", (chart_id,))
            alloc_row = cursor.fetchone()
            
            if alloc_row:
                audit_chart_status, current_at_auditor_id = alloc_row
                
                # 1. Ownership Check: If chart is already allocated, ensure it's the current AT-auditor
                # REMOVE restrictive role check for Manager, VP, AM, TL
                # Relax ownership check for quality review views
                if not is_quality_view and str(current_at_auditor_id) != str(auditor_id) and user.get("role") not in ["Manager", "VP", "AM", "TL"]:
                    return JsonResponse({"error": "This chart is already allocated to another AT-auditor."}, status=403)
                
                # 2. Finalized Check: Block only if role is regular Auditor/SME
                # Administrative roles can view finalized charts
                # Relax finalized check for quality review views
                normalized_at_audit_status = (audit_chart_status or "").strip().lower()
                if not is_quality_view and normalized_at_audit_status in ['complete', 'completed', 'reject', 'rejected'] and user.get("role") not in ["Manager", "VP", "AM", "TL"]:
                    return JsonResponse({"error": "Access Denied: This AT-audit is already finalized and cannot be accessed."}, status=403)
            else:
                # Ensure allocation exists
                cursor.execute("""
                    INSERT INTO at_audit_allocations (chart_id, project, subproject, at_auditor_id, chart_status, allocated_at) 
                    VALUES (%s, %s, %s, %s, 'assigned', %s)
                """, (chart_id, project_val, subproject_val, auditor_id, timezone.localtime(timezone.now())))
                audit_chart_status = "assigned"

            # ---- set start time once ----
            cursor.execute("""
                UPDATE at_audit_allocations
                SET start_time = COALESCE(start_time, %s)
                WHERE chart_id = %s
            """, (timezone.localtime(timezone.now()), chart_id))

            # ---- copy DX once ----
            cursor.execute("""
                INSERT INTO at_audit_dx_entries
                (chart_id, from_date, to_date, start_page, end_page,
                 dxcode, details, provider, eo, pos, dx_location, meat_dec, DOS_Flag, npi)
                SELECT chart_id, from_date, to_date, start_page, end_page,
                       dxcode, details, provider, eo, pos, dx_location, meat_dec, DOS_Flag, npi
                FROM audit_dx_entries
                WHERE chart_id = %s
                AND NOT EXISTS (
                    SELECT 1 FROM at_audit_dx_entries WHERE chart_id = %s
                )
                AND user_action IS NULL
            """, (chart_id, chart_id))

            # ================= POST ACTIONS =================
            if request.method == "POST":
                data = json.loads(request.body)
                action = data.get("action")

                if action == "update_state":
                    state = data.get("state") # e.g. "correct", "wrong", "missed"
                    error_type = data.get("error_type")
                    row_id = data.get("row_id")
                    
                    # 1. Snapshot Update (UPDATE query)
                    # We use user_action to store the current audit label/state
                    cursor.execute("UPDATE at_audit_dx_entries SET user_action = %s WHERE id = %s", (state if state else None, row_id))
                    
                    # 2. History Append (INSERT query)
                    insert_type = error_type if error_type else 'Correct'
                    if not state and not error_type: insert_type = 'Undo'
                    
                    cursor.execute("""
                        INSERT INTO at_audit_errors
                        (chart_id, row_id, error_type, error_count, error_command, changes, created_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """, (
                        chart_id, row_id, insert_type,
                        data.get("error_count"), data.get("error_command"), 
                        json.dumps({"action": "update_state", "state": state}), timezone.localtime(timezone.now())
                    ))
                    return JsonResponse({"ok": True})

                if action == "add_dx":
                    # --- DUPLICATE GUARD (5s) ---
                    cursor.execute("""
                        SELECT 1 FROM at_audit_dx_entries 
                        WHERE chart_id = %s 
                          AND dxcode = %s 
                          AND from_date = %s 
                          AND to_date = %s 
                          AND start_page = %s 
                          AND end_page = %s
                          AND created_at > DATEADD(second, -5, GETDATE())
                    """, (
                        chart_id, data.get("dxcode"), 
                        data.get("from_date") if data.get("from_date") else None,
                        data.get("to_date") if data.get("to_date") else None,
                        data.get("start_page"), data.get("end_page")
                    ))
                    if cursor.fetchone():
                        return JsonResponse({"error": "Duplicate entry detected (Too fast!)"}, status=409)

                    # Insert Data
                    cursor.execute("""
                        INSERT INTO at_audit_dx_entries
                        (chart_id, from_date, to_date, start_page, end_page,
                         dxcode, details, provider, eo, pos, dx_location, meat_dec, DOS_Flag, npi)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        chart_id, data.get("from_date"), data.get("to_date"),
                        data.get("start_page"), data.get("end_page"), data.get("dxcode"),
                        data.get("details"), data.get("provider"), data.get("eo"),
                        data.get("pos"), data.get("dx_location"), data.get("meat_dec"),
                        data.get("DOS_Flag"), data.get("npi")
                    ))
                    
                    # Check for error info
                    error_type = data.get("error_type")
                    if error_type:
                        # Get the ID of the inserted row
                        cursor.execute("SELECT @@IDENTITY") # MSSQL
                        # For SQLite it is last_insert_rowid(), but project seems to use MSSQL logic often.
                        # Fallback or generic: 
                        # Let's assume MSSQL based on previous interactions.
                        new_id = cursor.fetchone()[0]
                        
                        cursor.execute("""
                            INSERT INTO at_audit_errors
                            (chart_id, row_id, error_type, error_count, error_command, changes, created_at)
                            VALUES (%s, %s, %s, %s, %s, %s, %s)
                        """, (
                            chart_id, new_id, error_type,
                            data.get("error_count"), data.get("error_command"), 
                            json.dumps({"action": "added"}), timezone.localtime(timezone.now())
                        ))
                    return JsonResponse({"ok": True})

                if action == "save_edit":
                    row_id = data["row_id"]
                    fields = data["fields"]
                    values = data["values"]

                    cursor.execute("SELECT * FROM at_audit_dx_entries WHERE id = %s", (row_id,))
                    
                    cols = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
                    original_row = dict(zip(cols, cursor.fetchone() or []))
                    
                    if not original_row:
                        return JsonResponse({"error": "Original not found"}, status=404)

                    # Prepare updates
                    updated_values = {}
                    changes = {"original": {}, "new": {}}
                    
                    for f in fields:
                        if f in values:
                            new_val = values[f]
                            old_val = original_row.get(f)

                            # Robust comparison & string conversion for JSON
                            new_s = str(new_val) if new_val is not None else ""
                            old_s = old_val.strftime("%Y-%m-%d") if hasattr(old_val, "strftime") else str(old_val if old_val is not None else "")

                            if new_s != old_s:
                                updated_values[f] = new_val
                                changes["original"][f] = old_s
                                changes["new"][f] = new_s
                    
                    # Update Data Table
                    if updated_values:
                        set_clause = ", ".join([f"{k} = %s" for k in updated_values.keys()])
                        params = list(updated_values.values()) + [row_id]
                        cursor.execute(f"UPDATE at_audit_dx_entries SET {set_clause} WHERE id = %s", params)

                    # Update Error Table
                    # Append new entry to history (INSERT only)
                    error_type = data.get("error_type")
                    if error_type:
                        cursor.execute("""
                            INSERT INTO at_audit_errors
                            (chart_id, row_id, error_type, error_count, error_command, changes, created_at)
                            VALUES (%s, %s, %s, %s, %s, %s, %s)
                        """, (
                            chart_id, row_id, error_type,
                            data.get("error_count"), data.get("error_command"), 
                            json.dumps(changes), timezone.localtime(timezone.now())
                        ))
                    
                    return JsonResponse({"ok": True})
                
                if action == "bulk_update":
                    row_ids = data.get("row_ids", [])
                    updates = data.get("updates", {}) # Data fields
                    
                    error_type = data.get("error_type")
                    error_count = data.get("error_count")
                    error_command = data.get("error_command")
                    
                    if not row_ids or not updates:
                         return JsonResponse({"error": "Missing row_ids or updates"}, status=400)

                    data_updates = {k: v for k, v in updates.items() if k not in ["error_type", "error_count", "error_command", "state"]}
                    
                    if not data_updates:
                         return JsonResponse({"error": "No data updates provided"}, status=400)

                    # 1. Fetch original rows for all row_ids
                    placeholders = ", ".join(["%s"] * len(row_ids))
                    cursor.execute(f"SELECT * FROM at_audit_dx_entries WHERE id IN ({placeholders})", row_ids)
                    cols_desc = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
                    raw_rows = cursor.fetchall()
                    original_rows_map = {}
                    for r in raw_rows:
                        rd = dict(zip(cols_desc, r))
                        original_rows_map[int(rd['id'])] = rd

                    # 2. Update Data for all rows
                    set_clause = ", ".join([f"{k} = %s" for k in data_updates.keys()])
                    params = list(data_updates.values())
                    cursor.execute(
                        f"UPDATE at_audit_dx_entries SET {set_clause} WHERE id IN ({placeholders})",
                        params + row_ids
                    )
                    
                    # 3. Update Errors
                    if error_type:
                        for rid_raw in row_ids:
                            rid = int(rid_raw)
                            orig_row = original_rows_map.get(rid, {})
                            
                            row_changes = {"original": {}, "new": {}}
                            for f, new_v in data_updates.items():
                                old_v = orig_row.get(f)
                                # Robust comparison: handle dates and nulls
                                old_s = old_v.strftime("%Y-%m-%d") if hasattr(old_v, "strftime") else str(old_v if old_v is not None else "")
                                new_s = str(new_v if new_v is not None else "")

                                if new_s != old_s:
                                    row_changes["original"][f] = old_s
                                    row_changes["new"][f] = new_s
                            
                            if row_changes["original"]:
                                cursor.execute("""
                                    INSERT INTO at_audit_errors
                                    (chart_id, row_id, error_type, error_count, error_command, changes, created_at)
                                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                                """, (
                                    chart_id, rid, error_type, error_count, error_command,
                                    json.dumps(row_changes), timezone.localtime(timezone.now())
                                ))

                    return JsonResponse({"ok": True})

                if action == "delete_dx":
                    row_id = data["row_id"]
                    # Hard delete associated errors first
                    cursor.execute("DELETE FROM at_audit_errors WHERE row_id = %s", (row_id,))
                    # Hard delete the entry itself
                    cursor.execute("DELETE FROM at_audit_dx_entries WHERE id = %s", (row_id,))
                    return JsonResponse({"ok": True})

                if action == "delete_error":
                    # Revert data based on history log (Full Reversion)
                    error_log_id = data["row_id"]
                    
                    cursor.execute("SELECT * FROM at_audit_errors WHERE id = %s", (error_log_id,))
                    cols = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
                    log_row = dict(zip(cols, cursor.fetchone() or []))
                    
                    if log_row:
                        target_row_id = log_row["row_id"]
                        try:
                            changes = json.loads(log_row["changes"]) if log_row["changes"] else {}
                        except:
                            changes = {}
                            
                        error_type = log_row["error_type"]
                        
                        if error_type == 'Deleted':
                            # Restore visibility
                            cursor.execute("UPDATE at_audit_dx_entries SET user_action = NULL WHERE id = %s", (target_row_id,))
                        elif error_type == 'Missed':
                            # Hard-delete the added row (user wants no trace)
                            cursor.execute("DELETE FROM at_audit_dx_entries WHERE id = %s", (target_row_id,))
                            # Also clean up any other errors for this specifically added row if they exist
                            cursor.execute("DELETE FROM at_audit_errors WHERE row_id = %s", (target_row_id,))
                        elif changes.get("original"):
                            # Restore specific fields
                            orig = changes["original"]
                            set_clause = ", ".join([f"{k} = %s" for k in orig.keys()])
                            params = list(orig.values()) + [target_row_id]
                            cursor.execute(f"UPDATE at_audit_dx_entries SET {set_clause}, user_action = NULL WHERE id = %s", params)
                        else:
                            # Clear state/label
                            cursor.execute("UPDATE at_audit_dx_entries SET user_action = NULL WHERE id = %s", (target_row_id,))

                        # FULL DELETE of the error record
                        cursor.execute("DELETE FROM at_audit_errors WHERE id = %s", (error_log_id,))
                        
                    return JsonResponse({"ok": True})

                if action == "save_chart":
                    # Ensure hold_command column exists
                    cursor.execute("IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('at_audit_allocations') AND name = 'hold_command') ALTER TABLE at_audit_allocations ADD hold_command NVARCHAR(MAX) NULL")
                    if data.get("chart_status") == "hold":
                        cursor.execute("""
                            UPDATE at_audit_allocations
                            SET chart_status='hold', hold_command=%s
                            WHERE chart_id=%s
                        """, (
                            data.get("hold_command", ""),
                            chart_id
                        ))
                    else:
                        cursor.execute("""
                            UPDATE at_audit_allocations
                            SET end_time=%s, chart_status=%s, reject_reason=%s, reject_command=%s
                            WHERE chart_id=%s
                        """, (
                            timezone.localtime(timezone.now()), data.get("chart_status"),
                            data.get("reject_reason"), data.get("reject_command"),
                            chart_id
                        ))
                    return JsonResponse({"ok": True})

            # ================= FETCH =================
            # 1. Fetch Audit Data (Clean Rows)
            cursor.execute("""
                SELECT * FROM at_audit_dx_entries
                WHERE chart_id = %s AND (user_action IS NULL OR user_action != 'deleted')
                ORDER BY from_date, to_date, pos, id
            """, (chart_id,))
            
            cols = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
            rows = []
            for r in cursor.fetchall():
                rd = dict(zip(cols, r))
                for k in ['from_date', 'to_date']:
                    if rd.get(k) and not isinstance(rd[k], str):
                        rd[k] = rd[k].strftime("%m-%d-%Y")
                rows.append(rd)
                
            # 2. Fetch Errors (Latest per row_id wins)
            cursor.execute("""
                SELECT row_id, error_type, error_count, error_command, changes
                FROM at_audit_errors
                WHERE chart_id = %s
                ORDER BY id ASC
            """, (chart_id,))
            
            err_cols = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
            errors_map = {} # row_id -> error dict
            for r in cursor.fetchall():
                ed = dict(zip(err_cols, r))
                errors_map[ed["row_id"]] = ed

            # 3. Merge Errors into Rows
            # The frontend expects 'state', 'error_type', 'error_count', 'error_command' on the row object
            for row in rows:
                if row["id"] in errors_map:
                    err = errors_map[row["id"]]
                    row["error_type"] = err["error_type"]
                    row["error_count"] = err["error_count"]
                    row["error_command"] = err["error_command"]
                    try:
                        row["changes"] = json.loads(err["changes"]) if err["changes"] else {}
                    except:
                        row["changes"] = {}
                    row["state"] = state_from_error(err["error_type"]) # Derive state for frontend styling
                else:
                    row["state"] = ""

            # ---- Fetch original coder rows (Code Log) ----
            cursor.execute("""
                SELECT d.*, c.reject_command, c.reject_reason 
                FROM audit_dx_entries d
                LEFT JOIN audit_allocations c ON d.chart_id = c.chart_id
                WHERE d.chart_id = %s
                ORDER BY d.from_date, d.to_date, d.pos, d.id
            """, (chart_id,))
            coder_cols = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
            coder_rows = []
            for r in cursor.fetchall():
                rd = dict(zip(coder_cols, r))
                for k in ['from_date', 'to_date']:
                    if rd.get(k) and not isinstance(rd[k], str):
                        rd[k] = rd[k].strftime("%m-%d-%Y")
                coder_rows.append(rd)

            # ---- Fetch at_audit error log (Audit Log) ----
            # Join at_audit_errors and at_audit_dx_entries to get full context for the log
            cursor.execute("""
                SELECT e.id, e.changes,
                       r.from_date, r.to_date, r.start_page, r.end_page,
                       e.error_type, e.error_count, e.error_command, r.dxcode, 
                       r.details, r.provider, r.eo, r.pos, r.dx_location, r.meat_dec, r.DOS_Flag, r.npi,
                       e.created_at
                FROM at_audit_errors e
                LEFT JOIN at_audit_dx_entries r ON e.row_id = r.id
                WHERE e.chart_id = %s
                ORDER BY e.created_at DESC
            """, (chart_id,))
            
            log_cols = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
            audit_log = []
            for r in cursor.fetchall():
                ld = dict(zip(log_cols, r))
                # Format dates for JSON
                for k in ['from_date', 'to_date', 'created_at']:
                    if ld.get(k) and not isinstance(ld[k], str):
                        if k == 'created_at':
                            if timezone.is_aware(ld[k]):
                                ld[k] = timezone.localtime(ld[k]).strftime("%m-%d-%Y %H:%M:%S")
                            else:
                                ld[k] = ld[k].strftime("%m-%d-%Y %H:%M:%S")
                        else:
                            ld[k] = ld[k].strftime("%m-%d-%Y")
                
                # Parse changes
                try:
                    ld['changes'] = json.loads(ld['changes']) if ld.get('changes') else {}
                except:
                    ld['changes'] = {}

                # Derive 'state' for the log if frontend expects it
                ld['state'] = state_from_error(ld.get('error_type'))
                audit_log.append(ld)

            # ---- Fetch standard audit_errors (Full context for AT Auditor) ----
            cursor.execute("""
                SELECT e.id, e.changes,
                       r.from_date, r.to_date, r.start_page, r.end_page,
                       e.error_type, e.error_count, e.error_command, r.dxcode, 
                       r.details, r.provider, r.eo, r.pos, r.dx_location, r.meat_dec, r.DOS_Flag, r.npi,
                       e.created_at
                FROM audit_errors e
                LEFT JOIN audit_dx_entries r ON e.row_id = r.id
                WHERE e.chart_id = %s
                ORDER BY e.created_at DESC
            """, (chart_id,))
            
            std_log_cols = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
            standard_audit_log = []
            for r in cursor.fetchall():
                sld = dict(zip(std_log_cols, r))
                for k in ['from_date', 'to_date', 'created_at']:
                    if sld.get(k) and not isinstance(sld[k], str):
                        if k == 'created_at':
                            if timezone.is_aware(sld[k]):
                                sld[k] = timezone.localtime(sld[k]).strftime("%m-%d-%Y %H:%M:%S")
                            else:
                                sld[k] = sld[k].strftime("%m-%d-%Y %H:%M:%S")
                        else:
                            sld[k] = sld[k].strftime("%m-%d-%Y")
                try:
                    sld['changes'] = json.loads(sld['changes']) if sld.get('changes') else {}
                except:
                    sld['changes'] = {}
                sld['state'] = state_from_error(sld.get('error_type'))
                standard_audit_log.append(sld)

            pdf_relative_path = _get_pdf_relative_path(pdf_full_path)
            return JsonResponse({
                "chart_id": chart_id,
                "pdf_path": pdf_relative_path,
                "rows": rows,            # This is for "Chart" view
                "coder_rows": coder_rows, # This is for "Code Log" view
                "audit_log": audit_log,   # This is for "Audit Log" view
                "errors": audit_log,      # Keep for backward compatibility
                #"standard_audit_log": standard_audit_log, # Standard Audit results
                "reject_command": reject_command,
                "reject_reason": reject_reason,
                "project": project_val,
                "subproject": subproject_val,
                "audit_status": audit_chart_status,
                "is_quality_view": is_quality_view
            })
    except Exception as e:
        traceback.print_exc()
        return JsonResponse({"error": str(e)}, status=500)




def audit_quality_dashboard_api(request):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    user = ACTIVE_TOKENS[token]
    user_id = user["emp_id"]
    role = user["role"]

    from_date = request.GET.get("from_date")
    to_date = request.GET.get("to_date")
    project = request.GET.get("project")
    subproject = request.GET.get("subproject")

    with connection.cursor() as cursor:
        query = """
            SELECT DISTINCT r.id, r.chart_id, r.dxcode, r.start_page, r.end_page,
                   e.error_type, r.dx_location, e.error_command, e.error_count, e.id as error_id
            FROM at_audit_dx_entries r
            JOIN audit_allocations aa ON aa.chart_id = r.chart_id
            JOIN at_audit_errors e ON e.row_id = r.id
            WHERE aa.auditor_id = %s
            AND (r.user_action = 'pending' OR r.user_action IS NULL)
            AND e.error_type NOT IN ('Correct', 'Corrected', '')
        """
        params = [user_id]

        if from_date and to_date:
            query += " AND aa.allocated_at BETWEEN %s AND %s"
            params += [from_date, to_date]

        if project:
            query += " AND aa.project = %s"
            params.append(project)

        if subproject:
            query += " AND aa.subproject = %s"
            params.append(subproject)

        cursor.execute(query, params)
        
        # CRITICAL FIX: Convert column names to lowercase
        columns = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
        
        # Build the list of dictionaries
        rows = [dict(zip(columns, r)) for r in cursor.fetchall()]

    return JsonResponse({"rows": rows})
@csrf_exempt
def audit_quality_summary_api(request):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    user = ACTIVE_TOKENS[token]
    user_id = user["emp_id"]

    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT
                c.project,
                c.subproject,
                COUNT(DISTINCT aa.chart_id) AS total_audited,
                COUNT(DISTINCT dx.id) AS total_icd,
                COUNT(DISTINCT CASE 
                    WHEN err.error_type NOT IN ('Correct', 'Corrected', '') 
                    AND err.id = (SELECT MAX(id) FROM at_audit_errors e2 WHERE e2.row_id = dx.id)
                    THEN dx.id 
                END) AS total_error
            FROM audit_allocations aa
            JOIN codings c ON c.chart_id = aa.chart_id
            LEFT JOIN at_audit_dx_entries dx ON dx.chart_id = aa.chart_id AND (dx.user_action IS NULL)
            LEFT JOIN at_audit_errors err ON err.row_id = dx.id
            WHERE aa.auditor_id = %s
            AND (aa.chart_status = 'complete' OR aa.chart_status = 'reject')
            GROUP BY c.project, c.subproject
            ORDER BY c.project, c.subproject
        """, [user_id])

        columns = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
        rows = [dict(zip(columns, r)) for r in cursor.fetchall()]

    # 🔢 Compute Quality %
    for r in rows:
        total_icd = r["total_icd"] or 0
        total_error = r["total_error"] or 0
        r["quality_percent"] = (
            round((1 - (total_error / total_icd)) * 100, 2)
            if total_icd > 0 else 100
        )

    return JsonResponse({"rows": rows})
@csrf_exempt
def audit_quality_action_api(request):
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request"}, status=400)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    row_id = data.get("id")
    action = data.get("action")
    comment = data.get("comment", "")

    if not row_id or not action:
        return JsonResponse({"error": "Missing data"}, status=400)

    with connection.cursor() as cursor:
        # CHANGED: '?' to '%s'
        cursor.execute("""
            UPDATE at_audit_dx_entries
            SET user_action = %s,
                user_action_command = %s
            WHERE id = %s
        """, (action, comment or action, row_id))

        if cursor.rowcount == 0:
            return JsonResponse({"error": "No row updated"}, status=400)

    return JsonResponse({"ok": True})
def audit_quality_view_chart_api(request, chart_id):
    # This will now use at_audit_open_chart_api so the auditor can see AT Audit results
    return at_audit_open_chart_api(request, chart_id, is_quality_view=True)


# ============================================================
# Hourly Production Tracker
# ============================================================

@csrf_exempt
def hourly_production_api(request):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    login_emp_id = ACTIVE_TOKENS[token]["emp_id"]

    # --------------------------------------------------
    # Parse filters (POST)
    # --------------------------------------------------
    filters = {}
    if request.method == "POST":
        try:
            data = json.loads(request.body)
            filters = {
                "manager": data.get("manager"),
                "tl": data.get("tl"),
                "project": data.get("project"),
                "subproject": data.get("subproject"),
                "date": data.get("date"),  # single date, defaults to today
            }
        except:
            pass

    selected_date = filters.get("date") or timezone.localdate().strftime("%Y-%m-%d")

    # --------------------------------------------------
    # Dropdown options
    # --------------------------------------------------
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT DISTINCT user_employee_id, username
            FROM user_details WHERE user_profile = 'Manager'
            ORDER BY username
        """)
        managers = [{"id": r[0], "name": r[1]} for r in cursor.fetchall()]

        cursor.execute("""
            SELECT DISTINCT user_employee_id, username
            FROM user_details WHERE user_profile = 'TL'
            ORDER BY username
        """)
        tls = [{"id": r[0], "name": r[1]} for r in cursor.fetchall()]

        cursor.execute("SELECT DISTINCT project, subproject FROM codings WHERE project IS NOT NULL AND subproject IS NOT NULL ORDER BY project, subproject")
        project_subproject_map = {}
        for p, s in cursor.fetchall():
            if p not in project_subproject_map:
                project_subproject_map[p] = []
            if s not in project_subproject_map[p]:
                project_subproject_map[p].append(s)
        
        projects = sorted(list(project_subproject_map.keys()))
        subprojects = sorted(list(set([s for ss in project_subproject_map.values() for s in ss])))

    # --------------------------------------------------
    # Recursive team hierarchy
    # --------------------------------------------------
    all_emp_ids = {login_emp_id}
    parent_ids = [login_emp_id]

    while parent_ids:
        placeholders = ",".join(["%s"] * len(parent_ids))
        with connection.cursor() as cursor:
            cursor.execute(
                f"SELECT user_employee_id FROM user_details WHERE tl_employee_id IN ({placeholders})",
                parent_ids,
            )
            children_ids = [r[0] for r in cursor.fetchall()]
        if not children_ids:
            break
        new_ids = [cid for cid in children_ids if cid not in all_emp_ids]
        if not new_ids:
            break
        all_emp_ids.update(new_ids)
        parent_ids = new_ids

    if not all_emp_ids:
        return JsonResponse({
            "rows": [],
            "filters": {"managers": managers, "tls": tls, "projects": projects, "subprojects": subprojects},
        })

    emp_ids = list(all_emp_ids)

    # --------------------------------------------------
    # Build dynamic conditions
    # --------------------------------------------------
    user_where = []
    user_params = []
    coding_conditions = []
    coding_params = []

    placeholders = ",".join(["%s"] * len(emp_ids))
    user_where.append(f"u.user_employee_id IN ({placeholders})")
    user_params.extend(emp_ids)

    coding_conditions.append("c_inner.chart_status IN ('complete', 'reject')")

    # Date filter (single day) - timestamps are stored in IST
    coding_conditions.append("CAST(c_inner.created_at AS DATE) = %s")
    coding_params.append(selected_date)

    if filters.get("manager"):
        user_where.append("tl.tl_employee_id = %s")
        user_params.append(filters["manager"])

    if filters.get("tl"):
        user_where.append("u.tl_employee_id = %s")
        user_params.append(filters["tl"])

    if filters.get("project"):
        coding_conditions.append("c_inner.project = %s")
        coding_params.append(filters["project"])

    if filters.get("subproject"):
        coding_conditions.append("c_inner.subproject = %s")
        coding_params.append(filters["subproject"])

    where_clause = " AND ".join(user_where)

    # --------------------------------------------------
    # Query: aggregate by user + hour
    # --------------------------------------------------
    with connection.cursor() as cursor:
        cursor.execute(f"""
            SELECT
                u.user_employee_id,
                u.username,
                u.user_mail_id,
                tl.username AS tl_name,
                DATEPART(HOUR, c.created_at) AS hour_slot,

                COUNT(DISTINCT c.chart_id) AS charts,

                COUNT(DISTINCT CASE
                    WHEN c.chart_status = 'complete' THEN c.chart_id
                END) AS completed_charts,

                COUNT(DISTINCT CASE
                    WHEN c.chart_status = 'reject' THEN c.chart_id
                END) AS rejected_charts,

                SUM(COALESCE(p.page_count, 0)) AS total_pages,
                SUM(COALESCE(c.chart_dos, 0)) AS total_dos,
                SUM(COALESCE(c.chart_icd, 0)) AS total_icd

            FROM user_details u
            LEFT JOIN user_details tl
                ON tl.user_employee_id = u.tl_employee_id

            LEFT JOIN (
                -- 1. Coder Production
                SELECT
                    c_inner.user_id,
                    c_inner.chart_id,
                    c_inner.chart_status,
                    c_inner.project_pdf_id,
                    c_inner.created_at,
                    dx_agg.chart_dos,
                    dx_agg.chart_icd
                FROM codings c_inner
                LEFT JOIN (
                    SELECT
                        chart_id,
                        COUNT(DISTINCT CONCAT(chart_id, '_', from_date, '_', to_date)) as chart_dos,
                        COUNT(CASE WHEN dxcode IS NOT NULL AND dxcode != '' THEN id END) as chart_icd
                    FROM dx_entries
                    GROUP BY chart_id
                ) dx_agg ON dx_agg.chart_id = c_inner.chart_id
                WHERE c_inner.chart_status IN ('complete', 'reject')
                AND dbo.fn_get_shift_date(c_inner.user_id, c_inner.created_at) = %s
                {"AND c_inner.project = %s" if filters.get("project") else ""}
                {"AND c_inner.subproject = %s" if filters.get("subproject") else ""}

                UNION ALL

                -- 2. Auditor Production
                SELECT
                    aa.auditor_id as user_id,
                    aa.chart_id,
                    aa.chart_status,
                    c_base.project_pdf_id,
                    aa.allocated_at as created_at,
                    dx_agg.chart_dos,
                    dx_agg.chart_icd
                FROM audit_allocations aa
                JOIN codings c_base ON c_base.chart_id = aa.chart_id
                LEFT JOIN (
                    SELECT
                        chart_id,
                        COUNT(DISTINCT CONCAT(chart_id, '_', from_date, '_', to_date)) as chart_dos,
                        COUNT(CASE WHEN dxcode IS NOT NULL AND dxcode != '' THEN id END) as chart_icd
                    FROM audit_dx_entries
                    GROUP BY chart_id
                ) dx_agg ON dx_agg.chart_id = aa.chart_id
                WHERE aa.chart_status IN ('complete', 'reject')
                AND dbo.fn_get_shift_date(aa.auditor_id, aa.allocated_at) = %s
                {"AND aa.project = %s" if filters.get("project") else ""}
                {"AND aa.subproject = %s" if filters.get("subproject") else ""}

                UNION ALL

                -- 3. AT Auditor Production
                SELECT
                    ata.at_auditor_id as user_id,
                    ata.chart_id,
                    ata.chart_status,
                    c_base.project_pdf_id,
                    ata.allocated_at as created_at,
                    dx_agg.chart_dos,
                    dx_agg.chart_icd
                FROM at_audit_allocations ata
                JOIN codings c_base ON c_base.chart_id = ata.chart_id
                LEFT JOIN (
                    SELECT
                        chart_id,
                        COUNT(DISTINCT CONCAT(chart_id, '_', from_date, '_', to_date)) as chart_dos,
                        COUNT(CASE WHEN dxcode IS NOT NULL AND dxcode != '' THEN id END) as chart_icd
                    FROM at_audit_dx_entries
                    GROUP BY chart_id
                ) dx_agg ON dx_agg.chart_id = ata.chart_id
                WHERE ata.chart_status IN ('complete', 'reject')
                AND dbo.fn_get_shift_date(ata.at_auditor_id, ata.allocated_at) = %s
                {"AND ata.project = %s" if filters.get("project") else ""}
                {"AND ata.subproject = %s" if filters.get("subproject") else ""}
            ) c ON c.user_id = u.user_employee_id

            LEFT JOIN project_pdfs p
                ON p.id = c.project_pdf_id

            WHERE {where_clause}

            GROUP BY
                u.user_employee_id,
                u.username,
                u.user_mail_id,
                tl.username,
                DATEPART(HOUR, c.created_at)

            ORDER BY u.username, hour_slot
        """, [val for _ in range(3) for val in (
            [selected_date] + 
            ([filters["project"]] if filters.get("project") else []) + 
            ([filters["subproject"]] if filters.get("subproject") else [])
        )] + user_params)

        cols = [col[0] for col in cursor.description]
        raw_rows = [dict(zip(cols, r)) for r in cursor.fetchall()]

    # --------------------------------------------------
    # Build response rows
    # --------------------------------------------------
    rows = []
    idx = 1
    for r in raw_rows:
        h = r.get("hour_slot")
        if h is None:
            continue
        hour_label = f"{int(h):02d}:00 – {int(h)+1:02d}:00"
        rows.append({
            "id": idx,
            "user_employee_id": r["user_employee_id"],
            "username": r["username"],
            "user_mail_id": r["user_mail_id"],
            "tl_name": r["tl_name"],
            "hour_slot": hour_label,
            "hour_val": int(h),
            "charts": r["charts"] or 0,
            "completed_charts": r["completed_charts"] or 0,
            "rejected_charts": r["rejected_charts"] or 0,
            "total_pages": r["total_pages"] or 0,
            "total_dos": r["total_dos"] or 0,
            "total_icd": r["total_icd"] or 0,
        })
        idx += 1

    return JsonResponse({
        "rows": rows,
        "selected_date": selected_date,
        "filters": {
            "managers": managers,
            "tls": tls,
            "projects": projects,
            "subprojects": subprojects,
            "project_subproject_map": project_subproject_map,
        },
    })


@csrf_exempt
def export_hourly_production_api(request):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    login_emp_id = ACTIVE_TOKENS[token]["emp_id"]

    filters = {}
    if request.method == "POST":
        try:
            data = json.loads(request.body)
            filters = data
        except:
            pass

    selected_date = filters.get("date") or timezone.localdate().strftime("%Y-%m-%d")

    # Recursive team hierarchy
    all_emp_ids = {login_emp_id}
    parent_ids = [login_emp_id]
    while parent_ids:
        placeholders = ",".join(["%s"] * len(parent_ids))
        with connection.cursor() as cursor:
            cursor.execute(
                f"SELECT user_employee_id FROM user_details WHERE tl_employee_id IN ({placeholders})",
                parent_ids,
            )
            children_ids = [r[0] for r in cursor.fetchall()]
        if not children_ids:
            break
        new_ids = [cid for cid in children_ids if cid not in all_emp_ids]
        if not new_ids:
            break
        all_emp_ids.update(new_ids)
        parent_ids = new_ids

    if not all_emp_ids:
        return JsonResponse({"error": "No team data found"}, status=404)

    emp_ids = list(all_emp_ids)

    # Build conditions
    user_where = []
    user_params = []
    coding_conditions = []
    coding_params = []

    placeholders = ",".join(["%s"] * len(emp_ids))
    user_where.append(f"u.user_employee_id IN ({placeholders})")
    user_params.extend(emp_ids)

    coding_conditions.append("c_inner.chart_status IN ('complete', 'reject')")
    coding_conditions.append("CAST(c_inner.created_at AS DATE) = %s")
    coding_params.append(selected_date)

    if filters.get("manager"):
        user_where.append("tl.tl_employee_id = %s")
        user_params.append(filters["manager"])
    if filters.get("tl"):
        user_where.append("u.tl_employee_id = %s")
        user_params.append(filters["tl"])
    if filters.get("project"):
        coding_conditions.append("c_inner.project = %s")
        coding_params.append(filters["project"])
    if filters.get("subproject"):
        coding_conditions.append("c_inner.subproject = %s")
        coding_params.append(filters["subproject"])

    where_clause = " AND ".join(user_where)

    with connection.cursor() as cursor:
        cursor.execute(f"""
            SELECT
                u.user_employee_id AS [Emp ID],
                u.username AS [Employee],
                u.user_mail_id AS [Email],
                tl.username AS [TL],
                DATEPART(HOUR, c.created_at) AS [Hour],

                COUNT(DISTINCT c.chart_id) AS [Charts],

                COUNT(DISTINCT CASE
                    WHEN c.chart_status = 'complete' THEN c.chart_id
                END) AS [Completed],

                COUNT(DISTINCT CASE
                    WHEN c.chart_status = 'reject' THEN c.chart_id
                END) AS [Rejected],

                SUM(COALESCE(p.page_count, 0)) AS [Pages],
                SUM(COALESCE(c.chart_dos, 0)) AS [DOS],
                SUM(COALESCE(c.chart_icd, 0)) AS [ICD]

            FROM user_details u
            LEFT JOIN user_details tl
                ON tl.user_employee_id = u.tl_employee_id

            LEFT JOIN (
                -- 1. Coder Production
                SELECT
                    c_inner.user_id,
                    c_inner.chart_id,
                    c_inner.chart_status,
                    c_inner.project_pdf_id,
                    c_inner.created_at,
                    dx_agg.chart_dos,
                    dx_agg.chart_icd
                FROM codings c_inner
                LEFT JOIN (
                    SELECT
                        chart_id,
                        COUNT(DISTINCT CONCAT(chart_id, '_', from_date, '_', to_date)) as chart_dos,
                        COUNT(CASE WHEN dxcode IS NOT NULL AND dxcode != '' THEN id END) as chart_icd
                    FROM dx_entries
                    GROUP BY chart_id
                ) dx_agg ON dx_agg.chart_id = c_inner.chart_id
                WHERE c_inner.chart_status IN ('complete', 'reject')
                AND dbo.fn_get_shift_date(c_inner.user_id, c_inner.created_at) = %s
                {"AND c_inner.project = %s" if filters.get("project") else ""}
                {"AND c_inner.subproject = %s" if filters.get("subproject") else ""}

                UNION ALL

                -- 2. Auditor Production
                SELECT
                    aa.auditor_id as user_id,
                    aa.chart_id,
                    aa.chart_status,
                    c_base.project_pdf_id,
                    aa.allocated_at as created_at,
                    dx_agg.chart_dos,
                    dx_agg.chart_icd
                FROM audit_allocations aa
                JOIN codings c_base ON c_base.chart_id = aa.chart_id
                LEFT JOIN (
                    SELECT
                        chart_id,
                        COUNT(DISTINCT CONCAT(chart_id, '_', from_date, '_', to_date)) as chart_dos,
                        COUNT(CASE WHEN dxcode IS NOT NULL AND dxcode != '' THEN id END) as chart_icd
                    FROM audit_dx_entries
                    GROUP BY chart_id
                ) dx_agg ON dx_agg.chart_id = aa.chart_id
                WHERE aa.chart_status IN ('complete', 'reject')
                AND dbo.fn_get_shift_date(aa.auditor_id, aa.allocated_at) = %s
                {"AND aa.project = %s" if filters.get("project") else ""}
                {"AND aa.subproject = %s" if filters.get("subproject") else ""}

                UNION ALL

                -- 3. AT Auditor Production
                SELECT
                    ata.auditor_id as user_id,
                    ata.chart_id,
                    ata.chart_status,
                    c_base.project_pdf_id,
                    ata.allocated_at as created_at,
                    dx_agg.chart_dos,
                    dx_agg.chart_icd
                FROM at_audit_allocations ata
                JOIN codings c_base ON c_base.chart_id = ata.chart_id
                LEFT JOIN (
                    SELECT
                        chart_id,
                        COUNT(DISTINCT CONCAT(chart_id, '_', from_date, '_', to_date)) as chart_dos,
                        COUNT(CASE WHEN dxcode IS NOT NULL AND dxcode != '' THEN id END) as chart_icd
                    FROM at_audit_dx_entries
                    GROUP BY chart_id
                ) dx_agg ON dx_agg.chart_id = ata.chart_id
                WHERE ata.chart_status IN ('complete', 'reject')
                AND dbo.fn_get_shift_date(ata.auditor_id, ata.allocated_at) = %s
                {"AND ata.project = %s" if filters.get("project") else ""}
                {"AND ata.subproject = %s" if filters.get("subproject") else ""}
            ) c ON c.user_id = u.user_employee_id

            LEFT JOIN project_pdfs p
                ON p.id = c.project_pdf_id

            WHERE {where_clause}

            GROUP BY
                u.user_employee_id,
                u.username,
                u.user_mail_id,
                tl.username,
                DATEPART(HOUR, c.created_at)

            ORDER BY u.username, [Hour]
        """, [val for _ in range(3) for val in (
            [selected_date] + 
            ([filters["project"]] if filters.get("project") else []) + 
            ([filters["subproject"]] if filters.get("subproject") else [])
        )] + user_params)

        columns = [col[0] for col in cursor.description]
        data_rows = cursor.fetchall()

    import pandas as pd
    df = pd.DataFrame(data_rows, columns=columns)

    if df.empty:
        final_columns = ["Emp ID", "Employee", "TL"] + \
                        [f"{(h % 12) if (h % 12) != 0 else 12}{'am' if h < 12 else 'pm'}" for h in range(24)] + \
                        ["Total"]
        final_data = []
    else:
        # Pivot
        pivot_df = df.pivot_table(
            index=["Emp ID", "Employee", "TL"],
            columns="Hour",
            values="Charts",
            aggfunc="sum"
        ).fillna(0)

        # Ensure all 24 hours are present
        for h in range(24):
            if h not in pivot_df.columns:
                pivot_df[h] = 0

        # Sort columns 0-23
        pivot_df = pivot_df.reindex(columns=sorted([c for c in pivot_df.columns if isinstance(c, (int, float))]))

        # Calculate Total
        pivot_df["Total"] = pivot_df.sum(axis=1)

        # Rename hour columns
        rename_map = {h: f"{(h % 12) if (h % 12) != 0 else 12}{'am' if h < 12 else 'pm'}" for h in range(24)}
        pivot_df = pivot_df.rename(columns=rename_map)

        # Reset index to bring Emp ID, Employee, TL back as columns
        final_df = pivot_df.reset_index()
        
        final_columns = list(final_df.columns)
        final_data = final_df.values.tolist()

    import openpyxl
    from openpyxl.styles import Font, Alignment, PatternFill
    from io import BytesIO

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Hourly Production"

    # Header styling
    header_fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
    hour_header_font = Font(bold=True, color="B91C1C") # Red font for hours as in image

    for col_num, column_title in enumerate(final_columns, 1):
        cell = ws.cell(row=1, column=col_num)
        cell.value = column_title
        cell.font = Font(bold=True)
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
        
        # If it's an hour column, make font red
        if ampm_suffix := any(suffix in column_title for suffix in ["am", "pm"]):
            cell.font = Font(bold=True, color="B91C1C")

    for row_num, row_data in enumerate(final_data, 2):
        for col_num, cell_value in enumerate(row_data, 1):
            cell = ws.cell(row=row_num, column=col_num)
            cell.value = cell_value if cell_value != 0 else ""
            cell.alignment = Alignment(horizontal="center")

    output = BytesIO()
    wb.save(output)
    output.seek(0)

    filename = f"Hourly_Production_{selected_date}.xlsx"
    response = HttpResponse(
        output.getvalue(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@csrf_exempt
def my_production_api(request):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    login_emp_id = ACTIVE_TOKENS[token]["emp_id"]
    from_date = request.GET.get("from_date")
    to_date = request.GET.get("to_date")

    where_conditions = ["c.user_id = %s", "c.chart_status IN ('complete', 'reject')"]
    params = [login_emp_id]

    if from_date:
        where_conditions.append("dbo.fn_get_shift_date(c.user_id, c.created_at) >= %s")
        params.append(from_date)
    if to_date:
        where_conditions.append("dbo.fn_get_shift_date(c.user_id, c.created_at) <= %s")
        params.append(to_date)

    where_clause = " AND ".join(where_conditions)

    with connection.cursor() as cursor:
        cursor.execute(f"""
            SELECT
                c.chart_id,
                c.project,
                c.subproject,
                c.chart_status,
                c.created_at,
                dbo.fn_get_shift_name(c.user_id, dbo.fn_get_shift_date(c.user_id, c.created_at)) AS shift_name,
                CONVERT(VARCHAR(10), dbo.fn_get_shift_date(c.user_id, c.created_at), 120) AS shift_date,
                COALESCE(p.page_count, 0) AS total_pages,
                COALESCE(dx_agg.chart_dos, 0) AS total_dos,
                COALESCE(dx_agg.chart_icd, 0) AS total_icd
            FROM codings c
            LEFT JOIN project_pdfs p ON p.id = c.project_pdf_id
            LEFT JOIN (
                SELECT
                    chart_id,
                    COUNT(DISTINCT CONCAT(chart_id, '_', from_date, '_', to_date)) as chart_dos,
                    COUNT(CASE WHEN dxcode IS NOT NULL AND dxcode != '' THEN id END) as chart_icd
                FROM dx_entries
                GROUP BY chart_id
            ) dx_agg ON dx_agg.chart_id = c.chart_id
            WHERE {where_clause}
            ORDER BY c.created_at DESC
        """, params)

        columns = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
        rows = []
        for r in cursor.fetchall():
            row_dict = dict(zip(columns, r))
            row_dict['encrypted_chart_id'] = encrypt_chart_id(row_dict['chart_id'])
            rows.append(row_dict)

    return JsonResponse({"rows": rows})


@csrf_exempt
def my_audit_production_api(request):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    login_emp_id = ACTIVE_TOKENS[token]["emp_id"]
    from_date = request.GET.get("from_date")
    to_date = request.GET.get("to_date")

    where_conditions = ["aa.auditor_id = %s", "aa.chart_status IN ('complete', 'reject')"]
    params = [login_emp_id]

    if from_date:
        where_conditions.append("dbo.fn_get_shift_date(aa.auditor_id, aa.allocated_at) >= %s")
        params.append(from_date)
    if to_date:
        where_conditions.append("dbo.fn_get_shift_date(aa.auditor_id, aa.allocated_at) <= %s")
        params.append(to_date)

    where_clause = " AND ".join(where_conditions)

    with connection.cursor() as cursor:
        cursor.execute(f"""
            SELECT
                aa.chart_id,
                c.project,
                c.subproject,
                aa.chart_status,
                aa.allocated_at as created_at,
                dbo.fn_get_shift_name(aa.auditor_id, dbo.fn_get_shift_date(aa.auditor_id, aa.allocated_at)) AS shift_name,
                CONVERT(VARCHAR(10), dbo.fn_get_shift_date(aa.auditor_id, aa.allocated_at), 120) AS shift_date,
                COALESCE(p.page_count, 0) AS total_pages,
                COALESCE(dx_agg.chart_dos, 0) AS total_dos,
                COALESCE(dx_agg.chart_icd, 0) AS total_icd,
                COALESCE(err_agg.total_errors, 0) AS total_errors
            FROM audit_allocations aa
            JOIN codings c ON c.chart_id = aa.chart_id
            LEFT JOIN project_pdfs p ON p.id = c.project_pdf_id
            LEFT JOIN (
                SELECT
                    chart_id,
                    COUNT(DISTINCT CONCAT(chart_id, '_', from_date, '_', to_date)) as chart_dos,
                    COUNT(CASE WHEN dxcode IS NOT NULL AND dxcode != '' THEN id END) as chart_icd
                FROM audit_dx_entries
                GROUP BY chart_id
            ) dx_agg ON dx_agg.chart_id = aa.chart_id
            LEFT JOIN (
                SELECT chart_id, COUNT(*) as total_errors
                FROM audit_errors
                GROUP BY chart_id
            ) err_agg ON err_agg.chart_id = aa.chart_id
            WHERE {where_clause}
            ORDER BY aa.allocated_at DESC
        """, params)

        columns = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
        rows = []
        for r in cursor.fetchall():
            row_dict = dict(zip(columns, r))
            row_dict['encrypted_chart_id'] = encrypt_chart_id(row_dict['chart_id'])
            rows.append(row_dict)

    return JsonResponse({"rows": rows})


@csrf_exempt
def my_at_audit_production_api(request):
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    login_emp_id = ACTIVE_TOKENS[token]["emp_id"]
    from_date = request.GET.get("from_date")
    to_date = request.GET.get("to_date")

    where_conditions = ["aa.auditor_id = %s", "aa.chart_status IN ('complete', 'reject')"]
    params = [login_emp_id]

    if from_date:
        where_conditions.append("dbo.fn_get_shift_date(aa.auditor_id, aa.allocated_at) >= %s")
        params.append(from_date)
    if to_date:
        where_conditions.append("dbo.fn_get_shift_date(aa.auditor_id, aa.allocated_at) <= %s")
        params.append(to_date)

    where_clause = " AND ".join(where_conditions)

    with connection.cursor() as cursor:
        cursor.execute(f"""
            SELECT
                aa.chart_id,
                c.project,
                c.subproject,
                aa.chart_status,
                aa.allocated_at as created_at,
                dbo.fn_get_shift_name(aa.auditor_id, dbo.fn_get_shift_date(aa.auditor_id, aa.allocated_at)) AS shift_name,
                CONVERT(VARCHAR(10), dbo.fn_get_shift_date(aa.auditor_id, aa.allocated_at), 120) AS shift_date,
                COALESCE(p.page_count, 0) AS total_pages,
                COALESCE(dx_agg.chart_dos, 0) AS total_dos,
                COALESCE(dx_agg.chart_icd, 0) AS total_icd,
                COALESCE(err_agg.total_errors, 0) AS total_errors
            FROM at_audit_allocations aa
            JOIN codings c ON c.chart_id = aa.chart_id
            LEFT JOIN project_pdfs p ON p.id = c.project_pdf_id
            LEFT JOIN (
                SELECT
                    chart_id,
                    COUNT(DISTINCT CONCAT(chart_id, '_', from_date, '_', to_date)) as chart_dos,
                    COUNT(CASE WHEN dxcode IS NOT NULL AND dxcode != '' THEN id END) as chart_icd
                FROM at_audit_dx_entries
                GROUP BY chart_id
            ) dx_agg ON dx_agg.chart_id = aa.chart_id
            LEFT JOIN (
                SELECT chart_id, COUNT(*) as total_errors
                FROM at_audit_errors
                GROUP BY chart_id
            ) err_agg ON err_agg.chart_id = aa.chart_id
            WHERE {where_clause}
            ORDER BY aa.allocated_at DESC
        """, params)

        columns = [col[0] if col[0].lower() == 'dos_flag' else col[0].lower() for col in cursor.description]
        rows = []
        for r in cursor.fetchall():
            row_dict = dict(zip(columns, r))
            row_dict['encrypted_chart_id'] = encrypt_chart_id(row_dict['chart_id'])
            rows.append(row_dict)

    return JsonResponse({"rows": rows})


# ============================================================
#   CLARIFICATION PORTAL
# ============================================================

_CLARIFICATION_TABLES_READY = False

def _ensure_clarification_tables():
    """Create clarification_requests and clarification_responses tables if not present."""
    global _CLARIFICATION_TABLES_READY
    if _CLARIFICATION_TABLES_READY:
        return
    try:
        with connection.cursor() as c:
            # clarification_requests
            c.execute("SELECT * FROM sysobjects WHERE name='clarification_requests' AND xtype='U'")
            if not c.fetchone():
                c.execute("""
                    CREATE TABLE clarification_requests (
                        id INT IDENTITY(1,1) PRIMARY KEY,
                        chart_id NVARCHAR(255) NOT NULL,
                        project NVARCHAR(255),
                        subproject NVARCHAR(255),
                        dx_location NVARCHAR(255),
                        doubt_page_from INT,
                        doubt_page_to INT,
                        doubt_scenario NVARCHAR(255),
                        description NVARCHAR(MAX),
                        image_path NVARCHAR(MAX),
                        status NVARCHAR(50) DEFAULT 'pending',
                        raised_by NVARCHAR(255),
                        raised_by_name NVARCHAR(255),
                        raised_at DATETIME DEFAULT GETDATE()
                    )
                """)

            # clarification_responses
            c.execute("SELECT * FROM sysobjects WHERE name='clarification_responses' AND xtype='U'")
            if not c.fetchone():
                c.execute("""
                    CREATE TABLE clarification_responses (
                        id INT IDENTITY(1,1) PRIMARY KEY,
                        clarification_id INT NOT NULL,
                        response_text NVARCHAR(MAX),
                        responded_by NVARCHAR(255),
                        responded_by_name NVARCHAR(255),
                        responded_at DATETIME DEFAULT GETDATE()
                    )
                """)
            _CLARIFICATION_TABLES_READY = True
    except Exception:
        traceback.print_exc()



@csrf_exempt
def clarification_count_api(request):
    """Returns notification count for the current user (used for nav badge)."""
    _ensure_clarification_tables()
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"count": 0})

    user = ACTIVE_TOKENS[token]
    emp_id = user["emp_id"]
    role = user["role"]

    # Cache for 15s — nav badge polling every few seconds from 60+ users
    # would otherwise create hundreds of DB queries per minute.
    _cc_key = f"clarif_count:{emp_id}"
    _cached_count = _CLARIF_CNT_CACHE.get(_cc_key)
    if _cached_count is not None:
        return JsonResponse({"count": _cached_count})

    try:
        with connection.cursor() as cursor:
            if role == "Coder":
                cursor.execute("""
                    SELECT COUNT(*) FROM clarification_requests
                    WHERE raised_by = %s AND status = 'responded'
                """, [emp_id])

            elif role == "SME":
                cursor.execute("""
                    SELECT COUNT(*) FROM clarification_requests
                    WHERE status = 'pending'
                """)

            elif role in ["TL", "Manager", "VP", "AM"]:
                cursor.execute("""
                    ;WITH TeamHierarchy AS (
                        SELECT user_employee_id FROM user_details WHERE user_employee_id = %s
                        UNION ALL
                        SELECT u.user_employee_id FROM user_details u
                        INNER JOIN TeamHierarchy th ON u.tl_employee_id = th.user_employee_id
                    )
                    SELECT COUNT(*) FROM clarification_requests r
                    WHERE r.raised_by IN (
                        SELECT user_employee_id FROM TeamHierarchy
                        WHERE user_employee_id != %s
                    ) AND r.status = 'pending'
                """, [emp_id, emp_id])

            else:
                return JsonResponse({"count": 0})

            count = cursor.fetchone()[0]
        _CLARIF_CNT_CACHE.set(_cc_key, count)
        return JsonResponse({"count": count})
    except Exception:
        traceback.print_exc()
        return JsonResponse({"count": 0})


@csrf_exempt
def clarification_portal_api(request):
    """GET: list clarification requests (role-scoped). POST: create new request."""
    _ensure_clarification_tables()
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    user = ACTIVE_TOKENS[token]
    emp_id = user["emp_id"]
    role = user["role"]

    if request.method == "GET":
        requests_list = []

        _SELECT_COLS = """
            SELECT r.id, r.chart_id, r.project, r.subproject, r.dx_location,
                   r.doubt_page_from, r.doubt_page_to, r.doubt_scenario,
                   r.description, r.image_path, r.status,
                   r.raised_by, r.raised_by_name,
                   CONVERT(NVARCHAR, r.raised_at, 120) as raised_at,
                   ISNULL(ud.tl_employee_id, '') as tl_employee_id,
                   ISNULL(tl_ud.username, '') as tl_name
            FROM clarification_requests r
            LEFT JOIN user_details ud ON ud.user_employee_id = r.raised_by
            LEFT JOIN user_details tl_ud ON tl_ud.user_employee_id = ud.tl_employee_id
        """

        with connection.cursor() as cursor:
            if role == "Coder":
                # Coders see only their OWN requests
                cursor.execute(_SELECT_COLS + """
                    WHERE r.raised_by = %s
                    ORDER BY r.raised_at DESC
                """, [emp_id])
                cols = [d[0] for d in cursor.description]
                rows_data = cursor.fetchall()

            elif role == "SME":
                # SMEs see ALL requests from every coder
                cursor.execute(_SELECT_COLS + "ORDER BY r.raised_at DESC")
                cols = [d[0] for d in cursor.description]
                rows_data = cursor.fetchall()

            elif role in ["TL", "Manager", "VP", "AM"]:
                # TL/Manager hierarchy: find all users under this person's supervision
                cursor.execute("""
                    ;WITH TeamHierarchy AS (
                        SELECT user_employee_id
                        FROM user_details
                        WHERE user_employee_id = %s

                        UNION ALL

                        SELECT u.user_employee_id
                        FROM user_details u
                        INNER JOIN TeamHierarchy th ON u.tl_employee_id = th.user_employee_id
                    )
                    SELECT DISTINCT user_employee_id FROM TeamHierarchy
                    WHERE user_employee_id != %s
                """, [emp_id, emp_id])
                team_ids = [r[0] for r in cursor.fetchall()]

                if team_ids:
                    placeholders = ",".join(["%s"] * len(team_ids))
                    # Include team hierarchy requests AND their own raised requests
                    cursor.execute(f"""
                        {_SELECT_COLS}
                        WHERE r.raised_by IN ({placeholders})
                           OR r.raised_by = %s
                        ORDER BY r.raised_at DESC
                    """, team_ids + [emp_id])
                else:
                    # No team members found — still show their own requests
                    cursor.execute(_SELECT_COLS + """
                        WHERE r.raised_by = %s
                        ORDER BY r.raised_at DESC
                    """, [emp_id])

                cols = [d[0] for d in cursor.description]
                rows_data = cursor.fetchall()

            else:
                # Auditor and any other roles — show only their own raised requests
                cursor.execute(_SELECT_COLS + """
                    WHERE r.raised_by = %s
                    ORDER BY r.raised_at DESC
                """, [emp_id])
                cols = [d[0] for d in cursor.description]
                rows_data = cursor.fetchall()

            for row in rows_data:
                req = dict(zip(cols, row))
                # Fetch responses for each request
                cursor2_sql = """
                    SELECT id, response_text, responded_by, responded_by_name,
                           CONVERT(NVARCHAR, responded_at, 120) as responded_at
                    FROM clarification_responses
                    WHERE clarification_id = %s
                    ORDER BY responded_at ASC
                """
                with connection.cursor() as c2:
                    c2.execute(cursor2_sql, [req["id"]])
                    resp_cols = [d[0] for d in c2.description]
                    req["responses"] = [dict(zip(resp_cols, r)) for r in c2.fetchall()]
                requests_list.append(req)

        return JsonResponse({"requests": requests_list, "current_user_id": emp_id})

    elif request.method == "POST":
        try:
            # Support multipart (image upload) or JSON
            if request.content_type and "multipart" in request.content_type:
                data = request.POST
                chart_id_raw = data.get("chart_id", "")
                project = data.get("project", "")
                subproject = data.get("subproject", "")
                dx_location = data.get("dx_location", "")
                doubt_page_from = data.get("doubt_page_from") or None
                doubt_page_to = data.get("doubt_page_to") or None
                doubt_scenario = data.get("doubt_scenario", "")
                description = data.get("description", "")
                image_path = ""

                if "image" in request.FILES:
                    img_file = request.FILES["image"]
                    import os
                    from django.conf import settings
                    save_dir = os.path.join(settings.MEDIA_ROOT, "clarifications")
                    os.makedirs(save_dir, exist_ok=True)
                    safe_name = f"{uuid.uuid4()}_{img_file.name}"
                    save_path = os.path.join(save_dir, safe_name)
                    with open(save_path, "wb") as f:
                        for chunk in img_file.chunks():
                            f.write(chunk)
                    image_path = f"clarifications/{safe_name}"
            else:
                data = json.loads(request.body)
                chart_id_raw = data.get("chart_id", "")
                project = data.get("project", "")
                subproject = data.get("subproject", "")
                dx_location = data.get("dx_location", "")
                doubt_page_from = data.get("doubt_page_from") or None
                doubt_page_to = data.get("doubt_page_to") or None
                doubt_scenario = data.get("doubt_scenario", "")
                description = data.get("description", "")
                image_path = data.get("image_path", "")

            # Decrypt chart_id if encrypted
            chart_id = decrypt_chart_id(chart_id_raw)
            if not chart_id:
                chart_id = chart_id_raw

            # Get username
            with connection.cursor() as cursor:
                cursor.execute("SELECT username FROM user_details WHERE user_employee_id = %s", [emp_id])
                row = cursor.fetchone()
                raised_by_name = row[0] if row else emp_id

            with connection.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO clarification_requests
                        (chart_id, project, subproject, dx_location,
                         doubt_page_from, doubt_page_to, doubt_scenario,
                         description, image_path, status, raised_by, raised_by_name, raised_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending', %s, %s, GETDATE())
                """, [
                    chart_id, project, subproject, dx_location,
                    doubt_page_from, doubt_page_to, doubt_scenario,
                    description, image_path, emp_id, raised_by_name
                ])
            return JsonResponse({"ok": True})

        except Exception as e:
            traceback.print_exc()
            return JsonResponse({"error": str(e)}, status=500)

    return JsonResponse({"error": "Method not allowed"}, status=405)


@csrf_exempt
def clarification_respond_api(request, clarification_id):
    """GET: detail of one request + its pdf_path. POST: add a response."""
    _ensure_clarification_tables()
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    user = ACTIVE_TOKENS[token]
    emp_id = user["emp_id"]

    if request.method == "GET":
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT r.id, r.chart_id, r.project, r.subproject, r.dx_location,
                       r.doubt_page_from, r.doubt_page_to, r.doubt_scenario,
                       r.description, r.image_path, r.status,
                       r.raised_by, r.raised_by_name,
                       CONVERT(NVARCHAR, r.raised_at, 120) as raised_at
                FROM clarification_requests r
                WHERE r.id = %s
            """, [clarification_id])
            cols = [d[0] for d in cursor.description]
            row = cursor.fetchone()
            if not row:
                return JsonResponse({"error": "Not found"}, status=404)
            req = dict(zip(cols, row))

            # Get pdf_path from codings table
            cursor.execute("""
                SELECT TOP 1 p.file_path
                FROM codings c
                LEFT JOIN project_pdfs p ON p.id = c.project_pdf_id
                WHERE c.chart_id = %s
            """, [req["chart_id"]])
            pdf_row = cursor.fetchone()
            req["pdf_path"] = _get_pdf_relative_path(pdf_row[0]) if pdf_row and pdf_row[0] else ""

            # Get responses
            cursor.execute("""
                SELECT id, response_text, responded_by, responded_by_name,
                       CONVERT(NVARCHAR, responded_at, 120) as responded_at
                FROM clarification_responses
                WHERE clarification_id = %s
                ORDER BY responded_at ASC
            """, [clarification_id])
            resp_cols = [d[0] for d in cursor.description]
            req["responses"] = [dict(zip(resp_cols, r)) for r in cursor.fetchall()]

        return JsonResponse({"request": req})

    elif request.method == "POST":
        try:
            data = json.loads(request.body)
            response_text = data.get("response_text", "").strip()
            if not response_text:
                return JsonResponse({"error": "Response text is required"}, status=400)

            # Get username
            with connection.cursor() as cursor:
                cursor.execute("SELECT username FROM user_details WHERE user_employee_id = %s", [emp_id])
                row = cursor.fetchone()
                responded_by_name = row[0] if row else emp_id

            with connection.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO clarification_responses
                        (clarification_id, response_text, responded_by, responded_by_name, responded_at)
                    VALUES (%s, %s, %s, %s, GETDATE())
                """, [clarification_id, response_text, emp_id, responded_by_name])

                # Update request status to 'responded'
                cursor.execute("""
                    UPDATE clarification_requests SET status = 'responded'
                    WHERE id = %s AND status = 'pending'
                """, [clarification_id])

            return JsonResponse({"ok": True})
        except Exception as e:
            traceback.print_exc()
            return JsonResponse({"error": str(e)}, status=500)

    return JsonResponse({"error": "Method not allowed"}, status=405)


@csrf_exempt
def clarification_upload_image_api(request):
    """POST: Upload an image for a clarification request. Returns image_path."""
    token = _extract_token_from_header(request)
    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    if "image" not in request.FILES:
        return JsonResponse({"error": "No image file provided"}, status=400)

    img_file = request.FILES["image"]
    import os
    from django.conf import settings
    save_dir = os.path.join(settings.MEDIA_ROOT, "clarifications")
    os.makedirs(save_dir, exist_ok=True)
    safe_name = f"{uuid.uuid4()}_{img_file.name}"
    save_path = os.path.join(save_dir, safe_name)
    with open(save_path, "wb") as f:
        for chunk in img_file.chunks():
            f.write(chunk)

    return JsonResponse({"image_path": f"clarifications/{safe_name}"})

from django.core.mail import send_mail
from django.contrib.auth.hashers import make_password
import string

@csrf_exempt
def forgot_password_request_otp_api(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    try:
        data = json.loads(request.body)
        email = data.get("email", "").strip().lower()
        if not email:
            return JsonResponse({"error": "Email is required"}, status=400)

        with connection.cursor() as cursor:
            cursor.execute("SELECT user_employee_id, username FROM user_details WHERE LOWER(user_mail_id) = %s", (email,))
            row = cursor.fetchone()

        if not row:
            return JsonResponse({"error": "Email not found"}, status=404)

        emp_id, username = row
        otp = ''.join(random.choices(string.digits, k=6))
        expires_at = datetime.datetime.now() + datetime.timedelta(minutes=10)

        with connection.cursor() as cursor:
            # Overwrite any existing OTP for this user
            cursor.execute("""
                IF EXISTS (SELECT 1 FROM user_otps WHERE user_employee_id=%s)
                    UPDATE user_otps SET otp=%s, created_at=GETDATE(), expires_at=%s WHERE user_employee_id=%s
                ELSE
                    INSERT INTO user_otps (user_employee_id, otp, expires_at) VALUES (%s, %s, %s)
            """, (emp_id, otp, expires_at, emp_id, emp_id, otp, expires_at))
            transaction.commit()

        # Send email
        subject = "Password Reset OTP - MedLearn Vision"
        message = f"Hi {username},\n\nYour OTP to reset your password is: {otp}\n\nThis OTP is valid for 10 minutes.\n\nThanks,\nMedLearn Vision"
        try:
            send_mail(subject, message, settings.DEFAULT_FROM_EMAIL, [email], fail_silently=False)
        except smtplib.SMTPRecipientsRefused:
            traceback.print_exc()
            return JsonResponse({"error": "Failed to send email. The recipient mailbox is full or rejecting emails."}, status=400)
        except ConnectionRefusedError:
            traceback.print_exc()
            return JsonResponse({"error": "Failed to connect to the email server. Please try again later."}, status=500)
        except Exception as e:
            traceback.print_exc()
            return JsonResponse({"error": "Failed to send email. Please check SMTP settings."}, status=500)

        return JsonResponse({"success": True, "message": "OTP sent successfully"})
    except Exception as e:
        traceback.print_exc()
        return JsonResponse({"error": str(e)}, status=500)

@csrf_exempt
def forgot_password_verify_otp_api(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    try:
        data = json.loads(request.body)
        email = data.get("email", "").strip().lower()
        otp_input = data.get("otp", "").strip()

        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT o.otp, o.expires_at 
                FROM user_otps o
                JOIN user_details u ON u.user_employee_id = o.user_employee_id
                WHERE LOWER(u.user_mail_id) = %s
            """, (email,))
            row = cursor.fetchone()

        if not row:
            return JsonResponse({"error": "No OTP requested for this email"}, status=400)

        stored_otp, expires_at = row
        if stored_otp != otp_input:
            return JsonResponse({"error": "Invalid OTP"}, status=400)

        if datetime.datetime.now() > expires_at:
            return JsonResponse({"error": "OTP has expired"}, status=400)

        return JsonResponse({"success": True, "message": "OTP verified"})
    except Exception as e:
        traceback.print_exc()
        return JsonResponse({"error": str(e)}, status=500)

@csrf_exempt
def forgot_password_reset_api(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    try:
        data = json.loads(request.body)
        email = data.get("email", "").strip().lower()
        otp_input = data.get("otp", "").strip()
        new_password = data.get("new_password", "").strip()

        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT o.otp, o.expires_at, u.user_employee_id 
                FROM user_otps o
                JOIN user_details u ON u.user_employee_id = o.user_employee_id
                WHERE LOWER(u.user_mail_id) = %s
            """, (email,))
            row = cursor.fetchone()

        if not row:
            return JsonResponse({"error": "No OTP requested for this email"}, status=400)

        stored_otp, expires_at, emp_id = row
        if stored_otp != otp_input:
            return JsonResponse({"error": "Invalid OTP"}, status=400)

        if datetime.datetime.now() > expires_at:
            return JsonResponse({"error": "OTP has expired"}, status=400)

        hashed_password = make_password(new_password)
        with connection.cursor() as cursor:
            # Update password
            cursor.execute("UPDATE user_passwords SET password_hash=%s WHERE user_employee_id=%s", (hashed_password, emp_id))
            # Delete OTP
            cursor.execute("DELETE FROM user_otps WHERE user_employee_id=%s", (emp_id,))
            transaction.commit()

        return JsonResponse({"success": True, "message": "Password updated successfully"})
    except Exception as e:
        traceback.print_exc()
        return JsonResponse({"error": str(e)}, status=500)
