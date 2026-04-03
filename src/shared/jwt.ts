// ============================================================
// JWT sign/verify using Web Crypto API (HMAC-SHA256)
//
// Token lifecycle:
//   1. DO releases visitor from queue
//   2. sign() creates JWT with visitor_id, event_id, expiry
//   3. Token sent to client via WebSocket "released" message
//   4. Client stores token in cookie
//   5. Gateway calls verify() on each request
//   6. Valid → proxy to origin. Invalid → redirect to queue.
//
// Token format (standard JWT):
//   header.payload.signature
//   │       │         │
//   │       │         └── HMAC-SHA256(header.payload, secret)
//   │       └── base64url({ sub, evt, iat, exp, pos })
//   └── base64url({ alg: "HS256", typ: "JWT" })
// ============================================================

/** JWT payload claims for queue access tokens */
export interface QueueTokenClaims {
  /** Subject: unique visitor ID */
  sub: string;
  /** Event ID this token grants access to */
  evt: string;
  /** Issued at (Unix timestamp seconds) */
  iat: number;
  /** Expires at (Unix timestamp seconds) */
  exp: number;
  /** Queue position when released (for audit) */
  pos: number;
}

const JWT_HEADER = { alg: "HS256", typ: "JWT" };
const HEADER_B64 = base64UrlEncode(JSON.stringify(JWT_HEADER));

// ── Encoding helpers ──

function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  return base64UrlEncodeBytes(bytes);
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): string {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

// ── Crypto helpers ──

async function importKey(secret: string): Promise<CryptoKey> {
  const keyData = new TextEncoder().encode(secret);
  return crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function hmacSign(data: string, key: CryptoKey): Promise<string> {
  const dataBytes = new TextEncoder().encode(data);
  const signature = await crypto.subtle.sign("HMAC", key, dataBytes);
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

async function hmacVerify(data: string, signature: string, key: CryptoKey): Promise<boolean> {
  const dataBytes = new TextEncoder().encode(data);

  // Decode the signature from base64url
  const sigPadded = signature.replace(/-/g, "+").replace(/_/g, "/");
  const sigBinary = atob(sigPadded);
  const sigBytes = new Uint8Array(sigBinary.length);
  for (let i = 0; i < sigBinary.length; i++) {
    sigBytes[i] = sigBinary.charCodeAt(i);
  }

  return crypto.subtle.verify("HMAC", key, sigBytes, dataBytes);
}

// ── Public API ──

/**
 * Sign a JWT token with HMAC-SHA256.
 *
 * @param claims - Token payload claims
 * @param secret - HMAC signing secret
 * @returns Signed JWT string (header.payload.signature)
 */
export async function signToken(claims: QueueTokenClaims, secret: string): Promise<string> {
  const payload = base64UrlEncode(JSON.stringify(claims));
  const signingInput = `${HEADER_B64}.${payload}`;
  const key = await importKey(secret);
  const signature = await hmacSign(signingInput, key);
  return `${signingInput}.${signature}`;
}

/**
 * Verify and decode a JWT token.
 *
 * @param token - JWT string to verify
 * @param secret - HMAC signing secret
 * @returns Decoded claims if valid
 * @throws TokenParseError if token is malformed
 * @throws TokenSignatureError if signature is invalid
 * @throws TokenExpiredError if token is expired (past grace period)
 */
export async function verifyToken(
  token: string,
  secret: string,
  gracePeriodSeconds = 0,
): Promise<QueueTokenClaims> {
  // Parse the three JWT segments
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new (await import("./errors.js")).TokenParseError("Expected 3 segments, got " + parts.length);
  }

  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  // Verify signature
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await importKey(secret);
  const isValid = await hmacVerify(signingInput, signatureB64, key);

  if (!isValid) {
    throw new (await import("./errors.js")).TokenSignatureError();
  }

  // Decode and parse payload
  let claims: QueueTokenClaims;
  try {
    const payloadJson = base64UrlDecode(payloadB64);
    claims = JSON.parse(payloadJson) as QueueTokenClaims;
  } catch {
    throw new (await import("./errors.js")).TokenParseError("Invalid payload JSON");
  }

  // Validate required fields
  if (!claims.sub || !claims.evt || !claims.iat || !claims.exp) {
    throw new (await import("./errors.js")).TokenParseError("Missing required claims (sub, evt, iat, exp)");
  }

  // Check expiry
  const now = Math.floor(Date.now() / 1000);
  if (now > claims.exp + gracePeriodSeconds) {
    throw new (await import("./errors.js")).TokenExpiredError(claims.exp);
  }

  return claims;
}
