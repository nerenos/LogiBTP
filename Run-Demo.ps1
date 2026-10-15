# LogiBTP Demo Launcher
# This script starts the API and client for the LogiBTP demo
# It assumes the database is already set up and running
# It does NOT recreate the database - only verifies it's online

Write-Host "=== LogiBTP Demo Launcher ===" -ForegroundColor Cyan
Write-Host "Starting API and client...`n" -ForegroundColor Yellow

# Configuration
$apiPath = Join-Path -Path (Get-Location) -ChildPath "src\LogiBTP.Api"
$clientPath = Join-Path -Path (Get-Location) -ChildPath "client"
$dbHost = "localhost"
$dbPort = 5433
$apiPort = 5080
$clientPort = 5173

# Function to check if database is online
function Check-DatabaseOnline {
    Write-Host "Checking database connection to ${dbHost}:${dbPort}..." -ForegroundColor DarkCyan
    try {
        $tcpClient = New-Object System.Net.Sockets.TcpClient
        $result = $tcpClient.BeginConnect($dbHost, $dbPort, $null, $null)
        $success = $result.AsyncWaitHandle.WaitOne(3000, $false) # 3 second timeout
        $tcpClient.Close()

        if ($success) {
            Write-Host "✓ Database is online at ${dbHost}:${dbPort}" -ForegroundColor Green
            return $true
        } else {
            Write-Host "✗ Database connection timeout to ${dbHost}:${dbPort}" -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host "✗ Database connection failed: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# Function to start a process
function Start-ProcessQuiet {
    param(
        [string]$FilePath,
        [string]$Arguments = "",
        [string]$WorkingDirectory = (Get-Location),
        [string]$ProcessName
    )

    try {
        # Ensure working directory exists
        if (-not (Test-Path -Path $WorkingDirectory -PathType Container)) {
            Write-Host "Working directory does not exist: $WorkingDirectory" -ForegroundColor Red
            return $null
        }

        $processInfo = New-Object System.Diagnostics.ProcessStartInfo
        $processInfo.FileName = $FilePath
        $processInfo.Arguments = $Arguments
        $processInfo.WorkingDirectory = $WorkingDirectory
        $processInfo.UseShellExecute = $false
        $processInfo.RedirectStandardError = $true
        $processInfo.RedirectStandardOutput = $true
        $processInfo.CreateNoWindow = $true

        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = $processInfo

        $process.Start() | Out-Null

        Write-Host "✓ Started $ProcessName (PID: $($process.Id))" -ForegroundColor Green
        return $process
    } catch {
        Write-Host "✗ Failed to start $ProcessName: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

# Main script execution
Set-Location -Path (Get-Location) # Ensure we're in the project root

# Step 1: Check database
Write-Host "`nStep 1: Verifying database status..." -ForegroundColor Cyan
$dbOnline = Check-DatabaseOnline
if (-not $dbOnline) {
    Write-Host "`nError: Database is not available." -ForegroundColor Red
    Write-Host "Please ensure PostgreSQL is running on ${dbHost}:${dbPort}" -ForegroundColor Yellow
    Write-Host "You can start it with: docker compose up -d postgres" -ForegroundColor Yellow
    Write-Host "Or check your PostgreSQL service.`n" -ForegroundColor Yellow
    exit 1
}

# Step 2: Start API
Write-Host "`nStep 2: Starting LogiBTP API..." -ForegroundColor Cyan
$apiProcess = Start-ProcessQuiet -FilePath "dotnet" -Arguments "run" -WorkingDirectory $apiPath -ProcessName "LogiBTP API"
if (-not $apiProcess) {
    Write-Host "`nError: Failed to start API. Exiting." -ForegroundColor Red
    exit 1
}

# Give API a moment to start
Write-Host "Waiting for API to initialize..." -ForegroundColor DarkCyan
Start-Sleep -Seconds 5

# Step 3: Start client
Write-Host "`nStep 3: Starting LogiBTP Client..." -ForegroundColor Cyan
$clientProcess = Start-ProcessQuiet -FilePath "npm" -Arguments "run dev" -WorkingDirectory $clientPath -ProcessName "LogiBTP Client"
if (-not $clientProcess) {
    Write-Host "`nError: Failed to start client. Exiting." -ForegroundColor Red
    # Try to stop the API we started
    Stop-Process -Id $apiProcess.Id -ErrorAction SilentlyContinue
    exit 1
}

# Step 4: Verify API is responding
Write-Host "`nStep 4: Verifying API is responding..." -ForegroundColor Cyan
$maxAttempts = 15
$attempt = 0
$apiReady = $false

while ($attempt -lt $maxAttempts -and -not $apiReady) {
    $attempt++
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:${apiPort}/api/types-document" -TimeoutSec 10 -ErrorAction Stop
        if ($response) {
            Write-Host "✓ API is responding on http://localhost:${apiPort}" -ForegroundColor Green
            $apiReady = $true
        }
    } catch {
        if ($attempt -lt $maxAttempts) {
            Write-Host "  Attempt $attempt/$maxAttempts: API not ready yet, waiting..." -ForegroundColor DarkCyan
            Start-Sleep -Seconds 3
        } else {
            Write-Host "✗ API did not respond after $maxAttempts attempts" -ForegroundColor Red
        }
    }
}

# Final status
Write-Host "`n=== Demo Status ===" -ForegroundColor Cyan
if ($apiReady) {
    Write-Host "✓ Database: Online" -ForegroundColor Green
    Write-Host "✓ API: Running on http://localhost:${apiPort} (PID: $($apiProcess.Id))" -ForegroundColor Green
    Write-Host "✓ Client: Running on http://localhost:${clientPort} (PID: $($clientProcess.Id))" -ForegroundColor Green
    Write-Host "`nTo view the application, open: http://localhost:${clientPort}" -ForegroundColor Yellow
    Write-Host "To stop the demo, close this window or press Ctrl+C and then run:" -ForegroundColor Yellow
    Write-Host "  taskkill /PID $($apiProcess.Id) /F" -ForegroundColor DarkYellow
    Write-Host "  taskkill /PID $($clientProcess.Id) /F" -ForegroundColor DarkYellow
} else {
    Write-Host "✗ API failed to start properly" -ForegroundColor Red
    Write-Host "The client may still be starting - check http://localhost:${clientPort} manually" -ForegroundColor Yellow
}

# Keep the script running so the background processes continue
Write-Host "`nDemo is running. Press Ctrl+C to stop." -ForegroundColor Cyan
try {
    while ($true) { Start-Sleep -Seconds 5 }
} catch {
    Write-Host "`nStopping demo processes..." -ForegroundColor Cyan
    Stop-Process -Id $apiProcess.Id -ErrorAction SilentlyContinue
    Stop-Process -Id $clientProcess.Id -ErrorAction SilentlyContinue
    Write-Host "Demo stopped." -ForegroundColor Green
}