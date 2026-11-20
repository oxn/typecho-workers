import { eq, sql } from 'drizzle-orm';
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

function skippedCounts(dataset: WordPressMigrationDataset, alreadyImported: number) {
  return {
    ...dataset.skipped,
    ...(alreadyImported ? { alreadyImported } : {}),
  };
}

function insertStatements(db: Database, table: unknown, rows: Record<string, unknown>[]) {
  const writer = db as any;
  const statements: unknown[] = [];
  for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_SIZE) {
    statements.push(writer.insert(table).values(rows.slice(offset, offset + INSERT_CHUNK_SIZE)));
  }
  return statements;
}

async function writeDataset(db: Database, dataset: WordPressMigrationDataset): Promise<void> {
  const writer = db as any;
  const statements = [
    ...insertStatements(db, schema.metas, dataset.metas),
    ...insertStatements(db, schema.contents, dataset.contents),
    ...insertStatements(db, schema.fields, dataset.fields),
    ...insertStatements(db, schema.relationships, dataset.relationships),
    ...insertStatements(db, schema.comments, dataset.comments),
    ...dataset.affectedMetaIds.map(mid => writer.update(schema.metas)
      .set({ count: sql`(SELECT COUNT(*) FROM ${schema.relationships} WHERE ${schema.relationships.mid} = ${mid})` })
      .where(eq(schema.metas.mid, mid))),
  ];

  // D1 batch executes the ordered statements transactionally. A failed write
  // cannot leave an incomplete set of imported content and relationships.
  if (statements.length) await writer.batch(statements);
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
    skipped: skippedCounts(dataset, alreadyImported),
    preview: true,
  };
}

export async function importWordPressExport(
  db: Database,
  xml: string,
  authorId: number,
): Promise<WordPressImportReport> {
  const source = parseWordPressExport(xml);
  const { dataset, alreadyImported } = await buildDataset(db, source, authorId);
  if (dataset.contents.length) await writeDataset(db, dataset);

  return {
    siteTitle: source.siteTitle,
    totalItems: source.items.length,
    alreadyImported,
    imported: dataset.imported,
    skipped: skippedCounts(dataset, alreadyImported),
    preview: false,
  };
}
