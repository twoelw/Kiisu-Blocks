/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Blockly from 'blockly';
import { requestPrompt } from '@/components/ide/blocklyPromptApi';

interface DialogLike {
  setPrompt?: (fn: (message: string, defaultValue: string, callback: (value?: string) => void) => void) => void;
  __kiisuPromptInstalled?: boolean;
}

/** Install a custom prompt override replacing the default window.prompt based implementation. */
export function installPromptOverride() {
  // Try known dialog entry points (Blockly 7+ uses dialog, some older builds exposed Dialog)
  const anyDialog: DialogLike | undefined = (Blockly as any).dialog || (Blockly as any).Dialog;
  if (!anyDialog) return;
  if (anyDialog.__kiisuPromptInstalled) return;

  const handler = (message: string, defaultValue: string, callback: (value?: string) => void) => {
    requestPrompt({
      title: 'Enter Name',
      message,
      defaultValue,
      validate: (v) => !v.trim() ? 'Value required' : null,
    }).then(val => {
      if (val === null) {
        // Fallback: try native prompt in browser (not Electron) if available
        const isElectron = !!(globalThis as any).process?.versions?.electron;
        if (!isElectron && typeof window !== 'undefined' && typeof window.prompt === 'function') {
          try {
            const nativeVal = window.prompt(message, defaultValue);
            callback(nativeVal ?? undefined);
            return;
          } catch { /* ignore */ }
        }
      }
      callback(val ?? undefined);
    }).catch(() => {
      // Final fallback: silent undefined
      callback(undefined);
    });
  };

  if (anyDialog.setPrompt) {
    anyDialog.setPrompt(handler);
  } else if (anyDialog && typeof (anyDialog as any).prompt === 'function') {
    // Older dialog API exposing a prompt function directly on the dialog object – safe to patch.
    const orig = (anyDialog as any).prompt;
    (anyDialog as any).prompt = (message: string, defaultValue: string, cb: (value?: string) => void) => handler(message, defaultValue, cb);
    // (Optional) keep reference if we ever need to restore: (anyDialog as any).__origPrompt = orig;
  }

  anyDialog.__kiisuPromptInstalled = true;
}
