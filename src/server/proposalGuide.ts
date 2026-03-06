import path from "path";
import fs from "fs";

/** 提取出来方便在多个模块中复用 */
export function loadProcurementGuide(): string | null {
  try {
    const guidePath = path.resolve(
      __dirname,
      "..",
      "imports",
      "procurement-response-guide.md"
    );
    if (!fs.existsSync(guidePath)) return null;
    const content = fs.readFileSync(guidePath, "utf8");
    return content;
  } catch (err) {
    console.warn("[proposalGuide] 加载采购响应指引失败：", err);
    return null;
  }
}

