param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$folder = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'WhirlwindFX\Plugins'
New-Item -ItemType Directory -Path $folder -Force | Out-Null
foreach ($name in @('Razer_Stream_Controller_X.js')) {
    $target = Join-Path $folder $name
    if (Test-Path -LiteralPath $target) { Copy-Item -LiteralPath $target -Destination ($target+'.before-stargatelabs') -Force }
    if ($Uninstall) { if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target } }
    else { Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('plugin\'+$name)) -Destination $target -Force }
}
Write-Host 'Restart SignalRGB / Riavvia SignalRGB.'
