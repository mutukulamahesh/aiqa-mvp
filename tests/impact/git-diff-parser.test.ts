import { spawnSync } from "child_process";
import { getChangedFiles, getGitRoot, isShallowClone } from "../../src/impact/GitDiffParser";

jest.mock("child_process", () => ({ spawnSync: jest.fn() }));
const mockSpawnSync = spawnSync as jest.Mock;

function okResult(stdout: string) {
  return { stdout, stderr: "", status: 0, error: undefined };
}
function errResult(stderr: string) {
  return { stdout: "", stderr, status: 128, error: undefined };
}

afterEach(() => jest.clearAllMocks());

describe("getChangedFiles", () => {
  test("returns list of changed files from git output", () => {
    mockSpawnSync.mockReturnValue(okResult("src/auth/login.ts\nsrc/api/users.ts\n"));
    const files = getChangedFiles({ base: "origin/main" });
    expect(files).toEqual(["src/auth/login.ts", "src/api/users.ts"]);
  });

  test("uses origin/main as default base", () => {
    mockSpawnSync.mockReturnValue(okResult(""));
    getChangedFiles();
    const [, args] = mockSpawnSync.mock.calls[0] as [string, string[]];
    expect(args.some((a: string) => a.includes("origin/main"))).toBe(true);
  });

  test("passes args as an array — no shell invoked (injection safety)", () => {
    mockSpawnSync.mockReturnValue(okResult("src/x.ts\n"));
    getChangedFiles({ base: "origin/develop", cwd: "/tmp/project" });
    const [cmd, args, opts] = mockSpawnSync.mock.calls[0] as [string, string[], { cwd: string }];
    // spawnSync called with executable + args array, NOT a shell string
    expect(cmd).toBe("git");
    expect(Array.isArray(args)).toBe(true);
    expect(args).toContain("--name-only");
    expect(opts.cwd).toBe("/tmp/project");
  });

  test("returns empty array when no files changed", () => {
    mockSpawnSync.mockReturnValue(okResult("\n\n"));
    expect(getChangedFiles()).toEqual([]);
  });

  test("strips blank lines and whitespace from output", () => {
    mockSpawnSync.mockReturnValue(okResult("  src/foo.ts  \n\n  src/bar.ts\n"));
    expect(getChangedFiles()).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  test("throws descriptive error when git returns non-zero status", () => {
    mockSpawnSync.mockReturnValue(errResult("unknown revision: typo/main"));
    expect(() => getChangedFiles({ base: "typo/main" })).toThrow("GitDiffParser");
    expect(() => getChangedFiles({ base: "typo/main" })).toThrow("unknown revision");
  });

  test("throws when git exits with error object (e.g. ENOENT)", () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: null, error: new Error("ENOENT") });
    expect(() => getChangedFiles()).toThrow("GitDiffParser");
  });
});

describe("getGitRoot", () => {
  test("returns trimmed path from git rev-parse --show-toplevel", () => {
    mockSpawnSync.mockReturnValue(okResult("/home/user/project\n"));
    expect(getGitRoot()).toBe("/home/user/project");
  });

  test("returns null when git exits non-zero (not a git repo)", () => {
    mockSpawnSync.mockReturnValue(errResult("not a git repository"));
    expect(getGitRoot()).toBeNull();
  });
});

describe("isShallowClone", () => {
  test("returns true when git reports 'true'", () => {
    mockSpawnSync.mockReturnValue(okResult("true\n"));
    expect(isShallowClone()).toBe(true);
  });

  test("returns false when git reports 'false'", () => {
    mockSpawnSync.mockReturnValue(okResult("false\n"));
    expect(isShallowClone()).toBe(false);
  });

  test("returns false when git command fails", () => {
    mockSpawnSync.mockReturnValue(errResult("not a git repository"));
    expect(isShallowClone()).toBe(false);
  });
});
