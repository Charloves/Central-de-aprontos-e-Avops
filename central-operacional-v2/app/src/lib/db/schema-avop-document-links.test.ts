import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261023142643_repair_avop_document_links.sql'),
  'utf8',
);

describe('AVOP legacy document link repair migration', () => {
  it('reads the preserved legacy document columns and never uses WEBAPP_URL', () => {
    expect(migration).toContain("r.original_content->>'LINK_PDF'");
    expect(migration).toContain("r.original_content->>'PDF_URL'");
    expect(migration).not.toContain("r.original_content->>'WEBAPP_URL'");
  });

  it('updates only imported AVOPs whose current document is invalid', () => {
    expect(migration).toContain("r.source_record_type = 'AVOPS'");
    expect(migration).toContain('r.migrated = true');
    expect(migration).toContain("r.resolved_entity_type = 'avop'");
    expect(migration).toContain('update public.avops a');
    expect(migration).toContain("a.drive_url !~ '^https://drive[.]google[.]com(/|$)'");
    expect(migration).toContain('c.drive_file_id is not null');
  });

  it('accepts only exact HTTPS Google Drive hosts with a recognized file ID', () => {
    expect(migration).toContain("c.drive_url ~ '^https://drive[.]google[.]com(/|$)'");
    expect(migration).not.toContain('(?:');
    expect(migration).toContain("substring(c.drive_url from '/file/d/([^/?#]+)')");
    expect(migration).toContain("substring(c.drive_url from '[?&]id=([^&#]+)')");
  });

  it('fails closed and does not touch unrelated operational objects', () => {
    expect(migration).toContain("raise exception 'imported AVOP document links require manual review'");
    expect(migration).not.toMatch(/\b(delete|truncate|drop)\b/i);
    expect(migration).not.toMatch(/\b(update|insert into)\s+public\.(profiles|briefings|ois|avop_acknowledgements)\b/i);
    expect(migration).not.toMatch(/\b(create|alter)\s+(policy|function|table|type|index)\b/i);
  });
});
