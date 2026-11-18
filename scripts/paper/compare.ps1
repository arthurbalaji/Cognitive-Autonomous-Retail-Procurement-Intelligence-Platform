# Usage: powershell -NoProfile -File scripts/paper/compare.ps1 -Original <docx> -Revised <docx> -Out <tracked.docx>
# Produces a document in which every difference between the original and the revised paper is a tracked change.
param([Parameter(Mandatory=$true)][string]$Original, [Parameter(Mandatory=$true)][string]$Revised, [Parameter(Mandatory=$true)][string]$Out)
$ErrorActionPreference = "Stop"
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $o = $word.Documents.Open($Original, $false, $true)
  $r = $word.Documents.Open($Revised, $false, $true)
  # wdCompareDestinationNew = 2, wdGranularityWordLevel = 1
  $c = $word.CompareDocuments($o, $r, 2, 1, $true, $true, $true, $true, $true, $true, $true, $true, $false, $false, "Revised from measurements")
  $c.SaveAs2($Out)
  "revisions=" + $c.Revisions.Count
  $c.Close(0)
  $o.Close(0)
  $r.Close(0)
} finally { $word.Quit() }
