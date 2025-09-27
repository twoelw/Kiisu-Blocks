/* eslint-disable @typescript-eslint/no-explicit-any */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  Code2, 
  Play, 
  Square, 
  Copy,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Terminal
} from "lucide-react";
import { useCompiler } from "@/hooks/use-compiler";
import { buildManifest } from "@/lib/manifest-builder";
import { exportWorkspaceJson, getWorkspace } from "@/lib/workspace-export";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const CompilePage = () => {
  const { code } = useCompiler();
  const { toast } = useToast();
  const generatedCode = useMemo(() => code || `#include <stdio.h>

int main(void) {
  printf("Hello, world!\n");
  return 0;
}
`, [code]);

  interface LogLine { type: 'stdout' | 'stderr' | 'system'; text: string }
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [buildId, setBuildId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle'|'running'|'success'|'error'|'cancelled'>('idle');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [faps, setFaps] = useState<string[]>([]);
  const logRef = useRef<HTMLPreElement | null>(null);
  const launchHandlerRef = useRef<null | (() => Promise<void>)>(null);
  const [showFirstInstallDialog, setShowFirstInstallDialog] = useState(false);
  const firstInstallActionRef = useRef<null | (() => Promise<void>)>(null);
  const [probing, setProbing] = useState(false);

  // Helper: ensure environment (probe first, maybe show dialog) then run cb
  const withUfbtReady = useCallback(async (action: () => Promise<void>) => {
    try {
      setProbing(true);
      // @ts-expect-error preload
      const probe = await window.ufbt?.probeEnv?.();
      setProbing(false);
      if (probe?.error) {
        toast({ title: 'uFBT unavailable', description: probe.error });
        return;
      }
      if (probe && probe.needsInstall) {
        // Show dialog – user must confirm the first-time install.
        firstInstallActionRef.current = async () => {
          setShowFirstInstallDialog(false);
          // trigger ensureEnv now (will install)
          // @ts-expect-error preload
          const ensure = await window.ufbt?.ensureEnv?.();
          if (!ensure?.ready) {
            toast({ title: 'Install failed', description: ensure?.error || 'Unknown error installing uFBT' });
            return;
          }
          await action();
        };
        setShowFirstInstallDialog(true);
        return;
      }
      // Already installed; just run.
      await action();
    } catch (e) {
      setProbing(false);
      toast({ title: 'Env check failed', description: String(e instanceof Error ? e.message : e) });
    }
  }, [toast]);

  // Build a stable function that performs the same as the "Compile & Launch" button
  const compileAndLaunch = useCallback(async () => {
    // Reuse the compile logic but call compileLaunch instead
    let appId = 'demo_app';
    let name = 'Demo App';
    let apptype: string | undefined = undefined;
    let icon: string | undefined = undefined;
    let category: string | undefined = undefined;
    let author: string | undefined = undefined;
    let version: string | undefined = undefined;
    let description: string | undefined = undefined;
    let stack: number | undefined = undefined;
    try {
      const ws = getWorkspace();
      if (ws) {
        const blocks = ws.getAllBlocks(false);
        const manifestBlock = blocks.find(b => (b as any).type === 'flipper_manifest');
        if (manifestBlock && (manifestBlock as any).getFieldValue) {
          const get = (field: string) => String((manifestBlock as any).getFieldValue(field) || '').trim();
          const maybeAppId = get('APPID');
          const maybeName = get('NAME');
          const maybeType = get('APPTYPE');
          const maybeIcon = get('ICON');
          const maybeCategory = get('CATEGORY');
          const maybeAuthor = get('AUTHOR');
          const maybeVersion = get('VERSION');
          const maybeDescription = get('DESCRIPTION');
          const maybeStackRaw = get('STACK');
          if (maybeAppId) appId = maybeAppId;
          if (maybeName) name = maybeName;
          if (maybeType) apptype = maybeType;
          if (maybeIcon) icon = maybeIcon;
          if (maybeCategory) category = maybeCategory;
          if (maybeAuthor) author = maybeAuthor;
          if (maybeVersion) version = maybeVersion;
          if (maybeDescription) description = maybeDescription;
          if (maybeStackRaw) {
            const parsed = parseInt(maybeStackRaw, 10);
            if (!Number.isNaN(parsed) && parsed > 0) stack = parsed;
          }
        }
      }
    } catch { /* ignore */ }

    let manifest: string | null = null;
    try {
      const markerStart = '----- application.fam -----';
      const markerEnd = '---------------------------';
      const startIdx = generatedCode.indexOf(markerStart);
      const endIdx = generatedCode.indexOf(markerEnd, startIdx + markerStart.length);
      if (startIdx !== -1 && endIdx !== -1) {
        const slice = generatedCode.substring(startIdx + markerStart.length, endIdx).trim();
        manifest = slice.startsWith('App(') ? slice + '\n' : null;
        if (manifest) {
          const m = /appid="([A-Za-z0-9_-]+)"/.exec(manifest);
          if (m) appId = m[1];
        }
      }
    } catch { /* ignore */ }
    if (!manifest) {
      manifest = buildManifest({
        appId,
        name,
        appType: (['FlipperAppType.EXTERNAL','FlipperAppType.APP','FlipperAppType.PLUGIN'] as const).includes(apptype as any) ? (apptype as any) : undefined,
        icon,
        category,
        author,
        version,
        description,
        stackSize: stack,
      });
    }
    const workspaceJson = exportWorkspaceJson();
    try {
      // @ts-expect-error: preload
      const res = await window.projects?.writeProject({ appId, manifest, code: generatedCode, workspaceJson });
      if (res?.error || !res?.projectPath) {
        toast({ title: 'Write failed', description: res?.error || 'Unknown error'});
        return;
      }
      setLogLines([{ type: 'system', text: `[start build+launch ${appId}]` }]);
      setStatus('running');
      setStartedAt(Date.now());
      setDurationMs(null);
      setFaps([]);
      // @ts-expect-error: preload
      const start = await window.ufbt?.compileLaunch(res.projectPath);
      if (!start?.started) {
        setStatus('error');
        setLogLines(prev => [...prev, { type: 'stderr', text: start?.error || 'Failed to start build+launch' }]);
        return;
      }
      setBuildId(start.id);
    } catch (e) {
      setStatus('error');
      setLogLines(prev => [...prev, { type: 'stderr', text: String(e instanceof Error ? e.message : e) }]);
    }
  }, [generatedCode, toast]);

  // autoscroll
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logLines]);

  useEffect(() => {
    // register listeners once
    // @ts-expect-error preload
  const offOut = window.ufbt?.onOutput?.((o: { id: string; stream: 'stdout'|'stderr'; line: string; ts: number }) => {
      setLogLines(prev => {
        const next = [...prev, { type: o.stream, text: o.line }];
        if (next.length > 5000) next.splice(0, next.length - 5000);
        return next;
      });
    });
    // @ts-expect-error preload
    const offDone = window.ufbt?.onDone?.((d: { id: string; success: boolean; code: number; durationMs: number; faps: string[] }) => {
      if (buildId && d.id !== buildId) return; // ignore stale
      setStatus(d.success ? 'success' : 'error');
      setDurationMs(d.durationMs);
      setFaps(d.faps);
      setBuildId(null);
      setLogLines(prev => [...prev, { type: 'system', text: `[build ${d.success? 'success':'failed'} code=${d.code}]` }]);
      if (d.faps.length === 0 && d.success) {
        setLogLines(prev => [...prev, { type: 'stderr', text: '[warning] No .fap produced in dist/' }]);
      }
    });
  return () => { if (offOut) offOut(); if (offDone) offDone(); };
  }, [buildId]);

  // Expose a window event to trigger the same action as the "Compile & Launch" button
  useEffect(() => {
    // Create a function that encapsulates the compile+launch logic; we'll update the ref below
    const onLaunchEvent = async () => {
      // Call the latest handler if available
      if (launchHandlerRef.current) {
        try {
          await launchHandlerRef.current();
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("kiisu.blocks.compileLaunch", onLaunchEvent as EventListener);
    return () => {
      window.removeEventListener("kiisu.blocks.compileLaunch", onLaunchEvent as EventListener);
    };
  }, []);

  // Keep the latest handler available as code/workspace changes
  useEffect(() => {
    launchHandlerRef.current = compileAndLaunch;
  }, [compileAndLaunch]);

  const getOutputColor = (type: string) => {
    switch (type) {
      case 'system': return 'text-primary';
      case 'stdout': return 'text-accent';
      case 'stderr': return 'text-red-400';
      default: return 'text-foreground';
    }
  };

  const buildTimeDisplay = () => {
    if (status === 'running' && startedAt) return `${((Date.now()-startedAt)/1000).toFixed(2)}s`; 
    if (durationMs != null) return `${(durationMs/1000).toFixed(2)}s`;
    return '—';
  };

  const warningCount = useMemo(() => logLines.filter(l => l.type !== 'system' && /warning:/i.test(l.text)).length, [logLines]);
  const errorCount = useMemo(() => logLines.filter(l => l.type === 'stderr' || /error:/i.test(l.text)).length, [logLines]);

  return (
    <div className="flex-1 p-8 space-y-6 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold neon-text">Code Compilation</h2>
        </div>
        
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="cyber-border"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(generatedCode);
                toast({ title: "Copied", description: "Generated code copied to clipboard." });
              } catch (e) {
                toast({ title: "Copy failed", description: String(e instanceof Error ? e.message : e) });
              }
            }}
          >
            <Copy className="h-4 w-4 mr-2" />
            Copy Code
          </Button>
        </div>
      </div>

  <div className="grid grid-cols-1 lg:grid-cols-2 lg:auto-rows-min gap-6 items-stretch">
        {/* Generated Code Panel (compact) */}
        <Card className="bg-card cyber-border">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Code2 className="h-5 w-5 text-primary" />
              Generated C Code
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="p-4">
              <pre className="font-mono text-sm bg-background/50 rounded-lg p-4 cyber-border w-full overflow-auto scrollbar-cyber max-h-96 lg:max-h-[32rem]">
                <code className="text-foreground whitespace-pre">
                  {generatedCode}
                </code>
              </pre>
            </div>
          </CardContent>
        </Card>

  {/* Right Column: Status + Logs (logs expands) */}
  <div className="flex flex-col gap-6 h-full">
  <Card className="bg-card cyber-border">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <AlertCircle className="h-5 w-5 text-accent" />
                Compilation Status
              </CardTitle>
            </CardHeader>
            
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">Status</div>
                  <Badge className={
                    status === 'success' ? 'bg-neon-green/20 text-neon-green border-neon-green' :
                    status === 'error' ? 'bg-red-400/20 text-red-400 border-red-400' :
                    status === 'running' ? 'bg-primary/20 text-primary border-primary animate-pulse' :
                    status === 'cancelled' ? 'bg-yellow-500/20 text-yellow-500 border-yellow-500' :
                    'bg-muted text-foreground border-muted'
                  }>
                    {status === 'success' && <CheckCircle className="h-3 w-3 mr-1" />}
                    {status === 'error' && <AlertCircle className="h-3 w-3 mr-1" />}
                    {status === 'running' && <RefreshCw className="h-3 w-3 mr-1 animate-spin" />}
                    {status === 'cancelled' && <Square className="h-3 w-3 mr-1" />}
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </Badge>
                </div>
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">Build Time</div>
                  <div className="font-mono text-primary">{buildTimeDisplay()}</div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">Warnings</div>
                  <div className="font-mono text-accent">{warningCount}</div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">Errors</div>
                  <div className="font-mono text-neon-green">{errorCount}</div>
                </div>
              </div>
              
              <Separator />
              
              <div className="flex gap-2">
                <Button disabled={status==='running' || probing} className="flex-1 cyber-border bg-neon-green/20 hover:bg-neon-green/40 text-neon-green border-neon-green disabled:opacity-50"
                  onClick={async () => {
                    await withUfbtReady(async () => {
                    // Derive manifest data from any flipper_manifest block present in the workspace.
                    // Fallback to simple defaults if none found.
                    let appId = 'demo_app';
                    let name = 'Demo App';
                    let apptype: string | undefined = undefined;
                    let icon: string | undefined = undefined;
                    let category: string | undefined = undefined;
                    let author: string | undefined = undefined;
                    let version: string | undefined = undefined;
                    let description: string | undefined = undefined;
                    let stack: number | undefined = undefined;
                    try {
                      const ws = getWorkspace();
                      if (ws) {
                        const blocks = ws.getAllBlocks(false);
                        // Prefer the first manifest block (multiple not yet formally supported for compile output)
                        const manifestBlock = blocks.find(b => (b as any).type === 'flipper_manifest');
                        if (manifestBlock && (manifestBlock as any).getFieldValue) {
                          const get = (field: string) => String((manifestBlock as any).getFieldValue(field) || '').trim();
                          const maybeAppId = get('APPID');
                          const maybeName = get('NAME');
                          const maybeType = get('APPTYPE');
                          const maybeIcon = get('ICON');
                          const maybeCategory = get('CATEGORY');
                          const maybeAuthor = get('AUTHOR');
                          const maybeVersion = get('VERSION');
                          const maybeDescription = get('DESCRIPTION');
                          const maybeStackRaw = get('STACK');
                          if (maybeAppId) appId = maybeAppId;
                          if (maybeName) name = maybeName;
                          if (maybeType) apptype = maybeType;
                          if (maybeIcon) icon = maybeIcon;
                          if (maybeCategory) category = maybeCategory;
                          if (maybeAuthor) author = maybeAuthor;
                          if (maybeVersion) version = maybeVersion;
                          if (maybeDescription) description = maybeDescription;
                          if (maybeStackRaw) {
                            const parsed = parseInt(maybeStackRaw, 10);
                            if (!Number.isNaN(parsed) && parsed > 0) stack = parsed;
                          }
                        }
                      }
                    } catch { /* ignore extraction errors, keep defaults */ }

                    // Try to extract manifest footer from generated C (preferred, ensures parity with generator output)
                    let manifest: string | null = null;
                    try {
                      const markerStart = '----- application.fam -----';
                      const markerEnd = '---------------------------';
                      const startIdx = generatedCode.indexOf(markerStart);
                      const endIdx = generatedCode.indexOf(markerEnd, startIdx + markerStart.length);
                      if (startIdx !== -1 && endIdx !== -1) {
                        const slice = generatedCode.substring(startIdx + markerStart.length, endIdx).trim();
                        // slice may contain one or multiple App(...) entries
                        manifest = slice.startsWith('App(') ? slice + '\n' : null;
                        // Derive appId from first line if possible
                        if (manifest) {
                          const m = /appid="([A-Za-z0-9_-]+)"/.exec(manifest);
                          if (m) appId = m[1];
                        }
                      }
                    } catch { /* ignore */ }

                    if (!manifest) {
                      manifest = buildManifest({
                        appId,
                        name,
                        appType: (['FlipperAppType.EXTERNAL','FlipperAppType.APP','FlipperAppType.PLUGIN'] as const).includes(apptype as any) ? (apptype as any) : undefined,
                        icon,
                        category,
                        author,
                        version,
                        description,
                        stackSize: stack,
                      });
                    }
                    const workspaceJson = exportWorkspaceJson();
                    try {
                      // save project first
                      // @ts-expect-error: preload bridge injected at runtime
                      const res = await window.projects?.writeProject({ appId, manifest, code: generatedCode, workspaceJson });
                      if (res?.error || !res?.projectPath) {
                        toast({ title: 'Write failed', description: res?.error || 'Unknown error'});
                        return;
                      }
                      setLogLines([{ type: 'system', text: `[start build ${appId}]` }]);
                      setStatus('running');
                      setStartedAt(Date.now());
                      setDurationMs(null);
                      setFaps([]);
                      // @ts-expect-error: preload bridge injected at runtime
                      const start = await window.ufbt?.compile(res.projectPath);
                      if (!start?.started) {
                        setStatus('error');
                        setLogLines(prev => [...prev, { type: 'stderr', text: start?.error || 'Failed to start build' }]);
                        return;
                      }
                      setBuildId(start.id);
                    } catch (e) {
                      setStatus('error');
                      setLogLines(prev => [...prev, { type: 'stderr', text: String(e instanceof Error ? e.message : e) }]);
                    }
                    });
                  }}>
                  <Play className="h-4 w-4 mr-2" />
                  Compile
                </Button>
                <Button disabled={status==='running' || probing} variant="secondary" className="flex-1 cyber-border bg-primary/20 hover:bg-primary/40 text-primary border-primary disabled:opacity-50"
                  onClick={async () => {
                    // Ensure ref is up to date and run it
                    launchHandlerRef.current = compileAndLaunch;
                    await withUfbtReady(async () => {
                      await compileAndLaunch();
                    });
                  }}>
                  <Play className="h-4 w-4 mr-2" />
                  Compile & Launch
                </Button>
                <Button variant="outline" disabled={status!=='running'} className="cyber-border disabled:opacity-50"
                  onClick={async () => {
                    if (!buildId) return;
                    // @ts-expect-error: preload bridge injected at runtime
                    const r = await window.ufbt?.cancel(buildId);
                    if (!r?.cancelled) {
                      setLogLines(prev => [...prev, { type: 'stderr', text: `[cancel failed] ${r?.error||''}` }]);
                    } else {
                      setStatus('cancelled');
                      setLogLines(prev => [...prev, { type: 'system', text: '[cancel requested]' }]);
                    }
                  }}>
                  <Square className="h-4 w-4" />
                </Button>
              </div>
              {faps.length > 0 && (
                <div className="text-xs font-mono break-all space-y-1">
                  <div className="text-muted-foreground">Artifacts (.fap): (click to open in folder)</div>
                  {faps.map(f => (
                    <button
                      key={f}
                      onClick={() => {
                        window.ufbt?.openItem?.(f)
                      }}
                      className="text-left w-full underline decoration-dotted hover:decoration-solid hover:text-primary transition-colors"
                      title="Show in file explorer"
                    >
                      {f}
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

        {/* Logs Card (fills remaining height) */}
        <Card className="bg-card cyber-border flex flex-col flex-1 overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Terminal className="h-5 w-5 text-primary" />
              Logs
              <Badge variant="outline" className="cyber-border ml-auto">Read-only</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 flex flex-col">
            <div className="p-4 flex-1 min-h-0 flex">
              <pre ref={logRef} className="font-mono text-sm bg-background/50 rounded-lg p-4 cyber-border w-full overflow-auto overflow-x-auto scrollbar-cyber flex-1">
                <code className="whitespace-pre text-foreground">
                  {logLines.map((line, i) => (
                    <span key={i} className={`${getOutputColor(line.type)} block`}>{line.text}</span>
                  ))}
                </code>
              </pre>
            </div>
          </CardContent>
        </Card>
      </div>
      </div>
      <Dialog open={showFirstInstallDialog} onOpenChange={setShowFirstInstallDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Setting up uFBT Toolchain</DialogTitle>
            <DialogDescription>
              The Flipper build tool (uFBT) is not installed yet. Kiisu Blocks will now download and install the Python
              environment and SDK/toolchain. This is a one-time setup and can take several minutes depending on your
              internet speed and hardware. During this process additional command windows may appear and the app UI may
              temporarily freeze. Future compilations will be much faster.
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm space-y-2">
            <p className="text-muted-foreground">Please keep the application open until the installation finishes. Once complete, your build will start automatically.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowFirstInstallDialog(false); firstInstallActionRef.current = null; }}>Cancel</Button>
            <Button onClick={async () => { if (firstInstallActionRef.current) await firstInstallActionRef.current(); }}>OK, Install & Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CompilePage;