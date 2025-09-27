/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { loadWorkspaceFromJson, getWorkspace, exportWorkspaceJson } from '@/lib/workspace-export'
// Inline the literal block definitions in the prompt to provide concrete context
// Vite will import this file content as a string
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import flipperBlocksSource from '@/blockly/flipper_blocks.ts?raw'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Try to introspect the current toolbox (categories and block types) without hardcoding
function useToolboxSummary() {
  const [summary, setSummary] = useState<string>('')
  const [jsonSnapshot, setJsonSnapshot] = useState<string>('')
  const [workspaceSnapshot, setWorkspaceSnapshot] = useState<string>('')
  // JSON string of dropdown & checkbox metadata for blocks currently in the toolbox
  const [fieldOptions, setFieldOptions] = useState<string>('')

  useEffect(() => {
    let disposed = false
    let wsRef: any = null
    let changeListener: any = null
    let debounceTimer: any = null

    const computeToolbox = (ws: any) => {
      try {
        const tb = ws?.getToolbox?.()
        if (!tb?.getToolboxItems) {
          setSummary('')
          setJsonSnapshot('')
          setFieldOptions('')
          return
        }
        const items = tb.getToolboxItems() as any[]
        const lines: string[] = []
        const categories: Array<{ name: string; blocks: string[] }> = []
        const allBlockTypes = new Set<string>()
        for (const it of items) {
          // Category-like item
          const name = it?.name?.[0]?.text || it?.getName?.() || it?.name || ''
          const contents: any[] = typeof it?.getContents === 'function' ? it.getContents() : (it?.contents || [])
          if (Array.isArray(contents) && name) {
            const blockTypes: string[] = []
            for (const c of contents) {
              let t: any = undefined
              try {
                if (typeof c?.type === 'string') t = c.type
                else if (typeof c?.block?.type === 'string') t = c.block.type
                else if (typeof c?.getBlockType === 'function') t = c.getBlockType()
                else if (typeof c?.getType === 'function') t = c.getType()
                else if (typeof c?.json?.type === 'string') t = c.json.type
              } catch { /* ignore */ }
              if (typeof t === 'string') blockTypes.push(t)
            }
            const unique = Array.from(new Set(blockTypes))
            unique.forEach(b => allBlockTypes.add(b))
            const preview = unique.slice(0, 20)
            lines.push(`- ${String(name)}: ${preview.join(', ')}${unique.length > preview.length ? `, … (+${unique.length - preview.length} more)` : ''}`)
            categories.push({ name: String(name), blocks: unique })
          }
        }

        // Fallback: Blockly often provides a dynamic Variables category that may not enumerate via getContents()
        // If we did not capture any explicit variable blocks, probe the global Blockly registry for known variable block types.
        try {
          const hasVariablesAlready = categories.some(c => /variable/i.test(c.name))
          const globalBlockly: any = (globalThis as any).Blockly
          if (!hasVariablesAlready && globalBlockly?.Blocks) {
            const candidateVarBlocks = [
              'variables_get',
              'variables_set',
              'math_change', // common companion for variable use
            ]
            const available = candidateVarBlocks.filter(b => typeof globalBlockly.Blocks[b] !== 'undefined')
            // Heuristic: also check if workspace variable map allows creation (indicates variable support is enabled)
            const canUseVariables = available.length > 0 || (typeof ws?.getVariableMap === 'function' && ws.getVariableMap()?.getAllVariables()?.length >= 0)
            if (canUseVariables && available.length > 0) {
              categories.push({ name: 'Variables', blocks: available })
              lines.push(`- Variables: ${available.join(', ')}`)
            }
          }
        } catch { /* ignore variable probing errors */ }

        setSummary(lines.join('\n'))
        try { setJsonSnapshot(JSON.stringify({ categories }, null, 2)) } catch { setJsonSnapshot('') }

        // Introspect dropdown / checkbox field options by temporarily instantiating each block type.
        try {
          const optionMap: Record<string, { dropdowns?: Record<string, Array<{ label: string; value: string }>>; checkboxes?: string[] }> = {}
          const globalBlockly: any = (globalThis as any).Blockly
          if (globalBlockly && ws && allBlockTypes.size) {
            allBlockTypes.forEach(type => {
              try {
                const block = ws.newBlock(type)
                if (!block) return
                const dropdowns: Record<string, Array<{ label: string; value: string }>> = {}
                const checkboxes: string[] = []
                for (const input of (block.inputList || [])) {
                  for (const field of (input.fieldRow || [])) {
                    if (!field) continue
                    const name = (field as any).name
                    if (!name) continue
                    if (typeof (field as any).getOptions === 'function') {
                      try {
                        const optsRaw = (field as any).getOptions() || []
                        const opts = optsRaw.map((o: any) => ({ label: String(o[0]), value: String(o[1]) }))
                        if (opts.length) dropdowns[name] = opts
                      } catch { /* ignore */ }
                    }
                    // Checkbox detection
                    const ctorName = field.constructor?.name
                    if (ctorName === 'FieldCheckbox' || (field as any).CHECKBOX || ((field as any).value_ === 'TRUE' || (field as any).value_ === 'FALSE')) {
                      checkboxes.push(name)
                    }
                  }
                }
                if (Object.keys(dropdowns).length || checkboxes.length) {
                  optionMap[type] = {}
                  if (Object.keys(dropdowns).length) optionMap[type].dropdowns = dropdowns
                  if (checkboxes.length) optionMap[type].checkboxes = Array.from(new Set(checkboxes))
                }
                block.dispose()
              } catch { /* ignore block instantiation issues */ }
            })
          }
          if (Object.keys(optionMap).length) setFieldOptions(JSON.stringify(optionMap, null, 2))
          else setFieldOptions('')
        } catch { setFieldOptions('') }
      } catch {
        setSummary('')
        setJsonSnapshot('')
        setFieldOptions('')
      }
    }

    const isMeaningful = (state: any) => {
      if (!state || typeof state !== 'object') return false
      const b = state.blocks
      if (b && Array.isArray(b.blocks) && b.blocks.length > 0) return true
      // Treat variables-only state as meaningful so variable map is preserved
      if (Array.isArray(state.variables) && state.variables.length > 0) return true
      return false
    }

    const refreshSnapshots = (ws: any) => {
      try {
        const json = exportWorkspaceJson()
        try {
          const parsed = JSON.parse(json)
          setWorkspaceSnapshot(isMeaningful(parsed) ? json : '')
        } catch {
          setWorkspaceSnapshot('')
        }
      } catch {
        setWorkspaceSnapshot('')
      }
      computeToolbox(ws)
    }

    const attach = (ws: any) => {
      if (disposed || !ws) return
      wsRef = ws
      refreshSnapshots(ws)
      // Listen for any workspace changes and debounce snapshot updates
      changeListener = () => {
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => refreshSnapshots(ws), 150)
      }
      try { ws.addChangeListener(changeListener) } catch { /* ignore */ }
    }

    // Poll until the workspace is ready (toolbox and blocks loaded)
    const start = Date.now()
    const immediate = getWorkspace() as any
    if (immediate) attach(immediate)
    const poll = setInterval(() => {
      const ws = getWorkspace() as any
      if (ws) {
        clearInterval(poll)
        attach(ws)
      } else if (Date.now() - start > 10000) {
        clearInterval(poll)
      }
    }, 250)

    // Secondary delayed probe to catch late-loaded toolbox categories (e.g., dynamic variables)
    const lateProbe = setTimeout(() => {
      try {
        const ws = getWorkspace() as any
        if (ws) refreshSnapshots(ws)
      } catch { /* ignore */ }
    }, 1500)

    return () => {
      disposed = true
      clearInterval(poll)
      clearTimeout(lateProbe)
      if (debounceTimer) clearTimeout(debounceTimer)
      try { if (wsRef && changeListener) wsRef.removeChangeListener(changeListener) } catch { /* ignore */ }
    }
  }, [])

  return { summary, jsonSnapshot, workspaceSnapshot, fieldOptions }
}

