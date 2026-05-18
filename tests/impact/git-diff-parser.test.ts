import { execSync } from "child_process";
import { getChangedFiles, getGitRoot } from "../../src/impact/GitDiffParser";

jest.mock("child_process", () => ({ execSync: jest.fn() }));
const mockExecSync = execSync as jest.Mock;

afterEach(() => jest.clearAllMocks());

describe("getChangedFiles", () => {
  test("returns list of changed files from git output", () => {
    mockExecSync.mockReturnValue("src/auth/login.ts\nsrc/api/users.ts\n");
    const files = getChangedFiles({ base: "origin/main" });
    expect(files).toEqual(["src/auth/login.ts", "src/api/users.ts"]);
  });

  test("uses origin/main as default base", () => {
    mockExecSync.mockReturnValue("");
    getChangedFiles();
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining("origin/main"),
      expect.any(Object),
    );
  });

  test("returns empty array when no files changed", () => {
    mockExecSync.mockReturnValue("\n\n");
    expect(getChangedFiles()).toEqual([]);
  });

  test("strips blank lines and whitespace from output", () => {
    mockExecSync.mockReturnValue("  src/foo.ts  \n\n  src/bar.ts\n");
    expect(getChangedFiles()).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  test("throws descriptive error when git fails", () => {
    const err = Object.assign(new Error("bad exit"), { stderr: "unknown revision: typo/main" });
    mockExecSync.mockImplementation(() => { throw err; });
    expect(() => getChangedFiles({ base: "typo/main" })).toThrow("GitDiffParser");
    expect(() => getChangedFiles({ base: "typo/main" })).toThrow("unknown revision");
  });

  test("passes custom base ref and cwd to execSync", () => {
    mockExecSync.mockReturnValue("src/x.ts\n");
    getChangedFiles({ base: "origin/develop", cwd: "/tmp/project" });
    const [cmd, opts] = mockExecSync.mock.calls[0] as [string, { cwd: string }];
    expect(cmd).toContain("origin/develop");
    expect(opts.cwd).toBe("/tmp/project");
  });
});

describe("getGitRoot", () => {
  test("returns trimmed output from git rev-parse", () => {
    mockExecSync.mockReturnValue("/home/user/project\n");
    expect(getGitRoot()).toBe("/home/user/project");
  });

  test("returns null when not in a git repo", () => {
    mockExecSync.mockImplementation(() => { throw new Error("not a git repo"); });
    expect(getGitRoot()).toBeNull();
  });
});
