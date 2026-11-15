const respond = ({ clientAddress }: { clientAddress: string }) =>
  Response.json({ clientAddress });

export const GET = respond;
export const POST = respond;
