import { eq, inArray, sql } from 'drizzle-orm';
import { schema, type Database } from 'typecho/db';
import {
  buildWordPressMigrationDataset,
  parseWordPressExport,
  type WordPressExport,
  type WordPressMigrationDataset,
} from '../../../scripts/wordpress';

// D1 allows at most 100 bound parameters in each SQL statement.
const MAX_BOUND_PARAMETERS = 100;

export interface WordPressDatabaseWriteMetrics {
  rowsWritten: number;
  statementCount: number;
  batchDurationMs: number;
  sqlDurationMs: number;
}

export type WordPressImportContentType = 'post' | 'page' | 'note';

export function selectWordPressImportItems(
  source: WordPressExport,
  selectedTypes: readonly WordPressImportContentType[],
): WordPressExport {
  const selectedTypeSet = new Set(selectedTypes);
  const selectedItems = source.items.filter(item => selectedTypeSet.has(item.postType as WordPressImportContentType));
  const selectedContentIds = new Set(selectedItems.map(item => item.oldId));
  const referencedAttachmentIds = new Set<number>();

  for (const item of selectedItems) {
    for (const meta of item.postMeta) {
      if (meta.key !== '_thumbnail_id' && meta.key !== 'images' && meta.key !== 'attachment') continue;
      for (const rawId of meta.value.match(/\\d+/g) || []) {
        const id = Number(rawId);
        if (Number.isSafeInteger(id) && id > 0) referencedAttachmentIds.add(id);
      }
    }
  }

  // Keep attachments referenced by selected content, plus attachment children
  // whose WXR parent is selected. Unrelated media and unselected content stay out.
  const selectedItemsWithAttachments = source.items.filter(item =>
    selectedTypeSet.has(item.postType as WordPressImportContentType)
    || (item.postType === 'attachment'
      && (referencedAttachmentIds.has(item.oldId) || selectedContentIds.has(item.parentId))),
  );

  return { ...source, items: selectedItemsWithAttachments };
}

export interface WordPressImportReport {
  siteTitle: string;
  totalItems: number;
  alreadyImported: number;
  imported: Record<string, number>;
  skipped: Record<string, number>;
  databaseWrite?: WordPressDatabaseWriteMetrics;
  preview: boolean;
}

/** Read the per-statement D1 metadata returned by Drizzle's D1 batch adapter. */
export function summarizeD1BatchResults(
  results: unknown[],
  statementCount: number,
  batchDurationMs: number,
): WordPressDatabaseWriteMetrics {
  let rowsWritten = 0;
  let sqlDurationMs = 0;

  for (const result of results) {
    if (!result || typeof result !== 'object') continue;
    const meta = (result as { meta?: { rows_written?: unknown; duration?: unknown } }).meta;
    if (!meta) continue;
    if (typeof meta.rows_written === 'number' && Number.isFinite(meta.rows_written)) {
      rowsWritten += meta.rows_written;
    }
    if (typeof meta.duration === 'number' && Number.isFinite(meta.duration)) {
      sqlDurationMs += meta.duration;
    }
  }

  return {
    rowsWritten,
    statementCount,
    batchDurationMs,
    sqlDurationMs,
  };
}

export function normalizeWordPressSource(siteUrl: string): string {
  const value = siteUrl.trim();
  if (!value) {
    throw new Error('WXR 文件缺少 WordPress 站点地址，无法安全识别重复内容');
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
    url.hostname = url.hostname.toLowerCase();
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error('WXR 文件中的 WordPress 站点地址无效，无法安全识别重复内容');
  }
}

