# kurulum.ps1 — Masa "Yapay Zekaya Sor" için kurulum yardımcısı (Windows).
# Kurulum.bat tarafından çalıştırılır. Her adım önce "zaten var mı" diye bakar;
# tekrar çalıştırmak zararsızdır, bir şey bozulduğunda onarım için de kullanılabilir.
#   1) Python 3   — yoksa winget ile (yalnız bu kullanıcı için, yönetici izni gerekmez)
#   2) agy        — yoksa Antigravity'nin resmi kurulum betiğiyle
#   3) agy girişi — yapılmamışsa agy'yi açar, tarayıcıda Google girişi yapılır
#   4) Masaüstüne köprü kısayolu ve köprüyü başlatma (isteğe bağlı)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Masa = Split-Path -Parent $PSScriptRoot
$KopruBat = Join-Path $Masa 'AI Köprüsü Başlat.bat'
$AgyInstallUrl = 'https://antigravity.google/cli/install.ps1'   # resmi: antigravity.google/docs/getting-started

function Baslik($t) { Write-Host ''; Write-Host "== $t ==" -ForegroundColor Cyan }
function Tamam($t)  { Write-Host "  [tamam] $t" -ForegroundColor Green }
function Uyari($t)  { Write-Host "  [!] $t" -ForegroundColor Yellow }
function Hata($t)   { Write-Host "  [x] $t" -ForegroundColor Red }
function Sor($t) {
  while ($true) {
    $c = Read-Host "  $t (E/H)"
    if ($c -match '^[eEyY]') { return $true }
    if ($c -match '^[hHnN]') { return $false }
  }
}
function YoluYenile {
  # Kurulumların PATH'e eklediği klasörleri bu pencerede de görünür yap
  $m = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $u = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = ($m, $u, (Join-Path $env:LOCALAPPDATA 'agy\bin')) -join ';'
}

function PythonBul {
  # Windows Mağazası'nın sahte "python" kısayolu mağazayı açar; gerçek sürüm çıktısını arıyoruz.
  foreach ($aday in @(@('py', '-3'), @('python'))) {
    $exe = $aday[0]
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { continue }
    $eski = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $args2 = @($aday | Select-Object -Skip 1) + @('-c', 'import sys;print(sys.version_info[0]*100+sys.version_info[1])')
      $v = (& $exe @args2 2>$null | Select-Object -First 1)
      if ($v -match '^\d+$' -and [int]$v -ge 307) { return ,$aday }
    } catch { } finally { $ErrorActionPreference = $eski }
  }
  return $null
}

function AgyBul {
  $c = Get-Command agy -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $p = Join-Path $env:LOCALAPPDATA 'agy\bin\agy.exe'
  if (Test-Path $p) { return $p }
  return $null
}

function AgyGirisVarMi($agy) {
  # Giriş yapılmışsa "agy models" sekmeyle ayrılmış model satırları basar.
  # agy "Fetching..." satırını stderr'e yazar; PowerShell 5.1 bunu "Stop" modunda hata sayar,
  # bu yüzden bu çağrıda hata tercihini gevşetiyoruz.
  $eski = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $agy models 2>$null | Out-String
    return ($out -match "`t")
  } catch { return $false } finally { $ErrorActionPreference = $eski }
}

Write-Host 'Masa — Yapay Zekaya Sor kurulumu' -ForegroundColor White
Write-Host 'Gerekenler: Python 3 ve giriş yapılmış Antigravity CLI (agy).'

# ---------- 1) Python ----------
Baslik '1/4 Python'
$py = PythonBul
if ($py) {
  Tamam ("Python bulundu: " + ($py -join ' '))
} else {
  Uyari 'Python 3 bulunamadı.'
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    if (Sor 'Python 3.13 winget ile (yalnız bu kullanıcıya) kurulsun mu?') {
      winget install -e --id Python.Python.3.13 --scope user --accept-package-agreements --accept-source-agreements
      YoluYenile
      $py = PythonBul
      if ($py) { Tamam 'Python kuruldu.' } else { Hata 'Python kuruldu ama bu pencerede görünmüyor. Kurulum.bat''ı kapatıp yeniden çalıştır.' }
    }
  } else {
    Hata 'winget yok. Python''u https://www.python.org/downloads/ adresinden kur ("Add Python to PATH" kutusunu işaretle).'
    Start-Process 'https://www.python.org/downloads/'
  }
}

# ---------- 2) agy ----------
Baslik '2/4 Antigravity CLI (agy)'
$agy = AgyBul
if ($agy) {
  Tamam "agy bulundu: $agy"
} else {
  Uyari 'agy bulunamadı.'
  Write-Host "  Resmi kurulum betiği çalıştırılacak: $AgyInstallUrl"
  Write-Host '  Not: indirme yaklaşık 230 MB, yavaş internette uzun sürebilir.'
  if (Sor 'agy kurulsun mu?') {
    try {
      Invoke-RestMethod $AgyInstallUrl | Invoke-Expression
    } catch {
      Hata ("agy kurulumu başarısız: " + $_.Exception.Message)
    }
    YoluYenile
    $agy = AgyBul
    if ($agy) { Tamam "agy kuruldu: $agy" } else { Hata 'agy kurulamadı. Kurulum.bat''ı yeniden çalıştırmayı dene.' }
  }
}

# ---------- 3) agy girişi ----------
Baslik '3/4 agy girişi'
if (-not $agy) {
  Uyari 'agy olmadan giriş adımı atlandı.'
} elseif (AgyGirisVarMi $agy) {
  Tamam 'agy hesabına giriş yapılmış.'
} else {
  Uyari 'agy hesabına giriş yapılmamış.'
  Write-Host '  agy açılınca tarayıcıda Google hesabınla giriş yap.'
  Write-Host '  Giriş bitip agy istemi göründüğünde /exit yazıp Enter''a bas; kurulum kaldığı yerden devam eder.'
  Read-Host '  Hazırsan Enter''a bas' | Out-Null
  & $agy
  if (AgyGirisVarMi $agy) { Tamam 'Giriş tamam.' } else { Hata 'Giriş doğrulanamadı. Kurulum.bat''ı yeniden çalıştırabilirsin.' }
}

# ---------- 4) Kısayol ve başlatma ----------
Baslik '4/4 Köprü'
$hazir = $py -and $agy -and (AgyGirisVarMi $agy)
if (-not $hazir) {
  Hata 'Eksik adımlar var; yukarıdaki uyarılara bak ve Kurulum.bat''ı yeniden çalıştır.'
} else {
  $masaustu = [Environment]::GetFolderPath('Desktop')
  $lnk = Join-Path $masaustu 'Masa AI Köprüsü.lnk'
  if (Test-Path $lnk) {
    Tamam 'Masaüstü kısayolu zaten var.'
  } elseif (Sor 'Masaüstüne "Masa AI Köprüsü" kısayolu konsun mu?') {
    $ws = New-Object -ComObject WScript.Shell
    $s = $ws.CreateShortcut($lnk)
    $s.TargetPath = $KopruBat
    $s.WorkingDirectory = $Masa
    $s.Description = 'Masa Yapay Zekaya Sor köprüsünü başlatır'
    $s.Save()
    Tamam "Kısayol oluşturuldu: $lnk"
  }
  Write-Host ''
  Tamam 'Kurulum tamam. Masa''yı (index.html) açıp PDF okuyucudaki ✦ düğmesini kullanabilirsin.'
  if (Sor 'Köprü şimdi başlatılsın mı?') {
    Start-Process -FilePath $KopruBat -WorkingDirectory $Masa
  }
}
