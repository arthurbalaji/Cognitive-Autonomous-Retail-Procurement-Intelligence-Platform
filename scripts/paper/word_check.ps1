# Usage: powershell -NoProfile -File scripts/paper/word_check.ps1 -Path <docx> [-Pdf <out.pdf>]
param([Parameter(Mandatory=$true)][string]$Path, [string]$Pdf = "")
$ErrorActionPreference = "Stop"
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open($Path, $false, $true)
  $doc.Repaginate()
  "pages=" + $doc.ComputeStatistics(2)
  "words=" + $doc.ComputeStatistics(0)
  "paragraphs=" + $doc.Paragraphs.Count
  "tables=" + $doc.Tables.Count
  "inlineShapes=" + $doc.InlineShapes.Count
  "equations=" + $doc.OMaths.Count
  "revisions=" + $doc.Revisions.Count
  "comments=" + $doc.Comments.Count
  $lastPage = $doc.Range($doc.Content.End - 1, $doc.Content.End - 1).Information(3)
  "lastPageOfBody=" + $lastPage
  if ($Pdf -ne "") { $doc.ExportAsFixedFormat($Pdf, 17); "pdf=" + $Pdf }
  $doc.Close(0)
} finally { $word.Quit() }
