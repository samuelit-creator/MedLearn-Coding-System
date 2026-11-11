from django.http import JsonResponse
def me_api(request):
    # Accept either 'Bearer <token>' or raw token
    auth = request.headers.get("Authorization") or ""
    token = auth.split(" ", 1)[1] if auth.startswith("Bearer ") else auth

    if not token or token not in ACTIVE_TOKENS:
        return JsonResponse({"authenticated": False}, status=401)

    user = ACTIVE_TOKENS[token]

    return JsonResponse({
        "authenticated": True,
        "user_employee_id": user["emp_id"]
    })