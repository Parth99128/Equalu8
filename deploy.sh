#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  EVALU8 — Azure VM Deployment Script
#  Run this ONCE on a fresh Ubuntu 24.04 VM to set up everything.
#
#  Usage (from your local machine):
#    ssh azureuser@VM_IP 'bash -s' < deploy.sh
#
#  Or directly on the VM:
#    bash deploy.sh
# ═══════════════════════════════════════════════════════════════

set -e

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  EVALU8 — VM Setup Starting                       ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── 1. Install Node.js 20 ──
echo "📦 Installing Node.js 20..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "   Node.js: $(node --version)"
echo "   npm:     $(npm --version)"

# ── 2. Install Python 3 + pip ──
echo "📦 Installing Python 3..."
sudo apt-get update -qq
sudo apt-get install -y python3 python3-pip python3-venv python3-dev
echo "   Python: $(python3 --version)"

# ── 3. Install Tesseract OCR ──
echo "📦 Installing Tesseract OCR..."
sudo apt-get install -y tesseract-ocr
echo "   Tesseract: $(tesseract --version 2>&1 | head -1)"

# ── 4. Install Caddy (reverse proxy with auto-SSL) ──
echo "📦 Installing Caddy..."
if ! command -v caddy &> /dev/null; then
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
  sudo apt-get update -qq
  sudo apt-get install -y caddy
fi
echo "   Caddy: $(caddy version 2>&1 | head -1)"

# ── 5. Install PM2 (process manager) ──
echo "📦 Installing PM2..."
sudo npm install -g pm2
echo "   PM2: $(pm2 --version)"

# ── 6. Clone/update the repository ──
APP_DIR="/home/azureuser/evalu8"
echo "📂 Cloning repository to $APP_DIR..."
if [ -d "$APP_DIR" ]; then
  cd "$APP_DIR"
  git pull origin main
else
  git clone https://github.com/Parth99128/Equalu8.git "$APP_DIR"
  cd "$APP_DIR"
fi

# ── 7. Install Node.js dependencies & build frontend ──
echo "📦 Installing npm dependencies..."
npm install

echo "🏗️  Building frontend..."
npm run build

# ── 8. Set up Python virtual environment ──
echo "📦 Setting up Python virtual environment..."
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
deactivate
echo "   Python packages installed"

# ── 9. Create .env from environment (if not exists) ──
if [ ! -f "$APP_DIR/.env" ]; then
  echo "⚠️  .env file not found. Creating template..."
  cat > "$APP_DIR/.env" << 'ENVEOF'
# ── Supabase ──
NEXT_PUBLIC_SUPABASE_URL=https://phjwiiqbtyeoexxtfeiq.supabase.co
SUPABASE_URL=https://phjwiiqbtyeoexxtfeiq.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
VITE_SUPABASE_URL=https://phjwiiqbtyeoexxtfeiq.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

# ── Gemini AI ──
GEMINI_API_KEY=your-gemini-api-key-here
GEMINI_MODEL=gemini-1.5-flash

# ── Google Auth ──
VITE_GOOGLE_CLIENT_ID=your-google-client-id-here

# ── Supabase Restore (optional) ──
FULLSTACK_PROJECT_REF=phjwiiqbtyeoexxtfeiq
FULLSTACK_RESTORE_API_URL=https://designarena.ai/api/fullstack-restore
ENVEOF
  echo "   ⚠️  Edit $APP_DIR/.env with your real keys before starting the app!"
fi

# ── 10. Start the app with PM2 ──
echo "🚀 Starting app with PM2..."
cd "$APP_DIR"
pm2 delete evalu8-server 2>/dev/null || true
pm2 start server.js --name evalu8-server
pm2 save
pm2 startup systemd -u azureuser --hp /home/azureuser 2>/dev/null || true

# ── 11. Configure Caddy reverse proxy ──
echo "🔧 Configuring Caddy..."
cat > /tmp/Caddyfile << 'CADDYEOF'
# EVALU8 — Caddy reverse proxy
# Replace :80 with your domain when ready, e.g. equalu8.me
# Caddy will auto-provision SSL certificates for real domains.

:80 {
    # API routes → Node.js server
    reverse_proxy /api/* localhost:3004

    # All other routes → Node.js server (serves static frontend)
    reverse_proxy /* localhost:3004

    # Compression
    encode gzip zstd

    # Security headers
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
    }
}
CADDYEOF

sudo cp /tmp/Caddyfile /etc/caddy/Caddyfile
sudo systemctl restart caddy
sudo systemctl enable caddy

# ── 12. Open firewall ports ──
echo "🔥 Configuring firewall..."
sudo ufw allow 22/tcp   2>/dev/null || true
sudo ufw allow 80/tcp   2>/dev/null || true
sudo ufw allow 443/tcp  2>/dev/null || true
sudo ufw --force enable 2>/dev/null || true

# ── Done ──
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  ✅ EVALU8 deployment complete!                   ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║                                                    ║"
echo "║  App running on:  http://localhost:3004             ║"
echo "║  Caddy proxy:    http://localhost:80               ║"
echo "║                                                    ║"
echo "║  PM2 status:     pm2 status                       ║"
echo "║  PM2 logs:        pm2 logs equalu8                ║"
echo "║  Restart app:     pm2 restart equalu8              ║"
echo "║                                                    ║"
echo "║  ⚠️  Edit .env with real API keys if not done:     ║"
echo "║      nano /home/azureuser/Equalu8/.env             ║"
echo "║      pm2 restart equalu8                           ║"
echo "║                                                    ║"
echo "║  To add a custom domain:                           ║"
echo "║    1. Point DNS A record to this VM's IP          ║"
echo "║    2. Edit /etc/caddy/Caddyfile                    ║"
echo "║       Replace :80 with yourdomain.me              ║"
echo "║    3. sudo systemctl restart caddy                ║"
echo "║                                                    ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
