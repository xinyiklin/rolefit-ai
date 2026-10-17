declare module "cross-spawn" {
  type SpawnOptions = import("node:child_process").SpawnOptions;
  // cross-spawn 7.0.6's own launch resolution (exported as `_parse`): on Windows
  // it reports whether the command runs through cmd.exe and the escaped line.
  type ParsedLaunch = {
    command: string;
    args: string[];
    options: SpawnOptions & { windowsVerbatimArguments?: boolean };
    file?: string;
  };
  const crossSpawn: typeof import("node:child_process").spawn & {
    _parse(command: string, args: string[], options: SpawnOptions): ParsedLaunch;
  };
  export default crossSpawn;
}
