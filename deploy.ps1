# deploy.ps1 — Deploy backend + frontend to production server

param([string]$Target = "all")

$Host_ip = "root@75.119.146.222"
$Key = "C:/Users/miche/.ssh/id_ed25519"
$Remote = "/opt/hitlijsten"
$SSH_opts = @("-i", $Key, "-o", "StrictHostKeyChecking=no")

$DO_BACKEND = ($Target -eq "all") -or ($Target -eq "backend")
$DO_FRONTEND = ($Target -eq "all") -or ($Target -eq "frontend")

Set-Location $PSScriptRoot

if ($DO_BACKEND) {
    Write-Host "Backend: uploading code..." -ForegroundColor Cyan
    ssh @SSH_opts $Host_ip "mkdir -p $Remote/backend"
    scp @SSH_opts -r backend/src backend/package.json backend/package-lock.json "$Host_ip`:$Remote/backend/"
    
    Write-Host "Backend: installing dependencies..." -ForegroundColor Cyan
    ssh @SSH_opts $Host_ip "cd $Remote/backend; npm install --omit=dev --no-audit --no-fund; echo 'npm install complete'"
    
    Write-Host "Backend: restarting PM2..." -ForegroundColor Cyan
    ssh @SSH_opts $Host_ip "pm2 restart hitlijsten --update-env; pm2 save"
}

if ($DO_FRONTEND) {
    Write-Host "Frontend: uploading code..." -ForegroundColor Cyan
    ssh @SSH_opts $Host_ip "mkdir -p $Remote/frontend"
    scp @SSH_opts -r frontend/src frontend/public frontend/package.json frontend/package-lock.json "$Host_ip`:$Remote/frontend/"
    
    Write-Host "Frontend: building..." -ForegroundColor Cyan
    ssh @SSH_opts $Host_ip "cd $Remote/frontend; npm install --omit=dev --no-audit --no-fund; npm run build"
    
    Write-Host "Frontend: reloading nginx..." -ForegroundColor Cyan
    ssh @SSH_opts $Host_ip "nginx -s reload"
}

Write-Host "Deploy voltooid!" -ForegroundColor Green
