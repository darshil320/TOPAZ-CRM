#!/usr/bin/env bash
# K1 · WA-MEDIA-SPIKE — send one real PDF + one image to a test phone via the live
# WhatsApp Cloud API, exactly the way apps/api does it (upload to /media -> get a
# media id -> send by id). Prints the message id (wamid) for each so you can match
# them against the `statuses` webhook.
#
# PREREQUISITE — the 24h customer-service window MUST be open:
#   free-form media is only deliverable inside an open window, so FIRST send any
#   WhatsApp ("hi") FROM the test phone TO the business number, then run this
#   within 24h. Outside the window Meta returns error 131047 / 131026.
#
# Usage:
#   WA_TOKEN='EAAG...' scripts/wa_media_spike.sh                 # uses generated test files
#   WA_TOKEN='EAAG...' TO='+919426529230' PDF=my.pdf IMG=my.jpg scripts/wa_media_spike.sh
#
# Env:
#   WA_TOKEN            (required) Meta System User token
#   WA_PHONE_NUMBER_ID  (default 1189429440922862) — Topaz live sender
#   TO                  (default +919426529230)
#   PDF / IMG           (optional) paths; minimal valid test files are generated if unset
set -euo pipefail

API="https://graph.facebook.com/v20.0"
PHONE_ID="${WA_PHONE_NUMBER_ID:-1189429440922862}"
TO="${TO:-+919426529230}"
TO="${TO#+}"   # Meta wants the number without the leading +

if [[ -z "${WA_TOKEN:-}" ]]; then
  echo "ERROR: WA_TOKEN not set (Railway → prod service → Variables → WA_TOKEN)" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- test files (only if caller didn't supply real ones) ---
PDF="${PDF:-$TMP/spike.pdf}"
if [[ ! -f "$PDF" ]]; then
  # smallest well-formed one-page PDF
  printf '%s\n' \
'%PDF-1.4' \
'1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj' \
'2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj' \
'3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj' \
'trailer<</Root 1 0 R>>' \
'%%EOF' > "$PDF"
fi

IMG="${IMG:-$TMP/spike.png}"
if [[ ! -f "$IMG" ]]; then
  # 1x1 red PNG (base64)
  base64 -d > "$IMG" <<'B64'
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==
B64
fi

# mime from extension
mime() { case "${1##*.}" in pdf) echo application/pdf;; png) echo image/png;; jpg|jpeg) echo image/jpeg;; *) echo application/octet-stream;; esac; }

# upload <file> <mime>  -> media id
upload() {
  local f="$1" m="$2"
  curl -sf -X POST "$API/$PHONE_ID/media" \
    -H "Authorization: Bearer $WA_TOKEN" \
    -F "messaging_product=whatsapp" \
    -F "type=$m" \
    -F "file=@$f;type=$m" \
    | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])"
}

# send_media <kind> <json>  -> prints response, returns wamid
post_msg() {
  curl -s -X POST "$API/$PHONE_ID/messages" \
    -H "Authorization: Bearer $WA_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$1"
}

echo "== to=$TO via phone_id=$PHONE_ID =="

echo "-- uploading PDF ($PDF) --"
PDF_ID="$(upload "$PDF" "$(mime "$PDF")")"
echo "   media_id=$PDF_ID"
PDF_RESP="$(post_msg "{\"messaging_product\":\"whatsapp\",\"to\":\"$TO\",\"type\":\"document\",\"document\":{\"id\":\"$PDF_ID\",\"filename\":\"spike.pdf\",\"caption\":\"K1 spike PDF\"}}")"
echo "   $PDF_RESP"

echo "-- uploading image ($IMG) --"
IMG_ID="$(upload "$IMG" "$(mime "$IMG")")"
echo "   media_id=$IMG_ID"
IMG_RESP="$(post_msg "{\"messaging_product\":\"whatsapp\",\"to\":\"$TO\",\"type\":\"image\",\"image\":{\"id\":\"$IMG_ID\",\"caption\":\"K1 spike image\"}}")"
echo "   $IMG_RESP"

echo
echo "Match these wamids against the statuses webhook (Railway logs / messages table):"
echo "$PDF_RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);print('  pdf   wamid:',d.get('messages',[{}])[0].get('id') or d)" 2>/dev/null || true
echo "$IMG_RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);print('  image wamid:',d.get('messages',[{}])[0].get('id') or d)" 2>/dev/null || true
