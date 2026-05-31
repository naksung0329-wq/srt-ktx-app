# 🚀 RailPick — Oracle Cloud Korea 영구 호스팅

**총 소요 시간: ~30분**
**비용: 평생 무료 (Always Free Tier)**
**결과: 한국 IP 영구 URL, PC 꺼도 24/7 작동, KORAIL/SRT 차단 위험 최소**

---

## Step 1. Oracle Cloud 가입 (~10분)

1. **https://signup.cloud.oracle.com** 접속
2. 이메일 + 비밀번호 입력
3. 본인 인증 (전화번호 SMS)
4. **Home Region** 선택 ⚠️ 중요:
   - **South Korea Central (Chuncheon)** 선택 — railpick과 동일 한국 IP
   - 다른 리전 선택하면 KORAIL이 외국 IP로 인식할 위험
5. 결제 카드 등록 (검증용, **결제는 절대 발생 안 함**)
6. 가입 완료 → 이메일 인증

> 💡 카드 등록은 Oracle 정책상 필수지만 Always Free Tier는 **자동 청구 없음**. 의심스러우면 가상카드 사용.

---

## Step 2. VM 인스턴스 생성 (~5분)

Oracle Cloud Console 접속 후:

1. 좌상단 햄버거 메뉴 → **Compute → Instances**
2. **Create Instance** 클릭
3. 다음 설정:

   | 항목 | 값 |
   |---|---|
   | **Name** | `railpick` |
   | **Image** | Ubuntu 22.04 minimal |
   | **Shape** | `VM.Standard.A1.Flex` (ARM, **Always Free**) |
   | **OCPU** | 1~2 |
   | **Memory** | 6 GB |
   | **Network** | 기본 VCN/subnet 사용 |
   | **Public IP** | **Assign a public IPv4 address** 체크 |
   | **SSH key** | **Generate SSH key pair** → Private/Public key 둘 다 **저장** |

4. **Create** 클릭 → 1~2분 후 RUNNING 상태
5. **Public IP 주소 기록** (예: `158.180.123.45`)

> ⚠️ "Out of capacity" 에러 나면 잠시 후 재시도 (ARM A1.Flex는 가끔 만석)

---

## Step 3. 방화벽 규칙 추가 (port 3000) (~2분)

1. Instance 페이지 → **Primary VNIC → Subnet** 클릭
2. **Security Lists** → 기본 security list 클릭
3. **Add Ingress Rules** 클릭
4. 다음 입력:

   | 항목 | 값 |
   |---|---|
   | Source Type | CIDR |
   | Source CIDR | `0.0.0.0/0` |
   | IP Protocol | TCP |
   | Destination Port Range | `3000` |
   | Description | RailPick |

5. **Add Ingress Rules** 클릭 저장

---

## Step 4. SSH 키 + 코드 업로드 (~5분, 본인 PC에서)

본인 Windows PowerShell 또는 cmd에서:

```powershell
# 1. SSH 키를 안전한 곳에 두기
# Oracle에서 다운로드한 'ssh-key-XXXX.key' 파일을 다음 위치에 저장:
move "다운로드받은_키_경로\ssh-key-*.key" "$env:USERPROFILE\.ssh\railpick.key"

# 2. 키 권한 제한 (Windows ICACLS)
icacls "$env:USERPROFILE\.ssh\railpick.key" /inheritance:r /grant:r "$env:USERNAME:F"

# 3. railpick.zip을 VM에 업로드 (Public IP 사용)
cd C:\Users\User\Documents\Claude\Projects\SRT\KTX
scp -i "$env:USERPROFILE\.ssh\railpick.key" railpick.zip ubuntu@<PUBLIC_IP>:~/

# 4. setup-oracle.sh도 업로드
scp -i "$env:USERPROFILE\.ssh\railpick.key" setup-oracle.sh ubuntu@<PUBLIC_IP>:~/
```

`<PUBLIC_IP>` 를 Step 2에서 받은 실제 IP로 교체.

---

## Step 5. VM에 SSH 접속해서 설치 (~5분)

```powershell
# SSH 접속
ssh -i "$env:USERPROFILE\.ssh\railpick.key" ubuntu@<PUBLIC_IP>

# 접속되면 (Ubuntu 프롬프트)
chmod +x ~/setup-oracle.sh
bash ~/setup-oracle.sh
```

스크립트가 자동으로:
- ✅ Node.js 20 설치
- ✅ railpick.zip 압축 해제 + npm install + build
- ✅ 방화벽 port 3000 열기 (iptables)
- ✅ systemd 서비스 등록 (자동 재시작 + 부팅 시 시작)
- ✅ Public IP + 접속 URL 출력

마지막에 표시되는 URL을 모바일 북마크:
```
http://<PUBLIC_IP>:3000
```

---

## Step 6. 사용

✅ 본인 PC를 꺼도 24/7 작동
✅ 모바일에서 `http://<PUBLIC_IP>:3000` 영구 URL
✅ 한국 IP라서 KORAIL/SRT 차단 위험 최소
✅ 텔레그램 봇 토큰/Chat ID는 동일하게 사용 (이미 발급받은 것)

### 서비스 관리 (VM에 SSH 접속해서)

```bash
sudo systemctl status railpick    # 상태 확인
sudo systemctl restart railpick   # 재시작
sudo systemctl stop railpick      # 정지
sudo journalctl -fu railpick      # 실시간 로그
```

### 코드 업데이트

수정한 railpick.zip을 다시 scp 업로드 후:

```bash
unzip -o ~/railpick.zip -d ~/railpick
cd ~/railpick
npm install
npm run build
sudo systemctl restart railpick
```

---

## 💡 선택 — HTTPS + 짧은 URL (~10분 추가)

`http://158.180.123.45:3000` 대신 `https://railpick.본인도메인.com` 으로 만들고 싶으면:

1. 본인 도메인이 있다면 → A 레코드를 Oracle Public IP로 설정
2. VM에서 Caddy 설치 (자동 HTTPS):
   ```bash
   sudo apt install -y caddy
   sudo tee /etc/caddy/Caddyfile << EOF
   railpick.본인도메인.com {
     reverse_proxy localhost:3000
   }
   EOF
   sudo systemctl reload caddy
   ```
3. 자동으로 Let's Encrypt 인증서 발급 → HTTPS 적용

---

## 🆘 트러블슈팅

| 문제 | 해결 |
|---|---|
| "Out of capacity" (Step 2) | 시간차 두고 재시도. 시간대를 새벽으로 |
| scp 권한 거부 | SSH 키 파일 권한 (icacls) 다시 |
| `http://IP:3000` 접속 안 됨 | Step 3 방화벽 다시 확인 |
| 서비스 fail | `sudo journalctl -u railpick -n 50` 로그 확인 |
| 빌드 메모리 부족 | VM RAM 늘리기 (Free 한도 내 6GB까지 가능) |

---

🚆 **준비된 파일**:
- `railpick.zip` (105KB) — 코드
- `setup-oracle.sh` (3KB) — 자동 설치 스크립트
- `ORACLE_SETUP.md` (이 문서)

모두 `C:\Users\User\Documents\Claude\Projects\SRT\KTX\` 안에 있습니다.
