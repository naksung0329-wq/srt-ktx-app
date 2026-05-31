#!/bin/bash
#
# RailPick — Oracle Cloud Korea 자동 설치 스크립트
#
# 사용법 (Ubuntu VM에서):
#   1. railpick.zip 파일을 ~/ 에 업로드
#   2. curl -fsSL <이_파일_URL> | bash
#      또는 wget + bash railpick-setup.sh
#
set -euo pipefail

INSTALL_DIR="$HOME/railpick"
SERVICE_NAME="railpick"
NODE_MAJOR="20"

echo "═══════════════════════════════════════════════════"
echo "  🚆 RailPick — Oracle Cloud Korea Setup"
echo "═══════════════════════════════════════════════════"

# 1. 시스템 업데이트 + 기본 도구
echo "[1/7] 시스템 패키지 업데이트..."
sudo apt-get update -qq
sudo apt-get install -y -qq curl wget unzip ca-certificates gnupg lsb-release

# 2. Node.js 20 설치
if ! command -v node &> /dev/null || [[ "$(node -v)" != v${NODE_MAJOR}* ]]; then
  echo "[2/7] Node.js ${NODE_MAJOR} 설치..."
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | sudo -E bash - > /dev/null 2>&1
  sudo apt-get install -y -qq nodejs
fi
echo "  node: $(node -v) | npm: $(npm -v)"

# 3. railpick.zip 압축 해제
echo "[3/7] 코드 압축 해제..."
mkdir -p "$INSTALL_DIR"
if [ -f ~/railpick.zip ]; then
  unzip -o -q ~/railpick.zip -d "$INSTALL_DIR"
else
  echo "❌ ~/railpick.zip 파일이 없습니다. scp로 업로드 먼저."
  exit 1
fi

# 4. 의존성 설치 + 빌드
echo "[4/7] npm install + build..."
cd "$INSTALL_DIR"
npm install --no-audit --no-fund --silent 2>&1 | tail -3
npm run build 2>&1 | tail -10

# 5. 방화벽: port 3000 외부 허용
echo "[5/7] 방화벽 port 3000 열기..."
sudo iptables -I INPUT -p tcp --dport 3000 -j ACCEPT 2>/dev/null || true
sudo netfilter-persistent save 2>/dev/null || true
sudo apt-get install -y -qq iptables-persistent 2>&1 | tail -1
sudo netfilter-persistent save 2>/dev/null || true

# 6. systemd 서비스 등록 (자동 재시작)
echo "[6/7] systemd 서비스 등록 (자동 시작)..."
SYSTEMD_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
sudo tee "$SYSTEMD_FILE" > /dev/null << EOF
[Unit]
Description=RailPick KTX/SRT booking
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"
sleep 3

# 7. 상태 확인
echo "[7/7] 상태 확인..."
if sudo systemctl is-active --quiet "$SERVICE_NAME"; then
  PUBLIC_IP=$(curl -s https://api.ipify.org)
  LOCAL=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ || echo "fail")
  echo ""
  echo "═══════════════════════════════════════════════════"
  echo "  ✅ RailPick 설치 완료!"
  echo "═══════════════════════════════════════════════════"
  echo "  Public IP:    $PUBLIC_IP"
  echo "  접속 URL:     http://$PUBLIC_IP:3000"
  echo "  localhost 응답: HTTP $LOCAL"
  echo ""
  echo "  서비스 명령:"
  echo "    sudo systemctl status $SERVICE_NAME    # 상태"
  echo "    sudo systemctl restart $SERVICE_NAME   # 재시작"
  echo "    sudo journalctl -fu $SERVICE_NAME      # 로그"
  echo ""
  echo "  ⚠️ Oracle Console에서 Security List → Ingress Rule"
  echo "     추가: TCP 3000 from 0.0.0.0/0 (반드시!)"
  echo "═══════════════════════════════════════════════════"
else
  echo "❌ 서비스 시작 실패. 로그:"
  sudo journalctl -u "$SERVICE_NAME" -n 30
fi
