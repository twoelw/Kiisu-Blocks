import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { 
  Code, 
  ArrowRight, 
  RotateCcw, 
  Calculator, 
  Type,
  Braces,
  Zap,
  Database
} from "lucide-react";

const ToolboxPanel = () => {
  const blockCategories = [
    {
      title: "App / Records",
      icon: Code,
      color: "primary",
      blocks: [
  { name: "Kiisu App", description: "app_main scaffold" },
        { name: "Open/Close Records", description: "GUI, Notification" },
      ],
    },
    {
      title: "GUI / ViewPort",
      icon: ArrowRight,
      color: "accent",
      blocks: [
        { name: "Setup ViewPort", description: "alloc, callbacks, add" },
        { name: "Enable/Disable", description: "enabled set" },
      ],
    },
    {
      title: "Canvas",
      icon: Type,
      color: "neon-green",
      blocks: [
        { name: "Clear", description: "canvas_clear" },
        { name: "Set font/color", description: "font & color" },
        { name: "Draw text", description: "canvas_draw_str" },
      ],
    },
    {
      title: "Input",
      icon: Calculator,
      color: "neon-blue",
      blocks: [
        { name: "Back to exit", description: "running=false on Back Short" },
      ],
    },
    {
      title: "Notifications",
      icon: Zap,
      color: "cyber-highlight",
      blocks: [
        { name: "Play sequence", description: "success, error, backlight" },
      ],
    },
    {
      title: "Logging & Timing",
      icon: Database,
      color: "primary",
      blocks: [
        { name: "FURI_LOG", description: "logs" },
        { name: "Delay ms", description: "furi_delay_ms" },
      ],
    },
  ];

  const getColorClass = (color: string) => {
    const colorMap: Record<string, string> = {
      'primary': 'border-primary text-primary',
      'accent': 'border-accent text-accent',
      'cyber-highlight': 'border-cyber-highlight',
      'neon-green': 'border-neon-green text-neon-green',
      'neon-blue': 'border-neon-blue text-neon-blue',
    };
    return colorMap[color] || 'border-primary text-primary';
  };

  return (
    <Card className="w-80 h-full bg-card cyber-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg neon-text">
          <Braces className="h-5 w-5" />
          Kiisu Blocks
        </CardTitle>
      </CardHeader>
      
      <CardContent className="p-0">
        <ScrollArea className="h-[calc(100vh-200px)]">
          <div className="p-4 space-y-4">
            {/* Placeholder Content */}
            <div className="text-center space-y-6">
              <div className="w-32 h-32 mx-auto bg-gradient-to-br from-primary/20 to-accent/20 rounded-2xl cyber-border flex items-center justify-center">
                <Braces className="h-16 w-16 text-primary opacity-50" />
              </div>
              
              <div className="space-y-2">
                <h3 className="text-lg font-semibold neon-text">Block Library</h3>
                <p className="text-sm text-muted-foreground">
                  Drag & drop Kiisu blocks (MVP set)
                </p>
              </div>
              
              {/* Preview Categories */}
              <div className="space-y-4">
                {blockCategories.map((category, index) => (
                  <div key={index} className="p-3 rounded-lg bg-background/30 cyber-border">
                    <div className="flex items-center gap-2 mb-2">
                      <category.icon className={`h-4 w-4 ${getColorClass(category.color).split(' ')[1]}`} />
                      <span className="font-semibold text-sm">{category.title}</span>
                      <Badge variant="outline" className="text-xs cyber-border">
                        {category.blocks.length}
                      </Badge>
                    </div>
                    
                    {/* Placeholder blocks */}
                    <div className="grid grid-cols-2 gap-2">
                      {category.blocks.slice(0, 2).map((block, blockIndex) => (
                        <div
                          key={blockIndex}
                          className="p-2 rounded bg-background/50 cyber-border opacity-60"
                        >
                          <div className="font-mono text-xs">{block.name}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Cyber Enhancement */}
            <div className="mt-8 p-4 rounded-lg bg-gradient-to-br from-primary/10 to-accent/10 cyber-border">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="h-4 w-4 text-primary animate-pulse" />
                <span className="text-sm font-semibold text-primary">Cyber Mode</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Drag and drop blocks to create C++ programs with cyberpunk aesthetics
              </p>
            </div>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

export default ToolboxPanel;