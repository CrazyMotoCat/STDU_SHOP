$ErrorActionPreference = 'Stop'
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    node scripts/env-init.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Local environment initialization failed.' }
}
finally { Pop-Location }
