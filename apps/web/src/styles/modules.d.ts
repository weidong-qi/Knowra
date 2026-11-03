// V4-04 CSS Module & side-effect CSS ambient declarations。

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.css' {
  const content: string;
  export default content;
}

declare module '*.svg' {
  const url: string;
  export default url;
}