// outputStyle:
//  'raw'    -> prefer strict raw JSON (legacy behavior)
//  'fenced' -> require fenced ```json block (raw only if impossible)
//  'auto'   -> prefer fenced/artifact if supported, raw acceptable fallback
function buildPrompt(
  toolboxSummary: string,
  toolboxJson: string,
  userRequest: string,
  workspaceJson: string,
  fieldOptions: string,
  outputStyle: 'auto' | 'fenced' | 'raw'
) {
  const parts: string[] = []
  parts.push('You are an expert assistant that designs and modifies Blockly workspaces for Kiisu Blocks (a Flipper Zero development environment).')
  if (outputStyle === 'fenced') {
    parts.push('Your primary goal is to output exactly ONE valid Blockly serialization JSON object wrapped in a single ```json fenced code block. Provide no text before or after the fence. Raw fallback only if fences are strictly unsupported.')
  } else if (outputStyle === 'auto') {
    parts.push('Your primary goal is to output exactly ONE valid Blockly serialization JSON object. If the platform supports code fences or artifacts, PREFER wrapping it in a single ```json fenced block (or structured artifact). Raw JSON is an acceptable fallback. No extraneous commentary.')
  } else {
    parts.push('Your primary goal is to output ONLY a valid Blockly serialization JSON that can be imported directly. Preferred: single raw JSON object. Optionally you may wrap it in a single ```json fenced block if the chat platform benefits from a copy button. No extra commentary before or after.')
  }

  // Critical output contract placed early to reduce model drift
  parts.push('OUTPUT CONTRACT (CRITICAL)')
  parts.push([
    outputStyle === 'fenced'
      ? 'Return exactly one valid JSON object wrapped in a single ```json fenced code block. No prose before or after. Raw ONLY if fenced impossible.'
      : outputStyle === 'auto'
        ? 'Return exactly one valid JSON object. Prefer a ```json fenced block (or artifact) for copy convenience; raw JSON acceptable fallback. No prose outside.'
        : 'Return exactly one valid JSON object. Raw is preferred; a single ```json fenced block is also acceptable. No prose outside the JSON.',
    'Strict JSON only: no comments, no trailing commas.',
    'Top-level keys: always "blocks"; include a "variables" array whenever you use any variable blocks (variables_set / variables_get / math_change) OR when the user request implies state (counter, score, value to track).',
    'If an existing workspace snapshot is provided below and it contains additional top-level keys beyond these, preserve them unchanged unless the user explicitly asks to modify or remove them.',
    'Exactly two root blocks (with x,y): one flipper_app and one flipper_manifest. All other blocks MUST be reachable under flipper_app via its statement inputs (SETUP, DRAW, INPUT, LOOP) and chained next links. flipper_manifest is unattached.',
    'Assign x,y ONLY to the two root blocks.',
    'All checkbox-like fields (e.g., XOR, STRIP) MUST be uppercase string values "TRUE" or "FALSE".',
    'Only use block types present in the toolbox snapshot. Never invent block types or field names.',
    'Fallbacks: Approximate unsupported requests using existing blocks and optional flipper_log messages. Never explain outside JSON.',
    'Variables: When you use variables, define them once in the top-level variables array with objects { "id": "var_id", "name": "human_name", "type": "" }. Reference them in variable blocks via the VAR field using the variable id. Prefer concise names (e.g., count, temp, state).',
    'IDs optional; if present they must be unique, short, stable (kebab or snake case).'
  ].join('\n'))

  parts.push('SCHEMA EXAMPLES (Illustrative)')
  parts.push([
    'Statement input example: { "type": "flipper_app", "x": 40, "y": 40, "inputs": { "SETUP": { "block": { "type": "flipper_viewport_setup" } } } }',
    'Value input example: { "type": "flipper_canvas_draw_text", "inputs": { "X": { "block": { "type": "math_number", "fields": { "NUM": 10 } } }, "Y": { "block": { "type": "math_number", "fields": { "NUM": 20 } } }, "TEXT": { "block": { "type": "text", "fields": { "TEXT": "Hello" } } } }, "fields": { "XOR": "FALSE" } }',
    'Chaining (next) example: { "type": "flipper_canvas_clear", "next": { "block": { "type": "flipper_request_redraw" } } }'
  ].join('\n'))

  parts.push('## Constraints & Rules')
  if (outputStyle === 'fenced') {
    parts.push('- **JSON Output Only**: One JSON object inside a single ```json fenced code block (required). No surrounding prose.')
  } else if (outputStyle === 'auto') {
    parts.push('- **JSON Output Only**: One JSON object. Prefer a single ```json fenced block; raw fallback allowed.')
  } else {
    parts.push('- **JSON Output Only**: Single raw JSON object suitable for `JSON.parse()`. No code fences or extra text.')
  }
  parts.push(
    '- **Use Existing Blocks**: Only use block types available in the provided toolbox. Do not invent blocks. If a capability is missing, use the closest available blocks.'
  )
  parts.push('- **Dropdown & Checkbox Values**: Only use enumerated dropdown internal values and checkbox names from the Field Options Reference. Use "TRUE"/"FALSE" strings for checkbox fields.')
  parts.push(
    '- **Valid Structure**: The output must be a valid Blockly Serialization object with a top-level `blocks` object containing a `blocks` array. It may also have a `variables` array.'
  )
  parts.push('- **Sensible Workspace**: Ensure the workspace can run. Include required entry/setup blocks (`flipper_app`, `flipper_manifest`) and position them at reasonable (x,y) coordinates.')
  parts.push('- **No Unapproved Blocks**: If you think a block exists but it is not listed in the toolbox snapshot, DO NOT use it.')
  parts.push('- **Degrade Gracefully**: If the user asks for something not possible with existing blocks, still return a valid workspace and approximate the intent using available blocks (e.g., log a message with `flipper_log`).')

  // Additional clarifications (Tasks 2-6)
  parts.push('### Variable & ID Guidance')
  parts.push('- If the task benefits from storing or updating a value (e.g., counters, sensor readings, status strings), introduce a variable even if the user did not explicitly say "variable".')
  parts.push('- Top-level `variables` array example:')
  parts.push('Example (do not include comments):')
  parts.push('{"variables":[{"id":"var_counter","name":"counter","type":""}],"blocks":{"blocks":[{"type":"flipper_app","x":40,"y":40},{"type":"flipper_manifest","x":260,"y":40}]}}')
  parts.push('- variables_set block example fragment (inside blocks array somewhere): { "type": "variables_set", "fields": { "VAR": { "id": "var_counter" } }, "inputs": { "VALUE": { "block": { "type": "math_number", "fields": { "NUM": 0 } } } } }')
  parts.push('- variables_get block example fragment: { "type": "variables_get", "fields": { "VAR": { "id": "var_counter" } } }')
  parts.push('- math_change referencing same variable: { "type": "math_change", "fields": { "VAR": { "id": "var_counter" } }, "inputs": { "DELTA": { "block": { "type": "math_number", "fields": { "NUM": 1 } } } } }')
  parts.push('- Preserve existing variable ids if modifying an existing workspace; add new variables with distinct ids (e.g., var_temp, var_state).')
  parts.push('- Block `id` fields are optional. If you include them, use short stable lowercase kebab or snake tokens (e.g., `app_root`, `manifest1`). Never duplicate an id.')

  parts.push('### Coordinate Guidelines')
  parts.push('- Use non-negative integer `x`/`y` positions. Space top-level blocks horizontally by ~200px to avoid overlap. Place flipper_app before flipper_manifest in the blocks array when possible.')
  parts.push('- Recommended: `flipper_app` at (40, 40), `flipper_manifest` at (260, 40) or further right.')

  parts.push('### Field Typing & Formatting')
  parts.push('- Numeric fields must be emitted as numbers (no quotes). Boolean checkbox fields use "TRUE" / "FALSE" (strings) only if the block definition expects string form; otherwise use boolean if already present in example blocks. (In these blocks they are strings).')
  parts.push('- Omit empty inputs entirely rather than providing null/empty objects.')
  parts.push('- Only include `fields` actually settable on the block; do not invent field names.')

  parts.push('### Manifest Field Constraints')
  parts.push('- APPID: lowercase letters, digits, underscores only; start with a letter. Suggested regex: `^[a-z][a-z0-9_]*$`.')
  parts.push('- NAME: short human-readable (max ~24 chars recommended).')
  parts.push('- APPTYPE: one of `FlipperAppType.EXTERNAL`, `FlipperAppType.APP`, `FlipperAppType.PLUGIN` (exact).')
  parts.push('- ICON: may be an empty string if none.')
  parts.push('- CATEGORY: single word or short phrase (e.g., General, Tools, Sensors).')
  parts.push('- AUTHOR: free text (keep short).')
  parts.push('- VERSION: semantic version string `MAJOR.MINOR.PATCH`.')
  parts.push('- STACK: number 512–32768 (multiple of 256). Use 4096 if unsure.')
  parts.push('- DESCRIPTION: brief sentence (<= 80 chars preferred).')

  // Mandatory structure that our environment expects
  parts.push('## Required Kiisu Blocks Structure')
  parts.push('- **`flipper_app` Block**: Every application must have exactly one `flipper_app` block as the root entry point, placed at sensible coordinates (e.g., x:40, y:40).')
  parts.push('- The `flipper_app` block defines four statement inputs: `SETUP` (runs once), `DRAW` (GUI callback), `INPUT` (key events), `LOOP` (repeats). Place your program\'s starting statements inside SETUP and relevant render/input blocks in DRAW/INPUT.')
  parts.push('- **`flipper_manifest` Block**: Include exactly one `flipper_manifest` block somewhere in the workspace (it is not connected). This is mandatory to build the app. Its fields include: APPID, NAME, APPTYPE (FlipperAppType.EXTERNAL | APP | PLUGIN), ICON (optional), CATEGORY, AUTHOR, VERSION, STACK (bytes), DESCRIPTION.')

  // Include literal source snippets of the key blocks to avoid ambiguity
  try {
    const extract = (name: string) => {
      const marker = `Blockly.Blocks["${name}"] = {`
      const i = flipperBlocksSource.indexOf(marker)
      if (i === -1) return ''
      const j = flipperBlocksSource.indexOf('\n};', i)
      if (j === -1) return flipperBlocksSource.slice(i)
      return flipperBlocksSource.slice(i, j + 3)
    }
    const appSrc = extract('flipper_app')
    const manifestSrc = extract('flipper_manifest')
    if (appSrc || manifestSrc) {
      parts.push('### Key Block Definitions (Source Code)')
      if (appSrc) {
        parts.push('**flipper_app block definition:**\n```javascript\n' + appSrc + '\n```')
      }
      if (manifestSrc) {
        parts.push('**flipper_manifest block definition:**\n```javascript\n' + manifestSrc + '\n```')
      }
    }
  } catch { /* ignore */ }

  // Brief serialization rules and a tiny skeleton to reduce malformed outputs
  parts.push('### Serialization Rules & Example')
  parts.push('- The root JSON object may include "variables" (array) and must include "blocks" with a "blocks" array of block nodes.')
  parts.push('- A block node has: `type`, optional `id`, `x`, `y`, optional `fields` (map), optional `inputs` (map of NAME->{ block }), and optional `next`->{ block }.')
  parts.push('- This is a structural example. Your final JSON will have different blocks and fields based on the user request:')
  parts.push(
    '```json\n' + JSON.stringify({
      blocks: {
        blocks: [
          {
            type: 'flipper_app',
            x: 40,
            y: 40
          },
          {
            type: 'flipper_manifest',
            x: 260,
            y: 40,
            fields: {
              APPID: 'my_app',
              NAME: 'My App',
              APPTYPE: 'FlipperAppType.EXTERNAL',
              ICON: '',
              CATEGORY: 'General',
              AUTHOR: 'Unknown',
              VERSION: '0.1.0',
              STACK: 4096,
              DESCRIPTION: 'Generated by Kiisu Blocks'
            }
          }
        ]
      }
    }, null, 2) + '\n```'
  )

  // Block reference (auto-maintained snippet – manually curated)
  parts.push('### Block Reference (Custom Kiisu Blocks Summary)')
  // Field options (dropdowns & checkboxes) reference
  if (fieldOptions) {
    parts.push('### Field Options Reference')
    parts.push('Use the following dropdown internal values (value) for each field; labels are for human display only. Checkbox fields listed should be set to "TRUE" or "FALSE".')
    parts.push('```json\n' + fieldOptions + '\n```')
  }

  parts.push('- flipper_app: statement inputs SETUP, DRAW, INPUT, LOOP.')
  parts.push('- flipper_manifest: fields APPID, NAME, APPTYPE, ICON, CATEGORY, AUTHOR, VERSION, STACK, DESCRIPTION; standalone (no prev/next).')
  parts.push('- flipper_viewport_setup: fields LAYER; statement (prev/next).')
  parts.push('- flipper_canvas_clear: statement.')
  parts.push('- flipper_canvas_set_font: field FONT.')
  parts.push('- flipper_canvas_set_color: field COLOR.')
  parts.push('- flipper_canvas_draw_text: value inputs X,Y,TEXT; field XOR (checkbox string TRUE/FALSE).')
  parts.push('- flipper_canvas_draw_text_aligned: value inputs X,Y,TEXT; fields HALIGN, VALIGN, XOR.')
  parts.push('- flipper_canvas_draw_box: numeric value inputs per geometry; field XOR.')
  parts.push('- flipper_canvas_draw_frame: numeric value inputs per geometry; field XOR.')
  parts.push('- flipper_canvas_draw_rbox: numeric value inputs per geometry; field XOR.')
  parts.push('- flipper_canvas_draw_rframe: numeric value inputs per geometry; field XOR.')
  parts.push('- flipper_canvas_draw_line: numeric value inputs per geometry; field XOR.')
  parts.push('- flipper_canvas_draw_circle: numeric value inputs per geometry; field XOR.')
  parts.push('- flipper_canvas_draw_disc: numeric value inputs per geometry; field XOR.')
  parts.push('- flipper_canvas_draw_dot: value inputs X,Y; field XOR.')
  parts.push('- flipper_canvas_width / flipper_canvas_height: outputs Number, no inputs.')
  parts.push('- flipper_widget_text_box: value inputs X,Y,W,H,TEXT; fields HALIGN, VALIGN, STRIP (checkbox).')
  parts.push('- flipper_widget_text_scroll: value inputs X,Y,W,H,TEXT.')
  parts.push('- flipper_widget_button: field BTN; value input LABEL.')
  parts.push('- flipper_request_redraw: statement.')
  parts.push('- flipper_input_exit_on_back_short: statement.')
  parts.push('- flipper_input_if_key_type: fields TYPE, KEY; statement input DO.')
  parts.push('- flipper_notify_sequence: field SEQ.')
  parts.push('- flipper_sleep_ms: value input MS.')
  parts.push('- flipper_log: fields LEVEL; value inputs TAG, MSG.')
  parts.push('- flipper_string_to_number: value STRING -> output Number.')
  parts.push('- flipper_number_to_string: value NUMBER -> output String.')
  parts.push('- flipper_string_length: value STRING -> output Number.')
  parts.push('- flipper_random_number: value MIN, MAX -> output Number.')
  parts.push('- flipper_storage_read: value PATH -> output String.')
  parts.push('- flipper_storage_write: value PATH, DATA; statement.')
  parts.push('- flipper_storage_exists: value PATH -> output Boolean.')
  parts.push('- flipper_storage_create / flipper_storage_delete: value PATH; statement.')
  parts.push('- flipper_gpio_init: fields PIN, MODE, PULL; statement.')
  parts.push('- flipper_gpio_write: fields PIN, STATE; statement.')
  parts.push('- flipper_gpio_read: field PIN -> output Number.')
  parts.push('- flipper_gpio_analog_read: fields PIN, MODE -> output Number.')
  parts.push('- flipper_pwm_start/set: field PIN; value inputs FREQ, DUTY; statement.')
  parts.push('- flipper_pwm_stop: field PIN; statement.')
  parts.push('- flipper_pwm_read: fields PIN, WHAT -> output Number.')
  parts.push('- flipper_servo_180: field PIN; value input ANGLE; statement.')
  parts.push('- flipper_servo_unlock: field PIN; statement.')
  parts.push('- flipper_potentiometer_read: fields PIN, R_VALUE (number), R_UNIT, MODE -> output Number.')
  parts.push('- flipper_ultrasonic_distance_cm: fields TRIG_PIN, ECHO_PIN -> output Number.')
  parts.push('- flipper_pir_motion: field PIN -> output Boolean.')
  parts.push('- flipper_dht11_temp_c / flipper_dht11_humidity_percent: field PIN -> output Number.')
  parts.push('- flipper_timer_periodic: field INTERVAL; statement input DO.')
  parts.push('- flipper_bitwise_and/or/xor: value A,B -> output Number.')
  parts.push('- flipper_bitwise_not: value A -> output Number.')

  // Execution semantics & best practices
  parts.push('### Execution Semantics & Best Practices')
  parts.push('- SETUP: one-time initialization (viewport setup, initial logs, file reads). Avoid long blocking sleeps here (keep <500ms).')
  parts.push('- DRAW: Only perform rendering + lightweight calculations. Do not perform storage I/O or long sleeps. If state changes require another frame, include a `request redraw` at end (or rely on timer/input events).')
  parts.push('- INPUT: Use `flipper_input_if_key_type` to branch on specific key events. For Back Short exit behavior add `exit on Back Short`.')
  parts.push('- LOOP: Use for periodic logic that is not timer-based. Keep iterations fast; use `sleep ms` for pacing if needed.')
  parts.push('- Timers: Prefer `flipper_timer_periodic` inside SETUP to schedule recurring updates instead of busy loops.')
  parts.push('- Redraw Strategy: After mutating any state that affects DISPLAY output (e.g., updated text), call `request redraw` once. Avoid spamming multiple redraw blocks in sequence.')
  parts.push('- Avoid Orphans: Besides the required standalone `flipper_manifest`, all other blocks should ultimately be reachable via a statement chain beneath `flipper_app`.')
  parts.push('- Storage: Read configuration in SETUP. Avoid writes inside DRAW/INPUT unless user-triggered (e.g., a button press).')
  parts.push('- Random: Seed not exposed; repeated runs may produce different values. If determinism requested but unavailable, document via log block.')

  parts.push('### Fallback & Approximation Rules')
  parts.push('- If an unsupported feature is requested (e.g., networking), approximate with logs or comments embedded as log messages.')
  parts.push('- Never output an error message instead of a workspace unless the user request is literally empty; in that case produce a "Hello World" text draw.')

  parts.push('### Structural Constraints Recap')
  parts.push('- Top-level JSON keys: always `blocks`; include `variables` whenever you introduce or use variables (even if not previously present). Preserve any existing unknown top-level keys from an input workspace JSON unchanged.')
  parts.push('- Each block object: keys among `type`, `id`, `x`, `y`, `fields`, `inputs`, `next`. Do NOT add other keys.')
  parts.push('- Exactly two root blocks (have x,y): one `flipper_app` and one `flipper_manifest`. All other blocks reachable from `flipper_app`.')
  parts.push('- Checkbox fields: emit "TRUE" or "FALSE" exactly (uppercase strings).')
  parts.push('- Omit empty `fields` or `inputs` maps.')

  parts.push('### Invalid Output Examples (Do NOT Do These)')
  parts.push('- Adding commentary outside JSON.')
  parts.push('- Inventing block type like `flipper_network_request`.')
  parts.push('- Using unknown field names (e.g., `COLOR_MODE` on a text block).')
  parts.push('- Returning an array at the top level instead of an object.')

  // Hardware reference section (added per user request)
  parts.push('### Hardware Reference (GPIO / Peripheral Capabilities)')
  parts.push('The target environment exposes a header with numbered pins referencing MCU ports (e.g., PA7). Logic level is 3.3V. Assume max source/sink ~8mA per pin (absolute max ~20mA) and keep total current modest (<100mA) to avoid brownouts. Always power higher‑draw peripherals (servos, motors) from an external supply sharing GND.')
  parts.push('General Rules:')
  parts.push('- Digital HIGH ≈ 3.3V. Avoid feeding >3.6V into any GPIO. If a sensor is 5V logic, level shift or ensure its output is 3.3V tolerant.')
  parts.push('- Ultrasonic HC-SR04 echo can be 5V: use a divider (e.g., 10k/18k) if not already shifted.')
  parts.push('- Servos draw large peak current; power separately (5V rail) and only route the signal wire to PWM-capable pin (PA7 or PA4).')
  parts.push('- Don\'t block long in DRAW/INPUT; use timer or LOOP with sleep for periodic tasks.')
  parts.push('- Avoid reusing a pin simultaneously for conflicting roles (e.g., PWM and analog read).')
  parts.push('- SWD pins (PA13 SWDIO, PA14 SWCLK) should generally be left unused for user logic unless you are not debugging.')
  parts.push('Pin Capability Summary (primary application‑level uses referenced by blocks):')
  parts.push('* Pin 2 – PA7: Digital I/O, ADC (channel), PWM (TIM1) -> supports `flipper_gpio_*`, `flipper_gpio_analog_read`, `flipper_pwm_*`, `flipper_servo_180`, ultrasonic TRIG/ECHO, sensors (DHT11, PIR, Potentiometer).')
  parts.push('* Pin 3 – PA6: Digital I/O, ADC -> `flipper_gpio_*`, `flipper_gpio_analog_read`, sensors (DHT11, PIR, Potentiometer, ultrasonic). Not PWM in blocks.')
  parts.push('* Pin 4 – PA4: Digital I/O, ADC, PWM (LPTIM2) -> `flipper_gpio_*`, `flipper_gpio_analog_read`, `flipper_pwm_*`, `flipper_servo_180`, sensors.')
  parts.push('* Pin 5 – PB3: Digital I/O (EXTI, timer alt functions possible) -> `flipper_gpio_*`, sensors (DHT11, PIR, ultrasonic). No ADC / PWM via provided blocks.')
  parts.push('* Pin 6 – PB2: Digital I/O -> `flipper_gpio_*`, sensors (DHT11, PIR, ultrasonic). No ADC / PWM.')
  parts.push('* Pin 7 – PC3: Digital I/O, ADC -> `flipper_gpio_*`, `flipper_gpio_analog_read`, sensors (DHT11, PIR, Potentiometer, ultrasonic).')
  parts.push('* Pin 15 – PC1: Digital I/O, ADC, potential I2C SDA role (future) -> `flipper_gpio_*`, `flipper_gpio_analog_read`, sensors.')
  parts.push('* Pin 16 – PC0: Digital I/O, ADC, potential I2C SCL role (future) -> `flipper_gpio_*`, `flipper_gpio_analog_read`, sensors.')
  parts.push('* Pins labeled USART_TX / USART_RX (13 / 14) can be used for ultrasonic TRIG/ECHO in provided block dropdown, but avoid using them for UART simultaneously when repurposed.')
  parts.push('* PA13 (SWDIO), PA14 (SWCLK): Debug only; avoid regular app usage to maintain programming/debug access.')
  parts.push('* 5V / 3.3V / GND rails: Power peripherals. Use 3.3V for logic sensors; 5V only where required (ultrasonic, servo power) with proper level shifting.')
  parts.push('Block ↔ Pin Mapping Quick Reference:')
  parts.push('- Analog read blocks (`flipper_gpio_analog_read`, potentiometer, ADC-based sensors) limited to: PA7, PA6, PA4, PC3, PC1, PC0.')
  parts.push('- PWM / Servo: PA7 (TIM1), PA4 (LPTIM2).')
  parts.push('- Servo angle block internally depends on active PWM; using `servo_unlock` (stop PWM) releases holding torque.')
  parts.push('- DHT11 / PIR / Ultrasonic: any dropdown pin they list (digital), observe sensor timing constraints (DHT11: ≥2s interval).')
  parts.push('- Bitwise/math/utility blocks are pure logic, no hardware constraints.')
  parts.push('Concurrency & Conflicts:')
  parts.push('- If you start PWM on PA7 then attempt analog read on PA7, the reading may be invalid or affect PWM timing—avoid mixing. Use separate pins.')
  parts.push('- Timers (`flipper_timer_periodic`) do not reserve hardware pins; they just schedule logic.')
  parts.push('- Excessive redraw requests (>30Hz) waste CPU; prefer timer intervals ≥50–100ms unless animating minimally.')
  parts.push('Safety Tips:')
  parts.push('- Always common ground when using external power supplies.')
  parts.push('- Debounce or rate-limit sensor polling (esp. DHT11) using timers instead of tight loops.')
  parts.push('- Log meaningful state changes with `flipper_log` for debugging rather than spamming each loop iteration.')

  // DISPLAY / CANVAS CONSTRAINTS (added per user request)
  parts.push('### Display / Canvas Constraints')
  parts.push('The drawing surface is a 128x64 monochrome OLED (0-based pixel coordinates). Valid coordinates: X: 0–127, Y: 0–63.')
  parts.push('- All geometry (text, boxes, lines, circles, widgets) must stay within bounds; clamp or choose values so max X < 128 and max Y < 64.')
  parts.push('- Avoid negative coordinates; do not exceed width/height.')
  parts.push('- When computing centered positions, use (flipper_canvas_width - element_width)/2 and (flipper_canvas_height - element_height)/2 (or integer approximations).')
  parts.push('- Text: if unsure of pixel width, place text with a safe left margin (e.g., X=2) or centered using canvas width with a rough estimated width; never allow starting X < 0 or X + assumed width > 128.')
  parts.push('- For boxes/frames: ensure X+W <= 128 and Y+H <= 64. If user requests something larger, scale down proportionally and log a notice via flipper_log.')
  parts.push('- Circles/discs: ensure X-radius >= 0, X+radius < 128, Y+radius < 64, Y-radius >= 0.')
  parts.push('- Scrolling text widgets: choose dimensions that fit fully inside the display (e.g., X=0,Y=0,W=128,H=16).')
  parts.push('- If the user asks for out-of-range coordinates or sizes, automatically clamp them silently or add a single log explaining the adjustment.')
  parts.push('- Do not place shapes partially off-screen unless the user explicitly requests clipping.')

  // External documentation encouragement (without enabling hallucination)
  parts.push('### External Documentation Guidance')
  parts.push('- When applying logic or naming constraints, align with official Flipper Zero firmware & application guidelines (e.g., manifest field semantics, stack sizing, typical app categories).')
  parts.push('- Follow Blockly core serialization rules: valid JSON object, block nodes with `type`, optional `fields`, `inputs`, `next`, respecting case-sensitive field names.')
  parts.push('- Treat any undocumented feature as unavailable; never invent new block types, manifest fields, or GPIO capabilities beyond those explicitly listed here.')
  parts.push('- If a user request references a concept outside this provided block set (e.g., networking, BLE GATT, file dialogs), approximate with available blocks and a `flipper_log` message indicating the limitation.')
  parts.push('- Prefer conservative, standards-aligned choices (e.g., semantic versioning, reasonable default STACK like 4096, short APPID w/ lowercase and underscores).')
  parts.push('- Variable naming: concise, lower_snake_case. Avoid shadowing or reusing variable IDs. Preserve existing variable IDs exactly when modifying an existing workspace.')
  parts.push('- Assume 128x64 display pixel bounds unless user explicitly overrides with a justified reason; never exceed or rely on undefined scaling.')
  parts.push('- If conflicting instructions appear, prioritize Output Contract > Structural Constraints > Safety (display/hardware bounds) > User convenience logs.')

  parts.push('## Toolbox & Available Blocks')
  if (toolboxSummary) {
    parts.push('### Available Toolbox Categories and Sample Blocks')
    parts.push(toolboxSummary)
    if (toolboxJson) {
      parts.push('### Complete Toolbox Snapshot (JSON)')
      parts.push('```json\n' + toolboxJson + '\n```')
    }
  } else {
    parts.push('- Toolbox details unavailable. Still, only use blocks visible to the user.')
  }

  if (workspaceJson) {
    parts.push('## Current Workspace State')
    parts.push('An existing workspace is loaded. Your task is to modify or extend it based on the user request. The current state is provided below. Your output should be a complete, modified version of this JSON.')
    parts.push('```json\n' + workspaceJson + '\n```')
  } else {
    parts.push('## Current Workspace State')
    parts.push('The workspace is currently empty. You will be creating a new set of blocks from scratch based on the user request.')
  }
  
  parts.push('## User Request')
  parts.push(userRequest.trim() || 'No request provided. Create a simple "Hello World" app.')

  parts.push('## Final Instruction')
  if (outputStyle === 'fenced') {
    parts.push('Generate the complete Blockly JSON and output it wrapped in ONE ```json fenced block with no extra text.')
  } else if (outputStyle === 'auto') {
    parts.push('Generate the complete Blockly JSON. Prefer a single ```json fenced block; raw JSON acceptable if fenced unsupported.')
  } else {
    parts.push('Generate the complete Blockly JSON and output only the raw JSON object (no fences, no extra text).')
  }
  return parts.join('\n\n')
}

