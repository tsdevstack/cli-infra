/**
 * Read every page of an Azure Resource Manager list call
 *
 * ARM returns lists as { value: [...], nextLink }; nextLink is the full URL
 * of the next page.
 */

export async function fetchArmList<T>(
  url: string,
  token: string,
): Promise<T[]> {
  const items: T[] = [];
  let next: string | undefined = url;

  while (next) {
    const response = await fetch(next, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${next.split('?')[0]}`);
    }
    const page = (await response.json()) as { value?: T[]; nextLink?: string };
    items.push(...(page.value ?? []));
    next = page.nextLink;
  }

  return items;
}
