from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.views.static import serve
from django.urls import re_path
 
urlpatterns = [
    path("admin/", admin.site.urls),
    path("", include("users.urls")),
    # Add this to serve media regardless of DEBUG status
    re_path(r'^media/(?P<path>.*)$', serve, {'document_root': settings.MEDIA_ROOT}),
]