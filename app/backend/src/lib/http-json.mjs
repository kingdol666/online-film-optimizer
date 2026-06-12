function toServiceError(message, statusCode = 502, code = 'upstream_request_failed') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function requestJson(method, url, payload) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: payload === undefined ? undefined : { 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload)
    });
  } catch (error) {
    throw toServiceError(
      `${method} ${url} unavailable: ${error.message}`,
      503,
      'simulator_unavailable'
    );
  }

  if (!response.ok) {
    let details = '';
    try {
      const data = await response.json();
      details = data?.error ? `: ${data.error}` : '';
    } catch {
      details = '';
    }
    throw toServiceError(
      `${method} ${url} failed: ${response.status}${details}`,
      response.status >= 500 ? 502 : response.status,
      'upstream_request_failed'
    );
  }

  return response.json();
}

export async function getJson(url) {
  return requestJson('GET', url);
}

export async function postJson(url, payload = {}) {
  return requestJson('POST', url, payload);
}
