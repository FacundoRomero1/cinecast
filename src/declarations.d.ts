declare module '@eyevinn/hls-duration' {
  export function hlsduration(url: URL | string): Promise<number>;
  const defaultExport: {
    hlsduration: (url: URL | string) => Promise<number>;
  };
  export default defaultExport;
}
