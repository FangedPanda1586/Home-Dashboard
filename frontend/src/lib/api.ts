export async function atlasFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status === 401 && (response.headers.get("x-xuan-auth-required") === "1" || response.headers.get("x-atlas-auth-required") === "1")) {
    window.dispatchEvent(new CustomEvent("atlas:auth-required"));
  }
  return response;
}
