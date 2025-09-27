import * as Blockly from 'blockly'

// Minimal shape for Blockly serialization structures we care about
export interface SerializedBlock {
  type: string
  id?: string
  inputs?: Record<string, SerializedInput>
  next?: { block?: SerializedBlock }
  fields?: Record<string, unknown>
  extraState?: unknown
}

export interface SerializedInput {
  block?: SerializedBlock
  shadow?: SerializedBlock
}

export interface SerializedBlocksRoot {
  blocks?: SerializedBlock[]
}

export interface SerializedWorkspaceLike {
  blocks?: SerializedBlocksRoot
  variables?: unknown[]
  [k: string]: unknown
}

/**
 * Light-weight repair step for Blockly serialization JSON prior to load.
 *
 * Common chatbot outputs sometimes place statement-only blocks (no output
 * connection, e.g. `controls_if`) into value inputs. Blockly's serializer will
 * throw a hard error in this case: "is missing a(n) output connection".
 *
 * This function walks the JSON tree and, when a child block placed in a value
 * input doesn't provide an output connection, it detaches that child and
 * hoists it to the top level. Likewise, if a block is placed in a `next`
 * connection but lacks a `previousStatement` connection, it is hoisted.
 *
 * The goal is to preserve as much of the user's blocks as possible and let the
 * user fix minor placement issues after import, instead of failing entirely.
 */
export function repairSerialization(state: SerializedWorkspaceLike, ws: Blockly.Workspace): SerializedWorkspaceLike {
  if (!state || typeof state !== 'object') return state;
  const blocksRoot = state.blocks;
  if (!blocksRoot || typeof blocksRoot !== 'object') return state;
  const topBlocks = Array.isArray(blocksRoot.blocks) ? blocksRoot.blocks : null;
  if (!topBlocks) return state;

  // Caches to avoid creating temp blocks repeatedly
  const cache = new Map<string, { out: boolean; prev: boolean; next: boolean }>();

  const capabilities = (type: string) => {
    let caps = cache.get(type);
    if (caps) return caps;
    try {
      const tmp = ws.newBlock(type);
      caps = {
        out: !!tmp.outputConnection,
        prev: !!tmp.previousConnection,
        next: !!tmp.nextConnection,
      };
      tmp.dispose(false);
    } catch {
      // Unknown block type – assume flexible to avoid over-repairing
      caps = { out: true, prev: true, next: true };
    }
    cache.set(type, caps);
    return caps;
  };

  const hoisted: SerializedBlock[] = [];

  const fixBlock = (node: SerializedBlock) => {
    const type: string | undefined = node?.type;

    // Fix invalid children in value/statement inputs
    if (node.inputs && typeof node.inputs === 'object') {
      for (const name of Object.keys(node.inputs)) {
        const inputState = node.inputs[name] as SerializedInput | undefined;
        if (!inputState || typeof inputState !== 'object') continue;

        // Only one of block/shadow is relevant here; prefer real block
        const child: SerializedBlock | undefined = inputState.block ?? inputState.shadow;
        if (child && typeof child === 'object' && typeof child.type === 'string') {
          // Determine what this input expects by instantiating the parent type
          if (typeof type === 'string') {
            try {
              const parentTmp = ws.newBlock(type);
              const input = parentTmp.getInput(name);
      // Determine if this input slot is a value input by comparing its internal enum value (undocumented).
      const inputTypes = (Blockly as unknown as { [k: string]: unknown })['inputTypes'] as { VALUE?: number } | undefined;
      const isValue = !!input && (input as unknown as { type?: number }).type === inputTypes?.VALUE;
              parentTmp.dispose(false);
              if (isValue) {
                const caps = capabilities(child.type);
                if (!caps.out) {
                  // Detach and hoist statement-only block from a value slot
                  if (inputState.block) delete inputState.block;
                  if (inputState.shadow) delete inputState.shadow;
                  hoisted.push(child);
                  continue; // nothing more to do for this input
                }
              }
            } catch {
              // If we cannot introspect parent input, fallback to child capability only
              const caps = capabilities(child.type);
              if (!caps.out) {
                if (inputState.block) delete inputState.block;
                if (inputState.shadow) delete inputState.shadow;
                hoisted.push(child);
                continue;
              }
            }
          }
          // Recurse into validly-placed child
          fixBlock(child);
        }
      }
    }

    // Fix invalid `next` chains (value blocks placed where a statement is required)
    if (node.next && node.next.block && typeof node.next.block === 'object') {
      const nb = node.next.block as SerializedBlock;
      if (typeof nb.type === 'string') {
        const caps = capabilities(nb.type);
        if (!caps.prev) {
          hoisted.push(nb);
          delete node.next.block;
        } else {
          fixBlock(nb);
        }
      }
    }
  };

  for (const b of topBlocks) fixBlock(b);
  if (hoisted.length) {
    blocksRoot.blocks = [...topBlocks, ...hoisted];
  }
  return state;
}
