// Bridge API for custom Blockly prompt dialogs.
// The host component will register an enqueue function here at runtime.
export type PromptOptions = { 
  title?: string; 
  message?: string; 
  defaultValue?: string; 
  placeholder?: string; 
  validate?: (v: string) => string | null 
};

type EnqueueFn = (opts: PromptOptions) => Promise<string | null>;
let enqueuePrompt: EnqueueFn | null = null;

export function _registerPromptEnqueue(fn: EnqueueFn | null) { enqueuePrompt = fn; }

export function requestPrompt(opts: PromptOptions): Promise<string | null> {
  if (!enqueuePrompt) return Promise.resolve(null);
  return enqueuePrompt(opts);
}
