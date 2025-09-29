import { useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Blockly from "blockly";
import { javascriptGenerator } from "blockly/javascript";
import "blockly/blocks";
import "@/blockly/flipper_blocks";
import { installFlipperCGenerator } from "@/blockly/flipper_c_generator";
import { useCompiler } from "@/hooks/use-compiler";
import { registerWorkspace } from "@/lib/workspace-export";
import { onProjectImported } from "@/lib/projectImport";
import BlocklyPromptHost from './BlocklyPromptHost';
import { installPromptOverride } from '@/blockly/prompt_override';

type Props = {
  onCompile?: () => void;
};

const defaultToolbox: Blockly.utils.toolbox.ToolboxDefinition = {
  kind: "categoryToolbox",
  contents: [
    { kind: "category", name: "Logic", contents: [
      { kind: "block", type: "controls_if" },
      { kind: "block", type: "logic_compare" },
      { kind: "block", type: "logic_operation" },
      { kind: "block", type: "logic_negate" },
      { kind: "block", type: "logic_boolean" },
      { kind: "sep" },
      { kind: "block", type: "flipper_bitwise_and" },
      { kind: "block", type: "flipper_bitwise_or" },
      { kind: "block", type: "flipper_bitwise_xor" },
      { kind: "block", type: "flipper_bitwise_not" }
    ] },
    { kind: "category", name: "Loops", contents: [{ kind: "block", type: "controls_repeat_ext" }, { kind: "block", type: "controls_whileUntil" }] },
    { kind: "category", name: "Math", contents: [
      { kind: "block", type: "math_number" },
      { kind: "block", type: "flipper_hex_number" },
      { kind: "block", type: "math_arithmetic" }
    ] },
    { kind: "category", name: "Text", contents: [{ kind: "block", type: "text" }, { kind: "block", type: "text_print" }] },
    { kind: "category", name: "Variables", custom: "VARIABLE" },
    { kind: "category", name: "App", contents: [
      { kind: "block", type: "flipper_app" },
      { kind: "block", type: "flipper_manifest" }
    ] },
    {
      kind: "category",
      name: "Screen",
      contents: [
        { kind: "block", type: "flipper_viewport_setup" },
        { kind: "block", type: "flipper_canvas_clear" },
        { kind: "block", type: "flipper_canvas_set_color" },
        { kind: "block", type: "flipper_canvas_set_font" },
    { kind: "block", type: "flipper_canvas_draw_text" },
    { kind: "block", type: "flipper_canvas_draw_text_aligned" },
  { kind: "block", type: "flipper_canvas_draw_frame" },
  { kind: "block", type: "flipper_canvas_draw_box" },
  { kind: "block", type: "flipper_canvas_draw_rframe" },
  { kind: "block", type: "flipper_canvas_draw_rbox" },
  { kind: "block", type: "flipper_canvas_draw_line" },
  { kind: "block", type: "flipper_canvas_draw_circle" },
  { kind: "block", type: "flipper_canvas_draw_disc" },
  { kind: "block", type: "flipper_canvas_draw_dot" },
  { kind: "block", type: "flipper_canvas_width" },
  { kind: "block", type: "flipper_canvas_height" },
  { kind: "block", type: "flipper_widget_text_box" },
  { kind: "block", type: "flipper_widget_text_scroll" },
  { kind: "block", type: "flipper_widget_button" },
        { kind: "block", type: "flipper_request_redraw" },
      ],
    },
    {
      kind: "category",
      name: "Input",
      contents: [
        { kind: "block", type: "flipper_input_exit_on_back_short" },
        { kind: "block", type: "flipper_input_if_key_type" },
      ],
    },
    {
      kind: "category",
      name: "Notifications",
      contents: [{ kind: "block", type: "flipper_notify_sequence" }],
    },
    {
      kind: "category",
      name: "Logging",
      contents: [{ kind: "block", type: "flipper_log" }],
    },
    {
      kind: "category",
      name: "Timing",
      contents: [{ kind: "block", type: "flipper_sleep_ms" }],
    },
    { 
      kind: "category", 
      name: "Utilities", 
      contents: [
        { kind: "block", type: "flipper_string_to_number" },
        { kind: "block", type: "flipper_number_to_string" },
        { kind: "block", type: "flipper_string_length" },
        { kind: "block", type: "flipper_random_number" }
      ] 
    },
    {
      kind: "category",
      name: "Storage",
      contents: [
        { kind: "block", type: "flipper_storage_read" },
        { kind: "block", type: "flipper_storage_write" },
        { kind: "block", type: "flipper_storage_exists" },
        { kind: "block", type: "flipper_storage_create" },
        { kind: "block", type: "flipper_storage_delete" }
      ]
    },
    { kind: "category", name: "GPIO", contents: [
      { kind: "block", type: "flipper_gpio_init" },
      { kind: "block", type: "flipper_gpio_write" },
  { kind: "block", type: "flipper_gpio_read" },
  { kind: "block", type: "flipper_gpio_analog_read" },
  { kind: "block", type: "flipper_pwm_start" },
  { kind: "block", type: "flipper_pwm_set" },
  { kind: "block", type: "flipper_pwm_stop" },
  { kind: "block", type: "flipper_pwm_read" }
    ] },
    { kind: "category", name: "Outputs", contents: [
  { kind: "block", type: "flipper_servo_180" },
  { kind: "block", type: "flipper_servo_unlock" }
    ] },
    { kind: "category", name: "Inputs", contents: [
      { kind: "block", type: "flipper_ultrasonic_distance_cm" },
  { kind: "block", type: "flipper_pir_motion" },
  { kind: "block", type: "flipper_dht11_temp_c" },
  { kind: "block", type: "flipper_dht11_humidity_percent" },
  { kind: "block", type: "flipper_potentiometer_read" }
    ] },
    { kind: "category", name: "Timers", contents: [
      { kind: "block", type: "flipper_timer_periodic" }
    ] },
    { kind: "category", name: "I2C", contents: [
      { kind: "block", type: "flipper_i2c_device_ready" },
      { kind: "block", type: "flipper_i2c_read_reg8" },
      { kind: "block", type: "flipper_i2c_write_reg8" },
      { kind: "block", type: "flipper_i2c_read_reg16" },
      { kind: "block", type: "flipper_i2c_write_reg16" },
      { kind: "block", type: "flipper_i2c_write_bytes" },
      { kind: "block", type: "flipper_i2c_read_bytes" },
      { kind: "block", type: "flipper_i2c_update_bits8" },
      { kind: "block", type: "flipper_byte_stream" },
      { kind: "block", type: "flipper_byte_stream_length" },
      { kind: "block", type: "flipper_byte_stream_get_byte" },
      { kind: "block", type: "flipper_hex_number" }
    ] },
  ]
};

const BlocklyWorkspace = ({ onCompile }: Props) => {
  const blocklyDiv = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const debounceRef = useRef<number | null>(null);
  const { setCode } = useCompiler();

  // Minimal C generator (with Flipper-first behavior)
  const generateCCode = () => {
    const ws = workspaceRef.current;
    if (!ws) return "";

    // Prefer Flipper generator if any Flipper-specific block is present
    try {
      const all = ws.getAllBlocks(false);
      const hasFlipper = all.some((b) => b.type.startsWith("flipper_"));
      if (hasFlipper) {
        const flipper = installFlipperCGenerator();
        // Reset accumulation to avoid leaking between builds
        try { flipper.reset(ws); } catch { /* ignore */ }
        // Properly init Blockly's javascript generator to avoid deprecation/runtime warnings
        try { javascriptGenerator.init(ws); } catch { /* ignore */ }
        // Process top-level blocks to allow custom forBlock handlers to accumulate state
        const top = ws.getTopBlocks(true);
        for (const b of top) {
          try { javascriptGenerator.blockToCode(b as any); } catch { /* ignore */ }
        }
        // Finish / dispose generator lifecycle (ensures variable DB cleanup)
        try { javascriptGenerator.finish(''); } catch { /* ignore */ }
        const code = flipper.build(ws);
        if (code) return code as string;
      }
    } catch { /* fallback to basic C */ }

    const declared = new Set<string>();
    let loopCounter = 0;

    const valueCode = (block: Blockly.Block | null | undefined): string => {
      if (!block) return "0";
      switch (block.type) {
        case "math_number":
          return String((block as any).getFieldValue("NUM") ?? "0");
        case "text": {
          const v = String((block as any).getFieldValue("TEXT") ?? "");
          const escaped = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
          return `"${escaped}"`;
        }
        case "variables_get":
          return String((block as any).getFieldValue("VAR") ?? "x");
        case "math_arithmetic": {
          const op = (block as any).getFieldValue("OP");
          const A = valueCode((block as any).getInputTargetBlock("A"));
          const B = valueCode((block as any).getInputTargetBlock("B"));
          const map: Record<string, string> = { ADD: "+", MINUS: "-", MULTIPLY: "*", DIVIDE: "/" };
          return `(${A} ${map[op] ?? '+'} ${B})`;
        }
        case "logic_compare": {
          const op = (block as any).getFieldValue("OP");
          const A = valueCode((block as any).getInputTargetBlock("A"));
          const B = valueCode((block as any).getInputTargetBlock("B"));
          const map: Record<string, string> = { EQ: "==", NEQ: "!=", LT: "<", LTE: "<=", GT: ">", GTE: ">=" };
          return `(${A} ${map[op] ?? '=='} ${B})`;
        }
        case "logic_boolean": {
          const val = (block as any).getFieldValue("BOOL");
          return val === "TRUE" ? "1" : "0";
        }
        default:
          return "0 /* unsupported value block */";
      }
    };

    const statementCode = (block: Blockly.Block | null | undefined): string => {
      let code = "";
      let current: Blockly.Block | null = (block as any) ?? null;
      while (current) {
        switch (current.type) {
          case "text_print": {
            const v = valueCode((current as any).getInputTargetBlock("TEXT"));
            const isString = /^".*"$/.test(v);
            code += isString ? `printf("%s\\n", ${v});\n` : `printf("%d\\n", ${v});\n`;
            break;
          }
          case "variables_set": {
            const name = String((current as any).getFieldValue("VAR") ?? "x");
            const v = valueCode((current as any).getInputTargetBlock("VALUE"));
            if (!declared.has(name)) {
              declared.add(name);
              const isString = /^".*"$/.test(v);
              code += isString ? `const char* ${name} = ${v};\n` : `int ${name} = ${v};\n`;
            } else {
              code += `${name} = ${v};\n`;
            }
            break;
          }
          case "controls_repeat_ext": {
            const times = valueCode((current as any).getInputTargetBlock("TIMES"));
            const idx = `i${loopCounter++}`;
            const body = statementCode((current as any).getInputTargetBlock("DO"));
            code += `for (int ${idx} = 0; ${idx} < ${times}; ${idx}++) {\n${indent(body)}}\n`;
            break;
          }
          case "controls_whileUntil": {
            const mode = (current as any).getFieldValue("MODE");
            const condRaw = valueCode((current as any).getInputTargetBlock("BOOL"));
            const cond = mode === "UNTIL" ? `!(${condRaw})` : condRaw;
            const body = statementCode((current as any).getInputTargetBlock("DO"));
            code += `while (${cond}) {\n${indent(body)}}\n`;
            break;
          }
          case "controls_if": {
            // Handle multiple if/elseif blocks
            let n = 0;
            while ((current as any)[`IF${n}`] !== undefined || (current as any).inputList?.some((i: any) => i.name === `IF${n}`)) {
              const cond = valueCode((current as any).getInputTargetBlock(`IF${n}`));
              const body = statementCode((current as any).getInputTargetBlock(`DO${n}`));
              code += `${n === 0 ? 'if' : 'else if'} (${cond}) {\n${indent(body)}}\n`;
              n++;
            }
            const elseBody = statementCode((current as any).getInputTargetBlock("ELSE"));
            if (elseBody.trim()) code += `else {\n${indent(elseBody)}}\n`;
            break;
          }
          default:
            code += `/* unsupported block: ${current.type} */\n`;
        }
        current = current.getNextBlock();
      }
      return code;
    };

    const indent = (s: string) => s.split("\n").map(line => line ? `  ${line}` : line).join("\n");

    const topBlocks = ws.getTopBlocks(true);
    let body = "";
    for (const b of topBlocks) {
      body += statementCode(b);
    }

  const includes = "#include <stdio.h>\n\n";
  const mainFn = `int main(void) {\n${indent(body)}  return 0;\n}\n`;
    return includes + mainFn;
  };

  useEffect(() => {
    if (!blocklyDiv.current) return;
    const ws = Blockly.inject(blocklyDiv.current, {
      toolbox: defaultToolbox,
      renderer: "zelos",
      trashcan: true,
      move: { scrollbars: true, drag: true, wheel: true },
      grid: { spacing: 20, length: 0, colour: "transparent", snap: true },
      zoom: { controls: true, wheel: true },
    });
    // Install prompt override once Blockly is available in browser context
    try { installPromptOverride(); } catch { /* ignore */ }
    registerWorkspace(ws);
    workspaceRef.current = ws;

    // Simplified load: try existing saved workspace; otherwise seed starter template.
    const saved = localStorage.getItem("kiisu.blocks.workspace");
    if (saved) {
      try {
        const state = JSON.parse(saved);
        (Blockly as any).serialization?.workspaces?.load?.(state, ws);
      } catch { /* ignore parse errors; fall through to starter */ }
    }
    if (!saved) {
      const initialState = {
        blocks: {
          blocks: [
            { type: "flipper_manifest", x: 40, y: 40 },
            {
              type: "flipper_app",
              x: 40,
              y: 140,
              inputs: { SETUP: {}, DRAW: {}, INPUT: {}, LOOP: {} }
            }
          ]
        }
      } as unknown;
      (Blockly as unknown as { serialization?: { workspaces?: { load?: (state: unknown, ws: Blockly.Workspace) => void } } }).serialization?.workspaces?.load?.(initialState, ws);
    }

    // Generate code and persist after initial load
    try {
      const codeNow = generateCCode();
      setCode(codeNow);
      const stateNow = (Blockly as any).serialization?.workspaces?.save?.(ws);
      if (stateNow) localStorage.setItem("kiisu.blocks.workspace", JSON.stringify(stateNow));
    } catch { /* noop */ }

    // Change listener: debounce, generate code, and save workspace
    const onChange = (e: any) => {
      if (e && e.isUiEvent) return;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        try {
          const code = generateCCode();
          setCode(code);
          const state = (Blockly as any).serialization?.workspaces?.save?.(ws);
          if (state) localStorage.setItem("kiisu.blocks.workspace", JSON.stringify(state));
        } catch { /* ignore */ }
      }, 250);
    };
    ws.addChangeListener(onChange);

    // Resize handling
    const ro = new ResizeObserver(() => {
      Blockly.svgResize(ws);
    });
    ro.observe(blocklyDiv.current);
    resizeObserverRef.current = ro;

    return () => {
      ro.disconnect();
      try {
        const state = (Blockly as any).serialization?.workspaces?.save?.(ws);
        if (state) localStorage.setItem("kiisu.blocks.workspace", JSON.stringify(state));
      } catch { /* noop */ }
      ws.removeChangeListener(onChange as any);
      ws.dispose();
      workspaceRef.current = null;
      registerWorkspace(null as any); // clear global ref
    };
  }, [setCode]);

  // Bridge header buttons to workspace actions
  useEffect(() => {
    const onGen = () => {
      const code = generateCCode();
      setCode(code);
    };
    const onCompileEvent = () => {
      const code = generateCCode();
      setCode(code);
      onCompile?.();
    };
    window.addEventListener("kiisu.blocks.generate", onGen as EventListener);
    window.addEventListener("kiisu.blocks.compile", onCompileEvent as EventListener);
    return () => {
      window.removeEventListener("kiisu.blocks.generate", onGen as EventListener);
      window.removeEventListener("kiisu.blocks.compile", onCompileEvent as EventListener);
    };
  }, [onCompile, setCode]);

  // Listen for project imported events to load workspace json
  useEffect(() => {
    const off = onProjectImported((data) => {
      if (!data.workspaceJson || !workspaceRef.current) return;
      try {
        const state = JSON.parse(data.workspaceJson);
        (Blockly as any).serialization?.workspaces?.load?.(state, workspaceRef.current);
        // After loading, regenerate code & persist
        const code = generateCCode();
        setCode(code);
        localStorage.setItem("kiisu.blocks.workspace", JSON.stringify(state));
      } catch { /* ignore malformed */ }
    });
    return () => { off(); };
  }, [setCode]);

  const handleGenerate = () => {
    const code = generateCCode();
    setCode(code);
    onCompile?.();
  };

  return (
    <Card className="flex-1 h-full bg-card cyber-border relative overflow-hidden">
      {/* Host for custom prompt dialogs */}
      <BlocklyPromptHost />

  {/* Grid Background removed; using inner plane grid to avoid duplication */}

  {/* Header buttons trigger actions via window events */}

      {/* Blockly Workspace Area styled plane */}
      <div className="relative z-10 w-full h-full p-6">
        <div
          className="w-full h-full rounded-2xl overflow-hidden cyber-border"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, hsl(var(--primary) / 0.35) 1px, transparent 0)`,
            backgroundSize: "20px 20px",
          }}
        >
          <div ref={blocklyDiv} className="w-full h-full" />
        </div>
      </div>

  {/* Cyber Enhancement Effects removed: animated corner dots */}
    </Card>
  );
};

export default BlocklyWorkspace;