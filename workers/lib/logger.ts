// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Structured logging utility implementing the wide events pattern (canonical log lines).
 * 
 * Core principle: emit a single, context-rich structured event per request per service
 * instead of scattering log lines throughout handlers.
 * 
 * Each wide event includes:
 * - High-cardinality: requestId, userId, mailboxId (millions of unique values)
 * - High-dimensionality: 20-100+ fields per event
 * - Business context: action, success/failure, timing, entity IDs
 * - Environment: commit hash, version, region (set at startup)
 */

import type { Context } from "hono";

/** Log levels - only two: info (normal) and error (needs attention) */
export type LogLevel = "info" | "error";

/** Base fields present in every log entry */
interface BaseLogEntry {
	/** Log level */
	level: LogLevel;
	/** ISO timestamp */
	timestamp: string;
	/** Request ID for tracing */
	requestId: string;
	/** Worker version - set at startup */
	version?: string;
}

/** Wide event for API requests */
export interface RequestLogEntry extends BaseLogEntry {
	/** Event type identifier */
	event: "http_request";
	/** HTTP method */
	method: string;
	/** Request path */
	path: string;
	/** Response status code */
	status: number;
	/** Request duration in milliseconds */
	durationMs: number;
	/** User agent string */
	userAgent?: string;
	/** Referer header */
	referer?: string;
	/** Error message if request failed */
	error?: string;
	/** Error stack trace if available */
	stack?: string;
	/** Mailbox ID for mailbox-scoped requests */
	mailboxId?: string;
	/** Email ID for email-scoped operations */
	emailId?: string;
	/** Thread ID for thread-scoped operations */
	threadId?: string;
	/* Additional custom fields */
	[key: string]: unknown;
}

/** Wide event for email operations */
export interface EmailLogEntry extends BaseLogEntry {
	/** Event type identifier */
	event: "email_operation";
	/** Operation type: receive, send, draft, forward, reply */
	operation: "receive" | "send" | "draft" | "forward" | "reply";
	/** Success indicator */
	success: boolean;
	/** Duration in milliseconds */
	durationMs: number;
	/** Mailbox ID */
	mailboxId: string;
	/** Email ID */
	emailId: string;
	/** Thread ID */
	threadId?: string;
	/** Sender address */
	sender?: string;
	/** Recipient address(es) */
	recipient?: string;
	/** Email subject */
	subject?: string;
	/** Error message if operation failed */
	error?: string;
	/** Additional fields for operation-specific context */
	[key: string]: unknown;
}

/** Wide event for AI operations */
export interface AILogEntry extends BaseLogEntry {
	/** Event type identifier */
	event: "ai_operation";
	/** Operation type */
	operation: "prompt_injection_scan" | "draft_verify" | "generate_draft";
	/** Success indicator */
	success: boolean;
	/** Duration in milliseconds */
	durationMs: number;
	/** Mailbox ID if applicable */
	mailboxId?: string;
	/** Email ID being processed */
	emailId?: string;
	/** Thread ID being processed */
	threadId?: string;
	/** Result details */
	result?: string;
	/** Error message if operation failed */
	error?: string;
}

/** Wide event for Durable Object operations */
export interface DOOperationLogEntry extends BaseLogEntry {
	/** Event type identifier */
	event: "do_operation";
	/** Durable Object name */
	doName: string;
	/** Operation type */
	operation: string;
	/** Success indicator */
	success: boolean;
	/** Duration in milliseconds */
	durationMs: number;
	/** Mailbox ID if applicable */
	mailboxId?: string;
	/** Error message if operation failed */
	error?: string;
}

/** Union of all log entry types */
export type LogEntry =
	| RequestLogEntry
	| EmailLogEntry
	| AILogEntry
	| DOOperationLogEntry;

/**
 * Logger instance for a request context.
 * Emits structured JSON logs with requestId for correlation.
 */
export class Logger {
	private baseFields: Partial<BaseLogEntry>;

	/**
	 * Create a new logger with base fields that will be included in every log entry.
	 */
	constructor(
		requestId: string,
		version: string = (globalThis as unknown as Record<string, string | undefined>).WRANGLER_VERSION ||
			"unknown",
	) {
		this.baseFields = {
			requestId,
			version,
		};
	}

