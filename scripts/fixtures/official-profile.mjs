// Test-only consumer loaded by the official dsh Profile; never shipped in the plugin archive.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { createProbeEvidence, runGuardedCleanup, scrubDiagnosticText, settleRun } from './probe-evidence.mjs'

/** Marker line the fixed startup probe emits; only this line is ever parsed. */
const STARTUP_MARKER = 'PROJECT_OPS_STARTUP_DIAGNOSTIC='
/** Bound on that one line, so a complete marker payload is never larger than this. */
const STARTUP_MAX_CHARS = 8192
/** How much of one text source is scanned before the payload counts as incomplete. */
const STARTUP_SCAN_CHARS = 65536
/** How many text sources are considered at all; the marker is expected in the first. */
const STARTUP_MAX_SOURCES = 4
/** Bound on the whole diagnostic call (its own controller). */
const STARTUP_TIMEOUT_MS = 20000
/** Bound on waiting for a promoted diagnostic job to settle. */
const STARTUP_JOB_WAIT_MS = 5000
/** Race sentinel for the diagnostic's hard deadline. */
const STARTUP_DEADLINE = Symbol('startup-diagnostic-deadline')

/** Scrubbed, capped string; anything that is not a string stays null. */
function probeString(value, limit = 120) {
  return typeof value === 'string' && value.trim().length > 0 ? scrubDiagnosticText(value, limit) : null
}
/** Real booleans only; a missing flag is unknown, not false. */
const probeBool = value => typeof value === 'boolean' ? value : null
/** Finite integers only. */
const probeInt = value => Number.isFinite(value) ? Math.trunc(value) : null

/**
 * The fixed probe, read-only apart from starting one confirmed candidate.
 *
 * Only the two base64 literals differ per run and they are fixed data (base64
 * charset only), so no caller text is interpolated into the script. Absolute
 * paths stay inside the script: the upload keeps basenames, digests, classes and
 * equality booleans instead.
 */
