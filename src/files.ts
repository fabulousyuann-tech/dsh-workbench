import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import type { FileCategory, ProjectFile } from "./types.ts";

/** 项目内需要跳过的目录（隐藏目录 / 依赖 / 回收站）。 */
const SKIP_DIRS = new Set(["node_modules", ".git", ".trash", "_index"]);

/** 常见办公 / 文档文件扩展名 → 归集类别。 */
const EXTENSION_CATEGORY: Record<string, FileCategory> = {
  // 文档
  ".doc": "word",
  ".docx": "word",
  ".docm": "word",
  ".rtf": "word",
  ".odt": "word",
  // 表格
  ".xls": "excel",
  ".xlsx": "excel",
  ".xlsm": "excel",
  ".csv": "excel",
  ".tsv": "excel",
  ".ods": "excel",
  // 演示
  ".ppt": "ppt",
  ".pptx": "ppt",
  ".pptm": "ppt",
  ".key": "ppt",
  ".odp": "ppt",
  // PDF
  ".pdf": "pdf",
  // 文本 / Markdown
  ".md": "text",
  ".markdown": "text",
  ".txt": "text",
  // 图片
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".svg": "image",
  ".bmp": "image",
  ".tiff": "image",
  ".ico": "image",
  // 压缩包
  ".zip": "archive",
  ".rar": "archive",
  ".7z": "archive",
  ".tar": "archive",
  ".gz": "archive",
};

export function categoryOfFile(name: string): FileCategory {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "other";
  return EXTENSION_CATEGORY[name.slice(dot).toLowerCase()] ?? "other";
}

export const FILE_CATEGORIES: readonly FileCategory[] = [
  "word",
  "excel",
  "ppt",
  "pdf",
  "text",
  "image",
  "archive",
  "other",
];

function isSkippedDir(name: string): boolean {
  return SKIP_DIRS.has(name) || name.startsWith(".");
}

/**
 * 递归扫描项目文件夹，把文件按扩展名归集到类别。
 * 只扫描文件，跳过隐藏 / 依赖 / 回收站目录，限制在 MAX_DEPTH 层内防止误入深层目录树。
 */
export async function scanProjectFiles(
  folderPath: string,
  maxDepth = 6,
): Promise<ProjectFile[]> {
  const files: ProjectFile[] = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (isSkippedDir(entry.name)) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await stat(abs).catch(() => undefined);
      if (info === undefined) continue;
      files.push({
        name: entry.name,
        relativePath: relative(folderPath, abs).split(/[\\/]/).join("/"),
        category: categoryOfFile(entry.name),
        sizeBytes: info.size,
        modifiedMs: Math.round(info.mtimeMs),
      });
    }
  };

  await walk(folderPath, 0);
  files.sort((left, right) => right.modifiedMs - left.modifiedMs);
  return files;
}

export function categorizeFiles(
  files: readonly ProjectFile[],
): Record<FileCategory, number> {
  const counts = Object.fromEntries(
    FILE_CATEGORIES.map((category) => [category, 0]),
  ) as Record<FileCategory, number>;
  for (const file of files) {
    counts[file.category] += 1;
  }
  return counts;
}
