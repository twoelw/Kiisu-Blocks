import { listDemos, getDemoWorkspace } from '@/lib/demos';
import { useToast } from '@/hooks/use-toast';
import { useEffect, useState } from 'react';

interface DemoPageProps { onLoad: (slug: string, raw: string) => void }

const DemoPage = ({ onLoad }: DemoPageProps) => {
  const { toast } = useToast();
  const [demos, setDemos] = useState(() => listDemos());

  useEffect(() => {
    // In case hot-module replacement updates demos
    setDemos(listDemos());
  }, []);

  const handleLoad = (slug: string) => {
    const raw = getDemoWorkspace(slug);
    if (!raw) {
      toast({ title: 'Demo missing', description: slug });
      return;
    }
    // Defer actual load to parent/editor mount
    onLoad(slug, raw);
  };

  return (
    <div className="w-full p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold neon-text">Demos</h1>
          <p className="text-muted-foreground text-sm">Click a demo to load its workspace into the editor.</p>
        </header>
        {demos.length === 0 && (
          <div className="text-sm text-muted-foreground">No demos found. Add folders under <code>src/demos/&lt;slug&gt;</code>.</div>
        )}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 auto-rows-fr">
          {demos.map(d => {
            const clickable = (
              <div
                key={d.slug}
                onClick={() => handleLoad(d.slug)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleLoad(d.slug); } }}
                className="group cursor-pointer relative overflow-hidden rounded-lg border cyber-border bg-card/50 backdrop-blur flex flex-col focus:outline-none focus:ring-2 focus:ring-primary/60 transition shadow hover:shadow-lg hover:border-primary/50"
              >
                {d.previewPath && (
                  <div className="aspect-video w-full bg-muted/20 flex items-center justify-center overflow-hidden border-b border-border/40">
                    <img src={d.previewPath} alt={d.title} className="object-cover w-full h-full group-hover:scale-105 transition-transform" />
                  </div>
                )}
                <div className="p-4 space-y-2 flex-1 flex flex-col">
                  <h3 className="font-semibold text-lg leading-tight group-hover:text-primary transition-colors">{d.title}</h3>
                  <p className="text-xs text-muted-foreground whitespace-pre-line line-clamp-5 group-hover:text-foreground/90 flex-1">
                    {d.description}
                  </p>
                  <div className="pt-2 text-[10px] uppercase tracking-wide text-primary/70 opacity-0 group-hover:opacity-100 transition-opacity">Click to load</div>
                </div>
                <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-10 bg-primary transition-opacity" />
              </div>
            );
            return clickable;
          })}
        </div>
        <footer className="text-xs text-muted-foreground pt-8 pb-4">
          Add demos by creating <code>src/demos/&lt;slug&gt;/meta.txt</code>, <code>workspace.json</code> and <code>preview.png</code> (optional).
        </footer>
      </div>
    </div>
  );
};

export default DemoPage;
