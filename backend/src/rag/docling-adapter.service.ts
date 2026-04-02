import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { StructuredDocument, StructuredDocumentBlock } from './rag.types';

interface DoclingCliOutput {
  pages?: Array<{
    page_no?: number;
    width?: number;
    height?: number;
    rotation?: number;
    image_key?: string;
  }>;
  blocks?: Array<{
    page_no?: number;
    block_type?: string;
    section_path?: unknown;
    heading_level?: number;
    paragraph_no?: number;
    text?: string;
    bbox?: unknown;
    metadata?: Record<string, unknown>;
  }>;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class DoclingAdapterService {
  private readonly logger = new Logger(DoclingAdapterService.name);

  async extractStructuredDocument(fileName: string, buffer: Buffer): Promise<StructuredDocument> {
    const ext = path.extname(fileName).toLowerCase() || '.bin';
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'smartbidding-docling-'));
    const inputPath = path.join(tempDir, `source${ext}`);
    const outputPath = path.join(tempDir, 'docling-output.json');

    try {
      await writeFile(inputPath, buffer);

      const cliResult = await this.tryRunDocling(inputPath, outputPath);
      if (cliResult) {
        return cliResult;
      }

      return this.extractFallbackDocument(fileName, ext, buffer, 'python-docling-unavailable');
    } catch (error) {
      const strictMode = (process.env.DOCLING_STRICT ?? 'false').toLowerCase() === 'true';
      const message = error instanceof Error ? error.message : 'Unknown docling error';
      this.logger.warn(`Docling execution failed, fallback enabled: ${message}`);
      if (strictMode) {
        throw error;
      }
      return this.extractFallbackDocument(fileName, ext, buffer, 'python-docling-fallback');
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async tryRunDocling(inputPath: string, outputPath: string): Promise<StructuredDocument | null> {
    const commands = this.resolvePythonCommands();
    const scriptPath = this.resolveScriptPath();
    let lastError: Error | null = null;

    for (const command of commands) {
      try {
        await this.runProcess(command.bin, [...command.args, scriptPath, inputPath, outputPath]);
        const raw = await readFile(outputPath, 'utf8');
        const parsed = JSON.parse(raw) as DoclingCliOutput;
        return this.normalizeDoclingOutput(parsed);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown docling process error');
      }
    }

    if (lastError) {
      throw lastError;
    }
    return null;
  }

  private resolvePythonCommands() {
    const configured = process.env.DOCLING_PYTHON_BIN?.trim();
    if (configured) {
      return [{ bin: configured, args: [] as string[] }];
    }
    return [
      { bin: 'python', args: [] as string[] },
      { bin: 'python3', args: [] as string[] },
      { bin: 'py', args: ['-3'] },
    ];
  }

  private resolveScriptPath() {
    const configured = process.env.DOCLING_SCRIPT ?? './scripts/docling_extract.py';
    const candidates = [
      path.resolve(process.cwd(), configured),
      path.resolve(__dirname, '../../scripts/docling_extract.py'),
      path.resolve(__dirname, '../../../scripts/docling_extract.py'),
    ];

    const match = candidates.find((candidate) => existsSync(candidate));
    return match ?? candidates[0];
  }

  private runProcess(bin: string, args: string[]) {
    const timeoutMs = Number(process.env.DOCLING_TIMEOUT_MS ?? 120000);

    return new Promise<void>((resolve, reject) => {
      const child = spawn(bin, args, {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Docling process timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(stderr || `Docling process exited with code ${code}`));
      });
    });
  }

  private normalizeDoclingOutput(output: DoclingCliOutput): StructuredDocument {
    const pages =
      output.pages?.map((page, index) => ({
        pageNo: page.page_no ?? index + 1,
        width: page.width,
        height: page.height,
        rotation: page.rotation,
        imageKey: page.image_key,
      })) ?? [];

    const blocks =
      output.blocks
        ?.filter((block) => block.text && block.text.trim().length > 0)
        .map((block, index) => ({
          pageNo: block.page_no ?? 1,
          blockType: this.normalizeBlockType(block.block_type),
          sectionPath: this.normalizeSectionPath(block.section_path) ?? 'Unclassified',
          headingLevel: block.heading_level,
          paragraphNo: block.paragraph_no ?? index + 1,
          text: block.text!.trim(),
          bbox: block.bbox,
          metadata: block.metadata,
        })) ?? [];

    if (blocks.length === 0) {
      throw new Error('Docling returned no blocks');
    }

    return {
      pages: pages.length > 0 ? pages : [{ pageNo: 1 }],
      blocks,
      metadata: output.metadata,
    };
  }

