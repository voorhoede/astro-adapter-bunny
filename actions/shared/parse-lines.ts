// One NAME=value per line; the value may contain = itself.
export const parseLines = (lines: string[]): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const line of lines) {
    const at = line.indexOf("=");
    if (at === -1) {
      continue;
    }
    result[line.slice(0, at).trim()] = line.slice(at + 1);
  }
  return result;
};