async function buildDataset(
  db: Database,
  source: WordPressExport,
  authorId: number,
  selectedTypes: readonly WordPressImportContentType[],
) {
  const selectedSource = selectWordPressImportItems(source, selectedTypes);
  const sourceKey = normalizeWordPressSource(source.siteUrl);
  const [maxContent, maxComment, maxMeta, slugRows, metaRows, markerRows] = await Promise.all([
    db.select({ value: sql<number>`coalesce(max(${schema.contents.cid}), 0)` }).from(schema.contents),
    db.select({ value: sql<number>`coalesce(max(${schema.comments.coid}), 0)` }).from(schema.comments),
    db.select({ value: sql<number>`coalesce(max(${schema.metas.mid}), 0)` }).from(schema.metas),
    db.select({ slug: schema.contents.slug }).from(schema.contents),
    db.select({ mid: schema.metas.mid, type: schema.metas.type, slug: schema.metas.slug }).from(schema.metas),
    db.select({
      cid: schema.fields.cid,
      name: schema.fields.name,
      id: schema.fields.int_value,
      source: schema.fields.str_value,
    }).from(schema.fields).where(inArray(schema.fields.name, ['wordpress_post_id', 'wordpress_source'])),
  ]);

  const sourceByContentId = new Map<number, string>();
  const wordpressIdByContentId = new Map<number, number>();
  for (const row of markerRows) {
    const cid = Number(row.cid);
    if (row.name === 'wordpress_source') sourceByContentId.set(cid, String(row.source || ''));
    if (row.name === 'wordpress_post_id') wordpressIdByContentId.set(cid, Number(row.id));
  }

  // Keep compatibility with imports made before source-aware markers existed.
  // New imports are deduplicated by the pair (normalized source URL, WP post ID).
  const legacyImportedIds = new Set<number>();
  const importedSourceIds = new Set<string>();
  for (const [cid, oldId] of wordpressIdByContentId) {
    const existingSource = sourceByContentId.get(cid);
    if (existingSource) importedSourceIds.add(`${existingSource}#${oldId}`);
    else legacyImportedIds.add(oldId);
  }

  const pendingItems = selectedSource.items.filter(item =>
    !legacyImportedIds.has(item.oldId) && !importedSourceIds.has(`${sourceKey}#${item.oldId}`),
  );
  const alreadyImported = selectedSource.items.length - pendingItems.length;
  const pendingSource: WordPressExport = { ...selectedSource, items: pendingItems };

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

  // The shared migration builder predates Typecho's native "waiting" state
  // and treats unknown WordPress statuses as publish. Correct each imported
  // post/page from the original WXR status before any database write.
  const sourceItemById = new Map(source.items.map(item => [item.oldId, item]));
  const importedIdByContentId = new Map<number, number>();
  for (const field of dataset.fields) {
    if (field.name === 'wordpress_post_id') {
      importedIdByContentId.set(Number(field.cid), Number(field.int_value));
    }
  }
  for (const content of dataset.contents) {
    const item = sourceItemById.get(importedIdByContentId.get(Number(content.cid)) || 0);
    if (!item) continue;
    const mapped = mapWordPressContentStatus(item.postType, item.status);
    if (mapped) {
      content.type = mapped.type;
      content.status = mapped.status;
    }
    dataset.fields.push({
      cid: Number(content.cid),
      name: 'wordpress:post_type',
      type: 'str',
      str_value: item.postType,
      int_value: 0,
      float_value: 0,
    });
    dataset.fields.push({
      cid: Number(content.cid),
      name: 'wordpress:post_status',
      type: 'str',
      str_value: item.status,
      int_value: 0,
      float_value: 0,
    });
  }

  // Mark each imported content row with its source site. This keeps IDs from
  // unrelated WordPress installations from colliding during later imports.
  for (const marker of dataset.fields.filter(row => row.name === 'wordpress_post_id')) {
    dataset.fields.push({
      cid: Number(marker.cid),
      name: 'wordpress_source',
      type: 'str',
      str_value: sourceKey,
      int_value: 0,
      float_value: 0,
    });
  }

  // WordPress user IDs are not Typecho user IDs. Preserve commenter identity
  // in the author/name fields, but do not falsely associate them with importer.
  for (const comment of dataset.comments) comment.authorId = 0;

  return { dataset, alreadyImported };
}

/**
 * Map WordPress post statuses to Typecho's native content types/statuses.
 * Unknown and trashed content is kept as a draft, never published by default.
 */
export function mapWordPressContentStatus(
  postType: string,
  sourceStatus: string,
): { type: string; status: string } | null {
  if (postType !== 'post' && postType !== 'page') return null;
  const type = postType;
  switch (sourceStatus.trim().toLowerCase()) {
    case 'publish':
      return { type, status: 'publish' };
    case 'pending':
      return { type, status: 'waiting' };
    case 'private':
      return { type, status: 'private' };
    case 'future':
      return { type, status: 'hidden' };
    case 'draft':
    case 'auto-draft':
    case 'trash':
    default:
      return { type: `${type}_draft`, status: 'draft' };
  }
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
  if (rows.length === 0) return statements;

  // Count the union of supplied columns so every multi-row INSERT stays
  // within D1's per-statement bound-parameter limit.
  const columnCount = new Set(rows.flatMap(row => Object.keys(row))).size;
  const chunkSize = Math.max(1, Math.floor(MAX_BOUND_PARAMETERS / columnCount));

  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    statements.push(writer.insert(table).values(rows.slice(offset, offset + chunkSize)));
  }
  return statements;
}

async function writeDataset(
  db: Database,
  dataset: WordPressMigrationDataset,
): Promise<WordPressDatabaseWriteMetrics> {
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
  const startedAt = Date.now();
  const results = statements.length ? await writer.batch(statements) : [];
  return summarizeD1BatchResults(results, statements.length, Date.now() - startedAt);
}

export async function previewWordPressImport(
  db: Database,
  xml: string,
  authorId: number,
  selectedTypes: readonly WordPressImportContentType[] = ['post', 'page', 'note'],
): Promise<WordPressImportReport> {
  const source = parseWordPressExport(xml);
  const selectedSource = selectWordPressImportItems(source, selectedTypes);
  const { dataset, alreadyImported } = await buildDataset(db, source, authorId, selectedTypes);
  return {
    siteTitle: source.siteTitle,
    totalItems: selectedSource.items.length,
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
  selectedTypes: readonly WordPressImportContentType[] = ['post', 'page', 'note'],
): Promise<WordPressImportReport> {
  const source = parseWordPressExport(xml);
  const selectedSource = selectWordPressImportItems(source, selectedTypes);
  const { dataset, alreadyImported } = await buildDataset(db, source, authorId, selectedTypes);
  const databaseWrite = dataset.contents.length
    ? await writeDataset(db, dataset)
    : undefined;

  return {
    siteTitle: source.siteTitle,
    totalItems: selectedSource.items.length,
    alreadyImported,
    imported: dataset.imported,
    skipped: skippedCounts(dataset, alreadyImported),
    ...(databaseWrite ? { databaseWrite } : {}),
    preview: false,
  };
}
