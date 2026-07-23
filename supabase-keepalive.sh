#!/bin/bash
# Hält das Supabase-Projekt der Päckli-Aktion wach (Free-Tier pausiert Projekte
# nach ca. 7 Tagen ohne API-Zugriff). Läuft per Cronjob auf dem MacBook Air.
#
# Ruft eine echte Tabelle per REST ab (wie die App es auch tut). RLS lässt
# anonyme Anfragen zwar keine Zeilen sehen (nur "Angemeldete" dürfen lesen),
# liefert dafür aber HTTP 200 mit leerer Liste statt eines Fehlers - zählt
# trotzdem als gültiger API-Zugriff fürs Keepalive.
# (Die REST-Root /rest/v1/ geht NICHT: die verlangt seit Supabases neuem
# API-Key-System einen Secret Key, kein Publishable/Anon-Key.)

SUPABASE_URL="https://cbnntfscghzhpjzotety.supabase.co"
SUPABASE_ANON_KEY="sb_publishable_TZ11TZdGxD8mjOL6aVcQVA_PcvIkra2"
LOG_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/supabase-keepalive.log"

TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S')"

HTTP_STATUS="$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time 15 \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  "${SUPABASE_URL}/rest/v1/campaigns?select=id&limit=1")"

if [ "$HTTP_STATUS" = "200" ]; then
  echo "${TIMESTAMP} OK (HTTP ${HTTP_STATUS})" >> "$LOG_FILE"
else
  echo "${TIMESTAMP} FEHLER (HTTP ${HTTP_STATUS})" >> "$LOG_FILE"
fi
