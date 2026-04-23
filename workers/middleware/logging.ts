// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { MiddlewareHandler } from "hono";
import { Logger, generateRequestId } from "../lib/logger";

/**
 * Request logging middleware implementing the wide events pattern.
 * Emits a single structured log line per request with full context.
 * 
 * Captures:
 * - Request metadata (method, path, query params)
 * - Response metadata (status, duration)
 * - Context (requestId for correlation)
 * - Environment info (if available)
 */
export function requestLogging(): MiddlewareHandler {
	return async (c, next) => {
		const startTime = performance.now();
		const requestId = c.req.header("X-Request-ID") || generateRequestId();
		
		// Set request ID for downstream use
		c.set("requestId", requestId);
		
		// Create request-scoped logger
		const logger = new Logger({
			requestId,
			service: "agentic-inbox",
		});
		
		// Log request start
		const url = new URL(c.req.url);
		const baseFields = {
			requestId,
			method: c.req.method,
			path: url.pathname,
			query: url.search,
			userAgent: c.req.header("User-Agent"),
			referer: c.req.header("Referer"),
			cfRay: c.req.header("CF-Ray"),
		};

		try {
			await next();
			
			const durationMs = Math.round(performance.now() - startTime);
			const status = c.res.status;
			
			// Wide event: single log line with all context
			logger.info("request completed", {
				...baseFields,
				status,
				durationMs,
				responseSize: c.res.headers.get("Content-Length"),
			});
		} catch (err) {
			const durationMs = Math.round(performance.now() - startTime);
			const error = err instanceof Error ? err : new Error(String(err));
			
			// Wide event for errors includes full context
			logger.error("request failed", {
				...baseFields,
				status: 500,
				durationMs,
				error: error.message,
				stack: error.stack,
			});
			
			throw err;
		}
	};
}
