/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Blockly from "blockly";
import { javascriptGenerator } from "blockly/javascript";

// Helpers

export function installFlipperCGenerator() {
  const ORDER_ATOMIC = 0;

  const asNumber = (block: Blockly.Block, name: string, def: string) => {
    const code = javascriptGenerator.valueToCode(block, name, ORDER_ATOMIC) || def;
    return code;
  };
  const asString = (block: Blockly.Block, name: string, def: string) => {
    const code = javascriptGenerator.valueToCode(block, name, ORDER_ATOMIC);
    if (code === null || code === undefined) {
      return JSON.stringify(def);
    }
    // If the code is a single-quoted string from a blockly field, convert it to a double-quoted C literal.
    if (code.startsWith("'") && code.endsWith("'")) {
      // Extract content, escape double quotes and backslashes, then wrap in double quotes.
      const content = code.substring(1, code.length - 1).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return `"${content}"`;
    }
    // If it's already a double-quoted string, return as is
    if (code.startsWith('"') && code.endsWith('"')) {
      return code;
    }
    // Otherwise, assume it's a variable or other expression and return it as is.
    return code;
  };
  
  const asStringForDisplay = (block: Blockly.Block, name: string, def: string) => {
    const code = javascriptGenerator.valueToCode(block, name, ORDER_ATOMIC);
    if (code === null || code === undefined) {
      return JSON.stringify(def);
    }
    // If the code is a single-quoted string from a blockly field, convert it to a double-quoted C literal.
    if (code.startsWith("'") && code.endsWith("'")) {
      // Extract content, escape double quotes and backslashes, then wrap in double quotes.
      const content = code.substring(1, code.length - 1).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return `"${content}"`;
    }
    // If it's already a double-quoted string, return as is
    if (code.startsWith('"') && code.endsWith('"')) {
      return code;
    }
    // If it looks like a simple variable reference (strict pattern app->identifier)
    if (code.startsWith('app->') && /^app->[a-zA-Z_][a-zA-Z0-9_]*$/.test(code)) {
      const ws = block.workspace;
      const ctx = ensureCtx(ws);
      const varName = sanitizeVarName(code.replace('app->', ''));
      // Avoid false positives (e.g. varName 'p' matching 'display_buffer')
      const varDecl = ctx.variables.find(v => new RegExp(`\\b${varName}\\b`).test(v));
      
      if (varDecl && varDecl.includes('char')) {
        // It's a string variable, use it directly
        return `app->${varName}`;
      } else {
        // It's a numeric variable, use a shared display buffer
        const displayBuf = 'display_buffer';
        if (!ctx.variables.some(v => v.includes(displayBuf))) {
          ctx.variables.push(`char ${displayBuf}[64];`);
        }
        // Return a formatted string conversion
        return `(snprintf(app->${displayBuf}, sizeof(app->${displayBuf}), "%d", app->${varName}), app->${displayBuf})`;
      }
    }
    // For pure numeric literals
    if (!isNaN(Number(code))) {
      return `"${code}"`;
    }
  // For other expressions, treat as raw expression (expected to yield char* or be handled upstream)
  return code;
  };

  // A small registry to accumulate code sections during traversal
  const ctxSym = Symbol("flipper_codegen_ctx");

  // Helper function to sanitize variable names for C
  const sanitizeVarName = (name: string): string => {
    if (!name || name.trim() === "") return "variable";
    
    const trimmed = name.trim();
    
    // Check if the name is already a valid C identifier
    const isValidCIdentifier = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed);
    
    // Check if it's a reserved C keyword
    const cKeywords = ['auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 
                      'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 
                      'int', 'long', 'register', 'return', 'short', 'signed', 'sizeof', 
                      'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void', 
                      'volatile', 'while'];
    const isKeyword = cKeywords.includes(trimmed.toLowerCase());
    
    // If it's already valid and not a keyword, return as-is
    if (isValidCIdentifier && !isKeyword) {
      return trimmed;
    }
    
    // Otherwise, sanitize it
    let sanitized = trimmed.replace(/[^a-zA-Z0-9_]/g, '_');
    
    // Ensure it starts with a letter or underscore
    if (!/^[a-zA-Z_]/.test(sanitized)) {
      sanitized = 'var_' + sanitized;
    }
    
    // If it's a keyword, prefix it
    if (isKeyword) {
      sanitized = 'var_' + sanitized;
    }
    
    // Ensure it's not empty after sanitization
    if (sanitized === '' || sanitized === '_') {
      sanitized = 'variable';
    }
    
    return sanitized;
  };

  type GenCtx = {
    setup: string;
    widget_elements: string;
    input: string;
    loop: string;
    notifs: boolean;
    variables: string[];
    storage_used: boolean;
    storage_read_used: boolean;
    storage_write_used: boolean;
    storage_exists_used: boolean;
    storage_create_used: boolean;
    storage_delete_used: boolean;
    gpio_used: boolean;
    pwm_used: boolean;
  tim1_servo_used: boolean; // true when PA7 TIM1 compare path is emitted
  lptim_servo_used: boolean; // true when PA4 LPTIM2 compare path is emitted
  adc_used?: boolean; // when ADC helpers are needed
    pwm_channels: Set<string>;
    timer_used: boolean;
    timer_callbacks: Array<{interval: string, body: string}>;
    random_used: boolean;
    string_to_number_used: boolean;
  ultrasonic_used: boolean; // when HC-SR04 helper is needed
  dht11_used?: boolean; // when DHT11 helper is needed
  need_5v?: boolean; // enable OTG 5V when needed by sensors
  configured_gpios?: Set<string>; // pins we initialized in setup
  button_callbacks: string[];
  button_handlers: string; // code injected into input callback for soft buttons
  render_prep: string[]; // lines executed each redraw before adding widget elements
  derived: Set<string>; // track derived helpers like length buffers
  fam_manifests: FamSpec[]; // Collected manifest specs (support multiple)
  i2c_used?: boolean; // when any I2C block used
  };

  const defaultCtx = (): GenCtx => ({
    setup: "",
    widget_elements: "",
    input: "",
    loop: "",
    notifs: false,
  variables: [],
    storage_used: false,
    storage_read_used: false,
    storage_write_used: false,
    storage_exists_used: false,
    storage_create_used: false,
    storage_delete_used: false,
    gpio_used: false,
    pwm_used: false,
  tim1_servo_used: false,
  lptim_servo_used: false,
  adc_used: false,
    pwm_channels: new Set(),
    timer_used: false,
    timer_callbacks: [],
    random_used: false,
    string_to_number_used: false,
  ultrasonic_used: false,
  dht11_used: false,
  need_5v: false,
  configured_gpios: new Set(),
  button_callbacks: [],
  button_handlers: "",
  render_prep: [],
  derived: new Set(),
  fam_manifests: [],
  i2c_used: false,
  });

  // Structured manifest spec captured from the block; rendered at build time
  // Simplified manifest spec (reduced to essentials)
  type FamSpec = {
    appid: string;
    name: string;
    apptype: string;
    icon?: string; // optional icon asset
  category?: string;
  author?: string;
  version?: string;
  description?: string;
  stack?: number; // stack size bytes
  };

  const ensureCtx = (ws: Blockly.Workspace): GenCtx => {
    const anyWs = ws as any;
    if (!anyWs[ctxSym]) anyWs[ctxSym] = defaultCtx();
    return anyWs[ctxSym];
  };

  // Allow callers to reset accumulation between builds
  const resetCtx = (ws: Blockly.Workspace) => {
    const anyWs = ws as any;
    anyWs[ctxSym] = defaultCtx();
  };

  // Generators produce side effects into workspace context
  (javascriptGenerator.forBlock as any)["flipper_app"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    ctx.setup += javascriptGenerator.statementToCode(block, "SETUP") || "";
    // DRAW blocks now add widget elements
    ctx.widget_elements += javascriptGenerator.statementToCode(block, "DRAW") || "";
    ctx.input += javascriptGenerator.statementToCode(block, "INPUT") || "";
    ctx.loop += javascriptGenerator.statementToCode(block, "LOOP") || "";
    return "";
  };

  // Manifest (.FAM) block -> produce .fam text and stash in ctx; remains a loose block
  (javascriptGenerator.forBlock as any)["flipper_manifest"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    const spec: FamSpec = {
      appid: String((block as any).getFieldValue("APPID") || "my_app"),
      name: String((block as any).getFieldValue("NAME") || "My App"),
      apptype: String((block as any).getFieldValue("APPTYPE") || "FlipperAppType.EXTERNAL"),
      icon: String((block as any).getFieldValue("ICON") || ""),
  category: String((block as any).getFieldValue("CATEGORY") || "General"),
  author: String((block as any).getFieldValue("AUTHOR") || "Unknown"),
  version: String((block as any).getFieldValue("VERSION") || "0.1.0"),
  description: String((block as any).getFieldValue("DESCRIPTION") || "Generated by Kiisu Blocks"),
  stack: Number((block as any).getFieldValue("STACK") || 4096),
    };
    if(!ctx.fam_manifests) ctx.fam_manifests = [];
    ctx.fam_manifests.push(spec);
    return "";
  };

  (javascriptGenerator.forBlock as any)["flipper_viewport_setup"] = function (block: Blockly.Block) {
    // This block is now mostly conceptual, as the widget setup is standardized.
    // We can use it to trigger variable declarations or other setup if needed.
    return "";
  };

  (javascriptGenerator.forBlock as any)["flipper_canvas_clear"] = function (block: Blockly.Block) {
    // Clearing is implicit with widgets
    return "";
  };

  (javascriptGenerator.forBlock as any)["flipper_canvas_set_font"] = function (block: Blockly.Block) {
    // Font is set per-element
    return "";
  };

  (javascriptGenerator.forBlock as any)["flipper_canvas_set_color"] = function (block: Blockly.Block) {
    // Color is not directly supported by basic widget elements in this way
    return "";
  };

  (javascriptGenerator.forBlock as any)["flipper_canvas_draw_text"] = function (block: Blockly.Block) {
    const x = asNumber(block, "X", "0");
    const y = asNumber(block, "Y", "0");
    let textExpr = asStringForDisplay(block, "TEXT", "Hello");
    // If still quoted literal with outer quotes, leave; if expression containing unescaped quotes, wrap with parentheses
    if(!/^".*"$/.test(textExpr)) {
      textExpr = `(${textExpr})`;
    }
    const font = "FontPrimary"; // Default font
    return `    widget_add_string_element(app->widget, ${x}, ${y}, AlignLeft, AlignTop, ${font}, ${textExpr});\n`;
  };

  (javascriptGenerator.forBlock as any)["flipper_canvas_draw_text_aligned"] = function (block: Blockly.Block) {
    const x = asNumber(block, "X", "0");
    const y = asNumber(block, "Y", "0");
    const h = String((block as any).getFieldValue("HALIGN") || "AlignLeft");
    const v = String((block as any).getFieldValue("VALIGN") || "AlignTop");
    const text = asStringForDisplay(block, "TEXT", '""');
    const font = "FontPrimary"; // Default font
    return `    widget_add_string_element(app->widget, ${x}, ${y}, ${h}, ${v}, ${font}, ${text});\n`;
  };

  (javascriptGenerator.forBlock as any)["flipper_canvas_draw_box"] = function (block: Blockly.Block) {
    const x = asNumber(block, "X", "0");
    const y = asNumber(block, "Y", "0");
    const w = asNumber(block, "W", "0");
    const h = asNumber(block, "H", "0");
    return `    widget_add_rect_element(app->widget, ${x}, ${y}, ${w}, ${h}, 0, true);\n`;
  };

  (javascriptGenerator.forBlock as any)["flipper_canvas_draw_frame"] = function (block: Blockly.Block) {
    const x = asNumber(block, "X", "0");
    const y = asNumber(block, "Y", "0");
    const w = asNumber(block, "W", "0");
    const h = asNumber(block, "H", "0");
    return `    widget_add_rect_element(app->widget, ${x}, ${y}, ${w}, ${h}, 0, false);\n`;
  };

  (javascriptGenerator.forBlock as any)["flipper_canvas_draw_rbox"] = function (block: Blockly.Block) {
    const x = asNumber(block, "X", "0");
    const y = asNumber(block, "Y", "0");
    const w = asNumber(block, "W", "0");
    const h = asNumber(block, "H", "0");
    const r = asNumber(block, "R", "3");
    return `    widget_add_rect_element(app->widget, ${x}, ${y}, ${w}, ${h}, ${r}, true);\n`;
  };

  (javascriptGenerator.forBlock as any)["flipper_canvas_draw_rframe"] = function (block: Blockly.Block) {
    const x = asNumber(block, "X", "0");
    const y = asNumber(block, "Y", "0");
    const w = asNumber(block, "W", "0");
    const h = asNumber(block, "H", "0");
    const r = asNumber(block, "R", "3");
    return `    widget_add_rect_element(app->widget, ${x}, ${y}, ${w}, ${h}, ${r}, false);\n`;
  };

  (javascriptGenerator.forBlock as any)["flipper_canvas_draw_line"] = function (block: Blockly.Block) {
    const x1 = asNumber(block, "X1", "0");
    const y1 = asNumber(block, "Y1", "0");
    const x2 = asNumber(block, "X2", "0");
    const y2 = asNumber(block, "Y2", "0");
    return `    widget_add_line_element(app->widget, ${x1}, ${y1}, ${x2}, ${y2});\n`;
  };

  (javascriptGenerator.forBlock as any)["flipper_canvas_draw_circle"] = function (block: Blockly.Block) {
    const x = asNumber(block, "X", "0");
    const y = asNumber(block, "Y", "0");
    const r = asNumber(block, "R", "0");
    return `    widget_add_circle_element(app->widget, ${x}, ${y}, ${r}, false);\n`;
  };

  (javascriptGenerator.forBlock as any)["flipper_canvas_draw_disc"] = function (block: Blockly.Block) {
    const x = asNumber(block, "X", "0");
    const y = asNumber(block, "Y", "0");
    const r = asNumber(block, "R", "0");
    return `    widget_add_circle_element(app->widget, ${x}, ${y}, ${r}, true);\n`;
  };

  (javascriptGenerator.forBlock as any)["flipper_canvas_draw_dot"] = function (block: Blockly.Block) {
    const x = asNumber(block, "X", "0");
    const y = asNumber(block, "Y", "0");
    return `    widget_add_circle_element(app->widget, ${x}, ${y}, 1, true);\n`;
  };

  // Text box
  (javascriptGenerator.forBlock as any)["flipper_widget_text_box"] = function (block: Blockly.Block) {
    const x = asNumber(block, "X", "0");
    const y = asNumber(block, "Y", "0");
    const w = asNumber(block, "W", "0");
    const h = asNumber(block, "H", "0");
    const hAlign = String((block as any).getFieldValue("HALIGN") || "AlignLeft");
    const vAlign = String((block as any).getFieldValue("VALIGN") || "AlignTop");
    const text = asStringForDisplay(block, "TEXT", "");
    const strip = (block as any).getFieldValue("STRIP") === "TRUE" ? "true" : "false";
    return `    widget_add_text_box_element(app->widget, ${x}, ${y}, ${w}, ${h}, ${hAlign}, ${vAlign}, ${text}, ${strip});\n`;
  };

  // Text scroll
  (javascriptGenerator.forBlock as any)["flipper_widget_text_scroll"] = function (block: Blockly.Block) {
    const x = asNumber(block, "X", "0");
    const y = asNumber(block, "Y", "0");
    const w = asNumber(block, "W", "0");
    const h = asNumber(block, "H", "0");
    const text = asStringForDisplay(block, "TEXT", "");
    return `    widget_add_text_scroll_element(app->widget, ${x}, ${y}, ${w}, ${h}, ${text});\n`;
  };

  // Button element -> just creates a visual button, no callback needed
  (javascriptGenerator.forBlock as any)["flipper_widget_button"] = function (block: Blockly.Block) {
    const btn = String((block as any).getFieldValue("BTN") || "GuiButtonTypeLeft");
    const label = asString(block, "LABEL", "Btn");
    // No callback - just display the button icon
    return `    widget_add_button_element(app->widget, ${btn}, ${label}, NULL, NULL);\n`;
  };

  (javascriptGenerator.forBlock as any)["flipper_canvas_width"] = function (block: Blockly.Block) {
    return ["128", ORDER_ATOMIC];
  };

  (javascriptGenerator.forBlock as any)["flipper_canvas_height"] = function (block: Blockly.Block) {
    return ["64", ORDER_ATOMIC];
  };

  (javascriptGenerator.forBlock as any)["flipper_input_exit_on_back_short"] = function (block: Blockly.Block) {
    // This is now handled by the navigation callback
    return "";
  };

  (javascriptGenerator.forBlock as any)["flipper_notify_sequence"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    const seq = String((block as any).getFieldValue("SEQ") || "sequence_success");
    ctx.notifs = true;
    // Generate code for immediate notification
    return `        notification_message(app->notif, &${seq});\n`;
  };

  // Delay block
  (javascriptGenerator.forBlock as any)["flipper_sleep_ms"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    const ms = asNumber(block, "MS", "0");
    ctx.loop += `    furi_delay_ms(${ms});\n`;
    return "";
  };

  // Logging block
  (javascriptGenerator.forBlock as any)["flipper_log"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    const lvl = String((block as any).getFieldValue("LEVEL") || "I");
    const tag = asString(block, "TAG", "APP");
    const msg = asString(block, "MSG", "");
    const map: Record<string, string> = { E: "FURI_LOG_E", W: "FURI_LOG_W", I: "FURI_LOG_I", D: "FURI_LOG_D", T: "FURI_LOG_T" };
    // Generate inline in the current context instead of defaulting to loop
    return `        ${map[lvl] || "FURI_LOG_I"}(${tag}, ${msg});\n`;
  };

  // Input predicate block
  (javascriptGenerator.forBlock as any)["flipper_input_if_key_type"] = function (block: Blockly.Block) {
    const body = javascriptGenerator.statementToCode(block, "DO") || "";
    const type = String((block as any).getFieldValue("TYPE") || "InputTypeShort");
    const key = String((block as any).getFieldValue("KEY") || "InputKeyOk");
    return `    if(event->type == ${type} && event->key == ${key}) {\n${body}        consumed = true;\n    }\n`;
  };

  // Request redraw block
  (javascriptGenerator.forBlock as any)["flipper_request_redraw"] = function (block: Blockly.Block) {
    return "        view_dispatcher_send_custom_event(app->view_dispatcher, CustomEventTypeRedraw);\n";
  };

  // Basic logic support for timer/setup bodies (C code emission)
  (javascriptGenerator.forBlock as any)["logic_boolean"] = function (block: Blockly.Block) {
    const val = String((block as any).getFieldValue("BOOL") || "TRUE");
    return [val === "TRUE" ? "1" : "0", ORDER_ATOMIC];
  };

  (javascriptGenerator.forBlock as any)["logic_compare"] = function (block: Blockly.Block) {
    const op = String((block as any).getFieldValue("OP") || "EQ");
    const A = javascriptGenerator.valueToCode(block, "A", ORDER_ATOMIC) || "0";
    const B = javascriptGenerator.valueToCode(block, "B", ORDER_ATOMIC) || "0";
    const map: Record<string, string> = { EQ: "==", NEQ: "!=", LT: "<", LTE: "<=", GT: ">", GTE: ">=" };
    const cOp = map[op] || "==";
    return [`(${A} ${cOp} ${B})`, ORDER_ATOMIC];
  };

  (javascriptGenerator.forBlock as any)["controls_if"] = function (block: Blockly.Block) {
    let code = "";
    let n = 0;
    // Handle if/else-if
    while ((block as any)[`IF${n}`] !== undefined || (block as any).inputList?.some((i: any) => i.name === `IF${n}`)) {
      const cond = javascriptGenerator.valueToCode(block, `IF${n}`, ORDER_ATOMIC) || "0";
      const body = javascriptGenerator.statementToCode(block, `DO${n}`) || "";
      code += `${n === 0 ? 'if' : 'else if'} (${cond}) {\n${body}}\n`;
      n++;
    }
    // Handle else
    const elseBody = javascriptGenerator.statementToCode(block, "ELSE") || "";
    if (elseBody.trim()) code += `else {\n${elseBody}}\n`;
    return code;
  };

  // Inputs: Ultrasonic Distance (cm)
  (javascriptGenerator.forBlock as any)["flipper_ultrasonic_distance_cm"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    const trigSel = String((block as any).getFieldValue("TRIG_PIN") || "USART_TX");
    const echoSel = String((block as any).getFieldValue("ECHO_PIN") || "USART_RX");

    // Mark that ultrasonic helper is required
    ctx.ultrasonic_used = true;

    // Map selections to HAL pin identifiers
    const pinMap: Record<string, string> = {
      USART_TX: "&gpio_usart_tx",
      USART_RX: "&gpio_usart_rx",
      PA7: "&gpio_ext_pa7",
      PA6: "&gpio_ext_pa6",
      PA4: "&gpio_ext_pa4",
      PB3: "&gpio_ext_pb3",
      PB2: "&gpio_ext_pb2",
      PC3: "&gpio_ext_pc3",
      PC1: "&gpio_ext_pc1",
      PC0: "&gpio_ext_pc0",
    };
    const trigPin = pinMap[trigSel] || "&gpio_usart_tx";
    const echoPin = pinMap[echoSel] || "&gpio_usart_rx";

    // Generate an expression that measures once and returns centimeters
    // This emits a function call that's defined when ultrasonic_used is true
    return [`hc_sr04_measure_cm(${trigPin}, ${echoPin})`, ORDER_ATOMIC];
  };

  // Inputs: PIR Motion (HC-SR501)
  (javascriptGenerator.forBlock as any)["flipper_pir_motion"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    ctx.gpio_used = true; // we use GPIO read
  ctx.need_5v = true; // PIR modules typically powered at 5V
    const pinSel = String((block as any).getFieldValue("PIN") || "PA7");
    const pinMap: Record<string, string> = {
      PA7: "&gpio_ext_pa7",
      PA6: "&gpio_ext_pa6",
      PA4: "&gpio_ext_pa4",
      PB3: "&gpio_ext_pb3",
      PB2: "&gpio_ext_pb2",
      PC3: "&gpio_ext_pc3",
      PC1: "&gpio_ext_pc1",
      PC0: "&gpio_ext_pc0",
    };
    const pin = pinMap[pinSel] || "&gpio_ext_pa7";
    // Ensure input mode init happens once in setup
    if (!ctx.configured_gpios?.has(pin)) {
      ctx.setup += `    furi_hal_gpio_init(${pin}, GpioModeInput, GpioPullNo, GpioSpeedVeryHigh);\n`;
      ctx.configured_gpios?.add(pin);
    }
    return [`(furi_hal_gpio_read(${pin}) ? 1 : 0)`, ORDER_ATOMIC];
  };

  // Inputs: Potentiometer (ADC)
  (javascriptGenerator.forBlock as any)["flipper_potentiometer_read"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    ctx.adc_used = true;
    // Read block fields
    const pinSel = String((block as any).getFieldValue("PIN") || "PA7");
    const modeSel = String((block as any).getFieldValue("MODE") || "PERCENT");
    const rValStr = String((block as any).getFieldValue("R_VALUE") || "10");
    const rUnit = String((block as any).getFieldValue("R_UNIT") || "KOHM");

    // Map pin to constant and remember to configure it once as analog
    const pinMap: Record<string, {pin: string, extNum: number}> = {
      PA7: { pin: "&gpio_ext_pa7", extNum: 2 },
      PA6: { pin: "&gpio_ext_pa6", extNum: 3 },
      PA4: { pin: "&gpio_ext_pa4", extNum: 4 },
      PC3: { pin: "&gpio_ext_pc3", extNum: 7 },
      PC1: { pin: "&gpio_ext_pc1", extNum: 15 },
      PC0: { pin: "&gpio_ext_pc0", extNum: 16 },
    };
    const pm = pinMap[pinSel] || pinMap.PA7;

    // Configure GPIO to analog once
    if (!ctx.configured_gpios?.has(pm.pin)) {
      ctx.setup += `    furi_hal_gpio_init(${pm.pin}, GpioModeAnalog, GpioPullNo, GpioSpeedVeryHigh);\n`;
      ctx.configured_gpios?.add(pm.pin);
    }

    // Compute resistance in ohms as a constant expression
    let rMultiplier = "1.0f";
    if (rUnit === "KOHM") rMultiplier = "1000.0f";
    else if (rUnit === "MOHM") rMultiplier = "1000000.0f";
  const rOhmsExpr = `((${rValStr}*1.0f)*${rMultiplier})`;

    // Choose sampling time based on resistance (lower Z -> shorter sampling ok)
    // Thresholds: <=10k -> 24.5; <=50k -> 92.5; else 247.5
    const samplingExpr = `(${rOhmsExpr} <= 10000.0f ? FuriHalAdcSamplingtime24_5 : (${rOhmsExpr} <= 50000.0f ? FuriHalAdcSamplingtime92_5 : FuriHalAdcSamplingtime247_5))`;
    const oversample = `FuriHalAdcOversample64`;
  const scale = `FuriHalAdcScale2500`; // 2.5V internal reference gives more headroom for 3.3V rails (still clips above 2.5V)

    // Read raw once via helper
    const rawExpr = `adc_read_raw_on_gpio(${pm.pin}, ${scale}, FuriHalAdcClockSync64, ${oversample}, ${samplingExpr})`;

    // Return according to mode
    if (modeSel === "RAW") {
      return [`(${rawExpr})`, ORDER_ATOMIC];
    } else if (modeSel === "MV") {
      // Convert to mV based on selected ADC scale (2.5V or 2.048V)
      return [`adc_raw_to_mv_scale(${rawExpr}, ${scale})`, ORDER_ATOMIC];
    } else {
      // Percent 0-100
      return [`((int)((${rawExpr} * 100UL) / 4095UL))`, ORDER_ATOMIC];
    }
  };

  // Variable blocks
  (javascriptGenerator.forBlock as any)["variables_get"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    const varId = String((block as any).getFieldValue("VAR") || "variable");
  // v12+ deprecated direct workspace.getVariableById; use variableMap
  const variable = (block as any).workspace.getVariableMap?.().getVariableById?.(varId);
    // Always prefer the user-visible variable name over the internal ID
    const rawVarName = variable ? variable.name : varId;
    const varName = sanitizeVarName(rawVarName);
    
    // Track this variable in the context so it gets declared in the app structure
    if (!ctx.variables.some(v => new RegExp(`\\b${varName}\\b`).test(v))) {
      // Check if this variable is being used in a string context by examining the parent block
      const parentBlock = block.getParent();
      let shouldBeString = false;
      
      if (parentBlock) {
        // Check if parent is a string operation that expects string input
        if (parentBlock.type === 'flipper_string_length') {
          shouldBeString = true;
        }
        // Check if this variable is connected to a string input
        const inputs = parentBlock.inputList;
        for (const input of inputs) {
          if (input.connection && input.connection.targetBlock() === block) {
            if (input.name === 'STRING' || (input.connection as any).check?.includes?.('String')) {
              shouldBeString = true;
              break;
            }
          }
        }
      }
      
      if (shouldBeString) {
        ctx.variables.push(`char ${varName}[256];`);
      } else {
        ctx.variables.push(`int ${varName}; // Initialize numeric variable`);
      }
    }
    
    return [`app->${varName}`, ORDER_ATOMIC];
  };

  (javascriptGenerator.forBlock as any)["variables_set"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    const varId = String((block as any).getFieldValue("VAR") || "variable");
  const variable = (block as any).workspace.getVariableMap?.().getVariableById?.(varId);
    // Always prefer the user-visible variable name over the internal ID
    const rawVarName = variable ? variable.name : varId;
    const varName = sanitizeVarName(rawVarName);
    const value = asString(block, "VALUE", "0");
    
    // Track this variable in the context so it gets declared in the app structure
    if (!ctx.variables.some(v => new RegExp(`\\b${varName}\\b`).test(v))) {
      // Determine type based on the value - simple heuristic
      const isString = value.startsWith('"') && value.endsWith('"');
      const varDecl = isString ? `char ${varName}[256];` : `int ${varName};`;
      ctx.variables.push(varDecl);
    }
    
    // Generate assignment code
    const isString = value.startsWith('"') && value.endsWith('"');
    if (isString) {
      return `        strncpy(app->${varName}, ${value}, sizeof(app->${varName}) - 1);\n        app->${varName}[sizeof(app->${varName}) - 1] = '\\0';\n`;
    } else {
      return `        app->${varName} = ${value};\n`;
    }
  };

  (javascriptGenerator.forBlock as any)["math_change"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
  const varId = String((block as any).getFieldValue("VAR") || "variable");
  const variable = (block as any).workspace.getVariableMap?.().getVariableById?.(varId);
  // Always prefer the user-visible variable name over the internal ID
  const rawVarName = variable ? variable.name : varId;
  const varName = sanitizeVarName(rawVarName);
    const delta = asNumber(block, "DELTA", "1");
    
    // Ensure variable is declared
    if (!ctx.variables.some(v => new RegExp(`\\b${varName}\\b`).test(v))) {
      ctx.variables.push(`int ${varName};`);
    }
    
    return `        app->${varName} += ${delta};\n`;
  };

  // Math and logic blocks for value expressions
  (javascriptGenerator.forBlock as any)["math_number"] = function (block: Blockly.Block) {
    const value = String((block as any).getFieldValue("NUM") || "0");
    return [value, ORDER_ATOMIC];
  };

  (javascriptGenerator.forBlock as any)["math_arithmetic"] = function (block: Blockly.Block) {
    const op = String((block as any).getFieldValue("OP") || "ADD");
    const a = asNumber(block, "A", "0");
    const b = asNumber(block, "B", "0");
    const opMap: Record<string, string> = {
      ADD: "+",
      MINUS: "-", 
      MULTIPLY: "*",
      DIVIDE: "/",
      POWER: "**" // Note: C doesn't have ** operator, might need pow() function
    };
    const operator = opMap[op] || "+";
    if (op === "POWER") {
      return [`pow(${a}, ${b})`, ORDER_ATOMIC];
    }
    return [`(${a} ${operator} ${b})`, ORDER_ATOMIC];
  };

  (javascriptGenerator.forBlock as any)["logic_compare"] = function (block: Blockly.Block) {
    const op = String((block as any).getFieldValue("OP") || "EQ");
    const a = asString(block, "A", "0");
    const b = asString(block, "B", "0");
    const opMap: Record<string, string> = {
      EQ: "==",
      NEQ: "!=",
      LT: "<",
      LTE: "<=",
      GT: ">",
      GTE: ">="
    };
    const operator = opMap[op] || "==";
    return [`(${a} ${operator} ${b})`, ORDER_ATOMIC];
  };

  (javascriptGenerator.forBlock as any)["logic_boolean"] = function (block: Blockly.Block) {
    const value = String((block as any).getFieldValue("BOOL") || "TRUE");
    return [value === "TRUE" ? "true" : "false", ORDER_ATOMIC];
  };

  // Logical AND / OR (short-circuit) using core blockly block names
  (javascriptGenerator.forBlock as any)["logic_operation"] = function (block: Blockly.Block) {
    const op = String((block as any).getFieldValue("OP") || "AND");
    const A = javascriptGenerator.valueToCode(block, "A", ORDER_ATOMIC) || "false";
    const B = javascriptGenerator.valueToCode(block, "B", ORDER_ATOMIC) || "false";
    const operator = op === "AND" ? "&&" : "||";
    return [`(${A} ${operator} ${B})`, ORDER_ATOMIC];
  };

  // Logical negate
  (javascriptGenerator.forBlock as any)["logic_negate"] = function (block: Blockly.Block) {
    const A = javascriptGenerator.valueToCode(block, "BOOL", ORDER_ATOMIC) || "false";
    return [`(!(${A}))`, ORDER_ATOMIC];
  };

  // Bitwise helpers (custom Kiisu blocks)
  (javascriptGenerator.forBlock as any)["flipper_bitwise_and"] = function (block: Blockly.Block) {
    const A = javascriptGenerator.valueToCode(block, "A", ORDER_ATOMIC) || "0";
    const B = javascriptGenerator.valueToCode(block, "B", ORDER_ATOMIC) || "0";
    return [`((${A}) & (${B}))`, ORDER_ATOMIC];
  };
  (javascriptGenerator.forBlock as any)["flipper_bitwise_or"] = function (block: Blockly.Block) {
    const A = javascriptGenerator.valueToCode(block, "A", ORDER_ATOMIC) || "0";
    const B = javascriptGenerator.valueToCode(block, "B", ORDER_ATOMIC) || "0";
    return [`((${A}) | (${B}))`, ORDER_ATOMIC];
  };
  (javascriptGenerator.forBlock as any)["flipper_bitwise_xor"] = function (block: Blockly.Block) {
    const A = javascriptGenerator.valueToCode(block, "A", ORDER_ATOMIC) || "0";
    const B = javascriptGenerator.valueToCode(block, "B", ORDER_ATOMIC) || "0";
    return [`((${A}) ^ (${B}))`, ORDER_ATOMIC];
  };
  (javascriptGenerator.forBlock as any)["flipper_bitwise_not"] = function (block: Blockly.Block) {
    const A = javascriptGenerator.valueToCode(block, "A", ORDER_ATOMIC) || "0";
    return [`(~(${A}))`, ORDER_ATOMIC];
  };

  (javascriptGenerator.forBlock as any)["text"] = function (block: Blockly.Block) {
    const text = String((block as any).getFieldValue("TEXT") || "");
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return [`"${escaped}"`, ORDER_ATOMIC];
  };

  // Control flow blocks
  (javascriptGenerator.forBlock as any)["controls_if"] = function (block: Blockly.Block) {
    let code = "";
    let conditionCode, branchCode;
    
    // If condition
    conditionCode = asString(block, "IF0", "false");
    branchCode = javascriptGenerator.statementToCode(block, "DO0") || "";
    code += `    if (${conditionCode}) {\n${branchCode}    }\n`;
    
    // Elseif conditions - check dynamically for IF1, IF2, etc.
    let i = 1;
    while ((block as any).getInput(`IF${i}`)) {
      conditionCode = asString(block, `IF${i}`, "false");
      branchCode = javascriptGenerator.statementToCode(block, `DO${i}`) || "";
      code += `    else if (${conditionCode}) {\n${branchCode}    }\n`;
      i++;
    }
    
    // Else condition
    if ((block as any).getInput("ELSE")) {
      branchCode = javascriptGenerator.statementToCode(block, "ELSE") || "";
      code += `    else {\n${branchCode}    }\n`;
    }
    
    return code;
  };

  (javascriptGenerator.forBlock as any)["controls_repeat_ext"] = function (block: Blockly.Block) {
    const times = asNumber(block, "TIMES", "1");
    const body = javascriptGenerator.statementToCode(block, "DO") || "";
    const loopVar = `i_${Math.random().toString(36).substr(2, 9)}`;
    return `    for (int ${loopVar} = 0; ${loopVar} < ${times}; ${loopVar}++) {\n${body}    }\n`;
  };

  (javascriptGenerator.forBlock as any)["controls_whileUntil"] = function (block: Blockly.Block) {
    const mode = String((block as any).getFieldValue("MODE") || "WHILE");
    const condition = asString(block, "BOOL", "false");
    const body = javascriptGenerator.statementToCode(block, "DO") || "";
    
    if (mode === "WHILE") {
      return `    while (${condition}) {\n${body}    }\n`;
    } else {
      return `    while (!(${condition})) {\n${body}    }\n`;
    }
  };

  // Print/debug statement for testing variables
  (javascriptGenerator.forBlock as any)["text_print"] = function (block: Blockly.Block) {
    const value = asString(block, "TEXT", '""');
    return `        FURI_LOG_I("APP", "Print: %s", ${value});\n`;
  };

  // Utility blocks
  (javascriptGenerator.forBlock as any)["flipper_string_to_number"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    const str = asString(block, "STRING", '""');
    
    // Mark that string to number function is used
    ctx.string_to_number_used = true;
    
    // Use a helper function that extracts the first number found in the string
    return [`extract_number_from_string(${str})`, ORDER_ATOMIC];
  };

  (javascriptGenerator.forBlock as any)["flipper_number_to_string"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    const numExpr = javascriptGenerator.valueToCode(block, "NUMBER", ORDER_ATOMIC) || "0";
    // Derive stable buffer name
    let bufferName: string;
    const simpleVarMatch = /^app->([a-zA-Z_][a-zA-Z0-9_]*)$/.exec(numExpr);
    if(simpleVarMatch) {
      bufferName = `${simpleVarMatch[1]}_str`;
    } else {
      bufferName = `expr_${ctx.render_prep.length}_str`;
    }
    if(!ctx.variables.some(v => new RegExp(`\\b${bufferName}\\b`).test(v))) {
      ctx.variables.push(`char ${bufferName}[32];`);
    }
    const prepLine = `snprintf(app->${bufferName}, sizeof(app->${bufferName}), "%ld", (long)(${numExpr}));`;
    if(!ctx.render_prep.includes(prepLine)) ctx.render_prep.push(prepLine);
    return [`app->${bufferName}`, ORDER_ATOMIC];
  };

  (javascriptGenerator.forBlock as any)["flipper_string_length"] = function (block: Blockly.Block) {
    const raw = javascriptGenerator.valueToCode(block, "STRING", ORDER_ATOMIC) || '""';
    // Simply return strlen() - much simpler and more reliable
    return [`strlen(${raw})`, ORDER_ATOMIC];
  };

  (javascriptGenerator.forBlock as any)["flipper_random_number"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    const min = asNumber(block, "MIN", "0");
    const max = asNumber(block, "MAX", "100");
    
    // Mark that random function is used
    ctx.random_used = true;
    
    // Add helper function for unbiased random number generation
    if (!ctx.variables.some(v => v.includes('random_range_helper'))) {
      ctx.variables.push('int random_range_helper;');
    }
    
    // Generate unbiased random number in range [min, max] inclusive
    // Uses rejection sampling to avoid modulo bias and handles edge cases
    const helperFunc = `random_range(${min}, ${max})`;
    return [helperFunc, ORDER_ATOMIC];
  };

  // Storage blocks (simplified implementations)
  (javascriptGenerator.forBlock as any)["flipper_storage_read"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    const path = asString(block, "PATH", '"/ext/apps_data/app/file.txt"');
    
    // Mark that storage functions are used
    ctx.storage_used = true;
    ctx.storage_read_used = true;
    
    // Add storage API context if not present
    if (!ctx.variables.some(v => v.includes('storage_buffer'))) {
      ctx.variables.push('char storage_buffer[1024];');
    }
    
    // Add a prep line to read the file before using the buffer
    const prepLine = `storage_simple_read(app->storage_buffer, sizeof(app->storage_buffer), ${path});`;
    if(!ctx.render_prep.includes(prepLine)) ctx.render_prep.push(prepLine);
    
    return [`app->storage_buffer`, ORDER_ATOMIC];
  };

  (javascriptGenerator.forBlock as any)["flipper_storage_write"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    const path = asString(block, "PATH", '"/ext/apps_data/app/file.txt"');
    const data = asString(block, "DATA", '""');
    
    // Mark that storage functions are used
    ctx.storage_used = true;
    ctx.storage_write_used = true;
    
    // Simplified storage write
    return `        storage_simple_write(${path}, ${data});\n`;
  };

  (javascriptGenerator.forBlock as any)["flipper_storage_exists"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    const path = asString(block, "PATH", '"/ext/apps_data/app/file.txt"');
    
    // Mark that storage functions are used
    ctx.storage_used = true;
    ctx.storage_exists_used = true;
    
    return [`storage_simple_exists(${path})`, ORDER_ATOMIC];
  };

  (javascriptGenerator.forBlock as any)["flipper_storage_create"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    const path = asString(block, "PATH", '"/ext/apps_data/app/file.txt"');
    
    // Mark that storage functions are used
    ctx.storage_used = true;
    ctx.storage_create_used = true;
    
    return `storage_simple_create(${path});\n`;
  };

  (javascriptGenerator.forBlock as any)["flipper_storage_delete"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    const path = asString(block, "PATH", '"/ext/apps_data/app/file.txt"');
    
    // Mark that storage functions are used
    ctx.storage_used = true;
    ctx.storage_delete_used = true;
    
    return `storage_simple_delete(${path});\n`;
  };

  // GPIO Blocks
  (javascriptGenerator.forBlock as any)["flipper_gpio_init"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    const pin = block.getFieldValue("PIN");
    const mode = block.getFieldValue("MODE");
    const pull = block.getFieldValue("PULL");
    
    // Mark that GPIO is used
    ctx.gpio_used = true;
    
    // Convert pin name to GPIO pin constant
    const pinMap: Record<string, string> = {
      "PA7": "&gpio_ext_pa7",
      "PA6": "&gpio_ext_pa6", 
      "PA4": "&gpio_ext_pa4",
      "PB3": "&gpio_ext_pb3",
      "PB2": "&gpio_ext_pb2",
      "PC3": "&gpio_ext_pc3",
      "PC1": "&gpio_ext_pc1",
      "PC0": "&gpio_ext_pc0"
    };
    
    const pinConstant = pinMap[pin] || "&gpio_ext_pa7";
    
    // Convert mode to GPIO mode constant
    const modeMap: Record<string, string> = {
      "INPUT": "GpioModeInput",
      "OUTPUT": "GpioModeOutputPushPull", 
      "ANALOG": "GpioModeAnalog"
    };
    
    const modeConstant = modeMap[mode] || "GpioModeInput";
    
    // Convert pull to GPIO pull constant
    const pullMap: Record<string, string> = {
      "NONE": "GpioPullNo",
      "UP": "GpioPullUp",
      "DOWN": "GpioPullDown"
    };
    
    const pullConstant = pullMap[pull] || "GpioPullNo";
    
    return `furi_hal_gpio_init(${pinConstant}, ${modeConstant}, ${pullConstant}, GpioSpeedVeryHigh);\n`;
  };

  (javascriptGenerator.forBlock as any)["flipper_gpio_write"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    const pin = block.getFieldValue("PIN");
    const state = block.getFieldValue("STATE");
    
    // Mark that GPIO is used
    ctx.gpio_used = true;
    
    // Convert pin name to GPIO pin constant
    const pinMap: Record<string, string> = {
      "PA7": "&gpio_ext_pa7",
      "PA6": "&gpio_ext_pa6",
      "PA4": "&gpio_ext_pa4", 
      "PB3": "&gpio_ext_pb3",
      "PB2": "&gpio_ext_pb2",
      "PC3": "&gpio_ext_pc3",
      "PC1": "&gpio_ext_pc1",
      "PC0": "&gpio_ext_pc0"
    };
    
    const pinConstant = pinMap[pin] || "&gpio_ext_pa7";
    const stateValue = state === "HIGH" ? "true" : "false";
    
    return `furi_hal_gpio_write(${pinConstant}, ${stateValue});\n`;
  };

  (javascriptGenerator.forBlock as any)["flipper_gpio_read"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    const pin = block.getFieldValue("PIN");
    
    // Mark that GPIO is used
    ctx.gpio_used = true;
    
    // Convert pin name to GPIO pin constant
    const pinMap: Record<string, string> = {
      "PA7": "&gpio_ext_pa7",
      "PA6": "&gpio_ext_pa6",
      "PA4": "&gpio_ext_pa4",
      "PB3": "&gpio_ext_pb3", 
      "PB2": "&gpio_ext_pb2",
      "PC3": "&gpio_ext_pc3",
      "PC1": "&gpio_ext_pc1",
      "PC0": "&gpio_ext_pc0"
    };
    
    const pinConstant = pinMap[pin] || "&gpio_ext_pa7";
    
    return [`furi_hal_gpio_read(${pinConstant})`, ORDER_ATOMIC];
  };

  // GPIO: Analog read
  (javascriptGenerator.forBlock as any)["flipper_gpio_analog_read"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    ctx.adc_used = true;
    const pinSel = String((block as any).getFieldValue("PIN") || "PA7");
    const modeSel = String((block as any).getFieldValue("MODE") || "RAW");
    const pinMap: Record<string, string> = {
      PA7: "&gpio_ext_pa7",
      PA6: "&gpio_ext_pa6",
      PA4: "&gpio_ext_pa4",
      PC3: "&gpio_ext_pc3",
      PC1: "&gpio_ext_pc1",
      PC0: "&gpio_ext_pc0",
    };
    const pin = pinMap[pinSel] || "&gpio_ext_pa7";
    // Configure once as analog
    if (!ctx.configured_gpios?.has(pin)) {
      ctx.setup += `    furi_hal_gpio_init(${pin}, GpioModeAnalog, GpioPullNo, GpioSpeedVeryHigh);\n`;
      ctx.configured_gpios?.add(pin);
    }
    const scale = `FuriHalAdcScale2500`;
    const rawExpr = `adc_read_raw_on_gpio(${pin}, ${scale}, FuriHalAdcClockSync64, FuriHalAdcOversample64, FuriHalAdcSamplingtime92_5)`;
    if (modeSel === "MV") {
      return [`adc_raw_to_mv_scale(${rawExpr}, ${scale})`, ORDER_ATOMIC];
    }
    return [`(${rawExpr})`, ORDER_ATOMIC];
  };

  // Track PWM set values for readback
  const ensurePwmVars = (ctx: GenCtx) => {
    const vars = [
      { n: "pwm_pa7_freq", decl: "uint32_t pwm_pa7_freq;" },
      { n: "pwm_pa7_duty", decl: "uint8_t pwm_pa7_duty;" },
      { n: "pwm_pa4_freq", decl: "uint32_t pwm_pa4_freq;" },
      { n: "pwm_pa4_duty", decl: "uint8_t pwm_pa4_duty;" },
    ];
    for (const v of vars) {
      if (!ctx.variables.some(d => d.includes(` ${v.n};`))) ctx.variables.push(v.decl);
    }
  };

  // PWM Blocks
  (javascriptGenerator.forBlock as any)["flipper_pwm_start"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    const pin = String((block as any).getFieldValue("PIN") || "PA7");
    const freq = asNumber(block, "FREQ", "1000");
    const duty = asNumber(block, "DUTY", "50");
    const pinMap: Record<string, string> = {
      PA7: "FuriHalPwmOutputIdTim1PA7",
      PA4: "FuriHalPwmOutputIdLptim2PA4",
    };
    const channel = pinMap[pin];
    if (!channel) {
      return `    // PWM start: unsupported pin ${pin} (use PA7 or PA4)\n`;
    }
    ctx.pwm_used = true;
    ctx.pwm_channels.add(channel);
  // Remember last values for readback
  ensurePwmVars(ctx);
  const store = pin === "PA7" ? `app->pwm_pa7_freq = _f; app->pwm_pa7_duty = _d;` : `app->pwm_pa4_freq = _f; app->pwm_pa4_duty = _d;`;
  return `    // PWM start on ${pin}\n    {\n        uint32_t _f = (uint32_t)(${freq});\n        if(_f == 0) _f = 1;\n        uint8_t _d = (uint8_t)(${duty});\n        if(_d > 100) _d = 100;\n        if(furi_hal_pwm_is_running(${channel})) { furi_hal_pwm_set_params(${channel}, _f, _d); } else { furi_hal_pwm_start(${channel}, _f, _d); }\n        ${store}\n    }\n`;
  };

  (javascriptGenerator.forBlock as any)["flipper_pwm_set"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    const pin = String((block as any).getFieldValue("PIN") || "PA7");
    const freq = asNumber(block, "FREQ", "1000");
    const duty = asNumber(block, "DUTY", "50");
    const pinMap: Record<string, string> = {
      PA7: "FuriHalPwmOutputIdTim1PA7",
      PA4: "FuriHalPwmOutputIdLptim2PA4",
    };
    const channel = pinMap[pin];
    if (!channel) {
      return `    // PWM set: unsupported pin ${pin} (use PA7 or PA4)\n`;
    }
    ctx.pwm_used = true;
    ctx.pwm_channels.add(channel);
  ensurePwmVars(ctx);
  const store = pin === "PA7" ? `app->pwm_pa7_freq = _f; app->pwm_pa7_duty = _d;` : `app->pwm_pa4_freq = _f; app->pwm_pa4_duty = _d;`;
  return `    // PWM set on ${pin}\n    {\n        uint32_t _f = (uint32_t)(${freq});\n        if(_f == 0) _f = 1;\n        uint8_t _d = (uint8_t)(${duty});\n        if(_d > 100) _d = 100;\n        if(furi_hal_pwm_is_running(${channel})) { furi_hal_pwm_set_params(${channel}, _f, _d); } else { furi_hal_pwm_start(${channel}, _f, _d); }\n        ${store}\n    }\n`;
  };

  (javascriptGenerator.forBlock as any)["flipper_pwm_stop"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    const pin = String((block as any).getFieldValue("PIN") || "PA7");
    const pinMap: Record<string, string> = {
      PA7: "FuriHalPwmOutputIdTim1PA7",
      PA4: "FuriHalPwmOutputIdLptim2PA4",
    };
    const channel = pinMap[pin];
    if (!channel) {
      return `    // PWM stop: unsupported pin ${pin} (use PA7 or PA4)\n`;
    }
    ctx.pwm_used = true; // include headers
    // Don't add to init set: stopping doesn't require start on boot
    return `    // PWM stop on ${pin}\n    if(furi_hal_pwm_is_running(${channel})) { furi_hal_pwm_stop(${channel}); }\n`;
  };

  // PWM readback block (returns last set values)
  (javascriptGenerator.forBlock as any)["flipper_pwm_read"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    ensurePwmVars(ctx);
    const pin = String((block as any).getFieldValue("PIN") || "PA7");
    const what = String((block as any).getFieldValue("WHAT") || "DUTY");
    if (pin === "PA7") {
      return [what === "FREQ" ? "app->pwm_pa7_freq" : "app->pwm_pa7_duty", ORDER_ATOMIC];
    } else {
      return [what === "FREQ" ? "app->pwm_pa4_freq" : "app->pwm_pa4_duty", ORDER_ATOMIC];
    }
  };

  // Timer block for periodic execution
  (javascriptGenerator.forBlock as any)["flipper_timer_periodic"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    const interval = block.getFieldValue("INTERVAL") || "500";
    const body = javascriptGenerator.statementToCode(block, "DO") || "";
    
    // Mark that timer is used
    ctx.timer_used = true;
    
    // Store the timer code for later insertion
    if (!ctx.timer_callbacks) {
      ctx.timer_callbacks = [];
    }
    
    const timerId = ctx.timer_callbacks.length;
    ctx.timer_callbacks.push({
      interval: interval,
      body: body
    });
    
    return `    // Timer ${timerId} setup (${interval}ms interval)\n`;
  };

  // 180° Servo block
  (javascriptGenerator.forBlock as any)["flipper_servo_180"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    const pin = block.getFieldValue("PIN");
    const angle = asNumber(block, "ANGLE", "90");
    
    
    // Map pin to PWM channel and store the channel used
    const pwmMap: Record<string, { channel: string, varName: string }> = {
      "PA7": { channel: "FuriHalPwmOutputIdTim1PA7", varName: "servo_pa7_initialized" },
      "PA4": { channel: "FuriHalPwmOutputIdLptim2PA4", varName: "servo_pa4_initialized" },
      // Other pins will use software PWM or error
      "PA6": { channel: "FuriHalPwmOutputIdNone", varName: "" }, 
      "PB3": { channel: "FuriHalPwmOutputIdNone", varName: "" },
      "PB2": { channel: "FuriHalPwmOutputIdNone", varName: "" }, 
      "PC3": { channel: "FuriHalPwmOutputIdNone", varName: "" },
      "PC1": { channel: "FuriHalPwmOutputIdNone", varName: "" },
      "PC0": { channel: "FuriHalPwmOutputIdNone", varName: "" }
    };
    
    const pwmInfo = pwmMap[pin] || { channel: "FuriHalPwmOutputIdNone", varName: "" };
    
    // Generate servo control code optimized for TowerPro SG90
    // SG90 specs: Need 1000-2400µs pulse width for 0-180°, repeated every 20ms
    // Using higher PWM frequency (1000Hz = 1ms period) for better resolution
    // At 1000Hz: 1ms period, so we need multiple cycles to create servo pulses
    // Better approach: Use 50Hz with calculated duty cycles that work with hardware
    // 50Hz = 20ms period. Pulse widths: 1ms(5%), 1.5ms(7.5%), 2.4ms(12%)
    // Hardware quantization means we need to find working duty cycle values
    
    if (pwmInfo.channel === "FuriHalPwmOutputIdNone") {
      // Pin doesn't support hardware PWM - emit only a comment; do not mark PWM used
      return `    // ERROR: Pin ${pin} does not support hardware PWM for servo control (supported: PA7, PA4)\n`;
    }
    // Mark that PWM is used only for supported channels
    ctx.pwm_used = true;
    
    // Track which PWM channels we need to initialize
    if (!ctx.pwm_channels) {
      ctx.pwm_channels = new Set();
    }
    ctx.pwm_channels.add(pwmInfo.channel);
    
  // TIM1 (PA7) uses low-level compare like the working example; others use HAL duty at 50Hz
  if (pwmInfo.channel === "FuriHalPwmOutputIdTim1PA7") {
      ctx.tim1_servo_used = true;
      return `    // Set SG90 servo on ${pin} to ${angle}° (TIM1 compare)\n` +
             `    {\n` +
             `        const uint32_t _servo_freq_hz = 50;\n` +
             `        uint8_t servo_angle = (${angle} > 180) ? 180 : ((${angle} < 0) ? 0 : ${angle});\n` +
             `        uint32_t compare = servo_angle_to_compare(servo_angle);\n` +
             `        if(!furi_hal_pwm_is_running(${pwmInfo.channel})) {\n` +
             `            // Start PWM once to enable output routing on TIM1\n` +
             `            furi_hal_pwm_start(${pwmInfo.channel}, _servo_freq_hz, 7);\n` +
             `        }\n` +
             `        servo_custom_pwm_set_params(_servo_freq_hz, compare);\n` +
             `    }\n`;
    } else {
      // PA4 LPTIM2: use compare-based control for better resolution
      if (pwmInfo.channel === "FuriHalPwmOutputIdLptim2PA4") {
        ctx.lptim_servo_used = true;
        return `    // Set SG90 servo on ${pin} to ${angle}° (LPTIM2 compare)\n` +
               `    {\n` +
               `        const uint32_t _servo_freq_hz = 50;\n` +
               `        uint16_t servo_angle = (${angle} > 180) ? 180 : ((${angle} < 0) ? 0 : ${angle});\n` +
               `        if(!furi_hal_pwm_is_running(${pwmInfo.channel})) {\n` +
               `            // Start once to route PA4 to LPTIM2; duty is placeholder\n` +
               `            furi_hal_pwm_start(${pwmInfo.channel}, _servo_freq_hz, 7);\n` +
               `        }\n` +
               `        uint32_t period_ticks = LL_LPTIM_GetAutoReload(LPTIM2);\n` +
               `        if(period_ticks == 0) {\n` +
               `            // Nudge params to ensure ARR is latched\n` +
               `            furi_hal_pwm_set_params(${pwmInfo.channel}, _servo_freq_hz, 7);\n` +
               `            period_ticks = LL_LPTIM_GetAutoReload(LPTIM2);\n` +
               `        }\n` +
               `        uint32_t compare = servo_angle_to_lptim_compare((uint8_t)servo_angle, period_ticks);\n` +
               `        servo_lptim2_set_params(_servo_freq_hz, compare);\n` +
               `    }\n`;
      }
      // Fallback for any other supported PWM channel (currently none besides PA4/PA7)
      return `    // Set SG90 servo on ${pin} to ${angle}° (HAL duty)\n` +
             `    {\n` +
             `        const uint32_t _servo_freq_hz = 50;\n` +
             `        uint16_t servo_angle = (${angle} > 180) ? 180 : ((${angle} < 0) ? 0 : ${angle});\n` +
             `        uint8_t duty_cycle = (uint8_t)(3 + ((uint32_t)servo_angle * 10) / 180);\n` +
             `        if(duty_cycle < 1) duty_cycle = 1;\n` +
             `        if(duty_cycle > 99) duty_cycle = 99;\n` +
             `        if(furi_hal_pwm_is_running(${pwmInfo.channel})) {\n` +
             `            furi_hal_pwm_set_params(${pwmInfo.channel}, _servo_freq_hz, duty_cycle);\n` +
             `        } else {\n` +
             `            furi_hal_pwm_start(${pwmInfo.channel}, _servo_freq_hz, duty_cycle);\n` +
             `        }\n` +
             `    }\n`;
    }
  };

  // Servo unlock block: stop PWM output to release holding torque
  (javascriptGenerator.forBlock as any)["flipper_servo_unlock"] = function (block: Blockly.Block) {
    const ws = block.workspace;
    const ctx = ensureCtx(ws);
    const pin = block.getFieldValue("PIN");
    const pinMap: Record<string, string> = {
      "PA7": "FuriHalPwmOutputIdTim1PA7",
      "PA4": "FuriHalPwmOutputIdLptim2PA4",
    };
    const channel = pinMap[pin];
    if (!channel) {
      // Unsupported pin; no-op comment
      return `    // Servo unlock: pin ${pin} not supported (only PA7/PA4)\n`;
    }
  // We will need PWM header; do NOT add to init list so we don't auto-start PWM
  ctx.pwm_used = true;
    return `    // Unlock servo on ${pin}\n    if(furi_hal_pwm_is_running(${channel})) { furi_hal_pwm_stop(${channel}); }\n`;
  };

  // Hex literal block
  (javascriptGenerator.forBlock as any)["flipper_hex_number"] = function(block: Blockly.Block) {
    const txt = (block.getFieldValue("HEX") || "0x0").toString();
    // Assume validated format 0x[0-9A-F]; just return as-is
    return [txt, ORDER_ATOMIC];
  };

  // I2C Blocks Generators
  (javascriptGenerator.forBlock as any)["flipper_i2c_device_ready"] = function(block: Blockly.Block) {
    const ws = block.workspace; const ctx = ensureCtx(ws); ctx.i2c_used = true;
    const bus = (block.getFieldValue("BUS") === "EXT") ? 0 : 1; // 0 external, 1 power
    const addr = asNumber(block, "ADDR", "0x00");
    const timeout = asNumber(block, "TIMEOUT", "50");
    return [`kb_i2c_device_ready(${bus}, (uint8_t)(${addr}), (uint32_t)(${timeout}))`, ORDER_ATOMIC];
  };
  (javascriptGenerator.forBlock as any)["flipper_i2c_read_reg8"] = function(block: Blockly.Block) {
    const ws = block.workspace; const ctx:any = ensureCtx(ws); ctx.i2c_used = true; ctx.i2c_need_read_reg8 = true;
    const bus = (block.getFieldValue("BUS") === "EXT") ? 0 : 1;
    const addr = asNumber(block, "ADDR", "0x00");
    const reg = asNumber(block, "REG", "0x00");
    const timeout = asNumber(block, "TIMEOUT", "50");
    // allocate temp var once (per count) using render_prep pre-exec buffer if needed
    const varName = `i2c_reg8_${ctx.render_prep.length}`;
    if(!ctx.variables.some(v=>v.includes(varName))) ctx.variables.push(`uint8_t ${varName};`);
    const prep = `kb_i2c_read_reg8(${bus}, (uint8_t)(${addr}), (uint8_t)(${reg}), &app->${varName}, (uint32_t)(${timeout}));`;
    if(!ctx.render_prep.includes(prep)) ctx.render_prep.push(prep);
    return [`app->${varName}`, ORDER_ATOMIC];
  };
  (javascriptGenerator.forBlock as any)["flipper_i2c_write_reg8"] = function(block: Blockly.Block) {
    const ws = block.workspace; const ctx:any = ensureCtx(ws); ctx.i2c_used = true; ctx.i2c_need_write_reg8 = true;
    const bus = (block.getFieldValue("BUS") === "EXT") ? 0 : 1;
    const addr = asNumber(block, "ADDR", "0x00");
    const reg = asNumber(block, "REG", "0x00");
    const value = asNumber(block, "VALUE", "0");
    const timeout = asNumber(block, "TIMEOUT", "50");
    return `    kb_i2c_write_reg8(${bus}, (uint8_t)(${addr}), (uint8_t)(${reg}), (uint8_t)(${value}), (uint32_t)(${timeout}));\n`;
  };
  (javascriptGenerator.forBlock as any)["flipper_i2c_read_reg16"] = function(block: Blockly.Block) {
    const ws = block.workspace; const ctx:any = ensureCtx(ws); ctx.i2c_used = true; ctx.i2c_need_read_reg16 = true;
    const bus = (block.getFieldValue("BUS") === "EXT") ? 0 : 1;
    const addr = asNumber(block, "ADDR", "0x00");
    const reg = asNumber(block, "REG", "0x00");
    const timeout = asNumber(block, "TIMEOUT", "50");
    const varName = `i2c_reg16_${ctx.render_prep.length}`;
    if(!ctx.variables.some(v=>v.includes(varName))) ctx.variables.push(`uint16_t ${varName};`);
    const prep = `kb_i2c_read_reg16(${bus}, (uint8_t)(${addr}), (uint8_t)(${reg}), &app->${varName}, (uint32_t)(${timeout}));`;
    if(!ctx.render_prep.includes(prep)) ctx.render_prep.push(prep);
    return [`app->${varName}`, ORDER_ATOMIC];
  };
  (javascriptGenerator.forBlock as any)["flipper_i2c_write_reg16"] = function(block: Blockly.Block) {
    const ws = block.workspace; const ctx:any = ensureCtx(ws); ctx.i2c_used = true; ctx.i2c_need_write_reg16 = true;
    const bus = (block.getFieldValue("BUS") === "EXT") ? 0 : 1;
    const addr = asNumber(block, "ADDR", "0x00");
    const reg = asNumber(block, "REG", "0x00");
    const value = asNumber(block, "VALUE", "0");
    const timeout = asNumber(block, "TIMEOUT", "50");
    return `    kb_i2c_write_reg16(${bus}, (uint8_t)(${addr}), (uint8_t)(${reg}), (uint16_t)(${value}), (uint32_t)(${timeout}));\n`;
  };

  // I2C read bytes (memory burst)
  (javascriptGenerator.forBlock as any)["flipper_i2c_read_bytes"] = function(block: Blockly.Block) {
    const ws = block.workspace; const ctx:any = ensureCtx(ws); ctx.i2c_used = true; ctx.i2c_need_read_mem_bytes = true;
    const bus = (block.getFieldValue("BUS") === "EXT") ? 0 : 1;
    const addr = asNumber(block, "ADDR", "0x00");
    const mem = asNumber(block, "MEM", "0x00");
    const lenExpr = asNumber(block, "LEN", "1");
    const timeout = asNumber(block, "TIMEOUT", "50");
    // Attempt to parse a literal length at generation time for array sizing; fallback clamp 32
    let lengthLiteral = 0;
  try { lengthLiteral = parseInt(lenExpr.replace(/[^0-9]/g,''),10); } catch { /* ignore parse issues */ }
    if(!Number.isFinite(lengthLiteral) || lengthLiteral <= 0) lengthLiteral = 1;
    if(lengthLiteral > 64) lengthLiteral = 64; // safety cap
    const arrName = `i2c_read_bytes_${ctx.variables.filter(v=>v.includes('i2c_read_bytes_')).length}`;
    if(!ctx.variables.some(v=>v.includes(arrName+"["))) {
      ctx.variables.push(`uint8_t ${arrName}[${lengthLiteral}] ;`);
    }
    const prep = `kb_i2c_read_mem_bytes(${bus}, (uint8_t)(${addr}), (uint8_t)(${mem}), ${arrName}, ${lengthLiteral}, (uint32_t)(${timeout}));`;
    if(!ctx.render_prep.includes(prep)) ctx.render_prep.push(prep);
    return [arrName, ORDER_ATOMIC];
  };

  // I2C update bits (8-bit)
  (javascriptGenerator.forBlock as any)["flipper_i2c_update_bits8"] = function(block: Blockly.Block) {
    const ws = block.workspace; const ctx:any = ensureCtx(ws); ctx.i2c_used = true; ctx.i2c_need_read_reg8 = true; ctx.i2c_need_write_reg8 = true;
    const bus = (block.getFieldValue("BUS") === "EXT") ? 0 : 1;
    const addr = asNumber(block, "ADDR", "0x00");
    const reg = asNumber(block, "REG", "0x00");
    const mask = asNumber(block, "MASK", "0");
    const value = asNumber(block, "VALUE", "0");
    const timeout = asNumber(block, "TIMEOUT", "50");
    // Pre-exec code: read, modify, write. We compute shift server-side for literal masks; fallback to runtime loop.
    // We'll embed the logic inline here (statement block)
    return `    { uint8_t _tmp; if(kb_i2c_read_reg8(${bus}, (uint8_t)(${addr}), (uint8_t)(${reg}), &_tmp, (uint32_t)(${timeout}))) { uint8_t _m = (uint8_t)(${mask}); if(_m) { uint8_t _v = (uint8_t)(${value}); uint8_t _shift = 0; uint8_t _t=_m; while((_t & 1u)==0u){ _t >>= 1; _shift++; if(_t==0) break; } _v = (uint8_t)((_v << _shift) & _m); _tmp = (uint8_t)((_tmp & (uint8_t)(~_m)) | _v); kb_i2c_write_reg8(${bus}, (uint8_t)(${addr}), (uint8_t)(${reg}), _tmp, (uint32_t)(${timeout})); } } }\n`;
  };

  // Byte stream length
  (javascriptGenerator.forBlock as any)["flipper_byte_stream_length"] = function(block: Blockly.Block) {
    const stream = (javascriptGenerator as any).valueToCode(block,'STREAM', ORDER_ATOMIC) || '0';
    if(stream.startsWith('byte_stream_') || stream.startsWith('i2c_read_bytes_')) {
      return [`(int)sizeof(${stream})`, ORDER_ATOMIC];
    }
    return ['0', ORDER_ATOMIC];
  };

  // Byte stream get byte
  (javascriptGenerator.forBlock as any)["flipper_byte_stream_get_byte"] = function(block: Blockly.Block) {
    const stream = (javascriptGenerator as any).valueToCode(block,'STREAM', ORDER_ATOMIC) || '0';
    const idx = asNumber(block, 'INDEX', '0');
    if(stream.startsWith('byte_stream_') || stream.startsWith('i2c_read_bytes_')) {
      return [`(${idx} < (int)sizeof(${stream}) ? ${stream}[${idx}] : 0)`, ORDER_ATOMIC];
    }
    return ['0', ORDER_ATOMIC];
  };

  // Byte stream literal -> produces struct { data pointer + length } via static array in App
  (javascriptGenerator.forBlock as any)["flipper_byte_stream"] = function(block: Blockly.Block) {
    const ws = block.workspace; const ctx = ensureCtx(ws);
    const raw = (block.getFieldValue("BYTES")||"").trim();
    const tokens = raw ? raw.split(/ +/) : [];
    // Derive a unique name per occurrence
    const idx = ctx.variables.filter(v=>v.includes('byte_stream_')).length;
    const arrName = `byte_stream_${idx}`;
    if(!ctx.variables.some(v=>v.includes(arrName+"["))) {
      const bytes = tokens.filter(t=>t.length).map(t=>`0x${t}`); // assume validation ensures 2 hex chars
      const init = bytes.length ? bytes.join(', ') : '0x00';
      ctx.variables.push(`uint8_t ${arrName}[${Math.max(bytes.length,1)}] = { ${init} };`);
    }
    // Represent value as a struct expression {ptr,len}
    return [`${arrName}`, ORDER_ATOMIC];
  };

  // I2C write bytes (memory) block
  (javascriptGenerator.forBlock as any)["flipper_i2c_write_bytes"] = function(block: Blockly.Block) {
    const ws = block.workspace; const ctx:any = ensureCtx(ws); ctx.i2c_used = true; ctx.i2c_need_write_mem_bytes = true;
    const bus = (block.getFieldValue("BUS") === "EXT") ? 0 : 1;
    const addr = asNumber(block, "ADDR", "0x00");
    const mem = asNumber(block, "MEM", "0x00");
    const dataConn = block.getInputTargetBlock("DATA");
    let dataExpr = 'byte_stream_0'; // fallback
    if(dataConn) {
      // Expect the byte stream block returns array name
      const tuple = (javascriptGenerator as any).valueToCode(block, 'DATA', ORDER_ATOMIC) || '';
      if(tuple) dataExpr = tuple;
    }
    const timeout = asNumber(block, "TIMEOUT", "50");
    // Need length. We stored arrays as variables; can't compute length from expression generically.
    // Heuristic: if dataExpr matches our naming pattern, compute size via sizeof.
    const lenExpr = dataExpr.startsWith('byte_stream_') ? `sizeof(${dataExpr})` : '0';
    return `    kb_i2c_write_mem_bytes(${bus}, (uint8_t)(${addr}), (uint8_t)(${mem}), ${dataExpr}, ${lenExpr}, (uint32_t)(${timeout}));\n`;
  };

  // Export function to build final C file from accumulated context
  // Export pure helpers so callers don't need to touch Blockly namespace
  const build = (ws: Blockly.Workspace): string => {
    const ctx = ensureCtx(ws);
  const includes = [
      "#include <furi.h>",
      "#include <furi_hal.h>", // For hardware abstraction (random, etc.)
  ctx.adc_used ? "#include <furi_hal_adc.h>" : "",
  ctx.adc_used ? "#include <furi_hal_resources.h>" : "",
  ctx.i2c_used ? "#include <furi_hal_i2c.h>" : "",
      "#include <gui/gui.h>",
      "#include <gui/view_dispatcher.h>",
      "#include <gui/modules/widget.h>",
      "#include <input/input.h>",
      "#include <storage/storage.h>", // For file operations
      "#include <string.h>", // For string operations
      "#include <stdio.h>", // For snprintf
      "#include <stdlib.h>", // For atoi
      "#include <stdint.h>", // For UINT32_MAX
      "#include <math.h>", // For math operations like pow()
      ctx.notifs ? "#include <notification/notification.h>\n#include <notification/notification_messages.h>" : "",
  ctx.pwm_used ? "#include <furi_hal_pwm.h>" : "",
  ctx.tim1_servo_used ? "#include <stm32wbxx_ll_tim.h>" : "",
  ctx.lptim_servo_used ? "#include <stm32wbxx_ll_lptim.h>" : "",
  (ctx.tim1_servo_used || ctx.lptim_servo_used) ? "#include <stm32wbxx_ll_rcc.h>" : "",
  (ctx.ultrasonic_used || ctx.dht11_used || ctx.need_5v) ? "#include <furi_hal_power.h>" : "",
      "#include <furi/core/log.h>",
    ]
      .filter(Boolean)
      .join("\n");

    const enums = `
typedef enum {
    MyViewWidget,
} ViewId;

typedef enum {
    CustomEventTypeRedraw,
} CustomEventType;

${ctx.storage_used ? `// Helper functions for simplified storage operations` : ''}
${ctx.storage_read_used ? `static bool storage_simple_read(char* buffer, size_t buffer_size, const char* path) {
    Storage* storage = furi_record_open(RECORD_STORAGE);
    File* file = storage_file_alloc(storage);
    bool success = false;
    
    if(storage_file_open(file, path, FSAM_READ, FSOM_OPEN_EXISTING)) {
        size_t bytes_read = storage_file_read(file, buffer, buffer_size - 1);
        buffer[bytes_read] = '\\0';
        success = true;
    } else {
        buffer[0] = '\\0';
    }
    
    storage_file_close(file);
    storage_file_free(file);
    furi_record_close(RECORD_STORAGE);
    return success;
}

` : ''}${ctx.storage_write_used ? `static bool storage_simple_write(const char* path, const char* data) {
    Storage* storage = furi_record_open(RECORD_STORAGE);
    File* file = storage_file_alloc(storage);
    bool success = false;
    
    if(storage_file_open(file, path, FSAM_WRITE, FSOM_CREATE_ALWAYS)) {
        size_t data_len = strlen(data);
        success = storage_file_write(file, data, data_len) == data_len;
    }
    
    storage_file_close(file);
    storage_file_free(file);
    furi_record_close(RECORD_STORAGE);
    return success;
}

` : ''}${ctx.storage_exists_used ? `static bool storage_simple_exists(const char* path) {
    Storage* storage = furi_record_open(RECORD_STORAGE);
    bool exists = storage_file_exists(storage, path);
    furi_record_close(RECORD_STORAGE);
    return exists;
}

` : ''}${ctx.storage_create_used ? `static bool storage_simple_create(const char* path) {
    Storage* storage = furi_record_open(RECORD_STORAGE);
    File* file = storage_file_alloc(storage);
    bool success = false;
    
    if(storage_file_open(file, path, FSAM_WRITE, FSOM_CREATE_ALWAYS)) {
        success = true;
    }
    
    storage_file_close(file);
    storage_file_free(file);
    furi_record_close(RECORD_STORAGE);
    return success;
}

` : ''}${ctx.storage_delete_used ? `static bool storage_simple_delete(const char* path) {
    Storage* storage = furi_record_open(RECORD_STORAGE);
    bool success = storage_simply_remove(storage, path);
    furi_record_close(RECORD_STORAGE);
    return success;
}

` : ''}

${ctx.random_used ? `// Helper function for unbiased random number generation
// Uses rejection sampling to avoid modulo bias that occurs with simple % operations
// Handles edge cases: min > max (swaps them), min == max (returns min)
// Returns random number in range [min, max] inclusive
static int random_range(int min, int max) {
    if (min > max) {
        // Swap if min > max
        int temp = min;
        min = max;
        max = temp;
    }
    
    if (min == max) {
        return min;
    }
    
    uint32_t range = (uint32_t)(max - min + 1);
    uint32_t limit = UINT32_MAX - (UINT32_MAX % range);
    uint32_t random_val;
    
    // Rejection sampling to avoid modulo bias
    do {
        random_val = furi_hal_random_get();
    } while (random_val >= limit);
    
    return min + (int)(random_val % range);
}` : ''}

${ctx.string_to_number_used ? `// Helper function to extract the first number from a string
// Scans through the string and extracts the first sequence of digits found
static int extract_number_from_string(const char* str) {
    if (!str) return 0;
    
    // Skip non-digit characters to find the first digit
    while (*str && (*str < '0' || *str > '9')) {
        str++;
    }
    
    // If no digits found, return 0
    if (!*str) return 0;
    
    // Use atoi from the first digit position
    return atoi(str);
}` : ''}

${ctx.adc_used ? `// ADC helpers for external analog reads
static FuriHalAdcChannel adc_channel_for_gpio(const GpioPin* pin) {
  int32_t num = furi_hal_resources_get_ext_pin_number(pin);
  if(num < 0) return FuriHalAdcChannelNone;
  const GpioPinRecord* rec = furi_hal_resources_pin_by_number((uint8_t)num);
  return rec ? rec->channel : FuriHalAdcChannelNone;
}

static uint16_t adc_read_raw_on_channel(FuriHalAdcChannel channel, FuriHalAdcScale scale, FuriHalAdcClock clk, FuriHalAdcOversample ov, FuriHalAdcSamplingTime st) {
  if(channel == FuriHalAdcChannelNone) return 0;
  FuriHalAdcHandle* h = furi_hal_adc_acquire();
  furi_hal_adc_configure_ex(h, scale, clk, ov, st);
  uint16_t v = furi_hal_adc_read(h, channel);
  furi_hal_adc_release(h);
  return v;
}

static uint16_t adc_read_raw_on_gpio(const GpioPin* pin, FuriHalAdcScale scale, FuriHalAdcClock clk, FuriHalAdcOversample ov, FuriHalAdcSamplingTime st) {
  return adc_read_raw_on_channel(adc_channel_for_gpio(pin), scale, clk, ov, st);
}

static inline int adc_raw_to_mv_scale(uint16_t raw, FuriHalAdcScale scale) {
  const int scale_mv = (scale == FuriHalAdcScale2500) ? 2500 : 2048;
  int mv = (int)((raw * (long)scale_mv) / 4095L);
  if(mv < 0) {
    mv = 0;
  }
  if(mv > scale_mv) {
    mv = scale_mv;
  }
  return mv;
}
` : ''}

${ctx.ultrasonic_used ? `// HC-SR04 measurement helper returning distance in centimeters
// Reuses TX/RX default pins by default; can accept any GPIO pair
static inline float hc_sr04_us_to_cm(uint32_t us) {
  // speed of sound ~343 m/s => 29.1 us per cm round-trip; commonly 58 us per cm one-way*2
  // Using the datasheet formula: uS / 58 = cm
  return (float)us / 58.0f;
}

static float hc_sr04_measure_cm(const GpioPin* trig, const GpioPin* echo) {
  // Ensure 5V available (USB or OTG)
  if(!furi_hal_power_is_otg_enabled() && !furi_hal_power_is_charging()) {
    furi_hal_power_enable_otg();
  }

  // If using USART pins, temporarily acquire UART control so we can repurpose pins
  bool used_usart_pins = (trig == &gpio_usart_tx) || (echo == &gpio_usart_rx);
  FuriHalSerialHandle* serial_handle = NULL;
  if(used_usart_pins) {
    serial_handle = furi_hal_serial_control_acquire(FuriHalSerialIdUsart);
  }

  // Configure pins
  furi_hal_gpio_write(trig, false);
  furi_hal_gpio_init(trig, GpioModeOutputPushPull, GpioPullNo, GpioSpeedVeryHigh);
  furi_hal_gpio_init(echo, GpioModeInput, GpioPullNo, GpioSpeedVeryHigh);

  const uint32_t timeout_ms = 50; // shorter blocking window per call

  // 10us trigger pulse
  furi_hal_gpio_write(trig, true);
  furi_delay_us(10);
  furi_hal_gpio_write(trig, false);

  const uint32_t start = furi_get_tick();
  // Wait for echo go high
  while((furi_get_tick() - start) < timeout_ms && !furi_hal_gpio_read(echo)) {
    // spin
  }
  if(!furi_hal_gpio_read(echo)) {
    return -1.0f; // timeout
  }
  const uint32_t pulse_start = DWT->CYCCNT;
  // Wait for echo fall
  while((furi_get_tick() - start) < timeout_ms && furi_hal_gpio_read(echo)) {
    // spin
  }
  const uint32_t pulse_end = DWT->CYCCNT;

  uint32_t us = (pulse_end - pulse_start) / furi_hal_cortex_instructions_per_microsecond();
  float cm = hc_sr04_us_to_cm(us);

  // Restore USART pin alternate functions if needed
  if(used_usart_pins) {
    furi_hal_gpio_init_ex(&gpio_usart_tx, GpioModeAltFunctionPushPull, GpioPullUp, GpioSpeedVeryHigh, GpioAltFn7USART1);
    furi_hal_gpio_init_ex(&gpio_usart_rx, GpioModeAltFunctionPushPull, GpioPullUp, GpioSpeedVeryHigh, GpioAltFn7USART1);
    if(serial_handle) furi_hal_serial_control_release(serial_handle);
  }

  return cm;
}
` : ''}

${ctx.i2c_used ? `// Simple I2C helper wrappers (auto-acquire + release).
// Bus index 0 = GPIO external bus (PA7 SDA, PA6 SCL) -> furi_hal_i2c_handle_external
// Bus index 1 = Internal (power) bus -> furi_hal_i2c_handle_power
static const FuriHalI2cBusHandle* _resolve_i2c_handle(int bus_sel) {
  return bus_sel == 0 ? &furi_hal_i2c_handle_external : &furi_hal_i2c_handle_power;
}
${(ctx as any).i2c_need_read_reg8 ? `static bool kb_i2c_read_reg8(int bus_sel, uint8_t addr7, uint8_t reg, uint8_t* out, uint32_t timeout) {
  const FuriHalI2cBusHandle* h = _resolve_i2c_handle(bus_sel);
  furi_hal_i2c_acquire(h);
  bool ok = furi_hal_i2c_read_reg_8(h, addr7, reg, out, timeout);
  furi_hal_i2c_release(h);
  return ok;
}
` : ''}${(ctx as any).i2c_need_write_reg8 ? `static bool kb_i2c_write_reg8(int bus_sel, uint8_t addr7, uint8_t reg, uint8_t value, uint32_t timeout) {
  const FuriHalI2cBusHandle* h = _resolve_i2c_handle(bus_sel);
  furi_hal_i2c_acquire(h);
  bool ok = furi_hal_i2c_write_reg_8(h, addr7, reg, value, timeout);
  furi_hal_i2c_release(h);
  return ok;
}
` : ''}${(ctx as any).i2c_need_read_reg16 ? `static bool kb_i2c_read_reg16(int bus_sel, uint8_t addr7, uint8_t reg, uint16_t* out, uint32_t timeout) {
  const FuriHalI2cBusHandle* h = _resolve_i2c_handle(bus_sel);
  furi_hal_i2c_acquire(h);
  bool ok = furi_hal_i2c_read_reg_16(h, addr7, reg, out, timeout);
  furi_hal_i2c_release(h);
  return ok;
}
` : ''}${(ctx as any).i2c_need_write_reg16 ? `static bool kb_i2c_write_reg16(int bus_sel, uint8_t addr7, uint8_t reg, uint16_t value, uint32_t timeout) {
  const FuriHalI2cBusHandle* h = _resolve_i2c_handle(bus_sel);
  furi_hal_i2c_acquire(h);
  bool ok = furi_hal_i2c_write_reg_16(h, addr7, reg, value, timeout);
  furi_hal_i2c_release(h);
  return ok;
}
` : ''}${(ctx as any).i2c_need_write_mem_bytes ? `static bool kb_i2c_write_mem_bytes(int bus_sel, uint8_t addr7, uint8_t start_reg, const uint8_t* data, size_t len, uint32_t timeout) {
  const FuriHalI2cBusHandle* h = _resolve_i2c_handle(bus_sel);
  furi_hal_i2c_acquire(h);
  bool ok = furi_hal_i2c_write_mem(h, addr7, start_reg, data, len, timeout);
  furi_hal_i2c_release(h);
  return ok;
}
` : ''}${(ctx as any).i2c_need_read_mem_bytes ? `static bool kb_i2c_read_mem_bytes(int bus_sel, uint8_t addr7, uint8_t start_reg, uint8_t* data, size_t len, uint32_t timeout) {
  const FuriHalI2cBusHandle* h = _resolve_i2c_handle(bus_sel);
  furi_hal_i2c_acquire(h);
  bool ok = furi_hal_i2c_read_mem(h, addr7, start_reg, data, len, timeout);
  furi_hal_i2c_release(h);
  return ok;
}
` : ''}${(ctx as any).i2c_need_device_ready ? `static bool kb_i2c_device_ready(int bus_sel, uint8_t addr7, uint32_t timeout) {
  const FuriHalI2cBusHandle* h = _resolve_i2c_handle(bus_sel);
  furi_hal_i2c_acquire(h);
  bool ok = furi_hal_i2c_is_device_ready(h, addr7, timeout);
  furi_hal_i2c_release(h);
  return ok;
}
` : ''}` : ''}

${ctx.dht11_used ? `// DHT11 single-wire bit-banged reader (aligned with Unitemp)
// Uses open-drain with pull-up, disables IRQs during transaction, and distinguishes bits by comparing
// high vs low pulse counters (hT vs lT). Returns ints; on error returns negatives.
static inline void dht11_line_setup(const GpioPin* pin) {
  // Default high, open-drain with pull-up, very high speed
  furi_hal_gpio_write(pin, true);
  furi_hal_gpio_init(pin, GpioModeOutputOpenDrain, GpioPullUp, GpioSpeedVeryHigh);
}

static int dht11_read_raw(const GpioPin* pin, uint8_t data[5]) {
  if(!furi_hal_power_is_otg_enabled() && !furi_hal_power_is_charging()) {
    furi_hal_power_enable_otg();
  }

  dht11_line_setup(pin);

  // Start: pull low >=18ms
  furi_hal_gpio_write(pin, false);
  furi_delay_ms(19);

  // Critical section: keep timings undisturbed
  __disable_irq();
  // Release line (high via pull-up)
  furi_hal_gpio_write(pin, true);

  // Wait sequence: idle high -> sensor pulls low (~80us) -> high (~80us) -> low (start of data)
  uint16_t timeout = 0;
  while(!furi_hal_gpio_read(pin)) { if(++timeout > 500) { __enable_irq(); return -1; } }
  timeout = 0;
  while(furi_hal_gpio_read(pin)) { if(++timeout > 500) { __enable_irq(); return -2; } }
  while(!furi_hal_gpio_read(pin)) { if(++timeout > 500) { __enable_irq(); return -3; } }
  timeout = 0;
  while(furi_hal_gpio_read(pin)) { if(++timeout > 500) { __enable_irq(); return -4; } }

  // Read 5 bytes MSB-first
  for(uint8_t a = 0; a < 5; a++) {
    data[a] = 0;
    for(int8_t b = 7; b >= 0; b--) {
      uint16_t hT = 0, lT = 0;
      // count low duration
      while(!furi_hal_gpio_read(pin) && lT != 65535) lT++;
      // count high duration
      while(furi_hal_gpio_read(pin) && hT != 65535) hT++;
      if(hT > lT) data[a] |= (1u << b);
    }
  }

  __enable_irq();

  // Checksum
  if(((uint8_t)(data[0] + data[1] + data[2] + data[3])) != data[4]) return -5;
  return 0;
}

static int dht11_read_temperature_c(const GpioPin* pin) {
  uint8_t d[5] = {0};
  int r = dht11_read_raw(pin, d);
  if(r != 0) return -99;
  // Base integer part
  int temp = (int)d[2];
  // Some clones put sign/fraction in d[3]
  if(d[3] != 0) {
    if(d[3] & 0x80) {
      // negative fraction magnitude in low 7 bits
      int frac = (int)(d[3] & 0x7F);
      temp = -(temp + (frac > 0 ? 1 : 0));
    }
  }
  return temp;
}

static int dht11_read_humidity_percent(const GpioPin* pin) {
  uint8_t d[5] = {0};
  int r = dht11_read_raw(pin, d);
  if(r != 0) return -1;
  return (int)d[0];
}
` : ''}

${ctx.tim1_servo_used ? `// Map servo angle (0-180) to TIM1 compare value at 50Hz, matching known-good values (TIM1/PA7)
static inline uint32_t servo_angle_to_compare(uint8_t angle) {
  const uint32_t min_compare = 1920; // ~3%
  const uint32_t max_compare = 8320; // ~13%
  if(angle <= 0) return min_compare;
  if(angle >= 180) return max_compare;
  return min_compare + (uint32_t)((((uint32_t)angle) * (max_compare - min_compare)) / 180u);
}

// Low-level TIM1 parameter update (prescaler, period, compare) at the requested frequency
static void servo_custom_pwm_set_params(uint32_t freq, uint32_t compare) {
  if(freq == 0) return;
  uint32_t freq_div = 64000000UL / freq; // TIM1 clock assumed 64MHz
  uint32_t prescaler = freq_div / 0x10000UL;
  uint32_t period = freq_div / (prescaler + 1UL);
  if(period == 0) period = 1;

  LL_TIM_SetPrescaler(TIM1, prescaler);
  LL_TIM_SetAutoReload(TIM1, period - 1);
  LL_TIM_OC_SetCompareCH1(TIM1, compare);
}
` : ''}

${ctx.lptim_servo_used ? `// Map servo angle (0-180) to LPTIM2 compare/ARR at 50Hz (PA4)
// We keep frequency at 50Hz and compute a compare value matching ~0.5–2.4ms pulses
static inline uint32_t servo_angle_to_lptim_compare(uint8_t angle, uint32_t period_ticks) {
  // For SG90 ~500–2400us; proportionally map across period
  const uint32_t min_us = 500;
  const uint32_t max_us = 2400;
  if(angle > 180) angle = 180;
  uint32_t pulse_us = min_us + ((uint32_t)angle * (max_us - min_us)) / 180u;
  // Ticks = pulse_us * (period_ticks / 20000us)
  return (pulse_us * period_ticks) / 20000u;
}

// Low-level LPTIM2 parameter update: set period and compare for 50Hz
static void servo_lptim2_set_params(uint32_t freq_hz, uint32_t compare) {
  if(freq_hz == 0) return;
  // LPTIM clocks vary; use HAL wrapper to set frequency via PWM first, then adjust compare
  // We assume furi_hal_pwm_start has already routed PA4 to LPTIM2 output.
  uint32_t period_ticks = LL_LPTIM_GetAutoReload(LPTIM2);
  if(period_ticks == 0) {
    // If not yet configured, approximate period by starting PWM once at desired freq and read ARR
    // Caller should ensure furi_hal_pwm_start was invoked.
    period_ticks = LL_LPTIM_GetAutoReload(LPTIM2);
    if(period_ticks == 0) return;
  }
  if(compare >= period_ticks) compare = period_ticks - 1;
  LL_LPTIM_SetAutoReload(LPTIM2, period_ticks);
  LL_LPTIM_SetCompare(LPTIM2, compare);
}
` : ''}
`;

    // Split variables: struct-friendly (no initializers/arrays) vs global (arrays or have initializers)
    const structVars = ctx.variables.filter(v => !v.includes('=') && !v.includes('['));
    const globalVars = ctx.variables.filter(v => v.includes('=') || v.includes('['));

    const global_vars_block = globalVars.length ? `// Global variables generated from blocks (arrays / initialized)
${globalVars.join('\n')}
` : '';

    const app_struct = `
${global_vars_block}typedef struct {
    ViewDispatcher* view_dispatcher;
    Widget* widget;
    ${ctx.notifs ? "NotificationApp* notif;" : ""}
    ${ctx.timer_used ? "FuriTimer* timer;" : ""}
  ${ctx.ultrasonic_used ? "bool otg_enabled;" : ""}
    // Your variables here
  // Scalar variables generated from blocks
  ${structVars.join("\n    ")}
} App;
`;

    // Forward declarations for button callbacks
    const button_forward_decls = ctx.button_callbacks.length ? 
      `// Forward declarations for button callbacks\n${ctx.button_callbacks.map((_, i) => `static void app_button_cb_${i}(GuiButtonType result, InputType type, void* context);`).join('\n')}\n` : "";

    // Timer callback function
    const timer_callback = ctx.timer_used ? `
// Timer callback function
static void app_timer_callback(void* context) {
    App* app = context;
    furi_assert(app);
    
    // Execute timer blocks
${ctx.timer_callbacks.map(timer => timer.body).join("")}
}
` : "";

    const update_render_func = `
static void update_render(App* app) {
    furi_assert(app);
    widget_reset(app->widget);
    // Add widget elements
  // Dynamic value preparation
${ctx.render_prep.map(l => `    ${l}`).join("\n")}
${ctx.widget_elements || `    widget_add_string_multiline_element(app->widget, 64, 32, AlignCenter, AlignCenter, FontPrimary, "Add blocks to Draw section");`}
}
`;

    const custom_event_callback = `
static bool app_custom_event_callback(void* context, uint32_t event) {
    App* app = context;
    furi_assert(app);
    switch(event) {
    case CustomEventTypeRedraw:
        update_render(app);
        return true;
    default:
        return false;
    }
}
`;

    const input_callback = `
static bool app_input_callback(InputEvent* event, void* context) {
    App* app = context;
    furi_assert(app);
  (void)event; // suppress unused parameter warning when no input blocks consume it
    bool consumed = false;

    // Let the blocks handle the input
${ctx.input}

    return consumed;
}
`;

    const navigation_callback = `
static bool app_navigation_callback(void* context) {
    App* app = context;
    furi_assert(app);
    view_dispatcher_stop(app->view_dispatcher);
    return true;
}

static uint32_t app_view_navigation_callback(void* context) {
    App* app = context;
    furi_assert(app);
    view_dispatcher_stop(app->view_dispatcher);
    return VIEW_NONE;
}
`;

    const alloc_func = `
static App* app_alloc() {
    App* app = malloc(sizeof(App));
    furi_assert(app);

    Gui* gui = furi_record_open(RECORD_GUI);
    ${ctx.notifs ? "app->notif = furi_record_open(RECORD_NOTIFICATION);" : ""}

    app->view_dispatcher = view_dispatcher_alloc();
    view_dispatcher_attach_to_gui(app->view_dispatcher, gui, ViewDispatcherTypeFullscreen);
    view_dispatcher_set_custom_event_callback(app->view_dispatcher, app_custom_event_callback);
    view_dispatcher_set_navigation_event_callback(app->view_dispatcher, app_navigation_callback);
    view_dispatcher_set_event_callback_context(app->view_dispatcher, app);

    app->widget = widget_alloc();
    view_set_previous_callback(widget_get_view(app->widget), app_view_navigation_callback);
    view_set_input_callback(widget_get_view(app->widget), app_input_callback);
    view_set_context(widget_get_view(app->widget), app);
    view_dispatcher_add_view(app->view_dispatcher, MyViewWidget, widget_get_view(app->widget));
    
    view_dispatcher_switch_to_view(app->view_dispatcher, MyViewWidget);

    // Initialize variables
${structVars.map(varDecl => {
  const varName = varDecl.match(/(\w+);$/)?.[1];
  if (!varName) return "";
  if (varDecl.includes("char")) {
    return `    app->${varName}[0] = '\\0'; // Initialize string variable`;
  } else {
    return `    app->${varName} = 0; // Initialize numeric variable`;
  }
}).filter(Boolean).join("\n")}

  ${ctx.ultrasonic_used ? `// Make sure DWT cycle counter is enabled for timing
  CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
  DWT->CYCCNT = 0; DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;` : ""}
  ${ctx.dht11_used && !ctx.ultrasonic_used ? `// Enable DWT cycle counter for microsecond timing (used by DHT11)
  CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
  DWT->CYCCNT = 0; DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;` : ""}

