declare module 'dataurl' {
    const dataurl: { parse: (uri: string) => { readonly data: Buffer; readonly mimetype: string; readonly charset?: string } };
    export default dataurl;
}
