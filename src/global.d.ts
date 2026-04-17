// CSS module declarations
declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}

// Image module declarations
declare module '*.png' {
  const value: string;
  export default value;
}

declare module '*.jpg' {
  const value: string;
  export default value;
}

declare module '*.svg' {
  const value: string;
  export default value;
}