function startupDiagnosticScript(execPathBase64, cwdBase64) {
  return [
    "$ErrorActionPreference = 'Continue'",
    "$ProgressPreference = 'SilentlyContinue'",
    `$expectedExe = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${execPathBase64}'))`,
    `$expectedCwd = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${cwdBase64}'))`,
    "$out = [ordered]@{ protocol = 1 }",
    "$out.powershell = [ordered]@{ version = [string]$PSVersionTable.PSVersion; edition = [string]$PSVersionTable.PSEdition; dotnet = [string][Environment]::Version }",
    "$out.npm = [ordered]@{ type = $null; shim = $null; rule = 'unknown'; prefixLines = $null }",
    "$out.candidate = [ordered]@{ basename = $null; source = 'unknown'; pathDigest = $null; matchesHostExecPath = $null; exists = $null; isFile = $null; readable = $null }",
    "$out.cwd = [ordered]@{ expectedMatches = $null; accessible = $null }",
    "$out.start = [ordered]@{ attempted = $false; started = $null; exitCode = $null; stdoutLength = $null; stderrLength = $null; timedOut = $null; killed = $null; cleanupSettled = $null; skippedReason = $null; error = $null }",
    "try {",
    "  $cwdNow = (Get-Location).Path",
    "  $out.cwd.accessible = [bool](Test-Path -LiteralPath $cwdNow)",
    "  $out.cwd.expectedMatches = [bool]($cwdNow -eq $expectedCwd)",
    "} catch { }",
    "$candidatePath = $null",
    "try {",
    "  $npm = Get-Command npm -ErrorAction Stop",
    "  $out.npm.type = [string]$npm.CommandType",
    "  if ($npm.Source) { $out.npm.shim = [IO.Path]::GetFileName([string]$npm.Source) }",
    "  if ([string]$npm.CommandType -eq 'ExternalScript' -and $npm.Source) {",
    "    # Prefix verification of the known npm 10.x shim, not an assumption: read only",
    "    # the first lines and require the documented node.exe / $PSScriptRoot / Test-Path",
    "    # markers. Anything else is unsupported, and nothing is started.",
    "    $shimText = ''",
    "    try {",
    "      $reader = New-Object System.IO.StreamReader([string]$npm.Source)",
    "      try {",
    "        $kept = New-Object System.Collections.Generic.List[string]",
    "        for ($i = 0; $i -lt 13; $i++) {",
    "          $line = $reader.ReadLine()",
    "          if ($line -eq $null) { break }",
    "          if ($line.Length -gt 400) { $line = $line.Substring(0, 400) }",
    "          $kept.Add($line.Trim())",
    "        }",
    "        $shimText = $kept -join [Environment]::NewLine",
    "      } finally { $reader.Dispose() }",
    "    } catch { }",
    "    # Only code lines count: a comment that merely mentions node.exe must not",
    "    # select a candidate. This is a structural prefix match of the documented",
    "    # npm 10.9.3 shim, not a file identity check.",
    "    $codeLines = @()",
    "    if ($shimText -ne '') { $codeLines = @($shimText -split [Environment]::NewLine | Where-Object { $_ -ne '' -and -not $_.StartsWith('#') } | ForEach-Object { $_.Trim() }) }",
    "    $out.npm.prefixLines = [int]$codeLines.Count",
    "    # Exact per-line match of the npm 10.9.x shim's node-resolution prefix",
    "    # (header comment and blank lines already dropped). A comment that merely",
    "    # mentions node.exe, or any other shim, does not match and never starts",
    "    # anything.",
    "    $expectedBlock = @(",
    "      '$NODE_EXE=\"$PSScriptRoot/node.exe\"'",
    "      'if (-not (Test-Path $NODE_EXE)) {'",
    "      '$NODE_EXE=\"$PSScriptRoot/node\"'",
    "      '}'",
    "      'if (-not (Test-Path $NODE_EXE)) {'",
    "      '$NODE_EXE=\"node\"'",
    "      '}'",
    "    )",
    "    $knownRule = $false",
    "    for ($i = 0; $i -le ($codeLines.Count - $expectedBlock.Count); $i++) {",
    "      $blockMatch = $true",
    "      for ($j = 0; $j -lt $expectedBlock.Count; $j++) { if ($codeLines[$i + $j] -cne $expectedBlock[$j]) { $blockMatch = $false; break } }",
    "      if ($blockMatch) { $knownRule = $true; break }",
    "    }",
    "    $out.npm.rule = if ($knownRule) { 'prefix-block-match' } else { 'unsupported-shim-prefix' }",
    "    if ($knownRule) {",
    "      $shimDir = [IO.Path]::GetDirectoryName([string]$npm.Source)",
    "      $withExe = Join-Path $shimDir 'node.exe'",
    "      $withoutExe = Join-Path $shimDir 'node'",
    "      if (Test-Path -LiteralPath $withExe) { $candidatePath = $withExe; $out.candidate.source = 'shim-sibling-exe'; $out.npm.rule = 'block-match-sibling-exe' }",
    "      elseif (Test-Path -LiteralPath $withoutExe) { $candidatePath = $withoutExe; $out.candidate.source = 'shim-sibling-plain'; $out.npm.rule = 'block-match-sibling-plain' }",
    "      else {",
    "        # PATH fallback resolves through Get-Command: the candidate is the resolved",
    "        # Application's absolute Source, never the bare word node.",
    "        $nodeCmd = $null",
    "        try { $nodeCmd = Get-Command node -ErrorAction Stop } catch { }",
    "        if ($nodeCmd -ne $null -and [string]$nodeCmd.CommandType -eq 'Application' -and $nodeCmd.Source) {",
    "          $candidatePath = [string]$nodeCmd.Source; $out.candidate.source = 'path-lookup'; $out.npm.rule = 'block-match-path-lookup'",
    "        } else { $out.npm.rule = 'unsupported-node-lookup' }",
    "      }",
    "    } else { $out.npm.rule = 'unsupported-shim' }",
    "  } elseif ([string]$npm.CommandType -eq 'Application') {",
    "    # An Application npm is npm itself, never a node candidate: it is not started.",
    "    $out.npm.rule = 'unsupported-application'",
    "  } else { $out.npm.rule = 'unsupported' }",
    "} catch { $out.npm.rule = 'npm-not-found' }",
    "# Only a confirmed node-shaped candidate may be inspected or started.",
    "if ($candidatePath) {",
    "  $candidateName = [IO.Path]::GetFileName($candidatePath)",
    "  if ($candidateName -notmatch '^node(\\.exe)?$') { $candidatePath = $null; $out.npm.rule = 'unsupported-node-lookup' }",
    "} ",
    "if ($candidatePath) {",
    "  try {",
    "    $out.candidate.basename = [IO.Path]::GetFileName($candidatePath)",
    "    if ([IO.Path]::IsPathRooted($candidatePath)) {",
    "      $out.candidate.matchesHostExecPath = [bool]($candidatePath -eq $expectedExe)",
    "      try {",
    "        $sha = [Security.Cryptography.SHA256]::Create()",
    "        $out.candidate.pathDigest = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($candidatePath))) -replace '-', '').ToLowerInvariant()",
    "      } catch { }",
    "    }",
    "    $candidateExists = Test-Path -LiteralPath $candidatePath",
    "    $out.candidate.exists = [bool]$candidateExists",
    "    if ($candidateExists) {",
    "      try { $item = Get-Item -LiteralPath $candidatePath -ErrorAction Stop; $out.candidate.isFile = [bool](-not $item.PSIsContainer) } catch { }",
    "      try { $stream = [IO.File]::Open($candidatePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite); $stream.Dispose(); $out.candidate.readable = $true } catch { $out.candidate.readable = $false }",
    "    } else { $out.candidate.readable = $false }",
    "  } catch { }",
    "} ",
    "# The probe only starts in the confirmed cwd, and only a confirmed node candidate.",
    "$startAllowed = ($candidatePath -ne $null) -and ($out.candidate.exists -eq $true) -and ($out.candidate.isFile -eq $true) -and ($out.cwd.expectedMatches -eq $true) -and ($out.cwd.accessible -eq $true)",
    "if (-not $startAllowed) {",
    "  if ($candidatePath -eq $null) { $out.start.skippedReason = 'no-verified-node-candidate' }",
    "  elseif ($out.cwd.expectedMatches -ne $true -or $out.cwd.accessible -ne $true) { $out.start.skippedReason = 'cwd-not-confirmed' }",
    "  else { $out.start.skippedReason = 'candidate-not-a-file' }",
    "} else {",
    "  $out.start.attempted = $true",
    "  $proc = $null",
    "  try {",
    "    $psi = New-Object System.Diagnostics.ProcessStartInfo",
    "    $psi.FileName = $candidatePath",
    "    $psi.Arguments = '--version'",
    "    $psi.UseShellExecute = $false",
    "    $psi.RedirectStandardOutput = $true",
    "    $psi.RedirectStandardError = $true",
    "    $psi.CreateNoWindow = $true",
    "    $psi.WorkingDirectory = $expectedCwd",
    "    # Encoding is set only after both redirects are enabled: the contradictory",
    "    # combination is what the Host error text reported, and this probe repeats it.",
    "    $psi.StandardOutputEncoding = [Text.Encoding]::UTF8",
    "    $psi.StandardErrorEncoding = [Text.Encoding]::UTF8",
    "    $proc = New-Object System.Diagnostics.Process",
    "    $proc.StartInfo = $psi",
    "    $started = $false",
    "    try { $started = $proc.Start() } catch {",
    "      # Bounded inner-exception walk: the discovered Win32Exception is reported,",
    "      # with its own message and code rather than the outer PowerShell wrapper.",
    "      $ex = $_.Exception; $depth = 0; $win32 = $null",
    "      while ($ex -ne $null -and $depth -lt 4) { if ($ex -is [System.ComponentModel.Win32Exception]) { $win32 = $ex; break }; $ex = $ex.InnerException; $depth++ }",
    "      $reported = if ($win32 -ne $null) { $win32.Message } else { $_.Exception.Message }",
    "      $reportedType = if ($win32 -ne $null) { 'Win32Exception' } else { $_.Exception.GetType().Name }",
    "      $out.start.error = [ordered]@{ win32 = [bool]($win32 -ne $null); type = [string]$reportedType; nativeErrorCode = $null; hresult = $null; message = [string]$reported }",
    "      if ($win32 -ne $null) { $out.start.error.nativeErrorCode = [int]$win32.NativeErrorCode; $out.start.error.hresult = [int]$win32.HResult }",
    "    }",
    "    if ($started) {",
    "      $out.start.started = $true",
    "      $outTask = $null; $errTask = $null",
    "      try {",
    "        # Both streams start reading before any wait.",
    "        $outTask = $proc.StandardOutput.ReadToEndAsync()",
    "        $errTask = $proc.StandardError.ReadToEndAsync()",
    "        if ($proc.WaitForExit(700)) { $out.start.timedOut = $false } else {",
    "          $out.start.timedOut = $true",
    "          # Kill(bool) returns void: no exception means the request was submitted.",
    "          try { $proc.Kill($true); $out.start.killed = $true } catch { $out.start.killed = $false }",
    "          try { $proc.WaitForExit(500) | Out-Null } catch { }",
    "        }",
    "        $deadline = [DateTime]::UtcNow.AddMilliseconds(500)",
    "        while ((-not $outTask.IsCompleted -or -not $errTask.IsCompleted) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 25 }",
    "        $outText = if ($outTask -ne $null -and $outTask.IsCompleted) { [string]$outTask.Result } else { '' }",
    "        $errText = if ($errTask -ne $null -and $errTask.IsCompleted) { [string]$errTask.Result } else { '' }",
    "        $out.start.stdoutLength = $outText.Length",
    "        $out.start.stderrLength = $errText.Length",
    "      } catch {",
    "        # A read or wait failure still kills and waits, bounded, before reporting.",
    "        try { if (-not $proc.HasExited) { $proc.Kill($true); $out.start.killed = $true } } catch { $out.start.killed = $false }",
    "        try { $proc.WaitForExit(500) | Out-Null } catch { }",
    "        $ex = $_.Exception; $depth = 0; $win32 = $null",
    "        while ($ex -ne $null -and $depth -lt 4) { if ($ex -is [System.ComponentModel.Win32Exception]) { $win32 = $ex; break }; $ex = $ex.InnerException; $depth++ }",
    "        $reported = if ($win32 -ne $null) { $win32.Message } else { $_.Exception.Message }",
    "        $reportedType = if ($win32 -ne $null) { 'Win32Exception' } else { $_.Exception.GetType().Name }",
    "        $out.start.error = [ordered]@{ win32 = [bool]($win32 -ne $null); type = [string]$reportedType; nativeErrorCode = $null; hresult = $null; message = [string]$reported }",
    "        if ($win32 -ne $null) { $out.start.error.nativeErrorCode = [int]$win32.NativeErrorCode; $out.start.error.hresult = [int]$win32.HResult }",
    "      }",
    "      try { $out.start.cleanupSettled = [bool]$proc.WaitForExit(500) } catch { }",
    "      try { if ($proc.HasExited) { $out.start.exitCode = [int]$proc.ExitCode } } catch { }",
    "    }",
    "  } finally { if ($proc -ne $null) { try { $proc.Dispose() } catch { } } }",
    "} ",
    "Write-Output (\'PROJECT_OPS_STARTUP_DIAGNOSTIC=\' + ($out | ConvertTo-Json -Compress -Depth 5))",
  ].join('\n')
}

