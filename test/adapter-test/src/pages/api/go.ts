export const GET = ({
  redirect,
}: {
  redirect: (path: string, status?: 301 | 302 | 307 | 308) => Response;
}) => redirect('/about', 302);
