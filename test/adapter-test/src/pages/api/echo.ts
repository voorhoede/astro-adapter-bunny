export const POST = async ({ request }: { request: Request }) =>
  Response.json({ received: Object.fromEntries(await request.formData()) });
