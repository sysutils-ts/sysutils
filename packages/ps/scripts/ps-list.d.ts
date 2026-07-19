declare module "ps-list" {
  const list: (options?: { all?: boolean }) => Promise<unknown[]>;
  export default list;
}
