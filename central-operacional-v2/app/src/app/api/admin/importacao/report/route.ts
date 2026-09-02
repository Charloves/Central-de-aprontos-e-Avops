import { NextResponse } from 'next/server';
import { readSession } from '@/lib/auth/server';
import { SupabaseLegacyImportRepository } from '@/lib/admin/supabase-legacy-import-repository';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await readSession();
  if (!session?.roles.includes('ADMIN')) return failure();

  const batchId = new URL(request.url).searchParams.get('batch') ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batchId)) {
    return failure();
  }

  try {
    const batch = await new SupabaseLegacyImportRepository().findBatch(batchId);
    if (!batch) return failure();
    return new NextResponse(JSON.stringify(batch.report, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="relatorio-importacao-sanitizado.json"',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return failure();
  }
}

function failure() {
  return NextResponse.json({ ok: false, message: 'Não foi possível gerar o relatório.' }, { status: 404 });
}