const AICodingDialog: React.FC<Props> = ({ open, onOpenChange }) => {
  const { toast } = useToast()
  const { summary: toolboxSummary, jsonSnapshot, workspaceSnapshot, fieldOptions } = useToolboxSummary()
  const [userRequest, setUserRequest] = useState('')
  const [resultJson, setResultJson] = useState('')
  const [copied, setCopied] = useState(false)
  const [importing, setImporting] = useState(false)
  const [step, setStep] = useState(0) // 0: ask, 1: copy, 2: paste/import
  const prompt = useMemo(
    () => buildPrompt(toolboxSummary, jsonSnapshot, userRequest, workspaceSnapshot, fieldOptions, 'auto'),
    [toolboxSummary, jsonSnapshot, userRequest, workspaceSnapshot, fieldOptions]
  )

  useEffect(() => {
    if (!open) {
      setResultJson('')
      setCopied(false)
      setImporting(false)
      setStep(0)
    }
  }, [open])

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      toast({ title: 'Prompt copied' })
    } catch (e) {
      toast({ title: 'Copy failed', description: String(e instanceof Error ? e.message : e) })
    }
  }

  function extractJsonFromText(text: string): string | null {
    const trimmed = text.trim()
    // Collect candidates: fenced blocks first, then any balanced JSON objects, choose the largest valid
    const candidates: string[] = []
    const fenceRegex = /```json\s*([\s\S]*?)\s*```/gi
    let m: RegExpExecArray | null
    while ((m = fenceRegex.exec(trimmed))) {
      if (m[1]) candidates.push(m[1].trim())
    }
    // Whole text as candidate
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) candidates.push(trimmed)
    // Scan for balanced objects (naive but works for single top-level objects)
    for (let idx = 0; idx < trimmed.length; idx++) {
      if (trimmed[idx] !== '{') continue
      let depth = 0
      for (let j = idx; j < trimmed.length; j++) {
        const ch = trimmed[j]
        if (ch === '{') depth++
        else if (ch === '}') {
          depth--
          if (depth === 0) {
            const candidate = trimmed.slice(idx, j + 1)
            candidates.push(candidate)
            break
          }
        }
      }
    }
    // Validate and pick the largest by length
    let best: string | null = null
    for (const c of candidates) {
      try { JSON.parse(c); if (!best || c.length > best.length) best = c } catch { /* ignore */ }
    }
    return best
  }

  const importJson = () => {
    // Final warning is already displayed; proceed with overwrite
    setImporting(true)
    try {
      const payload = extractJsonFromText(resultJson) ?? resultJson
      const res = loadWorkspaceFromJson(payload)
      if (!res.ok) {
        toast({ title: 'Import failed', description: res.error || 'Invalid JSON' })
        setImporting(false)
        return
      }
      toast({ title: res.queued ? 'Workspace queued' : 'Workspace imported', description: res.queued ? 'Editor will load it when ready' : 'Previous workspace overwritten' })
      onOpenChange(false)
    } catch (e) {
      toast({ title: 'Import exception', description: String(e instanceof Error ? e.message : e) })
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>AI Prompt Wizard</DialogTitle>
          <DialogDescription>
            Step {step + 1} of 3 · Quickly generate a prompt for an external AI and import the resulting Blockly JSON.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {step === 0 && (
            <section className="space-y-4">
              <div>
                <h3 className="font-medium mb-2">Describe what you want to build</h3>
                <Textarea
                  placeholder="Example: A simple app that shows a counter, increases on OK long press and exits on Back short..."
                  value={userRequest}
                  onChange={(e) => setUserRequest(e.target.value)}
                  className="min-h-[120px] text-sm"
                />
                <p className="mt-2 text-[11px] text-muted-foreground leading-snug">
                  Be concise but specific about desired behavior, inputs, outputs, and any hardware pins or display layout.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button size="sm" onClick={() => setStep(1)} disabled={!userRequest.trim()}>Next</Button>
              </div>
            </section>
          )}

          {step === 1 && (
            <section className="space-y-4">
              <div className="space-y-2">
                <h3 className="font-medium">Copy & Send Prompt</h3>
                <p className="text-xs text-muted-foreground leading-snug">
                  Click Copy Prompt, then paste it into your preferred AI chat (ChatGPT, Claude, Gemini) and send. The AI will return a JSON workspace. <strong>No preview is shown here to keep the flow simple.</strong>
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="default" onClick={copyPrompt}>{copied ? 'Prompt Copied' : 'Copy Prompt'}</Button>
                  <Button size="sm" variant="outline" onClick={() => { copyPrompt(); window.open('https://chat.openai.com/', '_blank'); }}>ChatGPT</Button>
                  <Button size="sm" variant="outline" onClick={() => { copyPrompt(); window.open('https://claude.ai/new', '_blank'); }}>Claude</Button>
                  <Button size="sm" variant="outline" onClick={() => { copyPrompt(); window.open('https://gemini.google.com/app', '_blank'); }}>Gemini</Button>
                </div>
                <div className="rounded-md border border-destructive/60 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
                  Warning: The JSON you import in the next step will OVERWRITE your current workspace.
                </div>
              </div>
              <div className="flex justify-between items-center pt-2">
                <Button size="sm" variant="ghost" onClick={() => setStep(0)}>Back</Button>
                <Button size="sm" onClick={() => setStep(2)}>Next</Button>
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="space-y-4">
              <div className="space-y-2">
                <h3 className="font-medium">Paste AI Output</h3>
                <p className="text-xs text-muted-foreground leading-snug">
                  Paste the AI's JSON (raw or inside a ```json fence). We will extract the largest valid JSON object automatically.
                </p>
                <Textarea
                  placeholder="Paste the AI response here..."
                  value={resultJson}
                  onChange={(e) => setResultJson(e.target.value)}
                  className="min-h-[220px] text-xs"
                />
                <div className="rounded-md border border-destructive/60 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
                  Importing will permanently overwrite the current Blockly workspace. Consider exporting a backup first if needed.
                </div>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setStep(1)}>Back</Button>
                  <Button size="sm" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
                </div>
                <Button size="sm" variant="destructive" onClick={importJson} disabled={importing || !resultJson.trim()}>
                  {importing ? 'Importing…' : 'Import & Overwrite'}
                </Button>
              </div>
            </section>
          )}
        </div>

        <DialogFooter>
          <div className="text-[11px] text-muted-foreground">
            Tip: Reopen anytime via the AI button. Steps: Describe → Copy → Paste.
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default AICodingDialog