${(ctx.need_5v || ctx.ultrasonic_used) ? `
  // Ensure 5V available via OTG for sensors
  if(!furi_hal_power_is_otg_enabled() && !furi_hal_power_is_charging()) {
    furi_hal_power_enable_otg();
  }
` : ""}
    // Custom setup
${ctx.setup}

  ${(ctx.tim1_servo_used || ctx.lptim_servo_used) ? `// Initialize PWM channels for servo defaults
${Array.from(ctx.pwm_channels).map(channel => `    furi_hal_pwm_start(${channel}, 50, 7); // Servo center init`).join('\n')}` : ""}

  ${ctx.timer_used ? `// Setup and start timer
  app->timer = furi_timer_alloc(app_timer_callback, FuriTimerTypePeriodic, app);
  ${ctx.dht11_used ? `// DHT11 warm-up after power: wait ~1.2s before first poll
  furi_delay_ms(1200);` : ``}
  furi_timer_start(app->timer, ${ctx.dht11_used ? "2000" : (ctx.timer_callbacks[0]?.interval || "500")});` : ""}

    return app;
}
`;

  const button_callbacks_block = ctx.button_callbacks.length ? `\n// Button callbacks generated from blocks\n${ctx.button_callbacks.join("\n\n")}\n` : "";

    const free_func = `
static void app_free(App* app) {
    furi_assert(app);
    
    ${ctx.timer_used ? "furi_timer_stop(app->timer);\n    furi_timer_free(app->timer);" : ""}
    
    ${ctx.pwm_used ? `// Stop PWM channels\n${Array.from(ctx.pwm_channels).map(channel => `    furi_hal_pwm_stop(${channel});`).join('\n')}` : ""}
    
    view_dispatcher_remove_view(app->view_dispatcher, MyViewWidget);
    widget_free(app->widget);
    view_dispatcher_free(app->view_dispatcher);

    furi_record_close(RECORD_GUI);
    ${ctx.notifs ? "furi_record_close(RECORD_NOTIFICATION);" : ""}
  ${(ctx.need_5v || ctx.ultrasonic_used || ctx.dht11_used) ? `if(furi_hal_power_is_otg_enabled()) { furi_hal_power_disable_otg(); }` : ""}
    
    free(app);
}
`;

    const main_func = `
