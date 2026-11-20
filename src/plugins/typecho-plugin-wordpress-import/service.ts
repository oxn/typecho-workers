import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema, type Database } from 'typecho/db';
import {
  buildWordPressMigrationDataset,
  parseWordPressExport,
  type WordPressExport,
  type WordPressMigrationDataset,
} from '../../../scripts/wordpress';

const INSERT_CHUNK_SIZE = 40;

export interface WordPressImportReport {
  siteTitle: string;
  totalItems: number;
  alreadyImported: number;
  imported: Record<string, number>;
  skipped: Record<string, number>;
  preview: boolean;
}

async function buildDataset(db: Database, source: WordPressExport, authorId: number) {
  const [maxContent, maxComment, maxMeta, slugRows, metaRows, markerRows] = await Promise.all([
    db.select({ value: sql<number>`coalesce(max(${schema.contents.cid}), 0)` }).from(schema.contents),
    db.select({ value: sql<number>`coalesce(max(${schema.comments.coid}), 0)` }).from(schema.comments),
    db.select({ value: sql<number>`coalesce(max(${schema.metas.mid}), 0)` }).from(schema.metas),
    db.select({ slug: schema.contents.slug }).from(schema.contents),
    db.select({ mid: schema.metas.mid, type: schema.metas.type, slug: schema.metas.slug }).from(schema.metas),
    db.select({ id: schema.fields.int_value }).from(schema.fields).where(eq(schema.fields.name, 'wordpress_post_id')),
  ]);

  const importedIds = new Set(markerRows.map(row => Number(row.id)).filter(id => id > 0));
  const pendingItems = source.items.filter(item => !importedIds.has(item.oldId));
  const alreadyImported = source.items.length - pendingItems.length;
  const pendingSource: WordPressExport = { ...source, items: pendingItems };

  const dataset = buildWordPressMigrationDataset(pendingSource, {
    maxContentId: Number(maxContent[0]?.value || 0),
    maxCommentId: Number(maxComment[0]?.value || 0),
    maxMetaId: Number(maxMeta[0]?.value || 0),
    contentSlugs: slugRows.map(row => row.slug || '').filter(Boolean),
    metas: metaRows.filter(row => row.slug).map(row => ({
      mid: row.mid,
      type: row.type,
      slug: row.slug!,
    })),
  }, {
    authorId,
    includeAttachments: true,
    siteUrl: '',
    rewriteMedia: false,
  });

  return { dataset, alreadyImported };
}

function countSkipped(dataset: WordPressMigrationDataset, alreadyImported: number) {
  return {
    ...dataset.skipped,
    ...(alreadyImported ? { alreadyImported } : {}),
  };
}

export async function previewWordPressImport(
  db: Database,
  xml: string,
  authorId: number,
): Promise<WordPressImportReport> {
  const source = parseWordPressExport(xml);
  const { dataset, alreadyImported } = await buildDataset(db, source, authorId);
  return {
    siteTitle: source.siteTitle,
    totalItems: source.items.length,
    alreadyImported,
    imported: dataset.imported,
    skipped: countSkipped(dataset, alreadyImported),
    preview: true,
  };
}

async function insertRows(db: Database, table: unknown, rows: Record<string, unknown>[]) {
  const writer = db as any;
  for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_SIZE) {
    await writer.insert(table).values(rows.slice(offset, offset + INSERT_CHUNK_SIZE)).run();
  }
}

export async function importWordPressExport(
  db: Database,
  xml: string,
  authorId: number,
): Promise<WordPressImportReport> {
  const source = parseWordPressExport(xml);
  const { dataset, alreadyImported } = await buildDataset(db, source, authorId);

  if (dataset.contents.length === 0) {
    return {
      siteTitle: source.siteTitle,
      totalItems: source.items.length,
      alreadyImported,
      imported: dataset.imported,
      skipped: countSkipped(dataset, alreadyImported),
      preview: false,
    };
  }

  // Keep the same dependency order as the CLI migrator. The WordPress ID marker
  // is stored with each content row so a repeated WXR upload skips those rows.
  await insertRows(db, schema.metas, dataset.metas);
  await insertRows(db, schema.contents, dataset.contents);
  await insertRows(db, schema.fields, dataset.fields);
  await insertRows(db, schema.relationships, dataset.relationships);
  await insertRows(db, schema.comments, dataset.comments);

  for (const mid of dataset.affectedMetaIds) {
    await db.update(schema.metas)
      .set({ count: sql`(SELECT COUNT(*) FROM ${schema.relationships} WHERE ${schema.relationships.mid} = ${mid})` })
      .where(eq(schema.metas.mid, mid));
  }

  return {
    siteTitle: source.siteTitle,
    totalItems: source.items.length,
    alreadyImported,
    imported: dataset.imported,
    skipped: countSkipped(dataset, alreadyImported),
    preview: false,
  };
}
