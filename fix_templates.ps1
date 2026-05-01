$content = Get-Content app.js -Raw
$content = $content -replace 'addLog\(`([^`]*)`, ''info''\)', 'addLog(''$1'', ''info'')'
$content = $content -replace 'addLog\(`([^`]*)`, ''success''\)', 'addLog(''$1'', ''success'')'
$content = $content -replace 'addLog\(`([^`]*)`, ''warn''\)', 'addLog(''$1'', ''warn'')'
$content = $content -replace 'addLog\(`([^`]*)`, ''error''\)', 'addLog(''$1'', ''error'')'
$content = $content -replace '\$\{([^}]*)\}', ''' + $1 + '''
$content = $content -replace '`', "'"
Set-Content app.js $content