int32_t app_main(void* p) {
    UNUSED(p);
    App* app = app_alloc();

    // Trigger initial render
    view_dispatcher_send_custom_event(app->view_dispatcher, CustomEventTypeRedraw);

    // Main loop
    view_dispatcher_run(app->view_dispatcher);
    
    // Optional loop code from blocks
${ctx.loop}

    app_free(app);
    return 0;
}
`;

  const c = [includes, enums, app_struct, button_forward_decls, timer_callback, update_render_func, custom_event_callback, input_callback, navigation_callback, button_callbacks_block, alloc_func, free_func, main_func].join("\n");

  // Final render for manifests with auto defaults
  const renderFam = (spec: FamSpec): string => {
    const parts: string[] = [];
    parts.push("App(");
    parts.push(`    appid="${spec.appid}",`);
    if(spec.name) parts.push(`    name="${spec.name}",`);
    parts.push(`    apptype=${spec.apptype},`);
  // Entry point: fixed to app_main (the generated C entry function)
  parts.push(`    entry_point="app_main",`);
    if(spec.icon) parts.push(`    fap_icon="${spec.icon}",`);
  if(spec.stack) parts.push(`    stack_size=${spec.stack},`);
  if(spec.category) parts.push(`    fap_category="${spec.category}",`);
  if(spec.author) parts.push(`    fap_author="${spec.author}",`);
  if(spec.version) parts.push(`    fap_version="${spec.version}",`);
  if(spec.description) parts.push(`    fap_description="${spec.description}",`);
    parts.push(")");
    return parts.join("\n");
  };

  const famFooter = (ctx.fam_manifests && ctx.fam_manifests.length)
    ? `\n/*\n----- application.fam -----\n${ctx.fam_manifests.map(renderFam).join("\n\n")}\n---------------------------\n*/\n`
    : "";
  return c + famFooter;
  };

  return { build, reset: resetCtx };
}
