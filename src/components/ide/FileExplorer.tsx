import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const FileExplorer = () => {
  return (
    <Card className="w-80 h-full bg-card cyber-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg neon-text">Device Preview</CardTitle>
      </CardHeader>
      <CardContent className="p-3 h-[calc(100vh-200px)]">
        <div
          className="w-full h-full rounded-xl cyber-border"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, hsl(var(--primary) / 0.25) 1px, transparent 0)",
            backgroundSize: "20px 20px",
          }}
        />
      </CardContent>
    </Card>
  );
};

export default FileExplorer;