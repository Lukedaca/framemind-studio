param(
    [Parameter(Mandatory = $true)][string[]]$Paths,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$CertificateThumbprint
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Verification never installs certificates or changes Windows trust settings.
function Find-SignTool {
    $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $sdkBin = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    $sdkVersions = Get-ChildItem -LiteralPath $sdkBin -Directory |
        Where-Object Name -Match '^10\.0\.\d+\.\d+$' |
        Sort-Object { [version]$_.Name } -Descending
    foreach ($sdk in $sdkVersions) {
        $tool = Join-Path $sdk.FullName 'x64\signtool.exe'
        if (Test-Path -LiteralPath $tool -PathType Leaf) { return $tool }
    }
    throw 'Windows SDK SignTool is required to verify a client release.'
}

try {
    # npm can inherit PowerShell 7 module paths when invoking Windows PowerShell 5.1.
    Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1')
    Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Management/Microsoft.PowerShell.Management.psd1')
    Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1')
    $verified = @()
    foreach ($path in $Paths) {
        $file = Get-Item -LiteralPath $path
        if ($file.PSIsContainer) { throw "Expected an executable: $path" }
        $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
        if ($signature.Status -ne 'Valid') {
            throw "Client release blocked: $($file.Name) signature is $($signature.Status)."
        }
        if ($signature.SignatureType -ne 'Authenticode') {
            throw "Client release blocked: $($file.Name) needs an embedded Authenticode signature."
        }
        if ($signature.SignerCertificate.Thumbprint -ne $CertificateThumbprint) {
            throw "Client release blocked: $($file.Name) has an unexpected publisher certificate."
        }
        if (-not $signature.TimeStamperCertificate) {
            throw "Client release blocked: $($file.Name) has no trusted timestamp."
        }
        $signTool = Find-SignTool
        # /pa validates Authenticode trust; /all checks every signature; /tw requires a timestamp.
        & $signTool verify /pa /all /tw /q $file.FullName
        if ($LASTEXITCODE -ne 0) {
            throw "Client release blocked: SignTool rejected $($file.Name), exit $LASTEXITCODE."
        }
        $verified += [pscustomobject]@{
            File = $file.FullName
            Publisher = $signature.SignerCertificate.Subject
            CertificateThumbprint = $signature.SignerCertificate.Thumbprint
            SHA256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    if ($verified.Count -eq 0) { throw 'No release files were verified.' }
    $verified | ConvertTo-Json -Depth 3
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
