import { companyJsonSchema } from '@/lib/domain/schema';

export async function GET() {
  return new Response(JSON.stringify(companyJsonSchema(), null, 2), {
    headers: { 'content-type': 'application/schema+json', 'content-disposition': 'attachment; filename="company.schema.json"' },
  });
}