/**
 * Typed, scrubbed whitelist of one probe payload.
 *
 * Unknown fields are dropped, every string is scrubbed and capped (the error
 * message gets the larger forensic cap), and a missing value stays null rather
 * than becoming `false` or `0`. The candidate path itself never appears: only its
 * basename, source class and an irreversible digest.
 */
function startupFacts(payload) {
  const row = payload !== null && typeof payload === 'object' ? payload : {}
  const section = name => row[name] !== null && typeof row[name] === 'object' ? row[name] : {}
  const powershell = section('powershell')
  const npm = section('npm')
  const candidate = section('candidate')
  const cwd = section('cwd')
  const start = section('start')
  const error = start.error !== null && typeof start.error === 'object' ? start.error : null
  const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) ? value : null
  return {
    powershell: { version: probeString(powershell.version), edition: probeString(powershell.edition),
      dotnet: probeString(powershell.dotnet) },
    npm: { type: probeString(npm.type), shim: probeString(npm.shim), rule: probeString(npm.rule),
      prefixLines: probeInt(npm.prefixLines) },
    candidate: { basename: probeString(candidate.basename), source: probeString(candidate.source),
      pathDigest: digest(candidate.pathDigest), matchesHostExecPath: probeBool(candidate.matchesHostExecPath),
      exists: probeBool(candidate.exists), isFile: probeBool(candidate.isFile), readable: probeBool(candidate.readable) },
    cwd: { expectedMatches: probeBool(cwd.expectedMatches), accessible: probeBool(cwd.accessible) },
    start: { attempted: probeBool(start.attempted), started: probeBool(start.started), exitCode: probeInt(start.exitCode),
      stdoutLength: probeInt(start.stdoutLength), stderrLength: probeInt(start.stderrLength),
      timedOut: probeBool(start.timedOut), killed: probeBool(start.killed), cleanupSettled: probeBool(start.cleanupSettled),
      error: error === null ? null : { win32: probeBool(error.win32), type: probeString(error.type),
        nativeErrorCode: probeInt(error.nativeErrorCode), hresult: probeInt(error.hresult),
        message: probeString(error.message, 512) } },
  }
}

