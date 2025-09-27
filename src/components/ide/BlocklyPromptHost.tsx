import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { _registerPromptEnqueue, PromptOptions } from './blocklyPromptApi';

export const BlocklyPromptHost: React.FC = () => {
  const [queue, setQueue] = useState<Array<PromptOptions & { id: number; resolve: (v: string | null) => void }>>([]);
  const [active, setActive] = useState<PromptOptions & { id: number; resolve: (v: string | null) => void } | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    _registerPromptEnqueue((opts) => new Promise((resolve) => {
      setQueue(q => [...q, { ...opts, id: Date.now() + Math.random(), resolve }]);
    }));
    return () => { _registerPromptEnqueue(null); };
  }, []);

  useEffect(() => {
    if (!active && queue.length) {
      const [next, ...rest] = queue;
      setQueue(rest);
      setActive(next);
      setValue(next.defaultValue ?? '');
      setError(null);
    }
  }, [active, queue]);

  useEffect(() => {
    if (active) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [active]);

  const close = useCallback((result: string | null) => {
    if (!active) return;
    active.resolve(result);
    setActive(null);
  }, [active]);

  const onConfirm = useCallback(() => {
    if (!active) return;
    const v = value.trim();
    const valErr = active.validate?.(v) || null;
    if (valErr) { setError(valErr); return; }
    close(v);
  }, [active, value, close]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(null); }
  };

  return (
    <Dialog open={!!active} onOpenChange={(o) => { if (!o) close(null); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{active?.title || 'Input'}</DialogTitle>
          {active?.message && <DialogDescription>{active.message}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-2">
          <Input ref={inputRef} value={value} placeholder={active?.placeholder} onChange={(e) => { setValue(e.target.value); setError(null); }} onKeyDown={onKey} />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter className="mt-4">
          <Button variant="secondary" type="button" onClick={() => close(null)}>Cancel</Button>
          <Button type="button" onClick={onConfirm}>OK</Button>
        </DialogFooter>
        <DialogClose className="hidden" />
      </DialogContent>
    </Dialog>
  );
};

export default BlocklyPromptHost;
