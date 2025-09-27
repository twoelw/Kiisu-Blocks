import React, { createContext, useContext, useMemo, useState } from "react";

type CompilerState = {
  code: string;
  setCode: (code: string) => void;
};

const CompilerContext = createContext<CompilerState | undefined>(undefined);

export const CompilerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [code, setCode] = useState<string>("");
  const value = useMemo(() => ({ code, setCode }), [code]);
  return <CompilerContext.Provider value={value}>{children}</CompilerContext.Provider>;
};

export const useCompiler = (): CompilerState => {
  const ctx = useContext(CompilerContext);
  if (!ctx) throw new Error("useCompiler must be used within a CompilerProvider");
  return ctx;
};
