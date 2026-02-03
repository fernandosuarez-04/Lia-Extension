/// <reference types="vite/client" />

// Type declarations for modules without @types packages

declare module 'react-markdown' {
  import { ComponentType, ReactNode } from 'react';

  interface ReactMarkdownProps {
    children: string;
    remarkPlugins?: any[];
    rehypePlugins?: any[];
    components?: Record<string, ComponentType<any>>;
    className?: string;
  }

  const ReactMarkdown: ComponentType<ReactMarkdownProps>;
  export default ReactMarkdown;
}

declare module 'remark-gfm' {
  const remarkGfm: any;
  export default remarkGfm;
}

declare module 'jspdf' {
  interface jsPDFOptions {
    orientation?: 'portrait' | 'landscape' | 'p' | 'l' | string;
    unit?: 'pt' | 'px' | 'in' | 'mm' | 'cm' | 'ex' | 'em' | 'pc' | string;
    format?: string | number[];
  }

  export default class jsPDF {
    constructor(options?: jsPDFOptions);
    constructor(orientation?: string, unit?: string, format?: string | number[]);
    text(text: string | string[], x: number, y: number, options?: any): jsPDF;
    setFontSize(size: number): jsPDF;
    setFont(fontName: string, fontStyle?: string): jsPDF;
    addPage(): jsPDF;
    save(filename: string): jsPDF;
    output(type: 'blob'): Blob;
    output(type: 'arraybuffer'): ArrayBuffer;
    output(type: string): string;
    setTextColor(r: number, g?: number, b?: number): jsPDF;
    setDrawColor(r: number, g?: number, b?: number): jsPDF;
    line(x1: number, y1: number, x2: number, y2: number): jsPDF;
    setPage(pageNumber: number): jsPDF;
    getNumberOfPages(): number;
    internal: {
      pageSize: {
        getWidth(): number;
        getHeight(): number;
      };
    };
    splitTextToSize(text: string, maxWidth: number): string[];
    getTextWidth(text: string): number;
  }
}

declare module '@google/genai' {
  export class GoogleGenAI {
    constructor(options: { apiKey: string });
    interactions: {
      create(options: { agent: string; input: string; background?: boolean }): Promise<any>;
      get(id: string): Promise<any>;
    };
  }
}
