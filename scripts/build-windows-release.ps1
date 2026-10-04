param(
    [string]$CertificateThumbprint = $env:FRAMEMIND_SIGNING_CERTIFICATE_THUMBPRINT
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = Split-Path -Parent $PSScriptRoot

try {
    if ($CertificateThumbprint -notmatch '^[0-9a-fA-F]{40}$') {
        throw 'Client release blocked: a trusted code-signing certificate is required. Set FRAMEMIND_SIGNING_CERTIFICATE_THUMBPRINT. No account or certificate is created by this script.'
    }
    Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1')
    Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Management/Microsoft.PowerShell.Management.psd1')
    Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1')
    $certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$CertificateThumbprint" -ErrorAction SilentlyContinue
    if (-not $certificate -or -not $certificate.HasPrivateKey) {
        throw 'Client release blocked: the selected certificate and private key are unavailable in CurrentUser\My.'
    }
    if ($certificate.NotBefore -gt (Get-Date) -or $certificate.NotAfter -le (Get-Date)) {
        throw 'Client release blocked: the selected certificate is outside its validity period.'
    }
    $eku = @($certificate.EnhancedKeyUsageList | ForEach-Object { $_.ObjectId.Value })
    if ('1.3.6.1.5.5.7.3.3' -notin $eku) {
        throw 'Client release blocked: the selected certificate does not allow code signing.'
    }
    $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
    try {
        $chain.ChainPolicy.RevocationMode = 'Online'
        if (-not $chain.Build($certificate)) {
            throw 'Client release blocked: Windows could not verify the certificate trust chain and revocation status.'
        }
    } finally { $chain.Dispose() }

    Push-Location $repo
    try {
        $config = Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw -Encoding UTF8 | ConvertFrom-Json
        $overlay = @{ bundle = @{ windows = @{
            certificateThumbprint = $CertificateThumbprint
            digestAlgorithm = 'sha256'
            timestampUrl = 'http://timestamp.digicert.com'
            tsp = $true
        } } } | ConvertTo-Json -Depth 5 -Compress
        # A file preserves JSON through Windows argv quoting. It contains no private key.
        $overlayPath = Join-Path $repo "src-tauri/target/signing-$([guid]::NewGuid().ToString('N')).json"
        New-Item -ItemType Directory -Path (Split-Path -Parent $overlayPath) -Force | Out-Null
        try {
            $overlay | Set-Content -LiteralPath $overlayPath -Encoding ASCII
            & node 'node_modules/@tauri-apps/cli/tauri.js' build --bundles nsis --config $overlayPath
            if ($LASTEXITCODE -ne 0) { throw "Signed desktop build failed, exit $LASTEXITCODE." }
        } finally {
            if (Test-Path -LiteralPath $overlayPath) { Remove-Item -LiteralPath $overlayPath }
        }

        $app = Join-Path $repo 'src-tauri/target/release/framemind-studio.exe'
        $installer = Join-Path $repo "src-tauri/target/release/bundle/nsis/$($config.productName)_$($config.version)_x64-setup.exe"
        & powershell.exe -NoProfile -File "$PSScriptRoot/verify-windows-release.ps1" -Paths $installer -CertificateThumbprint $CertificateThumbprint
        if ($LASTEXITCODE -ne 0) { throw 'Installer verification failed; no client artifact was prepared.' }
        & powershell.exe -NoProfile -File "$PSScriptRoot/verify-windows-release.ps1" -Paths $app -CertificateThumbprint $CertificateThumbprint
        if ($LASTEXITCODE -ne 0) { throw 'Application verification failed; no client artifact was prepared.' }

        $releaseDirectory = Join-Path $repo "src-tauri/target/client-release/$($config.version)-$([guid]::NewGuid().ToString('N'))"
        New-Item -ItemType Directory -Path $releaseDirectory | Out-Null
        $assetName = "FrameMind-Studio_$($config.version)_x64-setup.exe"
        $asset = Join-Path $releaseDirectory $assetName
        Copy-Item -LiteralPath $installer -Destination $asset
        $hash = (Get-FileHash -LiteralPath $asset -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  $assetName" | Set-Content -LiteralPath (Join-Path $releaseDirectory 'SHA256SUMS.txt') -Encoding ASCII
        Write-Output "Verified signed artifacts prepared: $releaseDirectory"
        Write-Output 'SmartScreen reputation and clean Windows installation still require separate verification before client publication.'
    } finally { Pop-Location }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
