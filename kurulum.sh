#!/usr/bin/env bash
# kurulum.sh — Masa "Yapay Zekaya Sor" için kurulum yardımcısı (macOS / Linux).
# Çalıştır:  bash kurulum.sh
# Her adım önce "zaten var mı" diye bakar; tekrar çalıştırmak zararsızdır.
set -u
cd "$(dirname "$0")"
AGY_INSTALL_URL="https://antigravity.google/cli/install.sh"   # resmi: antigravity.google/docs/getting-started
export PATH="$HOME/.local/bin:$PATH"

sor() { while true; do read -r -p "  $1 (E/H) " c; case "$c" in [eEyY]*) return 0;; [hHnN]*) return 1;; esac; done; }
tamam() { printf '  [tamam] %s\n' "$1"; }
uyari() { printf '  [!] %s\n' "$1"; }

echo "Masa — Yapay Zekaya Sor kurulumu"

echo; echo "== 1/3 Python =="
if command -v python3 >/dev/null 2>&1 && python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3,7) else 1)'; then
  tamam "Python bulundu: $(python3 --version)"
else
  uyari "Python 3.7+ bulunamadı. Kur ve bu betiği yeniden çalıştır:"
  echo "    macOS:  brew install python   (ya da https://www.python.org/downloads/)"
  echo "    Linux:  sudo apt install python3   (dağıtımına göre)"
  exit 1
fi

echo; echo "== 2/3 Antigravity CLI (agy) =="
if command -v agy >/dev/null 2>&1; then
  tamam "agy bulundu: $(command -v agy)"
else
  uyari "agy bulunamadı. Resmi kurulum betiği çalıştırılacak: $AGY_INSTALL_URL (yaklaşık 230 MB)"
  if sor "agy kurulsun mu?"; then
    curl -fsSL "$AGY_INSTALL_URL" | bash
    export PATH="$HOME/.local/bin:$PATH"
  fi
  command -v agy >/dev/null 2>&1 || { uyari "agy kurulamadı."; exit 1; }
  tamam "agy kuruldu."
fi

giris_var() { agy models 2>/dev/null | grep -q "$(printf '\t')"; }
echo; echo "== 3/3 agy girişi =="
if giris_var; then
  tamam "agy hesabına giriş yapılmış."
else
  uyari "Giriş yapılmamış. agy açılınca tarayıcıda Google hesabınla giriş yap, sonra /exit yaz."
  read -r -p "  Hazırsan Enter'a bas " _
  agy
  giris_var && tamam "Giriş tamam." || { uyari "Giriş doğrulanamadı; betiği yeniden çalıştır."; exit 1; }
fi

echo
tamam "Kurulum tamam. Köprüyü başlatmak için: python3 ai_kopru.py"
if sor "Köprü şimdi başlatılsın mı?"; then exec python3 ai_kopru.py; fi
