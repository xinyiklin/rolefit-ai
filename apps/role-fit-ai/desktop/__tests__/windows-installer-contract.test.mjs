import assert from "node:assert/strict";
import test from "node:test";

import {
  WINDOWS_EXECUTABLE_NAME,
  WINDOWS_SQUIRREL_PACKAGE_ID,
  resolveWindowsSquirrelPaths
} from "../windows-installer-contract.mjs";

test("Windows installer paths match the reviewed Squirrel package identity", () => {
  assert.equal(WINDOWS_SQUIRREL_PACKAGE_ID, "RoleFitLocalCompanion");
  assert.equal(WINDOWS_EXECUTABLE_NAME, "RoleFitLocalCompanion.exe");
  assert.deepEqual(
    resolveWindowsSquirrelPaths("C:\\Users\\runneradmin\\AppData\\Local", "0.1.0"),
    {
      installRoot: "C:\\Users\\runneradmin\\AppData\\Local\\RoleFitLocalCompanion",
      versionDirectory: "C:\\Users\\runneradmin\\AppData\\Local\\RoleFitLocalCompanion\\app-0.1.0",
      executable: "C:\\Users\\runneradmin\\AppData\\Local\\RoleFitLocalCompanion\\app-0.1.0\\RoleFitLocalCompanion.exe",
      updater: "C:\\Users\\runneradmin\\AppData\\Local\\RoleFitLocalCompanion\\Update.exe",
      tombstone: "C:\\Users\\runneradmin\\AppData\\Local\\RoleFitLocalCompanion\\.dead"
    }
  );
});

test("Windows installer paths reject ambiguous roots and versions", () => {
  assert.throws(
    () => resolveWindowsSquirrelPaths("AppData\\Local", "0.1.0"),
    /absolute Windows path/
  );
  assert.throws(
    () => resolveWindowsSquirrelPaths("C:\\Users\\runner\0escape", "0.1.0"),
    /absolute Windows path/
  );
  assert.throws(
    () => resolveWindowsSquirrelPaths("C:\\Users\\runner\\AppData\\Local", "0.1.0-beta.1"),
    /canonical X\.Y\.Z/
  );
});
