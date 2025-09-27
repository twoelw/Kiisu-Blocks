import { Button } from "@/components/ui/button";
import { Code, FolderOpen, Settings, Play, Download, Upload, BookOpen, Bot } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCompiler } from "@/hooks/use-compiler";
import { getWorkspace, exportWorkspaceJson } from "@/lib/workspace-export";
import { loadWorkspaceFromJson } from "@/lib/workspace-export";
import { buildManifest } from "@/lib/manifest-builder";
import React, { useState } from "react";
import AICodingDialog from "@/components/ide/AICodingDialog";

interface IDEHeaderProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const IDEHeader = ({ activeTab, onTabChange }: IDEHeaderProps) => {
  const tabs = [
    { id: "projects", label: "Projects", icon: FolderOpen },
    { id: "editor", label: "Editor", icon: Code },
    { id: "compile", label: "Compile", icon: Settings },
  { id: "demo", label: "Demo's", icon: BookOpen },
    { id: "manager", label: "File Manager", icon: Settings },
  ];

  const { toast } = useToast();
  const { code } = useCompiler();

  const [aiOpen, setAiOpen] = useState(false);
  // Open the 3-step AI coding dialog (no API or local AI used)
  const handleAIPrompt = () => setAiOpen(true);

  // Import a workspace serialization JSON file and load it into Blockly
  const handleImport = async () => {
    try {
      // @ts-expect-error preload
      const res = await window.workspaceFS?.importJson();
      if (!res || res.cancelled) return;
      if (res.error) {
        toast({ title: 'Import failed', description: res.error });
        return;
      }
      if (!res.raw) {
        toast({ title: 'Import error', description: 'Empty file' });
        return;
      }
      // Ensure we are on the editor so workspace exists
      if (activeTab !== 'editor') onTabChange('editor');
      const result = loadWorkspaceFromJson(res.raw);
      if (!result.ok) {
        toast({ title: 'Load failed', description: result.error || 'Unknown error' });
        return;
      }
      toast({
        title: result.queued ? 'Workspace queued' : 'Imported workspace',
        description: result.queued ? 'It will load when the editor is ready' : (res.filePath || 'Loaded')
      });
    } catch (e) {
      toast({ title: 'Import exception', description: String(e instanceof Error ? e.message : e) });
    }
  };

  const handleExport = async () => {
    try {
      // Ensure latest save first
      await handleSave();
      const json = exportWorkspaceJson();
      // @ts-expect-error preload
      const res = await window.workspaceFS?.exportJson(json);
      if (!res || res.cancelled) return;
      if (res.error) {
        toast({ title: 'Export failed', description: res.error });
      } else {
        toast({ title: 'Exported workspace', description: res.filePath || 'Saved' });
      }
    } catch (e) {
      toast({ title: 'Export exception', description: String(e instanceof Error ? e.message : e) });
    }
  };

  const handleSave = async () => {
    const generatedCode = code || '';
    // Extract manifest from workspace or from generated code footer as in CompilePage
    let appId = 'demo_app';
    let name = 'Demo App';
    let apptype: string | undefined;
    let icon: string | undefined;
    let category: string | undefined;
    let author: string | undefined;
    let version: string | undefined;
    let description: string | undefined;
    let stack: number | undefined;
    try {
      const ws = getWorkspace();
      if (ws) {
        const blocks = ws.getAllBlocks(false);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manifestBlock = blocks.find(b => (b as any).type === 'flipper_manifest');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (manifestBlock && (manifestBlock as any).getFieldValue) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    // Try footer extraction first
    let manifest: string | null = null;
    const markerStart = '----- application.fam -----';
    const markerEnd = '---------------------------';
    const startIdx = generatedCode.indexOf(markerStart);
    const endIdx = generatedCode.indexOf(markerEnd, startIdx + markerStart.length);
    if (startIdx !== -1 && endIdx !== -1) {
      const slice = generatedCode.substring(startIdx + markerStart.length, endIdx).trim();
      if (slice.startsWith('App(')) {
        manifest = slice + '\n';
        const m = /appid="([A-Za-z0-9_-]+)"/.exec(manifest);
        if (m) appId = m[1];
      }
    }
    if (!manifest) {
      manifest = buildManifest({
        appId,
        name,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  appType: (['FlipperAppType.EXTERNAL','FlipperAppType.APP','FlipperAppType.PLUGIN'] as const).includes(apptype as any) ? (apptype as any) : undefined,
        icon,
        category,
        author,
        version,
        description,
        stackSize: stack,
        entryPoint: 'app_main',
      });
    }

    const workspaceJson = exportWorkspaceJson();
    try {
      // @ts-expect-error preload
      const res = await window.projects?.writeProject({ appId, manifest, code: generatedCode, workspaceJson });
      if (res?.error) {
        toast({ title: 'Save failed', description: res.error });
      } else {
        toast({ title: 'Saved', description: `${res?.projectPath}` });
      }
    } catch(e) {
      toast({ title: 'IPC error', description: String(e instanceof Error ? e.message : e) });
    }
  };

  return (
    <>
    <header className="h-16 bg-card border-b border-border cyber-border flex items-center justify-between px-6">
      <div className="flex items-center gap-4">
        <img
          src={import.meta.env.BASE_URL + 'Kiisu_blocks.svg'}
          alt="Kiisu Blocks"
          className="h-8 w-auto select-none"
          draggable={false}
        />
        
        <div className="flex items-center gap-1 ml-8">
          {tabs.map((tab) => (
            <Button
              key={tab.id}
              variant={activeTab === tab.id ? "default" : "ghost"}
              size="sm"
              onClick={() => onTabChange(tab.id)}
              className={`
                flex items-center gap-2 px-4 py-2 transition-all duration-300
                ${activeTab === tab.id 
                  ? 'bg-primary text-primary-foreground cyber-glow' 
                  : 'hover:bg-secondary text-muted-foreground hover:text-foreground'
                }
              `}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" className="cyber-border" onClick={handleAIPrompt}>
          <Bot className="h-4 w-4 mr-2" />
          AI
        </Button>
        <Button size="sm" variant="outline" className="cyber-border" onClick={() => {
          // First, trigger code generation to ensure latest code is ready
          window.dispatchEvent(new CustomEvent("kiisu.blocks.compile"));
          // Navigate to the compile page
          onTabChange("compile");
          // After navigation, trigger the same action as the Compile & Launch button
          // Delay slightly to allow the CompilePage to mount and attach its listener
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent("kiisu.blocks.compileLaunch"));
          }, 300);
        }}>
          <Play className="h-4 w-4 mr-2" />
          Compile & Launch
        </Button>
        <Button size="sm" variant="outline" className="cyber-border" onClick={handleSave}>
          <Code className="h-4 w-4 mr-2" />
          Save
        </Button>
        <Button size="sm" variant="outline" className="cyber-border" onClick={handleImport}>
          <Download className="h-4 w-4 mr-2" />
          Import
        </Button>
        <Button size="sm" variant="outline" className="cyber-border" onClick={handleExport}>
          <Upload className="h-4 w-4 mr-2" />
          Export
        </Button>
      </div>
  </header>
  {/* AI Coding Assistant Dialog */}
  <AICodingDialog open={aiOpen} onOpenChange={setAiOpen} />
  </>
  );
};

export default IDEHeader;