// TODO: move me
interface FetchJsonOptions extends Omit<RequestInit, "body"> {
  body?: RequestInit["body"] | Record<string, unknown>;
  authorization?: string;
}
export const fetchJson = async (url: string, options?: FetchJsonOptions): Promise<any> => {
  const { authorization, ...fetchOptions } = options ?? {};
  const headers: RequestInit["headers"] = {
    ...options?.headers,
    accept: "application/json",
    "content-type": "application/json",
    ...(authorization ? { authorization: `Bearer ${authorization}` } : {}),
  };

  const body = typeof options?.body === "object" ? JSON.stringify(options.body) : options?.body;

  const response = await fetch(url, { ...fetchOptions, body, headers });

  const contentType = response.headers?.get("content-type") ?? "application/json";

  let content: any;

  try {
    if (contentType.includes("json")) {
      content = await response.json();
    } else {
      content = await response.text();
    }
  } catch {}

  if (response.ok) {
    return content;
  }

  throw new Error(
    (typeof content === "string" ? content : content?.message) ||
      response.statusText ||
      "An unknown error ocurred.",
    {
      cause: content,
    },
  );
};
