// Files Workers import as plain text (see "rules" in each wrangler.jsonc).
declare module '*.css' {
  const text: string;
  export default text;
}
declare module '*.sql' {
  const text: string;
  export default text;
}
