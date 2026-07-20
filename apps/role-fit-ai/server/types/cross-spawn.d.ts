declare module "cross-spawn" {
  const crossSpawn: typeof import("node:child_process").spawn;
  export default crossSpawn;
}
