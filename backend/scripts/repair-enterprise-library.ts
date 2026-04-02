import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import * as path from 'path';
import { PrismaClient, type Prisma } from '@prisma/client';
import { extractDocxSubsetBuffer } from '../src/asset/docx-preserve.util';
import { buildSafeFileName, normalizePossiblyMojibakeText, normalizeUploadedFileName } from '../src/asset/file-name.util';

const prisma = new PrismaClient();
const localRoot = path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR ?? './local-storage');
const KNOWN_RESUME_POSITIONS = [
  '项目经理',
  '项目成员',
  '测试工程师',
  '项目总监',
  '业务分析师',
  '实施工程师',
  '质量管理工程师',
] as const;

function resolveLocalPath(key: string) {
  return path.join(localRoot, key.replace(/[\\/]+/g, path.sep));
}

function baseName(fileName?: string | null) {
  return normalizeUploadedFileName(fileName).replace(/\.[^.]+$/, '').trim();
}

function fileExt(fileName?: string | null) {
  const normalized = normalizeUploadedFileName(fileName);
  const ext = normalized.split('.').pop()?.toLowerCase();
  return ext ? `.${ext}` : '';
}

function buildResumeTitle(currentTitle: string, bidName: string) {
  const normalized = normalizePossiblyMojibakeText(currentTitle).replace(/\.docx$/i, '').trim();
  const parts = normalized.split('-').map((part) => part.trim()).filter(Boolean);

  if (parts.length >= 4 && parts.at(-1) === '简历') {
    if (
      KNOWN_RESUME_POSITIONS.includes(parts[0] as (typeof KNOWN_RESUME_POSITIONS)[number]) &&
      parts[1] === '待确认单位职位'
    ) {
      return `待确认姓名-${parts[0]}-${parts.slice(2, -1).join('-')}-简历`;
    }
    return normalized;
  }

  const inferredPosition = KNOWN_RESUME_POSITIONS.find((position) => normalized.includes(position)) ?? '待确认单位职位';

  if (parts.length >= 2 && parts.at(-1) === '简历') {
    return `${KNOWN_RESUME_POSITIONS.includes(parts[0] as (typeof KNOWN_RESUME_POSITIONS)[number]) ? '待确认姓名' : parts[0]}-${inferredPosition}-${bidName}-简历`;
  }

  const inferredName = normalized.replace(/简历$/i, '').replace(/-+$/, '').trim() || '待确认姓名';
  const finalName = KNOWN_RESUME_POSITIONS.includes(inferredName as (typeof KNOWN_RESUME_POSITIONS)[number])
    ? '待确认姓名'
    : inferredName;
  return `${finalName}-${inferredPosition}-${bidName}-简历`;
}

