$ErrorActionPreference='Stop'
$stage='input'
try {
    # Node may inherit a PowerShell 7 module search path while launching Windows
    # PowerShell. Load this host's security module explicitly to avoid missing
    # ConvertTo/From-SecureString commands.
    Import-Module ([IO.Path]::Combine($PSHOME,'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1')) -ErrorAction Stop
    $request=[Console]::In.ReadToEnd()|ConvertFrom-Json
    $keyFile=[string]$request.path
    if ($request.mode -eq 'save') {
        $value=([string]$request.key).Trim() -replace '^(?i)Bearer\s+',''
        if($value.Length -lt 8 -or $value.Length -gt 1024 -or $value -match '[\s\p{C}"'']'){throw 'KEY_INPUT_INVALID'}
        $stage='encrypt'
        $cipher=ConvertFrom-SecureString (ConvertTo-SecureString $value -AsPlainText -Force)
        $stage='write'
        [IO.File]::WriteAllText(($keyFile+'.tmp'),$cipher.Trim(),(New-Object Text.UTF8Encoding($false)))
        Move-Item -LiteralPath ($keyFile+'.tmp') -Destination $keyFile -Force
        @{ok=$true}|ConvertTo-Json -Compress
    } elseif($request.mode -eq 'read') {
        if(-not(Test-Path -LiteralPath $keyFile)){throw 'KEY_NOT_SAVED'}
        $stage='read'
        $cipher=(Get-Content -LiteralPath $keyFile -Raw -Encoding UTF8).Trim().Trim([char]0xFEFF)
        $stage='decrypt'
        $secure=ConvertTo-SecureString $cipher
        $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try{$value=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
        @{key=$value}|ConvertTo-Json -Compress
    } else {throw 'KEY_OPERATION_INVALID'}
} catch {
    $code=if($_.Exception.Message -in @('KEY_NOT_SAVED','KEY_INPUT_INVALID')){$_.Exception.Message}elseif(($stage -eq 'encrypt') -and ($_.Exception.GetType().Name -eq 'CryptographicException')){'DPAPI_UNAVAILABLE'}else{'WINDOWS_KEY_STORAGE_FAILED'}
    @{error=$code;stage=$stage;exceptionType=$_.Exception.GetType().Name;hresult=$_.Exception.HResult}|ConvertTo-Json -Compress
    exit 1
}
