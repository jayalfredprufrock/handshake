export type FetchMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | (string & {});

export interface ErrorContext {
  request: Request;
  response: Response;
  attempt: number;
  options: FetchOptions;
  data: unknown;
}

export interface RetryOptions {
  delay?: number | number[];
  attempts?: number;
  jitter?: number;
}

export type FetchRetryFunc = (ctx: ErrorContext) => Promise<boolean | FetchOptions>;

export interface DefaultFetchOptions extends Omit<RequestInit, "headers" | "body"> {
  baseUrl?: string | URL;
  headers?: Record<string, string | number | undefined>;
  handleError?: (ctx: ErrorContext) => void;
  retry?: boolean | RetryOptions | FetchRetryFunc;
}

export interface FetchOptions extends DefaultFetchOptions {
  body?: Record<string, unknown>;
  query?: Record<string, string | number | undefined>;
  method?: FetchMethod;
}

// TODO: rename this since it casts values to string too??
const removeUndefined = <T>(obj: Record<string, T>): Record<string, string> => {
  return Object.fromEntries(
    Object.entries(obj).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])),
  ) as never;
};

// TODO: errors below shouldnt get swallowed,
// especially need to catch network-level fetch errors

export type MakeFetchFn = ReturnType<typeof makeFetch>;

export const makeFetch = (
  fetch: any,
  defaultFetchOptionsOrFunc?: DefaultFetchOptions | (() => Promise<DefaultFetchOptions>),
) => {
  const apiFetch = async (
    fetchUrl: string | URL,
    fetchOptions?: FetchOptions,
    attempt = 1,
  ): Promise<any> => {
    // resolve dynamic/async options
    const defaultFetchOptions =
      typeof defaultFetchOptionsOrFunc === "function"
        ? await defaultFetchOptionsOrFunc()
        : defaultFetchOptionsOrFunc;

    const options = { ...defaultFetchOptions, ...fetchOptions };
    const { baseUrl, retry, body, query, ...otherFetchOptions } = options;

    // merge headers separately
    const resolvedHeaders = removeUndefined({
      ...defaultFetchOptions?.headers,
      ...fetchOptions?.headers,
    });

    if (body) {
      resolvedHeaders["content-type"] = "application/json";
    }

    const url = new URL(fetchUrl, baseUrl);

    if (query) {
      for (const [key, value] of Object.entries(removeUndefined(query))) {
        url.searchParams.append(key, value);
      }
    }

    const request = new Request(url, {
      ...otherFetchOptions,
      body: options?.body ? JSON.stringify(options.body) : undefined,
      headers: resolvedHeaders,
    });

    const response: Response = await fetch(request);

    const contentType = response.headers?.get("content-type");

    let responseTextOrJson: any = await response.text();

    if (responseTextOrJson && !contentType?.includes("text")) {
      try {
        responseTextOrJson = JSON.parse(responseTextOrJson);
      } catch {}
    }

    if (response.ok) {
      return responseTextOrJson;
    }

    const errorContext = { request, response, options, attempt, data: responseTextOrJson };

    if (typeof retry === "function") {
      const shouldRetryOrOptions = await retry(errorContext);
      if (shouldRetryOrOptions) {
        return apiFetch(
          fetchUrl,
          typeof shouldRetryOrOptions === "object"
            ? { ...fetchOptions, ...shouldRetryOrOptions }
            : fetchOptions,
          attempt + 1,
        );
      }
    }

    if (options.handleError) {
      options.handleError(errorContext);
    } else {
      throw new FetchError(errorContext);
    }
  };

  return apiFetch;
};

export class FetchError extends Error {
  readonly request: Request;
  readonly response: Response;
  readonly attempt: number;
  readonly options: FetchOptions;
  readonly data: any;

  constructor(ctx: ErrorContext) {
    super(
      `[${ctx.request.method}] ${ctx.request.url} failed with status code ${ctx.response.status}`,
    );
    this.request = ctx.request;
    this.response = ctx.response;
    this.attempt = ctx.attempt;
    this.options = ctx.options;
    this.data = ctx.data;
  }
}