async function ensureParentDir(filePath: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function repairJobSourceData() {
  const jobs = await prisma.libraryIngestJob.findMany({
    include: {
      sourceAsset: {
        include: {
          documents: {
            include: {
              currentVersion: true,
            },
          },
        },
      },
      archiveAsset: {
        include: {
          documents: {
            include: {
              currentVersion: true,
            },
          },
        },
      },
    },
  });

  let repaired = 0;
  for (const job of jobs) {
    const nextSourceFileName = normalizeUploadedFileName(job.sourceFileName);
    if (nextSourceFileName !== job.sourceFileName) {
      await prisma.libraryIngestJob.update({
        where: { id: job.id },
        data: { sourceFileName: nextSourceFileName },
      });
      repaired += 1;
    }

    for (const asset of [job.sourceAsset, job.archiveAsset].filter(Boolean)) {
      const normalizedTitle = normalizePossiblyMojibakeText(asset!.title);
      if (normalizedTitle !== asset!.title) {
        await prisma.asset.update({
          where: { id: asset!.id },
          data: { title: normalizedTitle },
        });
        repaired += 1;
      }

      for (const document of asset!.documents) {
        const nextDocumentTitle = normalizePossiblyMojibakeText(document.title);
        if (nextDocumentTitle !== document.title) {
          await prisma.document.update({
            where: { id: document.id },
            data: { title: nextDocumentTitle },
          });
          repaired += 1;
        }

        if (document.currentVersion) {
          const nextFileName = normalizeUploadedFileName(document.currentVersion.fileName);
          if (nextFileName !== document.currentVersion.fileName) {
            await prisma.documentVersion.update({
              where: { id: document.currentVersion.id },
              data: { fileName: nextFileName },
            });
            repaired += 1;
          }
        }
      }
    }
  }

  return repaired;
}

async function repairGeneratedAssets() {
  const items = await prisma.libraryIngestItem.findMany({
    include: {
      asset: {
        include: {
          documents: {
            include: {
              currentVersion: true,
            },
          },
        },
      },
      job: {
        include: {
          sourceAsset: {
            include: {
              documents: {
                include: {
                  currentVersion: true,
                },
              },
            },
          },
        },
      },
    },
  });

  let repairedTitles = 0;
  let regeneratedDocs = 0;
  let skippedDocs = 0;

  for (const item of items) {
    const assetDocument = item.asset?.documents[0];
    const assetVersion = assetDocument?.currentVersion;
    const sourceVersion = item.job.sourceAsset?.documents[0]?.currentVersion;
    const bidName = baseName(item.job.sourceFileName);
    const currentTitle = item.finalTitle || item.suggestedTitle || item.asset?.title || '';
    const normalizedTitle =
      (item.asset?.subtype === 'person_resume' || item.targetSubtype === 'person_resume' || item.suggestedSubtype === 'person_resume')
        ? buildResumeTitle(currentTitle ?? '待确认姓名-待确认单位职位-简历', bidName)
        : normalizePossiblyMojibakeText(currentTitle);

    const updates: Prisma.LibraryIngestItemUpdateInput = {};
    if (item.finalTitle && normalizedTitle !== item.finalTitle) {
      updates.finalTitle = normalizedTitle;
    }
    if (item.suggestedTitle && normalizedTitle !== item.suggestedTitle) {
      updates.suggestedTitle = normalizedTitle;
    }
    if (Object.keys(updates).length > 0) {
      await prisma.libraryIngestItem.update({
        where: { id: item.id },
        data: updates,
      });
      repairedTitles += 1;
    }

    if (item.asset && normalizedTitle !== item.asset.title) {
      await prisma.asset.update({
        where: { id: item.asset.id },
        data: { title: normalizedTitle },
      });
      repairedTitles += 1;
    }

    if (assetDocument && normalizedTitle !== assetDocument.title) {
      await prisma.document.update({
        where: { id: assetDocument.id },
        data: { title: normalizedTitle },
      });
      repairedTitles += 1;
    }

    if (!item.asset || !assetVersion) {
      skippedDocs += 1;
      continue;
    }

    const nextFileName = `${buildSafeFileName(normalizedTitle)}${fileExt(assetVersion.fileName) || '.docx'}`;
    const versionUpdate: Prisma.DocumentVersionUpdateInput = {};
    if (nextFileName !== assetVersion.fileName) {
      versionUpdate.fileName = nextFileName;
    }

    if (
      sourceVersion &&
      item.sourceBlockIds &&
      Array.isArray(item.sourceBlockIds) &&
      item.sourceBlockIds.length > 0 &&
      assetVersion.storageBucket === 'local' &&
      sourceVersion.storageBucket === 'local'
    ) {
      const blocks = await prisma.documentBlock.findMany({
        where: {
          id: {
            in: item.sourceBlockIds.filter((value): value is string => typeof value === 'string'),
          },
        },
        include: { page: true },
        orderBy: [
          { page: { pageNo: 'asc' } },
          { paragraphNo: 'asc' },
          { createdAt: 'asc' },
        ],
      });

      const blockTexts = blocks.map((block) => block.text).filter(Boolean);
      if (blockTexts.length > 0) {
        const sourceBuffer = await readFile(resolveLocalPath(sourceVersion.storageKey));
        const preserved = await extractDocxSubsetBuffer(sourceBuffer, blockTexts, [
          item.sourceOutline ?? '',
          normalizedTitle,
        ]);

        if (preserved) {
          const targetPath = resolveLocalPath(assetVersion.storageKey);
          await ensureParentDir(targetPath);
          await writeFile(targetPath, preserved);
          versionUpdate.fileSize = preserved.length;
          versionUpdate.contentHash = createHash('sha256').update(preserved).digest('hex');
          regeneratedDocs += 1;
        } else {
          skippedDocs += 1;
        }
      } else {
        skippedDocs += 1;
      }
    } else {
      skippedDocs += 1;
    }

    if (Object.keys(versionUpdate).length > 0) {
      await prisma.documentVersion.update({
        where: { id: assetVersion.id },
        data: versionUpdate,
      });
      repairedTitles += 1;
    }
  }

  return { repairedTitles, regeneratedDocs, skippedDocs };
}

async function main() {
  const repairedJobSources = await repairJobSourceData();
  const generated = await repairGeneratedAssets();

  console.log(
    JSON.stringify(
      {
        repairedJobSources,
        repairedTitles: generated.repairedTitles,
        regeneratedDocs: generated.regeneratedDocs,
        skippedDocs: generated.skippedDocs,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
