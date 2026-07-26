#!/usr/bin/env bash
# update.sh — upload code-wijzigingen, bouw op de server en herstart de backend.
# Geen lokale Node/npm nodig (build draait remote). Gebruikt scp i.p.v. rsync.
#
# Gebruik:  bash update.sh              (default: backend + frontend)
#           bash update.sh backend      (alleen backend)
#           bash update.sh frontend     (alleen frontend)

set -e

HOST="root@75.119.146.222"
KEY="C:/Users/miche/.ssh/id_ed25519"
REMOTE="/opt/hitlijsten"
SSH="ssh -i $KEY -o StrictHostKeyChecking=no"
SCP="scp -i $KEY -o StrictHostKeyChecking=no"

TARGET="${1:-all}"
DO_BACKEND=0
DO_FRONTEND=0
case "$TARGET" in
  all)      DO_BACKEND=1; DO_FRONTEND=1 ;;
  backend)  DO_BACKEND=1 ;;
  frontend) DO_FRONTEND=1 ;;
  *) echo "Onbekend target: $TARGET (gebruik: all | backend | frontend)"; exit 1 ;;
esac

cd "$(dirname "$0")"

if [ "$DO_BACKEND" = "1" ]; then
  echo "=== Backend: code uploaden ==="
  $SSH $HOST "mkdir -p $REMOTE/backend"
  $SCP -r backend/src backend/package.json backend/package-lock.json $HOST:$REMOTE/backend/

  echo "=== Backend: dependencies (alleen indien gewijzigd) ==="
  $SSH $HOST "cd $REMOTE/backend && npm install --omit=dev --no-audit --no-fund"

  echo "=== Backend: PM2 herstarten ==="
  $SSH $HOST "pm2 restart hitlijsten --update-env || pm2 start $REMOTE/backend/src/index.js --name hitlijsten --update-env"
  $SSH $HOST "pm2 save"
fi

if [ "$DO_FRONTEND" = "1" ]; then
  echo "=== Frontend: bronbestanden uploaden ==="
  $SSH $HOST "mkdir -p $REMOTE/frontend"
  $SCP -r frontend/src frontend/public frontend/package.json frontend/package-lock.json $HOST:$REMOTE/frontend/

  echo "=== Frontend: dependencies + build op server ==="
  $SSH $HOST "cd $REMOTE/frontend && npm install --legacy-peer-deps --no-audit --no-fund && CI=false npm run build"
fi

echo ""
echo "=== Update klaar! ==="
[ "$DO_BACKEND"  = "1" ] && echo "  Backend  herstart"
[ "$DO_FRONTEND" = "1" ] && echo "  Frontend gebouwd op server"
echo "  Beheer:        http://75.119.146.222/admin"
echo "  Stemformulier: http://75.119.146.222/stem/<slug>"
