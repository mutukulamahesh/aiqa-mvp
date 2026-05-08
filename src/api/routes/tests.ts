import * as fs   from "fs";
import * as path from "path";
import { Router, Request, Response } from "express";
import { safeResolvePath } from "../middleware/sandbox";

const router     = Router();
const TESTS_ROOT = path.join(process.cwd(), "tests");

// GET /api/tests — list YAML files under ?dir= (default: tests/)
router.get("/tests", async (req, res) => {
  const subDir = (req.query.dir as string) ?? "";
  let base: string;
  try {
    base = subDir ? safeResolvePath(TESTS_ROOT, subDir) : TESTS_ROOT;
  } catch {
    res.status(400).json({ error: "Invalid dir parameter" });
    return;
  }

  try {
    const entries = await fs.promises.readdir(base, { withFileTypes: true });
    const files   = entries
      .filter(e => e.isFile() && (e.name.endsWith(".yaml") || e.name.endsWith(".yml")))
      .map(e => ({ name: e.name, path: path.relative(TESTS_ROOT, path.join(base, e.name)) }));
    res.json(files);
  } catch {
    res.status(404).json({ error: "Directory not found" });
  }
});

function getTestFilePath(req: Request): string {
  // Works with both Express 4 (req.params[0]) and wildcard patterns
  const raw = req.path.replace(/^\/tests\//, "");
  return decodeURIComponent(raw);
}

// GET /api/tests/<path> — read a specific YAML file
router.get(/^\/tests\/(.+)$/, async (req: Request, res: Response) => {
  const filePath = getTestFilePath(req);
  try {
    const resolved = safeResolvePath(TESTS_ROOT, filePath);
    const content  = await fs.promises.readFile(resolved, "utf-8");
    res.type("text/yaml").send(content);
  } catch {
    res.status(404).json({ error: "File not found" });
  }
});

// PUT /api/tests/<path> — save a YAML file (Portal builder)
router.put(/^\/tests\/(.+)$/, async (req: Request, res: Response) => {
  if (typeof req.body !== "string") {
    res.status(415).json({ error: "Content-Type must be text/yaml" });
    return;
  }
  const filePath = getTestFilePath(req);
  try {
    const resolved = safeResolvePath(TESTS_ROOT, filePath);
    await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
    await fs.promises.writeFile(resolved, req.body, "utf-8");
    res.json({ saved: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("outside project root")) {
      res.status(400).json({ error: msg });
    } else {
      res.status(500).json({ error: "Failed to save file" });
    }
  }
});

export default router;
