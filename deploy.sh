#!/usr/bin/env bash
# deploy.sh — bouwt de frontend en deployt backend + frontend naar de VPS
# Gebruik: bash deploy.sh

set -e

HOST="root@75.119.146.222"
KEY="C:/Users/miche/.ssh/id_ed25519"
REMOTE="/opt/hitlijsten"
SSH="ssh -i $KEY -o StrictHostKeyChecking=no"
SCP="scp -i $KEY -o StrictHostKeyChecking=no"

echo "=== Stap 1: Frontend bouwen ==="
cd "$(dirname "$0")/frontend"
npm install --legacy-peer-deps
npm run build
cd ..

echo "=== Stap 2: Mappen aanmaken op server ==="
$SSH $HOST "mkdir -p $REMOTE/backend/data $REMOTE/backend/uploads $REMOTE/frontend"

echo "=== Stap 3: Backend kopiëren ==="
rsync -avz -e "ssh -i $KEY -o StrictHostKeyChecking=no" \
  --exclude node_modules \
  --exclude .env \
  --exclude data \
  --exclude uploads \
  backend/ $HOST:$REMOTE/backend/

echo "=== Stap 4: Frontend build kopiëren ==="
rsync -avz -e "ssh -i $KEY -o StrictHostKeyChecking=no" \
  frontend/build/ $HOST:$REMOTE/frontend/build/

echo "=== Stap 5: Nginx config kopiëren ==="
$SCP nginx.conf $HOST:/etc/nginx/sites-available/hitlijsten
$SSH $HOST "ln -sf /etc/nginx/sites-available/hitlijsten /etc/nginx/sites-enabled/hitlijsten"
$SSH $HOST "nginx -t && systemctl reload nginx"

echo "=== Stap 6: npm install op server ==="
$SSH $HOST "cd $REMOTE/backend && npm install --omit=dev"

echo "=== Stap 7: .env aanmaken op server (alleen als nog niet bestaat) ==="
$SSH $HOST "
  if [ ! -f $REMOTE/backend/.env ]; then
    cat > $REMOTE/backend/.env << 'ENVEOF'
PORT=3001
NODE_ENV=production
PLAYIT_BASE_URL=https://domstadradio.playitradio.com:25433
PLAYIT_API_KEY=73d76c80fff74a459c81b51fb7372d37
SPOTIFY_CLIENT_ID=b4000f6f92b948f3918912b7625b8738
SPOTIFY_CLIENT_SECRET=1eb248242ba544fc90585a6fa1d0d323
DB_PATH=./data/hitlijsten.db
UPLOAD_PATH=./uploads
OWN_HOSTS=75.119.146.222,localhost
FRONTEND_URL=http://75.119.146.222
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@domstadradio.nl
BASE_URL=http://75.119.146.222
ENVEOF
    echo '.env aangemaakt'
  else
    echo '.env bestaat al, overgeslagen'
  fi
"

echo "=== Stap 8: PM2 (her)starten ==="
$SSH $HOST "
  cd $REMOTE/backend
  if pm2 list | grep -q 'hitlijsten'; then
    pm2 restart hitlijsten
  else
    pm2 start src/index.js --name hitlijsten --update-env
    pm2 save
  fi
"

echo ""
echo "=== Deploy klaar! ==="
echo "  Beheer:        http://75.119.146.222/admin"
echo "  Stemformulier: http://75.119.146.222/stem/<slug>"
echo ""
