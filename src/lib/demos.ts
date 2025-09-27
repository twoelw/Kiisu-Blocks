export interface DemoMeta {
  slug: string;
  title: string;
  description: string;
  workspaceJsonPath: string;
  previewPath?: string;
}

// Vite's import.meta.glob to gather demo assets (using modern query/import syntax)
const metaFiles = import.meta.glob('../demos/*/meta.txt', { query: '?raw', import: 'default', eager: true }) as Record<string,string>;
const workspaceFiles = import.meta.glob('../demos/*/workspace.json', { query: '?raw', import: 'default', eager: true }) as Record<string,string>;
const imageFiles = import.meta.glob('../demos/*/preview.{png,jpg,jpeg,svg,gif}', { eager: true, query: '?url' });

interface ImageModule { default: string }

const demos: DemoMeta[] = [];

for (const metaPath in metaFiles) {
  const raw = metaFiles[metaPath];
  const slugMatch = /..\/demos\/([^/]+)\/meta.txt$/.exec(metaPath);
  if (!slugMatch) continue;
  const slug = slugMatch[1];
  const lines = raw.split(/\r?\n/);
  const title = (lines.shift() || slug).trim();
  while (lines.length && lines[0].trim() === '') lines.shift();
  const description = lines.join('\n').trim();
  // locate workspace
  const wsKey = Object.keys(workspaceFiles).find(k => k.includes(`/demos/${slug}/workspace.json`));
  if (!wsKey) continue;
  // find image
  const imgKey = Object.keys(imageFiles).find(k => k.includes(`/demos/${slug}/preview`));
  let previewPath: string | undefined;
  if (imgKey) {
    // @ts-expect-error dynamic
    const mod: ImageModule = imageFiles[imgKey];
    previewPath = (mod as unknown as { default: string }).default || (mod as unknown as string);
  }
  demos.push({ slug, title, description, workspaceJsonPath: wsKey });
  if (previewPath) demos[demos.length-1].previewPath = previewPath;
}

export function listDemos(): DemoMeta[] { return demos.slice(); }

export function getDemoWorkspace(slug: string): string | null {
  const demo = demos.find(d => d.slug === slug);
  if (!demo) return null;
  const raw = workspaceFiles[demo.workspaceJsonPath];
  return raw || null;
}
