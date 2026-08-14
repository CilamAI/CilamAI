Write-Host "Starting CilamAI Desktop Installation..." -ForegroundColor Cyan

Write-Host "Checking for the latest version..."
$tagsUrl = "https://api.github.com/repos/CilamAI/CilamAI/tags"
$downloadUrl = "https://github.com/CilamAI/CilamAI/releases/download/v0.1.0.1/CilamAI-Setup.exe"
try {
    $tags = Invoke-RestMethod -Uri $tagsUrl -Method Get -Headers @{ "User-Agent" = "CilamAI" } -ErrorAction Stop
    if ($tags.Count -gt 0) {
        $latestTag = $tags[0].name
        $downloadUrl = "https://github.com/CilamAI/CilamAI/releases/download/$latestTag/CilamAI-Setup.exe"
        Write-Host "Found version: $latestTag"
    }
}
catch {
    Write-Host "Could not fetch latest version (API limit). Falling back to v0.1.0.1" -ForegroundColor Yellow
}

$installerPath = Join-Path -Path $env:TEMP -ChildPath "CilamAI-Setup.exe"

Write-Host "Downloading installer from GitHub..."

Try {
    $request = [System.Net.WebRequest]::Create($downloadUrl)
    $response = $request.GetResponse()
    $totalSize = $response.ContentLength

    $stream = $response.GetResponseStream()
    $buffer = New-Object byte[] 8192
    $fileStream = [System.IO.File]::Create($installerPath)

    $downloaded = 0
    $lastDraw = 0

    while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $fileStream.Write($buffer, 0, $read)
        $downloaded += $read

        if ($totalSize -gt 0) {
            $percent = [math]::Round(($downloaded / $totalSize) * 100)

            if ($percent -ne $lastDraw) {
                $hashes = "#" * [math]::Floor($percent / 5)
                $spaces = " " * (20 - [math]::Floor($percent / 5))

                Write-Host -NoNewline "`rDownload: [$hashes$spaces] $percent%"
                $lastDraw = $percent
            }
        }
    }

    $fileStream.Close()
    $stream.Close()
    $response.Close()

    Write-Host "`nDownload successful! Saved to $installerPath" -ForegroundColor Green

    Write-Host "Launching the installer silently..." -ForegroundColor Cyan
    $proc = Start-Process -FilePath $installerPath `
        -ArgumentList "/SP- /SILENT /NORESTART /SUPPRESSMSGBOXES" `
        -Wait -PassThru -NoNewWindow
    Write-Host "Installer exit code: $($proc.ExitCode)" -ForegroundColor Green

    Write-Host "Installation process complete." -ForegroundColor Green
}
Catch {
    if ($null -ne $fileStream) { $fileStream.Close() }
    if ($null -ne $stream) { $stream.Close() }
    if ($null -ne $response) { $response.Close() }

    Write-Host "`nAn error occurred during the download or installation process." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
}
