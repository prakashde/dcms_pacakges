$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Start-Process 'http://localhost:32190/prototype/'
node .\server.mjs
