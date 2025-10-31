$B64 = (Get-Content -Raw 'logo_wrapped.b64') -replace '\s',''
$content = Get-Content -Raw 'index.html'
$replacement = @"
<script>
window.CENTER_LOGO_B64 = '$B64';
</script>
"@
$new = $content.Replace('<script src="logo.b64.js"></script>', $replacement)
[System.IO.File]::WriteAllText('index.html', $new, [Text.UTF8Encoding]::UTF8)