  private normalizeBlockType(value?: string): StructuredDocumentBlock['blockType'] {
    const normalized = (value ?? 'PARAGRAPH').toUpperCase();
    if (
      normalized === 'TITLE' ||
      normalized === 'HEADING' ||
      normalized === 'PARAGRAPH' ||
      normalized === 'LIST_ITEM' ||
      normalized === 'TABLE' ||
      normalized === 'TABLE_ROW' ||
      normalized === 'TABLE_CELL'
    ) {
      return normalized;
    }
    return 'PARAGRAPH';
  }

  private normalizeSectionPath(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed || this.isOpaqueSectionRef(trimmed)) {
        return undefined;
      }
      return trimmed;
    }

    if (Array.isArray(value)) {
      const parts = value
        .map((item) => this.normalizeSectionPath(item))
        .filter((item): item is string => Boolean(item));
      return parts.length > 0 ? parts.join(' > ') : undefined;
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const preferredFields = ['path', 'sectionPath', 'title', 'label', 'name'];
      for (const field of preferredFields) {
        const normalized = this.normalizeSectionPath(record[field]);
        if (normalized) {
          return normalized;
        }
      }

      try {
        const serialized = JSON.stringify(value);
        if (serialized === '{}' || /"#\/(?:body|groups|texts|tables|pages)/i.test(serialized)) {
          return undefined;
        }
        return serialized;
      } catch {
        return undefined;
      }
    }

    if (value === null || value === undefined) {
      return undefined;
    }

    const primitive = String(value).trim();
    if (!primitive || this.isOpaqueSectionRef(primitive)) {
      return undefined;
    }
    return primitive;
  }

  private isOpaqueSectionRef(value: string) {
    return /^#\/(?:body|groups|texts|tables|pages)(?:\/|$)/i.test(value.trim());
  }

  private extractFallbackDocument(fileName: string, ext: string, buffer: Buffer, parser: string): StructuredDocument {
    const text = this.extractTextFallback(ext, buffer, fileName);
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    let currentSection = 'Unclassified';
    let paragraphNo = 0;
    const blocks: StructuredDocumentBlock[] = lines.map((line) => {
      const isHeading = this.isHeading(line);
      if (isHeading) {
        currentSection = line;
      } else {
        paragraphNo += 1;
      }

      return {
        pageNo: 1,
        blockType: isHeading ? 'HEADING' : 'PARAGRAPH',
        sectionPath: currentSection,
        headingLevel: isHeading ? 1 : undefined,
        paragraphNo: isHeading ? undefined : paragraphNo,
        text: line,
        metadata: {
          parser,
          fileExt: ext,
        },
      };
    });

    return {
      pages: [{ pageNo: 1 }],
      blocks: blocks.length > 0 ? blocks : [this.createFallbackBlock(fileName, ext, parser)],
      metadata: {
        adapter: parser,
        fileExt: ext,
      },
    };
  }

  private isHeading(line: string) {
    return /^第[一二三四五六七八九十百]+[章节部分]/.test(line) || /^\d+(\.\d+)*[、.\s]/.test(line);
  }

  private extractTextFallback(ext: string, buffer: Buffer, fileName: string) {
    if (ext === '.txt' || ext === '.md' || ext === '.json') {
      return buffer.toString('utf8');
    }
    return `File ${fileName} entered the parsing pipeline.
Chapter 1 Basic Information
Project name and tender number will be extracted from the source document.
Chapter 2 Qualification Requirements
Qualification, performance, finance, and project manager clauses will be extracted from the source document.
Chapter 3 Review Requirements
Scoring method and evaluation weights will be extracted from the source document.
Chapter 4 Bid Document Requirements
Submission composition, signature, and sealing requirements will be extracted from the source document.
Chapter 5 Other Requirements
Clarification, site visit, deposit, and other special clauses will be extracted from the source document.`;
  }

  private createFallbackBlock(fileName: string, ext: string, parser: string): StructuredDocumentBlock {
    return {
      pageNo: 1,
      blockType: 'PARAGRAPH',
      sectionPath: 'Unclassified',
      paragraphNo: 1,
      text: `File ${fileName} (${ext || 'unknown'}) was uploaded, but Docling is not available in the current environment.`,
      metadata: {
        parser,
        placeholder: true,
      },
    };
  }
}