	/**
	 * Emit a structured log entry.
	 */
	log(entry: Omit<LogEntry, "level" | "timestamp" | "requestId" | "version"> & { level?: LogLevel }): void {
		const fullEntry: LogEntry = {
			...this.baseFields,
			level: entry.level ?? "info",
			timestamp: new Date().toISOString(),
			...entry,
		} as LogEntry;

		// Emit as JSON - console.log in Cloudflare Workers goes to logpush/logs
		const json = JSON.stringify(fullEntry);
		if (fullEntry.level === "error") {
			console.error(json);
		} else {
			console.log(json);
		}
	}

	/**
	 * Log request completion - the primary wide event for HTTP requests.
	 */
	logRequest(entry: Omit<RequestLogEntry, "event" | "level" | "timestamp" | "requestId" | "version">): void {
		this.log({
			event: "http_request",
			level: entry.status >= 500 ? "error" : "info",
			...entry,
		});
	}

	/**
	 * Log email operation completion.
	 */
	logEmailOperation(entry: Omit<EmailLogEntry, "event" | "level" | "timestamp" | "requestId" | "version">): void {
		this.log({
			event: "email_operation",
			level: entry.success ? "info" : "error",
			...entry,
		});
	}

	/**
	 * Log AI operation completion.
	 */
	logAIOperation(entry: Omit<AILogEntry, "event" | "level" | "timestamp" | "requestId" | "version">): void {
		this.log({
			event: "ai_operation",
			level: entry.success ? "info" : "error",
			...entry,
		});
	}

	/**
	 * Log Durable Object operation completion.
	 */
	logDOOperation(entry: Omit<DOOperationLogEntry, "event" | "level" | "timestamp" | "requestId" | "version">): void {
		this.log({
			event: "do_operation",
			level: entry.success ? "info" : "error",
			...entry,
		});
	}
}

/**
 * Generate a unique request ID.
 */
export function generateRequestId(): string {
	return crypto.randomUUID();
}

/**
 * Extract request ID from headers or generate a new one.
 */
export function getRequestId(c: Context): string {
	const headerValue = c.req.header("x-request-id");
	return headerValue ?? generateRequestId();
}

/**
 * Create a logger middleware for Hono that:
 * - Generates/propagates request ID
 * - Tracks request timing
 * - Emits wide event on completion
 */
export function createLoggerMiddleware(options?: { version?: string }) {
	return async (c: Context, next: () => Promise<void>) => {
		const startTime = performance.now();
		const requestId = getRequestId(c);

		// Set request ID on response header for client correlation
		c.header("x-request-id", requestId);

		// Create logger instance
		const logger = new Logger(requestId, options?.version);

		// Attach to context for handlers to use
		c.set("logger", logger);
		c.set("requestId", requestId);

		try {
			await next();
		} finally {
			const durationMs = Math.round(performance.now() - startTime);
			const status = c.res.status;

			// Extract mailboxId from path if present
			const path = c.req.path;
			const mailboxMatch = path.match(/\/api\/v1\/mailboxes\/([^\/]+)/);
			const mailboxId = mailboxMatch ? mailboxMatch[1] : undefined;

			// Get emailId from path if present
			const emailMatch = path.match(/\/emails\/([^\/]+)/);
			const emailId = emailMatch ? emailMatch[1] : undefined;

			// Get threadId from path if present
			const threadMatch = path.match(/\/threads\/([^\/]+)/);
			const threadId = threadMatch ? threadMatch[1] : undefined;

			// Log the wide event
			logger.logRequest({
				method: c.req.method,
				path,
				status,
				durationMs,
				userAgent: c.req.header("user-agent"),
				referer: c.req.header("referer"),
				mailboxId,
				emailId,
				threadId,
			});
		}
	};
}

/**
 * Type augmentation for Hono context to include logger.
 */
declare module "hono" {
	interface ContextVariableMap {
		logger: Logger;
		requestId: string;
	}
}

export default Logger;
