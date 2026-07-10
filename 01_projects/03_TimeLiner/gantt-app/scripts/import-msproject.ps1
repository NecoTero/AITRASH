param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$document = New-Object System.Xml.XmlDocument
$document.Load((Resolve-Path -LiteralPath $InputPath))

$namespace = New-Object System.Xml.XmlNamespaceManager($document.NameTable)
$namespace.AddNamespace("m", "http://schemas.microsoft.com/project")

function Get-NodeText {
  param(
    [System.Xml.XmlNode]$Node,
    [string]$Name
  )

  $child = $Node.SelectSingleNode("m:$Name", $namespace)
  if ($null -eq $child) { return $null }
  return $child.InnerText
}

function Get-DateOnly {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
  return ([DateTime]::Parse($Value)).ToString("yyyy-MM-dd")
}

function Get-DurationLabel {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) { return "0 d" }
  $duration = [System.Xml.XmlConvert]::ToTimeSpan($Value)
  $days = $duration.TotalHours / 8
  if ([Math]::Abs($days - [Math]::Round($days)) -lt 0.001) {
    return "{0:0} d" -f $days
  }
  return "{0:0.##} d" -f $days
}

$tasks = @()
$parentAtLevel = @{}
$taskNodes = $document.SelectNodes("//m:Tasks/m:Task", $namespace)

foreach ($node in $taskNodes) {
  $uid = Get-NodeText $node "UID"
  if ($uid -eq "0") { continue }

  $sourceLevel = [int](Get-NodeText $node "OutlineLevel")
  $level = [Math]::Max(0, $sourceLevel - 1)
  $parentUid = $null
  if ($sourceLevel -gt 1 -and $parentAtLevel.ContainsKey($sourceLevel - 1)) {
    $parentUid = $parentAtLevel[$sourceLevel - 1]
  }
  $parentAtLevel[$sourceLevel] = $uid

  foreach ($key in @($parentAtLevel.Keys)) {
    if ([int]$key -gt $sourceLevel) { $parentAtLevel.Remove($key) }
  }

  $isSummary = (Get-NodeText $node "Summary") -eq "1"
  $isMilestone = (Get-NodeText $node "Milestone") -eq "1"
  $isCritical = (Get-NodeText $node "Critical") -eq "1"
  $progressText = Get-NodeText $node "PercentComplete"
  $progress = if ($progressText) { [int]$progressText } else { 0 }
  $taskType = if ($isMilestone) { "milestone" } elseif ($isSummary) { "summary" } else { "task" }
  $status = if ($progress -ge 100) { "done" } elseif ($progress -gt 0) { "in_progress" } else { "todo" }
  $color = if ($isSummary) { "#526985" } elseif ($isMilestone) { "#c2413b" } elseif ($progress -ge 100) { "#2f855a" } elseif ($isCritical) { "#d97706" } else { "#3276b8" }

  $predecessors = @(
    $node.SelectNodes("m:PredecessorLink", $namespace) | ForEach-Object {
      Get-NodeText $_ "PredecessorUID"
    } | Where-Object { $_ }
  )

  $tasks += [ordered]@{
    id = $uid
    parentTaskId = $parentUid
    taskType = $taskType
    name = Get-NodeText $node "Name"
    startDate = Get-DateOnly (Get-NodeText $node "Start")
    endDate = Get-DateOnly (Get-NodeText $node "Finish")
    actualStartDate = Get-DateOnly (Get-NodeText $node "ActualStart")
    actualEndDate = Get-DateOnly (Get-NodeText $node "ActualFinish")
    deadline = Get-DateOnly (Get-NodeText $node "Deadline")
    status = $status
    progress = $progress
    sortOrder = [int](Get-NodeText $node "ID")
    level = $level
    outlineNumber = Get-NodeText $node "OutlineNumber"
    duration = Get-DurationLabel (Get-NodeText $node "Duration")
    critical = $isCritical
    predecessors = $predecessors
    color = $color
  }
}

$project = $document.SelectSingleNode("/m:Project", $namespace)
$payload = [ordered]@{
  project = [ordered]@{
    name = [IO.Path]::GetFileNameWithoutExtension((Resolve-Path -LiteralPath $InputPath))
    startDate = Get-DateOnly (Get-NodeText $project "StartDate")
    endDate = Get-DateOnly (Get-NodeText $project "FinishDate")
    taskCount = $tasks.Count
  }
  tasks = $tasks
}

$outputDirectory = Split-Path -Parent $OutputPath
if ($outputDirectory) {
  New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}

$json = $payload | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText($OutputPath, $json, (New-Object Text.UTF8Encoding($false)))
Write-Host "Imported $($tasks.Count) tasks to $OutputPath"