export const name = 'project-ops-official-profile-probe'
export const inject = ['appReady', 'appExit', 'agents', 'agentLoop', 'tools', 'jobs', 'systemPrompt']

export function apply(ctx, config) {
  const abort = new AbortController()
  let pending
  ctx.effect(() => ctx.appReady.onReady(() => {
    pending = createProbeEvidence(config).run(evidence => probe(ctx, config, abort.signal, evidence))
    void pending.then(report => {
      ctx.appExit(report.passed ? 0 : 1)
    }, error => {
      console.error('Profile evidence could not be persisted:', error)
      ctx.appExit(1)
    })
  }))
  ctx.effect(() => async () => { abort.abort(); await pending?.catch(() => {}) })
}

async function probe(ctx, config, signal, evidence) {
  const names = ctx.tools.schemas().map(tool => tool.name).filter(name => name.startsWith('missher_project_ops_')).sort()
  const prompt = await ctx.systemPrompt.assemble()
  evidence.record('activation', { tools: names, servicePresent: ctx.get('projectOps') !== undefined,
    guidance: prompt.sections.some(section => section.name === 'missher-project-ops:agent-guidance') })
  if (config.removed) {
    assert.deepEqual(names, [])
    assert.equal(ctx.get('projectOps'), undefined)
    assert.equal(prompt.sections.some(section => section.name === 'missher-project-ops:agent-guidance'), false)
    return { passed: true, phase: 'removed', tools: [], guidance: false,
      runtime: { node: process.version, platform: process.platform, arch: process.arch } }
  }
  evidence.setBusinessStage('activation')
  assert.equal(names.length, 9)
  assert(prompt.sections.some(section => section.name === 'missher-project-ops:agent-guidance'))
  const handles = []
  const outstanding = new Set()
  const create = async sessionId => {
    const handle = await ctx.agents.create({ sessionId, meta: { cwd: config.workspace },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-flash' } })
    handles.push(handle)
    return handle.agent
  }
  const owner = await create('project-ops-profile-owner')
  const stranger = await create('project-ops-profile-stranger')
  const shell = process.platform === 'win32' ? 'pwsh' : 'bash'
  const originalShell = ctx.tools.get(shell, owner)
  let afterNative = () => {}
  // The tool call the native shell call was dispatched from; the evidence pair
  // needs that relation, and a driver-side ordinal is not a substitute for it.
  let enclosingToolCallId
  // The failed native call's workdir, kept locally for the one diagnostic call so
  // it runs in the same directory (never uploaded as a path).
  let lastNativeWorkdir
  const nativeShell = { ...originalShell, async execute(args, exec) {
    lastNativeWorkdir = typeof args.workdir === 'string' && args.workdir.length > 0 ? args.workdir : undefined
    const value = await evidence.observe('native', {
      tool: shell, callId: exec.callId ?? 'unavailable',
      parentCallId: enclosingToolCallId ?? 'unavailable', requestedWorkdir: args.workdir ?? 'unavailable',
    }, () => originalShell.execute(args, exec))
    afterNative(value, exec)
    return value
  } }
  const removeNativeObserver = owner.ctx.tools.register(nativeShell)
  let sequence = 0
  const result = (name, args, agent = owner) => {
    // The ordinal is this fixture's own call counter, so a tool call can be
    // named without borrowing any driver-side number.
    const ordinal = ++sequence
    const callId = ToolCallId(`profile-probe-${ordinal}`)
    enclosingToolCallId = callId
    return evidence.observe('tool', { tool: name, callId, ordinal, taskId: args.taskId ?? 'unavailable',
      requestedWorkdir: args.workdir ?? 'unavailable' }, () => ctx.agents.withInitiator(agent, () => ctx.tools.execute({
      name, arguments: args, agent, callId, signal,
    }))).finally(() => { enclosingToolCallId = undefined })
  }
  const call = async (name, args, agent = owner) => {
    const response = await result(name, args, agent)
    assert.equal(response.isError, false, JSON.stringify(response.content))
    return response.value
  }

  /**
   * One fixed, read-only startup probe for the first Windows `task_run` failure.
   *
   * It repeats the same call boundary the business run used — same owner, same
   * native shell tool, same failed workdir, same sandbox policy — and starts one
   * confirmed node candidate through an explicit .NET ProcessStartInfo, so the
   * PowerShell fallback that hid the original Win32 error cannot do so here.
   * Exactly one call, fixed script and arguments, its own controller and bounded
   * timeout. Everything it reports is typed, scrubbed and capped; it never
   * touches the business failure.
   */
  let startupDiag
  const runStartupDiagnostic = async () => {
    const diagnostics = []
    const result = { protocol: 1, phase: 'declared-workspace-execution', tool: 'missher_project_ops_task_run',
      result: 'skipped', attempted: false, platform: process.platform === 'win32' ? 'win32' : null,
      workdirClass: lastNativeWorkdir === undefined ? null
        : lastNativeWorkdir === join(config.workspace, 'packages', 'app') ? 'packages-app'
          : lastNativeWorkdir === config.workspace ? 'workspace' : 'other',
      data: null, job: null, notes: diagnostics }
    if (process.platform !== 'win32') { result.result = 'skipped-not-windows'; return result }
    if (signal.aborted) { result.result = 'skipped-aborted'; return result }
    // Without the failed call's own workdir there is nothing faithful to repeat:
    // running in the workspace root instead would not reproduce the boundary.
    if (lastNativeWorkdir === undefined) { result.result = 'skipped-no-workdir'; return result }
    result.attempted = true
    const controller = new AbortController()
    // A later abort of the run also stops the diagnostic.
    const onAbort = () => { controller.abort() }
    signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => { controller.abort() }, STARTUP_TIMEOUT_MS)
    // A hard deadline the call cannot outlive, so the diagnostic is bounded even
    // if the transport ignores the abort.
    let deadlineTimer
    const deadline = new Promise(resolve => {
      deadlineTimer = setTimeout(() => { resolve(STARTUP_DEADLINE) }, STARTUP_TIMEOUT_MS + 250)
    })
    let call
    let settled = false
    let callSettled = false
    let response
    try {
      // Built inside the guard: a synchronous throw here must still clear the
      // timers and the abort listener.
      call = Promise.resolve(ctx.agents.withInitiator(owner, () => ctx.tools.execute({
        name: shell,
        arguments: {
          command: startupDiagnosticScript(
            Buffer.from(process.execPath, 'utf8').toString('base64'),
            Buffer.from(lastNativeWorkdir, 'utf8').toString('base64')),
          description: 'Project Ops read-only Windows startup diagnostic',
          workdir: lastNativeWorkdir,
        },
        agent: owner,
        callId: ToolCallId('profile-probe-startup-diagnostic'),
        signal: controller.signal,
      })))
      // A late settlement is always handled, and a job it carries is cleaned up
      // here rather than merely remembered: by then the run cleanup may already
      // have taken its snapshot of the outstanding set.
      void call.then(async value => {
        if (!settled) return
        const lateJob = value?.value?.jobId
        if (typeof lateJob !== 'string' || lateJob.length === 0) return
        outstanding.add(lateJob)
        let killed = false
        try { await ctx.jobs.kill(lateJob, owner.session.id); killed = true } catch { killed = false }
        let waited = false
        try { await ctx.jobs.wait(lateJob, STARTUP_JOB_WAIT_MS, owner.session.id); waited = true } catch { waited = false }
        let terminal = null
        try {
          const status = ctx.jobs.get(lateJob, owner.session.id)?.status
          terminal = typeof status === 'string' ? ['completed', 'killed', 'failed'].includes(status) : null
        } catch { terminal = null }
        if (terminal === true) outstanding.delete(lateJob)
        diagnostics.push(terminal === true
          ? 'late diagnostic job cleaned up by the late handler'
          : `late diagnostic job cleanup unproven (killed=${String(killed)}, waited=${String(waited)})`)
      }, () => undefined)
      void call.then(() => { callSettled = true }, () => { callSettled = true })
      response = await Promise.race([call, deadline])
      settled = true
    } catch (error) {
      settled = true
      result.result = controller.signal.aborted ? 'timeout' : 'throw'
      diagnostics.push(probeString(error instanceof Error ? error.message : String(error), 240) ?? 'diagnostic call failed')
      return result
    } finally {
      clearTimeout(timer)
      clearTimeout(deadlineTimer)
      signal.removeEventListener('abort', onAbort)
    }
    if (response === STARTUP_DEADLINE) {
      result.result = 'timeout'
      // The call is still outstanding: cleanup is not proven, and saying it was
      // would overstate what this bounded probe knows.
      diagnostics.push(callSettled
        ? 'diagnostic call settled at the deadline; job cleanup unproven'
        : 'diagnostic call still pending at its deadline; job cleanup unproven')
      return result
    }
    const value = response?.value !== null && typeof response.value === 'object' ? response.value : {}
    // A promoted diagnostic is cleaned up with the existing ownership rules and
    // is never read as a completion or awaited without a bound.
    if (typeof value.jobId === 'string' && value.jobId.length > 0) {
      result.result = 'promoted'
      result.job = { promoted: true, killed: null, waited: null, terminal: null }
      outstanding.add(value.jobId)
      try { await ctx.jobs.kill(value.jobId, owner.session.id); result.job.killed = true } catch { result.job.killed = false }
      try { await ctx.jobs.wait(value.jobId, STARTUP_JOB_WAIT_MS, owner.session.id); result.job.waited = true } catch { result.job.waited = false }
      // `wait` resolving is not a terminal guarantee: read the real status and
      // release ownership only for a terminal one, otherwise the run cleanup keeps
      // holding the id instead of dropping it unproven.
      let status
      try { status = ctx.jobs.get(value.jobId, owner.session.id)?.status } catch { status = undefined }
      const terminal = status === 'completed' || status === 'killed' || status === 'failed'
      result.job.terminal = typeof status === 'string' ? terminal : null
      if (terminal) outstanding.delete(value.jobId)
      else diagnostics.push('diagnostic job ownership kept for the run cleanup')
      diagnostics.push('promoted diagnostic job was cancelled instead of being read')
      return result
    }
    if (response?.isError === true) {
      result.result = 'tool-error'
      diagnostics.push(probeString(response?.error?.message ?? 'diagnostic tool reported an error', 240) ?? 'tool error')
      return result
    }
    // Only the single marker line is parsed, from a bounded set of text sources.
    // At most STARTUP_MAX_SOURCES texts are ever copied, each capped by the scan
    // bound; later candidates are not even visited. The original length is kept
    // so a payload cut by the scan cap is reported as incomplete instead of being
    // parsed as JSON.
    const sources = []
    const push = candidate => {
      if (sources.length >= STARTUP_MAX_SOURCES) return
      if (typeof candidate === 'string') {
        sources.push({ text: candidate.slice(0, STARTUP_SCAN_CHARS), truncated: candidate.length > STARTUP_SCAN_CHARS })
      } else if (candidate !== null && typeof candidate === 'object' && typeof candidate.text === 'string') {
        sources.push({ text: candidate.text.slice(0, STARTUP_SCAN_CHARS),
          truncated: candidate.text.length > STARTUP_SCAN_CHARS })
      }
    }
    push(value.stdout)
    push(value.stderr)
    for (const block of (Array.isArray(value.nestedContent) ? value.nestedContent : []).slice(0, STARTUP_MAX_SOURCES)) push(block)
    for (const block of (Array.isArray(response?.content) ? response.content : []).slice(0, STARTUP_MAX_SOURCES)) push(block)
    const source = sources.find(candidate => candidate.text.includes(STARTUP_MARKER))
    if (source === undefined) { result.result = 'no-marker'; return result }
    const rest = source.text.slice(source.text.indexOf(STARTUP_MARKER) + STARTUP_MARKER.length)
    const lineEnd = rest.indexOf('\n')
    // A marker line that runs into the cut end of the scan is incomplete.
    if (lineEnd === -1 && source.truncated) { result.result = 'oversized'; return result }
    const line = (lineEnd === -1 ? rest : rest.slice(0, lineEnd)).replace(/\r$/u, '')
    if (line.length > STARTUP_MAX_CHARS) { result.result = 'oversized'; return result }
    let payload
    try { payload = JSON.parse(line) } catch { result.result = 'invalid-json'; return result }
    if (payload === null || typeof payload !== 'object' || payload.protocol !== 1) {
      result.result = 'unsupported-protocol'
      return result
    }
    result.result = 'ok'
    result.data = startupFacts(payload)
    return result
  }
  const checks = []
  /** First business exception; cleanup must never replace it. */
  let failure
  /** Success value, settled only after cleanup has run. `result` above is the call helper. */
  let probeReport
  try {
    const development = await call('missher_project_ops_document_write', { action: 'begin', slug: 'profile-acceptance', data: { title: 'Profile acceptance', requirements: 'Real Host document persistence', design: 'Native filesystem', steps: ['write', 'review'], acceptance: ['files on disk'], progress: 'started' } })
    assert(existsSync(join(config.workspace, development.planPath)))
    checks.push('development-plan-real-file')
    const doctor = await call('missher_project_ops_doctor', {})
    assert.equal(doctor.sourceSnapshot, true)
    assert.equal(doctor.foreground, true)
    evidence.setBusinessStage('task-planning')
    const planArgs = { changedFiles: ['packages/app/input.js'], goal: 'verify' }
    const plan = await call('missher_project_ops_task_plan', planArgs)
    const task = plan.tasks.find(row => row.id === 'package@packages/app:verify')
    assert(task)
    const runArgs = { taskId: task.id, manifestDigest: task.manifestDigest }
    evidence.setBusinessStage('declared-workspace-execution')
    let ran = await call('missher_project_ops_task_run', runArgs)
    if (ran.receipt.outcome === 'running') {
      outstanding.add(ran.receipt.jobId)
      const r = ran.receipt
      ran = await call('missher_project_ops_task_collect', { taskId: r.taskId, manifestDigest: r.manifestDigest, jobId: r.jobId, nestedCallId: r.nestedCallId, startedAt: r.startedAt, waitMs: 10000 })
      outstanding.delete(r.jobId)
    }
    assert.equal(ran.receipt.outcome, 'succeeded')
    const verifiedFile = existsSync(join(config.workspace, 'packages/app/.output/verified'))
    evidence.record('verified-file', { exists: verifiedFile })
    assert(verifiedFile)
    const gateArgs = { ...planArgs, planDigest: plan.planDigest, receipts: [ran.receipt] }
    assert.equal((await call('missher_project_ops_verification_gate', gateArgs)).verdict, 'passed')
    checks.push('declared-workspace-execution', 'verification-passed')
    evidence.setBusinessStage('development-ready-real-file')
    const delivery = await call('missher_project_ops_document_write', { action: 'finish', taskId: development.taskId, expectedRevision: development.revision, verification: gateArgs, data: { implementation: 'Profile writes PLAN and READY', checks: [{ criterion: 'files on disk', status: 'reported-pass', evidence: 'Node filesystem read-back in isolated workspace' }], artifacts: [development.planPath], git: 'not committed', release: 'not released', installation: 'isolated profile only', limitations: ['No real model or native Desktop'], rollback: 'remove isolated profile' } })
    assert(delivery.readyValid)
    assert(delivery.verification.includes('passed'))
    assert(readFileSync(join(config.workspace, delivery.readyPath), 'utf8').includes('not released'))
    assert.equal((await result('missher_project_ops_document_write', { action: 'update', taskId: development.taskId, expectedRevision: delivery.revision, data: {} }, stranger)).isError, true)
    checks.push('development-ready-real-file', 'development-session-fence')

    // Wrap the already-visible official shell definition in this Agent's scope; execute its real body.
    const message = createUserMessage({ content: [{ type: 'text', text: 'Profile fixture context.' }],
      source: { kind: 'plugin', plugin: name } })
    evidence.setBusinessStage('nested-context-and-conclusion')
    afterNative = (_value, exec) => { exec.deferContext(message); exec.concludeTurn() }
    const forwarded = await result('missher_project_ops_task_run', runArgs)
    afterNative = () => {}
    assert.equal(forwarded.isError, false)
    assert.deepEqual(forwarded.additionalContexts, [message])
    assert.equal(forwarded.concludesTurn, true)
    let forwardedOutcome = forwarded.value.receipt.outcome
    if (forwardedOutcome === 'running') {
      const r = forwarded.value.receipt
      outstanding.add(r.jobId)
      forwardedOutcome = (await call('missher_project_ops_task_collect', { taskId: r.taskId, manifestDigest: r.manifestDigest, jobId: r.jobId, nestedCallId: r.nestedCallId, startedAt: r.startedAt, waitMs: 10000 })).receipt.outcome
      outstanding.delete(r.jobId)
    }
    assert.equal(forwardedOutcome, 'succeeded')
    checks.push('nested-context-and-conclusion')

    // Remove the marker the earlier successful run really produced, so the deny
    // is proven by the native side effect staying absent — an outcome field
    // alone could not distinguish "denied" from "ran and failed differently".
    const verifyMarker = join(config.workspace, 'packages/app/.output/verified')
    assert(existsSync(verifyMarker))
    rmSync(verifyMarker, { force: true })
    assert(!existsSync(verifyMarker))
    evidence.setBusinessStage('native-policy-denied')
    const reject = owner.ctx.on('tools/pre-execute', (exec, next) => exec.name === shell
      ? { kind: 'deny', reason: 'Profile fixture denies the next native shell call.' } : next())
    const denied = await call('missher_project_ops_task_run', runArgs)
    reject()
    assert.notEqual(denied.receipt.outcome, 'succeeded')
    assert(!existsSync(verifyMarker), 'the denied native call still produced its marker')
    assert.equal((await call('missher_project_ops_verification_gate', gateArgs)).verdict, 'stale')
    checks.push('native-policy-denied', 'denied-call-produced-no-side-effect', 'old-success-cannot-hide-new-failure')

    evidence.setBusinessStage('background-wait')
    const listed = await call('missher_project_ops_task_list', {})
    const long = listed.tasks.find(task => task.name === 'long')
    const running = await call('missher_project_ops_task_run', {
      taskId: long.id, manifestDigest: long.manifestDigest, mode: 'auto', waitMs: 1,
    })
    assert.equal(running.receipt.outcome, 'running')
    outstanding.add(running.receipt.jobId)
    const pidFile = join(config.workspace, 'packages/app/.output/pid')
    const deadline = Date.now() + 10000
    while (!existsSync(pidFile) && Date.now() < deadline) await delay(25, undefined, { signal })
    evidence.record('background-readiness', { pidFile, exists: existsSync(pidFile) })
    assert(existsSync(pidFile), 'background producer never became ready')
    const pid = Number(readFileSync(pidFile, 'utf8'))
    evidence.record('background-pid', { pid })
    assert(Number.isInteger(pid) && pid > 0)
    assert.equal((await result('job_kill', { job_id: running.receipt.jobId }, stranger)).isError, true)
    await call('job_kill', { job_id: running.receipt.jobId })
    const receipt = running.receipt
    const collected = await call('missher_project_ops_task_collect', {
      taskId: receipt.taskId, manifestDigest: receipt.manifestDigest, jobId: receipt.jobId,
      nestedCallId: receipt.nestedCallId, startedAt: receipt.startedAt, waitMs: 10000,
    })
    assert.equal(collected.receipt.outcome, 'aborted')
    const heartbeat = join(config.workspace, 'packages/app/.output/heartbeat')
    const settledHeartbeat = existsSync(heartbeat) ? readFileSync(heartbeat, 'utf8') : 'absent'
    await delay(300, undefined, { signal })
    assert.equal(existsSync(heartbeat) ? readFileSync(heartbeat, 'utf8') : 'absent', settledHeartbeat)
    evidence.record('cancelled-producer-heartbeat', { stoppedAcrossMs: 300, namespacePid: pid, hostPidProbe: 'not-applicable: sandbox PID namespaces' })
    outstanding.delete(receipt.jobId)
    checks.push('background-wait', 'foreign-owner-denied', 'native-cancel-settled-and-heartbeat-stopped')

    evidence.setBusinessStage('foreground-promotion-retains-native-job')
    let timeoutResult
    afterNative = value => { timeoutResult = value }
    // Explicit foreground: promotion must come from the Host's own foreground
    // timeout, not from the background-first `auto` path.
    const timeoutRequest = { taskId: long.id, manifestDigest: long.manifestDigest, mode: 'foreground' }
    const timed = await call('missher_project_ops_task_run', timeoutRequest)
    afterNative = () => {}
    assert.equal(timeoutResult.kind, 'promoted')
    assert.equal(timed.receipt.outcome, 'running')
    assert.equal(timed.receipt.executionMode, 'background')
    outstanding.add(timed.receipt.jobId)
    await call('job_kill', { job_id: timed.receipt.jobId })
    const promoted = timed.receipt
    const stopped = await call('missher_project_ops_task_collect', { taskId: promoted.taskId, manifestDigest: promoted.manifestDigest, jobId: promoted.jobId, nestedCallId: promoted.nestedCallId, startedAt: promoted.startedAt, waitMs: 10000 })
    assert.equal(stopped.receipt.outcome, 'aborted')
    outstanding.delete(promoted.jobId)
    checks.push('foreground-promotion-retains-native-job', 'promoted-job-cancelled')
    // Two independent invalidations, each with its OWN fresh baseline. Sharing
    // one baseline would make the second assertion true for the first reason
    // already, which is a false positive rather than coverage.
    /**
     * Run one planned task and settle it to a terminal receipt (auto may promote).
     * The task is mandatory: falling back to an earlier plan's task would let a
     * disappeared task keep producing receipts against a plan nobody re-read.
     */
    const runToTerminal = async target => {
      const dispatched = await call('missher_project_ops_task_run', { taskId: target.id, manifestDigest: target.manifestDigest })
      if (dispatched.receipt.outcome !== 'running') return dispatched.receipt
      const job = dispatched.receipt
      outstanding.add(job.jobId)
      const settled = (await call('missher_project_ops_task_collect', { taskId: job.taskId, manifestDigest: job.manifestDigest,
        jobId: job.jobId, nestedCallId: job.nestedCallId, startedAt: job.startedAt, waitMs: 10000 })).receipt
      outstanding.delete(job.jobId)
      return settled
    }

    // (1) source invalidation: a fresh receipt and a passed gate, then one edit.
    // The plan is re-read here: writing PLAN/READY already changed the source
    // tree, so the first plan's digest would fail the baseline gate for a reason
    // that has nothing to do with the edit under test.
    evidence.setBusinessStage('source-change-baseline')
    const sourcePlan = await call('missher_project_ops_task_plan', planArgs)
    const sourceTask = sourcePlan.tasks.find(row => row.id === task.id)
    assert(sourceTask !== undefined, 'the verify task is missing from the re-read plan before the source-change baseline')
    const sourceReceipt = await runToTerminal(sourceTask)
    assert.equal(sourceReceipt.outcome, 'succeeded')
    const sourceGateArgs = { ...planArgs, planDigest: sourcePlan.planDigest, receipts: [sourceReceipt] }
    assert.equal((await call('missher_project_ops_verification_gate', sourceGateArgs)).verdict, 'passed')
    checks.push('fresh-receipt-passes-before-source-change')
    writeFileSync(join(config.workspace, 'packages/app/input.js'), 'export const changed = true\n')
    const sourceStale = await call('missher_project_ops_verification_gate', sourceGateArgs)
    assert.equal(sourceStale.verdict, 'stale')
    assert(sourceStale.reasonCodes.includes('plan-digest-mismatch'))
    checks.push('source-edit-invalidates-receipt')

    // (2) configuration invalidation: restore the source, re-plan and re-run to a
    // new fresh receipt first — the previous one is already stale by now.
    writeFileSync(join(config.workspace, 'packages/app/input.js'), 'export const changed = false\n')
    evidence.setBusinessStage('config-change-baseline')
    const replanned = await call('missher_project_ops_task_plan', planArgs)
    const replannedTask = replanned.tasks.find(row => row.id === task.id)
    assert(replannedTask !== undefined, 'the verify task is missing from the re-read plan before the config-change baseline')
    const configReceipt = await runToTerminal(replannedTask)
    assert.equal(configReceipt.outcome, 'succeeded')
    const configGateArgs = { ...planArgs, planDigest: replanned.planDigest, receipts: [configReceipt] }
    assert.equal((await call('missher_project_ops_verification_gate', configGateArgs)).verdict, 'passed')
    checks.push('fresh-receipt-passes-before-config-change')
    // The configuration file the snapshot covers (`.npmrc`), not the task's own
    // manifest: the receipt must go stale because the authorized input tree it
    // was produced against changed.
    writeFileSync(join(config.workspace, '.npmrc'), 'ignore-scripts=true\n')
    const configStale = await call('missher_project_ops_verification_gate', configGateArgs)
    assert.equal(configStale.verdict, 'stale')
    assert(configStale.reasonCodes.includes('execution-evidence-stale'))
    checks.push('config-snapshot-invalidates-a-fresh-receipt')

    probeReport = { passed: true, phase: 'installed', tools: names, guidance: true, checks,
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      timeout: { requestedMode: timeoutRequest.mode, kind: timeoutResult.kind, receiptOutcome: timed.receipt.outcome },
      modelProjection: { contexts: forwarded.additionalContexts.map(row => ({ role: row.role, source: row.source, content: row.content })),
        concludesTurn: forwarded.concludesTurn, outcome: forwardedOutcome },
      startupDiagnostic: startupDiag ?? null }
  } catch (error) {
    // Freeze first: cleanup runs in `finally` and may produce activity of its
    // own, and an expected deny/rejection earlier in the run must not be read as
    // this failure's context.
    const frozen = evidence.freezeBusinessFailure(error)
    failure = error
    // One diagnostic, only for the first Windows task_run failure. It carries its
    // own try/catch, so it cannot replace the business error or change the exit.
    if (frozen !== null && frozen.stage === 'declared-workspace-execution'
      && frozen.tool !== null && frozen.tool.tool === 'missher_project_ops_task_run') {
      try {
        startupDiag = await runStartupDiagnostic()
      } catch (diagnosticError) {
        startupDiag = { protocol: 1, phase: 'declared-workspace-execution', tool: 'missher_project_ops_task_run',
          result: 'diagnostic-failed', attempted: true, platform: process.platform === 'win32' ? 'win32' : null,
          workdirClass: null, data: null, job: null,
          notes: [probeString(diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError), 240) ?? 'diagnostic failed'] }
      }
      evidence.noteStartupDiagnostic(startupDiag)
    }
    evidence.recordError('check-error', error)
  } finally {
    // Each step is guarded by the shared helper: every one runs, the business
    // exception is preserved, and cleanup failures are recorded beside it.
    await runGuardedCleanup([
      ['remove native observer', () => { removeNativeObserver() }],
      ...[...outstanding].flatMap(id => [
        [`kill job ${id}`, () => { ctx.jobs.kill(id, owner.session.id) }],
        [`wait job ${id}`, () => ctx.jobs.wait(id, 10000, owner.session.id)],
      ]),
      ...handles.slice().reverse().map(handle => ['dispose agent handle', () => handle.dispose()]),
    ], (label, error) => evidence.noteCleanupError(label, error))
    if (failure === undefined && evidence.cleanupErrors.length > 0) {
      evidence.recordError('cleanup-error', new Error(evidence.cleanupErrors.join('; ')))
    }
  }
  // One settle point: a success that leaves cleanup failures behind is not a pass.
  return settleRun(probeReport, failure, evidence.cleanupErrors)
}
