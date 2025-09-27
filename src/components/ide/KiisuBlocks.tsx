import { useState } from "react";
import { useProjects } from "../../hooks/useProjects";
import { importProject } from "../../lib/projectImport";
import { useToast } from "@/hooks/use-toast";
import IDEHeader from "./IDEHeader";
import BlocklyWorkspace from "./BlocklyWorkspace";
import FileExplorer from "./FileExplorer";
import CompilePage from "./CompilePage";
import DemoPage from "./DemoPage";
import { loadWorkspaceFromJson } from "@/lib/workspace-export";

declare global {
  interface Window { ufbt: { openItem: (p: string) => Promise<{ opened: boolean; error?: string }> } }
}

const prettyBytes = (num: number) => {
  if (num === 0) return '0 B';
  const units = ['B','KB','MB','GB'];
  let i = 0;
  let n = num;
  while (n >= 1024 && i < units.length-1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i===0 ? 0 : 1)} ${units[i]}`;
};

const formatDate = (ms: number) => new Date(ms).toLocaleString();

const ProjectsListView = ({ onImport }: { onImport: (id: string) => void }) => {
  const { projects, basePath, loading, error, refresh } = useProjects();
  return (
    <div className="flex flex-col h-full p-6 gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold neon-text">Projects</h2>
          <p className="text-muted-foreground text-sm">Stored under {basePath ? (
            <button
              onClick={() => window.ufbt.openItem(basePath)}
              className="font-mono underline decoration-dotted hover:text-primary transition"
            >
              {basePath}
            </button>
          ) : '...'}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={refresh} className="px-3 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition">Refresh</button>
        </div>
      </div>
      <div className="flex-1 overflow-auto rounded-lg border cyber-border bg-card/40 backdrop-blur">
        {loading && (
          <div className="p-6 text-sm text-muted-foreground animate-pulse">Loading projects...</div>
        )}
        {!loading && error && (
          <div className="p-6 text-sm text-red-500">Error: {error}</div>
        )}
        {!loading && !error && projects.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">No projects yet. Compile something to create one.</div>
        )}
        {!loading && !error && projects.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground sticky top-0 bg-background/80 backdrop-blur border-b">
              <tr>
                <th className="text-left font-medium px-4 py-2">Name</th>
                <th className="text-left font-medium px-4 py-2">Files</th>
                <th className="text-left font-medium px-4 py-2">Size</th>
                <th className="text-left font-medium px-4 py-2">Modified</th>
                <th className="text-left font-medium px-4 py-2">Path</th>
              </tr>
            </thead>
            <tbody>
        {projects.map(p => (
                <tr
                  key={p.id}
                  className="border-b border-border/40 hover:bg-accent/30 transition cursor-pointer group"
          onClick={() => onImport(p.id)}
                >
                  <td className="px-4 py-2">
                    <div className="font-medium group-hover:text-primary transition-colors">{p.name}</div>
                    {p.error && <div className="text-xs text-red-500">{p.error}</div>}
                  </td>
                  <td className="px-4 py-2 tabular-nums">{p.fileCount}</td>
                  <td className="px-4 py-2 tabular-nums">{prettyBytes(p.sizeBytes)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{formatDate(p.mtimeMs)}</td>
                  <td className="px-4 py-2 max-w-[300px] truncate font-mono text-xs">
                    <button
                      onClick={(e) => { e.stopPropagation(); window.ufbt.openItem(p.path); }}
                      title={p.path}
                      className="underline decoration-dotted hover:text-primary text-left w-full truncate"
                    >
                      {p.path}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

const KiisuBlocks = () => {
  const [activeTab, setActiveTab] = useState("editor");
  const { toast } = useToast();

  const handleProjectImport = async (id: string) => {
    // Switch to editor first so Blockly workspace mounts before event broadcast (or gets replayed)
    if (activeTab !== 'editor') setActiveTab('editor');
    try {
      const res = await importProject(id);
      if ('error' in res) {
        toast({ title: 'Import failed', description: res.error });
      } else {
        toast({ title: 'Project imported', description: res.projectPath || id });
      }
    } catch (e) {
      toast({ title: 'Import exception', description: String(e instanceof Error ? e.message : e) });
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <IDEHeader activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {/* Always-mounted editor/workspace layer */}
        <div className={activeTab === 'editor' ? 'absolute inset-0 flex' : 'absolute inset-0 flex pointer-events-none opacity-0'}>
          <BlocklyWorkspace onCompile={() => setActiveTab("compile")} />
          <FileExplorer />
        </div>

        {/* Projects */}
        {activeTab === 'projects' && (
          <div className="absolute inset-0 overflow-y-auto">
            <ProjectsListView onImport={handleProjectImport} />
          </div>
        )}

        {/* Compile */}
        {activeTab === 'compile' && (
          <div className="absolute inset-0 overflow-y-auto">
            <CompilePage />
          </div>
        )}

        {/* Demo Page */}
        {activeTab === 'demo' && (
          <div className="absolute inset-0 overflow-y-auto">
            <DemoPage onLoad={(_slug, raw) => {
              // With always-mounted workspace we can load immediately.
              const result = loadWorkspaceFromJson(raw);
              if (!result.ok) {
                console.warn('[Demo load] failed', result.error);
              }
              setActiveTab('editor');
            }} />
          </div>
        )}

        {/* File Manager placeholder */}
        {activeTab === 'manager' && (
          <div className="absolute inset-0 overflow-y-auto flex items-center justify-center p-8">
            <div className="text-center space-y-4">
              <h2 className="text-2xl font-bold neon-text">File Manager</h2>
              <p className="text-muted-foreground text-sm">(Coming soon)</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default KiisuBlocks;
